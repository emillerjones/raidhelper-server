import crypto from "node:crypto";
import { parse } from "csv-parse/sync";

const MAX_ROWS = 25_000;

const HEADER_ALIASES = {
  orders: {
    orderId: ["orderid", "ordernumber", "order"],
    sku: ["sku", "productsku", "itemsku", "itemcode"],
    productName: ["product", "productname", "itemname", "description"],
    quantity: ["qty", "quantity", "unitssold", "units"],
    revenue: ["revenue", "sales", "total", "linetotal", "amount"],
  },
  warehouse: {
    itemCode: ["itemcode", "sku", "productsku", "stockcode"],
    onHand: ["onhand", "quantityonhand", "stock", "inventory", "available"],
    location: ["location", "warehouse", "bin", "warehousecode"],
  },
  returns: {
    rma: ["rma", "rmaid", "returnid", "returnnumber"],
    sku: ["sku", "productsku", "itemsku", "itemcode"],
    reason: ["reason", "returnreason", "notes"],
    units: ["units", "qty", "quantity", "returnedunits"],
  },
};

const TYPE_SIGNATURES = {
  orders: ["orderId", "sku", "revenue"],
  warehouse: ["itemCode", "onHand", "location"],
  returns: ["rma", "sku", "units"],
};

function normalizeHeader(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function normalizeSku(value) {
  const text = String(value ?? "").trim().toUpperCase();
  if (!text) return null;

  const compact = text.replace(/[\s_-]+/g, "-");
  const digitsOnly = compact.match(/^0*(\d+)$/);
  if (digitsOnly) return `SMR-${digitsOnly[1]}`;

  const smr = compact.match(/^SMR-?0*(\d+)$/);
  if (smr) return `SMR-${smr[1]}`;

  return compact;
}

function mapHeaders(headers, type) {
  const normalizedHeaders = headers.map(normalizeHeader);
  const mapping = {};

  for (const [field, aliases] of Object.entries(HEADER_ALIASES[type])) {
    const index = normalizedHeaders.findIndex((header) => aliases.includes(header));
    if (index !== -1) mapping[field] = index;
  }

  return mapping;
}

function detectFileType(headers) {
  const candidates = Object.keys(TYPE_SIGNATURES).filter((type) => {
    const mapping = mapHeaders(headers, type);
    return TYPE_SIGNATURES[type].every((field) => mapping[field] !== undefined);
  });

  if (candidates.length !== 1) {
    throw new Error(
      candidates.length === 0
        ? "The CSV headers do not match the orders, warehouse, or returns format."
        : "The CSV headers match more than one file type. Please make the headers more specific."
    );
  }

  return { type: candidates[0], mapping: mapHeaders(headers, candidates[0]) };
}

function optionalText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function parseInteger(value, fieldLabel, { required = false } = {}) {
  const text = optionalText(value);
  if (text === null) {
    return required
      ? { value: null, error: `${fieldLabel} is required` }
      : { value: null, warning: `${fieldLabel} is blank` };
  }

  const parsed = Number(text.replace(/,/g, ""));
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { value: null, error: `${fieldLabel} must be a non-negative whole number` };
  }
  return { value: parsed };
}

function parseMoney(value) {
  const text = optionalText(value);
  if (text === null) return { value: null, warning: "Revenue is blank" };

  const negative = /^\(.*\)$/.test(text);
  const cleaned = text.replace(/[$,()\s]/g, "");
  const parsed = Number(cleaned) * (negative ? -1 : 1);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { value: null, error: "Revenue must be a non-negative amount" };
  }
  return { value: Math.round((parsed + Number.EPSILON) * 100) / 100 };
}

function rawObject(headers, values) {
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
}

function addResultIssue(result, errors, warnings) {
  if (result.error) errors.push(result.error);
  if (result.warning) warnings.push(result.warning);
}

function parseOrderRow(values, headers, mapping, rowNumber, seen) {
  const errors = [];
  const warnings = [];
  const orderId = optionalText(values[mapping.orderId]);
  const originalSku = optionalText(values[mapping.sku]);
  const normalizedSku = normalizeSku(originalSku);
  const quantity = parseInteger(values[mapping.quantity], "Quantity");
  const revenue = parseMoney(values[mapping.revenue]);

  if (!orderId) errors.push("Order ID is required");
  if (!normalizedSku) errors.push("SKU is required");
  if (!optionalText(values[mapping.productName])) warnings.push("Product name is blank");
  addResultIssue(quantity, errors, warnings);
  addResultIssue(revenue, errors, warnings);

  const duplicateKey = orderId?.toUpperCase() || null;
  const isDuplicate = duplicateKey ? seen.has(duplicateKey) : false;
  if (isDuplicate) errors.push("Duplicate order ID in this file");
  if (duplicateKey) seen.add(duplicateKey);

  return {
    rowNumber,
    orderId,
    originalSku,
    normalizedSku,
    productName: optionalText(values[mapping.productName]),
    quantity: quantity.value,
    revenue: revenue.value,
    rawData: rawObject(headers, values),
    errors,
    warnings,
    isDuplicate,
    isValid: errors.length === 0,
  };
}

function parseWarehouseRow(values, headers, mapping, rowNumber, seen) {
  const errors = [];
  const warnings = [];
  const originalItemCode = optionalText(values[mapping.itemCode]);
  const normalizedSku = normalizeSku(originalItemCode);
  const location = optionalText(values[mapping.location]);
  const onHand = parseInteger(values[mapping.onHand], "On-hand quantity");

  if (!normalizedSku) errors.push("Item code is required");
  if (!location) errors.push("Location is required");
  addResultIssue(onHand, errors, warnings);

  const duplicateKey = normalizedSku && location
    ? `${normalizedSku}|${location.toUpperCase()}`
    : null;
  const isDuplicate = duplicateKey ? seen.has(duplicateKey) : false;
  if (isDuplicate) errors.push("Duplicate SKU and location in this file");
  if (duplicateKey) seen.add(duplicateKey);

  return {
    rowNumber,
    originalItemCode,
    normalizedSku,
    onHand: onHand.value,
    location,
    rawData: rawObject(headers, values),
    errors,
    warnings,
    isDuplicate,
    isValid: errors.length === 0,
  };
}

function parseReturnRow(values, headers, mapping, rowNumber, seen) {
  const errors = [];
  const warnings = [];
  const rma = optionalText(values[mapping.rma]);
  const originalSku = optionalText(values[mapping.sku]);
  const normalizedSku = normalizeSku(originalSku);
  const units = parseInteger(values[mapping.units], "Returned units", { required: true });

  if (!rma) errors.push("RMA is required");
  if (!normalizedSku) errors.push("SKU is required");
  if (!optionalText(values[mapping.reason])) warnings.push("Return reason is blank");
  addResultIssue(units, errors, warnings);

  const duplicateKey = rma?.toUpperCase() || null;
  const isDuplicate = duplicateKey ? seen.has(duplicateKey) : false;
  if (isDuplicate) errors.push("Duplicate RMA in this file");
  if (duplicateKey) seen.add(duplicateKey);

  return {
    rowNumber,
    rma,
    originalSku,
    normalizedSku,
    reason: optionalText(values[mapping.reason]),
    units: units.value,
    rawData: rawObject(headers, values),
    errors,
    warnings,
    isDuplicate,
    isValid: errors.length === 0,
  };
}

export function parseSmartishCsv(buffer) {
  const records = parse(buffer, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  });

  if (records.length < 2) throw new Error("The CSV must contain headers and at least one data row.");
  if (records.length - 1 > MAX_ROWS) throw new Error(`The CSV exceeds the ${MAX_ROWS.toLocaleString()} row limit.`);

  const headers = records[0].map((header) => String(header).trim());
  if (headers.some((header) => !header)) throw new Error("Every CSV column must have a header.");

  const { type, mapping } = detectFileType(headers);
  const seen = new Set();
  const parser = {
    orders: parseOrderRow,
    warehouse: parseWarehouseRow,
    returns: parseReturnRow,
  }[type];

  const rows = records.slice(1).map((values, index) =>
    parser(values, headers, mapping, index + 2, seen)
  );

  return {
    type,
    headers,
    rows,
    fileHash: crypto.createHash("sha256").update(buffer).digest("hex"),
    counts: {
      total: rows.length,
      valid: rows.filter((row) => row.isValid).length,
      invalid: rows.filter((row) => !row.isValid).length,
      warnings: rows.filter((row) => row.warnings.length > 0).length,
      duplicates: rows.filter((row) => row.isDuplicate).length,
    },
  };
}

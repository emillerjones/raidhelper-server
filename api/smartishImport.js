import express from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import {
  commitBatch,
  createBatch,
  getBatch,
  getReport,
  isValidSmartishAccessKey,
  listBatches,
  removeUploadedFile,
  saveUploadedFile,
} from "../db/smartishImport.js";
import { parseSmartishCsv } from "../services/smartishCsv.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const looksLikeCsv = file.originalname.toLowerCase().endsWith(".csv") ||
      ["text/csv", "application/csv", "application/vnd.ms-excel"].includes(file.mimetype);
    callback(looksLikeCsv ? null : new Error("Only CSV files are accepted"), looksLikeCsv);
  },
});

const attempts = new Map();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 10;

function clientIp(req) {
  return req.get("x-forwarded-for")?.split(",")[0]?.trim() || req.ip || "unknown";
}

async function requireAccessKey(req, res, next) {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = attempts.get(ip);
  if (entry && entry.expiresAt > now && entry.count >= MAX_FAILED_ATTEMPTS) {
    return res.status(429).json({ error: "Too many incorrect access-key attempts. Try again later." });
  }

  try {
    if (await isValidSmartishAccessKey(req.get("x-smartish-access-key"))) {
      attempts.delete(ip);
      return next();
    }
    const current = entry && entry.expiresAt > now ? entry : { count: 0, expiresAt: now + ATTEMPT_WINDOW_MS };
    current.count += 1;
    attempts.set(ip, current);
    return res.status(401).json({ error: "The Smartish access key is incorrect." });
  } catch (error) {
    next(error);
  }
}

router.use(requireAccessKey);

router.get("/batches", async (_req, res, next) => {
  try {
    res.json({ batches: await listBatches() });
  } catch (error) {
    next(error);
  }
});

router.post("/batches", async (req, res, next) => {
  const batchName = typeof req.body?.batchName === "string" ? req.body.batchName.trim().slice(0, 120) : "";
  const createdBy = typeof req.body?.createdBy === "string" ? req.body.createdBy.trim().slice(0, 120) : null;
  if (!batchName) return res.status(400).json({ error: "Batch name is required." });

  try {
    res.status(201).json({ batch: await createBatch({ batchName, createdBy: createdBy || null }) });
  } catch (error) {
    next(error);
  }
});

router.get("/batches/:batchId", async (req, res, next) => {
  try {
    const batch = await getBatch(Number(req.params.batchId));
    if (!batch) return res.status(404).json({ error: "Import batch not found." });
    res.json({ batch });
  } catch (error) {
    next(error);
  }
});

router.post("/batches/:batchId/files", upload.single("file"), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: "Choose a CSV file to upload." });

  try {
    const parsed = parseSmartishCsv(req.file.buffer);
    const expectedType = req.body?.expectedType;
    if (expectedType && parsed.type !== expectedType) {
      return res.status(400).json({
        error: `That looks like a ${parsed.type} file. Upload it in the ${parsed.type} slot.`
      });
    }
    const batch = await saveUploadedFile({
      batchId: Number(req.params.batchId),
      filename: req.file.originalname.slice(0, 255),
      size: req.file.size,
      parsed,
    });
    res.status(201).json({ batch, detectedType: parsed.type });
  } catch (error) {
    if (error.code === "CSV_INVALID_CLOSING_QUOTE" || error.code === "CSV_QUOTE_NOT_CLOSED") {
      error.status = 400;
      error.message = "The CSV contains malformed quoted text.";
    }
    next(error);
  }
});

router.delete("/batches/:batchId/files/:fileType", async (req, res, next) => {
  if (!["orders", "warehouse", "returns"].includes(req.params.fileType)) {
    return res.status(400).json({ error: "Unknown file type." });
  }
  try {
    const removed = await removeUploadedFile({
      batchId: Number(req.params.batchId),
      fileType: req.params.fileType,
    });
    if (!removed) return res.status(404).json({ error: "Draft file not found." });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post("/batches/:batchId/commit", async (req, res, next) => {
  try {
    res.json({ batch: await commitBatch(Number(req.params.batchId)) });
  } catch (error) {
    next(error);
  }
});

router.get("/batches/:batchId/report", async (req, res, next) => {
  try {
    const rows = await getReport(Number(req.params.batchId));
    res.json({ rows });
  } catch (error) {
    next(error);
  }
});

router.get("/batches/:batchId/report.xlsx", async (req, res, next) => {
  try {
    const batchId = Number(req.params.batchId);
    const batch = await getBatch(batchId);
    if (!batch || batch.status !== "completed") {
      return res.status(409).json({ error: "Complete the batch before generating its report." });
    }
    const rows = await getReport(batchId);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Smartish Import";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("SKU Summary", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = [
      { header: "SKU", key: "sku", width: 18 },
      { header: "Product", key: "product_name", width: 34 },
      { header: "Orders", key: "order_count", width: 12 },
      { header: "Units Ordered", key: "units_ordered", width: 16 },
      { header: "Revenue", key: "revenue", width: 14, style: { numFmt: "$#,##0.00" } },
      { header: "On Hand", key: "on_hand", width: 14 },
      { header: "Locations", key: "locations", width: 24 },
      { header: "Returns", key: "return_count", width: 12 },
      { header: "Units Returned", key: "units_returned", width: 17 },
    ];
    rows.forEach((row) => sheet.addRow({
      ...row,
      revenue: row.revenue === null ? null : Number(row.revenue),
    }));
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF173F3A" } };
    sheet.autoFilter = { from: "A1", to: "I1" };
    sheet.eachRow((row) => { row.alignment = { vertical: "middle" }; });

    const safeName = batch.batch_name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName || `batch-${batchId}`}-report.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
});

// Keep Smartish errors isolated so this temporary tool cannot change Horizon's
// existing API error behavior.
router.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "The request body is not valid JSON." });
  }
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "CSV files must be 5 MB or smaller." });
  }
  if (err.message === "Only CSV files are accepted") {
    return res.status(400).json({ error: err.message });
  }
  res.status(err.status || 500).json({
    error: err.status ? err.message : "The server could not complete that request."
  });
});

export default router;

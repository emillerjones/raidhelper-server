import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normalizeSku, parseSmartishCsv } from "../services/smartishCsv.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(currentDir, "../test/fixtures");

test("normalizes SKU variants to one canonical value", () => {
  assert.equal(normalizeSku("SMR_1001"), "SMR-1001");
  assert.equal(normalizeSku("smr-1001"), "SMR-1001");
  assert.equal(normalizeSku("1001"), "SMR-1001");
  assert.equal(normalizeSku(""), null);
});

for (const [filename, expectedType] of [
  ["orders.csv", "orders"],
  ["warehouse.csv", "warehouse"],
  ["returns.csv", "returns"],
]) {
  test(`detects and parses ${expectedType}`, async () => {
    const parsed = parseSmartishCsv(await readFile(path.join(fixturesDir, filename)));
    assert.equal(parsed.type, expectedType);
    assert.ok(parsed.rows.length > 0);
  });
}

test("quarantines the duplicate warehouse row", async () => {
  const parsed = parseSmartishCsv(await readFile(path.join(fixturesDir, "warehouse.csv")));
  assert.equal(parsed.counts.duplicates, 1);
  assert.equal(parsed.counts.invalid, 1);
});

test("preserves order warnings and rejects the missing SKU", async () => {
  const parsed = parseSmartishCsv(await readFile(path.join(fixturesDir, "orders.csv")));
  assert.equal(parsed.counts.invalid, 1);
  assert.equal(parsed.counts.warnings, 1);
  assert.equal(parsed.rows.find((row) => row.orderId === "1004").isValid, true);
});

test("accepts harmless weekly header changes", () => {
  const csv = Buffer.from(
    "Order Number,Product SKU,Product Name,Quantity,Line Total\n" +
    "2001,smr_0042,Example Case,2,$49.98\n"
  );
  const parsed = parseSmartishCsv(csv);
  assert.equal(parsed.type, "orders");
  assert.equal(parsed.rows[0].normalizedSku, "SMR-42");
  assert.equal(parsed.rows[0].revenue, 49.98);
});

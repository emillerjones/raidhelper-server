import crypto from "node:crypto";
import db from "./client.js";

export async function isValidSmartishAccessKey(accessKey) {
  if (typeof accessKey !== "string" || accessKey.length < 16 || accessKey.length > 200) return false;
  const keyHash = crypto.createHash("sha256").update(accessKey).digest("hex");
  const { rowCount } = await db.query(
    `SELECT 1 FROM smartish_import_access_keys WHERE key_hash = $1 AND is_active = TRUE`,
    [keyHash]
  );
  return rowCount === 1;
}

export async function listBatches() {
  const { rows } = await db.query(`
    SELECT
      b.smartish_import_batch_id AS batch_id,
      b.batch_name,
      b.status,
      b.created_by,
      b.created_at,
      b.committed_at,
      COUNT(f.smartish_import_file_id)::int AS file_count,
      COALESCE(SUM(f.row_count), 0)::int AS row_count,
      COALESCE(SUM(f.invalid_row_count), 0)::int AS invalid_row_count
    FROM smartish_import_batches b
    LEFT JOIN smartish_import_files f
      ON f.smartish_import_batch_id = b.smartish_import_batch_id
    GROUP BY b.smartish_import_batch_id
    ORDER BY b.created_at DESC
    LIMIT 30
  `);
  return rows;
}

export async function createBatch({ batchName, createdBy }) {
  const { rows } = await db.query(
    `INSERT INTO smartish_import_batches (batch_name, created_by)
     VALUES ($1, $2)
     RETURNING smartish_import_batch_id AS batch_id, batch_name, status, created_by, created_at`,
    [batchName, createdBy]
  );
  return rows[0];
}

export async function getBatch(batchId, queryable = db) {
  const { rows: batches } = await queryable.query(
    `SELECT smartish_import_batch_id AS batch_id, batch_name, status, created_by,
            created_at, committed_at, error_message
     FROM smartish_import_batches
     WHERE smartish_import_batch_id = $1`,
    [batchId]
  );
  if (!batches[0]) return null;

  const { rows: files } = await queryable.query(
    `SELECT smartish_import_file_id AS file_id, file_type, original_filename,
            size_bytes, original_headers, row_count, valid_row_count,
            invalid_row_count, warning_row_count, duplicate_row_count, uploaded_at
     FROM smartish_import_files
     WHERE smartish_import_batch_id = $1
     ORDER BY uploaded_at`,
    [batchId]
  );

  const { rows: issues } = await queryable.query(
    `
      SELECT 'orders' AS file_type, row_number, original_sku AS source_sku,
             normalized_sku, validation_errors, validation_warnings
      FROM smartish_import_order_rows r
      JOIN smartish_import_files f USING (smartish_import_file_id)
      WHERE f.smartish_import_batch_id = $1
        AND (NOT is_valid OR cardinality(validation_warnings) > 0)
      UNION ALL
      SELECT 'warehouse', row_number, original_item_code, normalized_sku,
             validation_errors, validation_warnings
      FROM smartish_import_warehouse_rows r
      JOIN smartish_import_files f USING (smartish_import_file_id)
      WHERE f.smartish_import_batch_id = $1
        AND (NOT is_valid OR cardinality(validation_warnings) > 0)
      UNION ALL
      SELECT 'returns', row_number, original_sku, normalized_sku,
             validation_errors, validation_warnings
      FROM smartish_import_return_rows r
      JOIN smartish_import_files f USING (smartish_import_file_id)
      WHERE f.smartish_import_batch_id = $1
        AND (NOT is_valid OR cardinality(validation_warnings) > 0)
      ORDER BY file_type, row_number
      LIMIT 100
    `,
    [batchId]
  );

  return { ...batches[0], files, issues };
}

const INSERT_ROW_SQL = {
  orders: `
    INSERT INTO smartish_import_order_rows (
      smartish_import_file_id, row_number, order_id, original_sku, normalized_sku,
      product_name, quantity, revenue, raw_data, is_valid, validation_errors,
      validation_warnings, is_duplicate
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
  `,
  warehouse: `
    INSERT INTO smartish_import_warehouse_rows (
      smartish_import_file_id, row_number, original_item_code, normalized_sku,
      on_hand, location, raw_data, is_valid, validation_errors,
      validation_warnings, is_duplicate
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
  `,
  returns: `
    INSERT INTO smartish_import_return_rows (
      smartish_import_file_id, row_number, rma, original_sku, normalized_sku,
      reason, units, raw_data, is_valid, validation_errors,
      validation_warnings, is_duplicate
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `,
};

function rowParams(type, fileId, row) {
  const commonTail = [row.rawData, row.isValid, row.errors, row.warnings, row.isDuplicate];
  if (type === "orders") {
    return [fileId, row.rowNumber, row.orderId, row.originalSku, row.normalizedSku,
      row.productName, row.quantity, row.revenue, ...commonTail];
  }
  if (type === "warehouse") {
    return [fileId, row.rowNumber, row.originalItemCode, row.normalizedSku,
      row.onHand, row.location, ...commonTail];
  }
  return [fileId, row.rowNumber, row.rma, row.originalSku, row.normalizedSku,
    row.reason, row.units, ...commonTail];
}

export async function saveUploadedFile({ batchId, filename, size, parsed }) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows: batches } = await client.query(
      `SELECT status FROM smartish_import_batches
       WHERE smartish_import_batch_id = $1 FOR UPDATE`,
      [batchId]
    );
    if (!batches[0]) throw Object.assign(new Error("Import batch not found"), { status: 404 });
    if (batches[0].status !== "draft") {
      throw Object.assign(new Error("Only draft batches can accept files"), { status: 409 });
    }

    const { rows: files } = await client.query(
      `INSERT INTO smartish_import_files (
        smartish_import_batch_id, file_type, original_filename, file_hash, size_bytes,
        original_headers, row_count, valid_row_count, invalid_row_count,
        warning_row_count, duplicate_row_count
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING smartish_import_file_id`,
      [batchId, parsed.type, filename, parsed.fileHash, size, JSON.stringify(parsed.headers),
        parsed.counts.total, parsed.counts.valid, parsed.counts.invalid,
        parsed.counts.warnings, parsed.counts.duplicates]
    );
    const fileId = files[0].smartish_import_file_id;

    for (const row of parsed.rows) {
      await client.query(INSERT_ROW_SQL[parsed.type], rowParams(parsed.type, fileId, row));
    }

    await client.query("COMMIT");
    return getBatch(batchId);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw Object.assign(
        new Error("That file type or exact file has already been uploaded to this batch"),
        { status: 409 }
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function removeUploadedFile({ batchId, fileType }) {
  const { rows } = await db.query(
    `DELETE FROM smartish_import_files f
     USING smartish_import_batches b
     WHERE f.smartish_import_batch_id = b.smartish_import_batch_id
       AND b.smartish_import_batch_id = $1
       AND b.status = 'draft'
       AND f.file_type = $2
     RETURNING f.smartish_import_file_id`,
    [batchId, fileType]
  );
  return rows.length > 0;
}

export async function commitBatch(batchId) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const { rows: batches } = await client.query(
      `SELECT status FROM smartish_import_batches
       WHERE smartish_import_batch_id = $1 FOR UPDATE`,
      [batchId]
    );
    if (!batches[0]) throw Object.assign(new Error("Import batch not found"), { status: 404 });
    if (batches[0].status !== "draft") {
      throw Object.assign(new Error("Only a draft batch can be imported"), { status: 409 });
    }

    const { rows: types } = await client.query(
      `SELECT file_type FROM smartish_import_files
       WHERE smartish_import_batch_id = $1 ORDER BY file_type`,
      [batchId]
    );
    const uploadedTypes = new Set(types.map((row) => row.file_type));
    const missing = ["orders", "warehouse", "returns"].filter((type) => !uploadedTypes.has(type));
    if (missing.length) {
      throw Object.assign(new Error(`Upload the missing file types: ${missing.join(", ")}`), { status: 409 });
    }

    await client.query(
      `UPDATE smartish_import_batches
       SET status = 'completed', committed_at = NOW(), error_message = NULL
       WHERE smartish_import_batch_id = $1`,
      [batchId]
    );
    await client.query("COMMIT");
    return getBatch(batchId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getReport(batchId) {
  const { rows } = await db.query(
    `
      WITH selected_batch AS (
        SELECT smartish_import_batch_id
        FROM smartish_import_batches
        WHERE smartish_import_batch_id = $1 AND status = 'completed'
      ),
      orders AS (
        SELECT r.normalized_sku,
               MAX(r.product_name) AS product_name,
               COUNT(DISTINCT r.order_id)::int AS order_count,
               SUM(r.quantity)::int AS units_ordered,
               SUM(r.revenue)::numeric(14,2) AS revenue
        FROM smartish_import_order_rows r
        JOIN smartish_import_files f USING (smartish_import_file_id)
        JOIN selected_batch b USING (smartish_import_batch_id)
        WHERE r.is_valid AND r.normalized_sku IS NOT NULL
        GROUP BY r.normalized_sku
      ),
      warehouse AS (
        SELECT r.normalized_sku,
               SUM(r.on_hand)::int AS on_hand,
               STRING_AGG(DISTINCT r.location, ', ' ORDER BY r.location) AS locations
        FROM smartish_import_warehouse_rows r
        JOIN smartish_import_files f USING (smartish_import_file_id)
        JOIN selected_batch b USING (smartish_import_batch_id)
        WHERE r.is_valid AND r.normalized_sku IS NOT NULL
        GROUP BY r.normalized_sku
      ),
      returns AS (
        SELECT r.normalized_sku,
               COUNT(DISTINCT r.rma)::int AS return_count,
               SUM(r.units)::int AS units_returned
        FROM smartish_import_return_rows r
        JOIN smartish_import_files f USING (smartish_import_file_id)
        JOIN selected_batch b USING (smartish_import_batch_id)
        WHERE r.is_valid AND r.normalized_sku IS NOT NULL
        GROUP BY r.normalized_sku
      ),
      order_warehouse AS (
        SELECT COALESCE(o.normalized_sku, w.normalized_sku) AS normalized_sku,
               o.product_name, o.order_count, o.units_ordered, o.revenue,
               w.on_hand, w.locations
        FROM orders o
        FULL OUTER JOIN warehouse w USING (normalized_sku)
      )
      SELECT COALESCE(ow.normalized_sku, r.normalized_sku) AS sku,
             ow.product_name, ow.order_count, ow.units_ordered, ow.revenue,
             ow.on_hand, ow.locations, r.return_count, r.units_returned
      FROM order_warehouse ow
      FULL OUTER JOIN returns r USING (normalized_sku)
      ORDER BY sku
    `,
    [batchId]
  );
  return rows;
}

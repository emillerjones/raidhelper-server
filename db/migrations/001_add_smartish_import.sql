-- Smartish Import is intentionally isolated from Horizon's existing tables.
-- This migration is additive and safe to run more than once.

CREATE TABLE IF NOT EXISTS smartish_import_access_keys (
  smartish_import_access_key_id BIGSERIAL PRIMARY KEY,
  label TEXT NOT NULL UNIQUE,
  key_hash CHAR(64) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO smartish_import_access_keys (label, key_hash)
VALUES (
  'interview-demo',
  '537d64f99aeed997e7a71d6a1114c2b39d2c95e395549f4b852755dc17362c55'
)
ON CONFLICT (label) DO NOTHING;

CREATE TABLE IF NOT EXISTS smartish_import_batches (
  smartish_import_batch_id BIGSERIAL PRIMARY KEY,
  batch_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ,
  error_message TEXT,
  CHECK (status IN ('draft', 'processing', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS smartish_import_batches_created_at_idx
ON smartish_import_batches (created_at DESC);

CREATE TABLE IF NOT EXISTS smartish_import_files (
  smartish_import_file_id BIGSERIAL PRIMARY KEY,
  smartish_import_batch_id BIGINT NOT NULL
    REFERENCES smartish_import_batches (smartish_import_batch_id) ON DELETE CASCADE,
  file_type TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_hash CHAR(64) NOT NULL,
  size_bytes INTEGER NOT NULL,
  original_headers JSONB NOT NULL DEFAULT '[]'::jsonb,
  row_count INTEGER NOT NULL DEFAULT 0,
  valid_row_count INTEGER NOT NULL DEFAULT 0,
  invalid_row_count INTEGER NOT NULL DEFAULT 0,
  warning_row_count INTEGER NOT NULL DEFAULT 0,
  duplicate_row_count INTEGER NOT NULL DEFAULT 0,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (file_type IN ('orders', 'warehouse', 'returns')),
  CHECK (size_bytes >= 0),
  CHECK (row_count >= 0),
  UNIQUE (smartish_import_batch_id, file_type),
  UNIQUE (smartish_import_batch_id, file_hash)
);

CREATE INDEX IF NOT EXISTS smartish_import_files_batch_id_idx
ON smartish_import_files (smartish_import_batch_id);

CREATE TABLE IF NOT EXISTS smartish_import_order_rows (
  smartish_import_order_row_id BIGSERIAL PRIMARY KEY,
  smartish_import_file_id BIGINT NOT NULL
    REFERENCES smartish_import_files (smartish_import_file_id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  order_id TEXT,
  original_sku TEXT,
  normalized_sku TEXT,
  product_name TEXT,
  quantity INTEGER,
  revenue NUMERIC(14, 2),
  raw_data JSONB NOT NULL,
  is_valid BOOLEAN NOT NULL,
  validation_errors TEXT[] NOT NULL DEFAULT '{}',
  validation_warnings TEXT[] NOT NULL DEFAULT '{}',
  is_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (row_number >= 2),
  CHECK (quantity IS NULL OR quantity >= 0),
  CHECK (revenue IS NULL OR revenue >= 0),
  UNIQUE (smartish_import_file_id, row_number)
);

CREATE INDEX IF NOT EXISTS smartish_import_order_rows_file_idx
ON smartish_import_order_rows (smartish_import_file_id);
CREATE INDEX IF NOT EXISTS smartish_import_order_rows_sku_idx
ON smartish_import_order_rows (normalized_sku) WHERE is_valid;

CREATE TABLE IF NOT EXISTS smartish_import_warehouse_rows (
  smartish_import_warehouse_row_id BIGSERIAL PRIMARY KEY,
  smartish_import_file_id BIGINT NOT NULL
    REFERENCES smartish_import_files (smartish_import_file_id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  original_item_code TEXT,
  normalized_sku TEXT,
  on_hand INTEGER,
  location TEXT,
  raw_data JSONB NOT NULL,
  is_valid BOOLEAN NOT NULL,
  validation_errors TEXT[] NOT NULL DEFAULT '{}',
  validation_warnings TEXT[] NOT NULL DEFAULT '{}',
  is_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (row_number >= 2),
  CHECK (on_hand IS NULL OR on_hand >= 0),
  UNIQUE (smartish_import_file_id, row_number)
);

CREATE INDEX IF NOT EXISTS smartish_import_warehouse_rows_file_idx
ON smartish_import_warehouse_rows (smartish_import_file_id);
CREATE INDEX IF NOT EXISTS smartish_import_warehouse_rows_sku_idx
ON smartish_import_warehouse_rows (normalized_sku) WHERE is_valid;

CREATE TABLE IF NOT EXISTS smartish_import_return_rows (
  smartish_import_return_row_id BIGSERIAL PRIMARY KEY,
  smartish_import_file_id BIGINT NOT NULL
    REFERENCES smartish_import_files (smartish_import_file_id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  rma TEXT,
  original_sku TEXT,
  normalized_sku TEXT,
  reason TEXT,
  units INTEGER,
  raw_data JSONB NOT NULL,
  is_valid BOOLEAN NOT NULL,
  validation_errors TEXT[] NOT NULL DEFAULT '{}',
  validation_warnings TEXT[] NOT NULL DEFAULT '{}',
  is_duplicate BOOLEAN NOT NULL DEFAULT FALSE,
  CHECK (row_number >= 2),
  CHECK (units IS NULL OR units >= 0),
  UNIQUE (smartish_import_file_id, row_number)
);

CREATE INDEX IF NOT EXISTS smartish_import_return_rows_file_idx
ON smartish_import_return_rows (smartish_import_file_id);
CREATE INDEX IF NOT EXISTS smartish_import_return_rows_sku_idx
ON smartish_import_return_rows (normalized_sku) WHERE is_valid;

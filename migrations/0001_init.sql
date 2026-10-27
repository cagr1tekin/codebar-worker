-- =============================================
-- CodeBar Worker - D1 Cloud Schema
-- Supabase'in yerini alan self-hosted veritabanı
-- =============================================
-- Notlar:
--   - PRAGMA ve TRIGGER yok (D1 desteklemiyor)
--   - updated_at → Workers kodunda güncellenir
--   - users tablosu → Supabase Auth'un yerini alır
--   - employees.supabase_user_id → user_id olarak taşındı
-- =============================================

-- ─── AUTH: Kullanıcılar ─────────────────────

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  store_id      TEXT REFERENCES stores(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  full_name     TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'cashier'
                  CHECK (role IN ('superadmin', 'admin', 'manager', 'cashier')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email   ON users(email);
CREATE INDEX        IF NOT EXISTS idx_users_store   ON users(store_id);

-- ─── AUTH: Aktif Oturumlar ──────────────────

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store_id   TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  is_revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id, is_revoked);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- ─── 1. STORES ──────────────────────────────

CREATE TABLE IF NOT EXISTS stores (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  address               TEXT,
  phone                 TEXT,
  tax_number            TEXT,
  subscription_end_date TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  is_deleted            INTEGER NOT NULL DEFAULT 0
);

-- ─── 2. PRODUCTS ────────────────────────────

CREATE TABLE IF NOT EXISTS products (
  id            TEXT PRIMARY KEY,
  store_id      TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  barcode       TEXT,
  buying_price  REAL NOT NULL DEFAULT 0,
  selling_price REAL NOT NULL DEFAULT 0,
  tax_rate      REAL NOT NULL DEFAULT 0,
  stock         REAL NOT NULL DEFAULT 0,
  stock_unit    TEXT NOT NULL DEFAULT 'adet' CHECK (stock_unit IN ('adet', 'gram')),
  category      TEXT NOT NULL DEFAULT 'Genel',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  is_deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_products_store    ON products(store_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_products_barcode  ON products(store_id, barcode);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(store_id, category);

-- ─── 3. CUSTOMERS ───────────────────────────

CREATE TABLE IF NOT EXISTS customers (
  id         TEXT PRIMARY KEY,
  store_id   TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  full_name  TEXT NOT NULL,
  phone      TEXT,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_customers_store ON customers(store_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(store_id, phone);

-- ─── 4. CUSTOMER_TRANSACTIONS ───────────────

CREATE TABLE IF NOT EXISTS customer_transactions (
  id          TEXT PRIMARY KEY,
  store_id    TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('DEBT', 'PAYMENT')),
  amount      REAL NOT NULL DEFAULT 0,
  description TEXT,
  date        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  is_deleted  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_customer_tx_store    ON customer_transactions(store_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_customer_tx_customer ON customer_transactions(store_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_tx_date     ON customer_transactions(store_id, date);

-- ─── 5. EMPLOYEES ───────────────────────────

CREATE TABLE IF NOT EXISTS employees (
  id         TEXT PRIMARY KEY,
  store_id   TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  full_name  TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  role       TEXT NOT NULL DEFAULT 'OTHER' CHECK (role IN ('CASHIER', 'MANAGER', 'STOCK', 'OTHER')),
  salary     REAL NOT NULL DEFAULT 0,
  start_date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d', 'now')),
  note       TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  is_deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_employees_store  ON employees(store_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(store_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_email
  ON employees(store_id, email) WHERE email IS NOT NULL;

-- ─── 6. EXPENSES ────────────────────────────

CREATE TABLE IF NOT EXISTS expenses (
  id             TEXT PRIMARY KEY,
  store_id       TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  amount         REAL NOT NULL DEFAULT 0,
  category       TEXT NOT NULL DEFAULT 'OTHER',
  date           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  payment_method TEXT NOT NULL DEFAULT 'CASH' CHECK (payment_method IN ('CASH', 'CREDIT_CARD')),
  description    TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  is_deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_expenses_store    ON expenses(store_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_expenses_date     ON expenses(store_id, date);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses(store_id, category);

-- ─── 7. POS_TRANSACTIONS ────────────────────

CREATE TABLE IF NOT EXISTS pos_transactions (
  id             TEXT PRIMARY KEY,
  store_id       TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK (type IN ('SALE', 'RETURN', 'PAYMENT')),
  total_amount   REAL NOT NULL DEFAULT 0,
  tax_amount     REAL NOT NULL DEFAULT 0,
  payment_method TEXT CHECK (payment_method IN ('CASH', 'CREDIT_CARD', 'SPLIT')),
  customer_id    TEXT REFERENCES customers(id) ON DELETE SET NULL,
  employee_id    TEXT REFERENCES employees(id) ON DELETE SET NULL,
  description    TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  is_deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pos_tx_store    ON pos_transactions(store_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_pos_tx_date     ON pos_transactions(store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pos_tx_type     ON pos_transactions(store_id, type);
CREATE INDEX IF NOT EXISTS idx_pos_tx_customer ON pos_transactions(store_id, customer_id);

-- ─── 8. POS_TRANSACTION_ITEMS ───────────────

CREATE TABLE IF NOT EXISTS pos_transaction_items (
  id             TEXT PRIMARY KEY,
  store_id       TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  transaction_id TEXT NOT NULL REFERENCES pos_transactions(id) ON DELETE CASCADE,
  product_id     TEXT REFERENCES products(id) ON DELETE SET NULL,
  product_name   TEXT NOT NULL,
  quantity       REAL NOT NULL DEFAULT 1,
  unit_price     REAL NOT NULL DEFAULT 0,
  tax_rate       REAL NOT NULL DEFAULT 0,
  unit           TEXT NOT NULL DEFAULT 'adet' CHECK (unit IN ('adet', 'gram')),
  line_total     REAL NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  is_deleted     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pos_items_store   ON pos_transaction_items(store_id, is_deleted);
CREATE INDEX IF NOT EXISTS idx_pos_items_tx      ON pos_transaction_items(transaction_id);
CREATE INDEX IF NOT EXISTS idx_pos_items_product ON pos_transaction_items(store_id, product_id);

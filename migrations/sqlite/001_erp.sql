-- AI-NEGOCE local ERP database (SQLite). Loaded from datasets/synthetic/v1 by `npm run db:seed`.
-- Amounts are TND with 3 decimals (millimes); dates are ISO yyyy-mm-dd text.
PRAGMA foreign_keys = ON;

CREATE TABLE agencies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  city TEXT NOT NULL
);

CREATE TABLE representatives (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  hire_date TEXT
);

CREATE TABLE roles (
  role TEXT PRIMARY KEY,
  agencies TEXT NOT NULL,
  permissions TEXT NOT NULL
);

CREATE TABLE product_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  default_vat_rate INTEGER NOT NULL
);

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tax_id TEXT,
  city TEXT,
  payment_terms_days INTEGER,
  category_ids TEXT
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES product_categories(id),
  supplier_id TEXT REFERENCES suppliers(id),
  unit_cost REAL,
  list_price REAL,
  vat_rate INTEGER,
  reorder_point INTEGER,
  uom TEXT
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  representative_id TEXT REFERENCES representatives(id),
  segment TEXT,
  credit_limit REAL,
  payment_terms_days INTEGER,
  customer_discount_pct REAL
);

CREATE TABLE sales_invoices (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('invoice', 'credit_note')),
  original_invoice_id TEXT,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  representative_id TEXT REFERENCES representatives(id),
  invoice_date TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'TND',
  total_discount REAL,
  total_ht REAL NOT NULL,
  total_vat REAL,
  stamp_duty REAL,
  total_ttc REAL NOT NULL,
  total_cost REAL
);
CREATE INDEX ix_sales_date_agency ON sales_invoices(invoice_date, agency_id);

CREATE TABLE sales_invoice_lines (
  id TEXT PRIMARY KEY,
  sales_invoice_id TEXT NOT NULL REFERENCES sales_invoices(id),
  product_id TEXT REFERENCES products(id),
  quantity REAL,
  unit_price REAL,
  discount_pct REAL,
  line_ht REAL,
  vat_rate INTEGER,
  line_vat REAL,
  unit_cost REAL,
  line_cost REAL
);
CREATE INDEX ix_sales_lines_invoice ON sales_invoice_lines(sales_invoice_id);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  sales_invoice_id TEXT NOT NULL REFERENCES sales_invoices(id),
  customer_id TEXT REFERENCES customers(id),
  payment_date TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT
);
CREATE INDEX ix_payments_date ON payments(payment_date);

CREATE TABLE receivables (
  sales_invoice_id TEXT PRIMARY KEY REFERENCES sales_invoices(id),
  customer_id TEXT REFERENCES customers(id),
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  invoice_date TEXT NOT NULL,
  due_date TEXT,
  total_ttc REAL,
  credited_ttc REAL,
  paid REAL,
  outstanding REAL NOT NULL,
  days_overdue INTEGER,
  status TEXT
);
CREATE INDEX ix_receivables_agency ON receivables(agency_id, status);

CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  order_date TEXT NOT NULL,
  status TEXT NOT NULL,
  total_ht REAL NOT NULL
);
CREATE INDEX ix_po_date ON purchase_orders(order_date);

CREATE TABLE purchase_order_lines (
  id TEXT PRIMARY KEY,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id),
  product_id TEXT REFERENCES products(id),
  quantity REAL,
  unit_cost REAL,
  line_total REAL
);

CREATE TABLE supplier_invoices (
  id TEXT PRIMARY KEY,
  supplier_invoice_number TEXT NOT NULL,
  supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  purchase_order_id TEXT REFERENCES purchase_orders(id),
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  invoice_date TEXT NOT NULL,
  due_date TEXT,
  currency TEXT NOT NULL DEFAULT 'TND',
  total_ht REAL,
  total_vat REAL,
  total_ttc REAL NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX ix_si_date ON supplier_invoices(invoice_date);

CREATE TABLE supplier_invoice_lines (
  id TEXT PRIMARY KEY,
  supplier_invoice_id TEXT NOT NULL REFERENCES supplier_invoices(id),
  product_id TEXT REFERENCES products(id),
  quantity REAL,
  unit_cost REAL,
  vat_rate INTEGER,
  line_ht REAL,
  line_vat REAL
);

CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  type TEXT NOT NULL,
  quantity REAL NOT NULL,
  reference TEXT
);
CREATE INDEX ix_moves_product ON stock_movements(product_id, agency_id, date);

CREATE TABLE inventory (
  product_id TEXT NOT NULL REFERENCES products(id),
  agency_id TEXT NOT NULL REFERENCES agencies(id),
  opening_date TEXT,
  opening_quantity REAL,
  current_quantity REAL NOT NULL,
  unit_cost REAL NOT NULL,
  reorder_point INTEGER,
  as_of TEXT,
  PRIMARY KEY (product_id, agency_id)
);

-- Key/value settings. as_of = the business "today"; absent means the real current date.
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

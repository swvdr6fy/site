const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || './data';
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const PRODUCTS_UPLOAD_DIR = path.join(UPLOADS_DIR, 'products');
const RECEIPTS_UPLOAD_DIR = path.join(UPLOADS_DIR, 'receipts');
const BANNERS_UPLOAD_DIR = path.join(UPLOADS_DIR, 'banners');

[DATA_DIR, UPLOADS_DIR, PRODUCTS_UPLOAD_DIR, RECEIPTS_UPLOAD_DIR, BANNERS_UPLOAD_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const db = new Database(path.join(DATA_DIR, 'shop.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  username TEXT,
  phone TEXT UNIQUE NOT NULL,
  email TEXT,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  price INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  category_id INTEGER,
  image TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  is_featured INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS product_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT,
  total_price INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'در انتظار پرداخت',
  payment_method TEXT NOT NULL DEFAULT 'card_to_card',
  receipt_image TEXT,
  tracking_code TEXT,
  admin_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  product_id INTEGER,
  title_snapshot TEXT NOT NULL,
  variant_label TEXT,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- اتصال حساب کاربری فروشگاه به چت بله (لازم برای ارسال فاکتور بله‌پی)
CREATE TABLE IF NOT EXISTS bale_connections (
  user_id INTEGER PRIMARY KEY,
  chat_id TEXT NOT NULL,
  bale_user_id TEXT,
  username TEXT,
  first_name TEXT,
  connected_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- کدهای یک‌بارمصرف برای اتصال حساب به بله از طریق دستور /start
CREATE TABLE IF NOT EXISTS bale_link_codes (
  code TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- فاکتورهای ارسال‌شده به بله‌پی برای هر سفارش
CREATE TABLE IF NOT EXISTS bale_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT UNIQUE NOT NULL,
  order_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  amount_rial INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  charge_id TEXT UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

// مهاجرت ایمن برای دیتابیس‌های قدیمی‌تر (اگر ستون‌های جدید وجود نداشته باشند اضافه می‌شوند)
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('username')) {
  db.exec('ALTER TABLE users ADD COLUMN username TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)');

const productCols = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
if (!productCols.includes('is_featured')) {
  db.exec('ALTER TABLE products ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0');
}

// مهاجرت سفارش‌ها: فیلدهای جدا برای آدرس پستی (استان/شهر/کد پستی) و متن کانفیگ تحویلی به مشتری
const orderCols = db.prepare('PRAGMA table_info(orders)').all().map((c) => c.name);
if (!orderCols.includes('province')) {
  db.exec('ALTER TABLE orders ADD COLUMN province TEXT');
}
if (!orderCols.includes('city')) {
  db.exec('ALTER TABLE orders ADD COLUMN city TEXT');
}
if (!orderCols.includes('postal_code')) {
  db.exec('ALTER TABLE orders ADD COLUMN postal_code TEXT');
}
if (!orderCols.includes('config_text')) {
  db.exec('ALTER TABLE orders ADD COLUMN config_text TEXT');
}

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

module.exports = {
  db,
  DATA_DIR,
  UPLOADS_DIR,
  PRODUCTS_UPLOAD_DIR,
  RECEIPTS_UPLOAD_DIR,
  BANNERS_UPLOAD_DIR,
  getSetting,
  setSetting,
};

const express = require('express');
const { db, getSetting, setSetting } = require('../config/db');
const { requireLogin, requireAdmin } = require('../middleware/auth');
const { uploadProductImage, uploadBanner } = require('../utils/upload');
const { generateProductPoster } = require('../utils/poster');
const { slugify } = require('../config/seed');
const baleApi = require('../utils/baleApi');
const balePay = require('../utils/balePay');

const router = express.Router();
router.use(requireLogin, requireAdmin);

const ORDER_STATUSES = [
  'در انتظار پرداخت',
  'در انتظار تایید پرداخت',
  'پرداخت تایید شد',
  'در حال پردازش',
  'ارسال شد',
  'تحویل داده شد',
  'رد شده',
  'لغو شده',
];

function parseVariantsFromBody(body) {
  const labels = [].concat(body.variant_label || []);
  const prices = [].concat(body.variant_price || []);
  const stocks = [].concat(body.variant_stock || []);
  const variants = [];
  for (let i = 0; i < labels.length; i++) {
    const label = (labels[i] || '').trim();
    if (!label) continue;
    variants.push({
      label,
      price: parseInt(prices[i], 10) || 0,
      stock: parseInt(stocks[i], 10) || 0,
    });
  }
  return variants;
}

router.get('/', (req, res) => {
  const stats = {
    productsCount: db.prepare('SELECT COUNT(*) c FROM products').get().c,
    ordersCount: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
    pendingOrders: db
      .prepare("SELECT COUNT(*) c FROM orders WHERE status = 'در انتظار تایید پرداخت'")
      .get().c,
    usersCount: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    totalRevenue: db
      .prepare("SELECT COALESCE(SUM(total_price),0) s FROM orders WHERE status NOT IN ('لغو شده','رد شده','در انتظار پرداخت')")
      .get().s,
  };
  const recentOrders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 8').all();
  res.render('admin/dashboard', { title: 'پنل مدیریت', stats, recentOrders });
});

// ---------- بله‌پی ----------
router.get('/bale', async (req, res) => {
  let webhookInfo = null;
  let webhookError = null;
  if (balePay.isBalePayEnabled()) {
    try {
      webhookInfo = await baleApi.getWebhookInfo();
    } catch (err) {
      webhookError = err.message;
    }
  }
  res.render('admin/bale', {
    title: 'بله‌پی',
    active: 'bale',
    enabled: balePay.isBalePayEnabled(),
    configured: baleApi.isConfigured(),
    baseUrl: process.env.BASE_URL || '',
    webhookSecretSet: !!process.env.BALE_WEBHOOK_SECRET,
    webhookInfo,
    webhookError,
  });
});

router.post('/bale/setup-webhook', async (req, res) => {
  const baseUrl = process.env.BASE_URL || '';
  const secret = process.env.BALE_WEBHOOK_SECRET || '';
  if (!baseUrl || !secret) {
    req.session.flash = { type: 'error', text: 'ابتدا BASE_URL و BALE_WEBHOOK_SECRET را در متغیرهای محیطی تنظیم کنید.' };
    return res.redirect('/admin/bale');
  }
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/webhook/bale/${secret}`;
    await baleApi.setWebhook(url);
    req.session.flash = { type: 'success', text: 'وبهوک بله با موفقیت ثبت شد.' };
  } catch (err) {
    req.session.flash = { type: 'error', text: 'ثبت وبهوک ناموفق بود: ' + err.message };
  }
  res.redirect('/admin/bale');
});

// ---------- محصولات ----------
router.get('/products', (req, res) => {
  const products = db
    .prepare(
      `SELECT products.*, categories.name as category_name FROM products
       LEFT JOIN categories ON products.category_id = categories.id
       ORDER BY products.created_at DESC`
    )
    .all();
  const variantCountStmt = db.prepare('SELECT COUNT(*) c FROM product_variants WHERE product_id = ?');
  products.forEach((p) => { p.variantCount = variantCountStmt.get(p.id).c; });
  res.render('admin/products', { title: 'مدیریت محصولات', products });
});

router.get('/products/new', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/product-form', { title: 'افزودن محصول', product: null, variants: [], categories, error: null });
});

router.post('/products/new', uploadProductImage.single('image'), (req, res) => {
  const { title, description, price, stock, category_id, is_active, is_featured } = req.body;
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  const variants = parseVariantsFromBody(req.body);

  if (!title || (variants.length === 0 && !price)) {
    return res.render('admin/product-form', {
      title: 'افزودن محصول',
      product: req.body,
      variants,
      categories,
      error: 'عنوان محصول الزامی است و باید حداقل قیمت پایه یا یک پلن/حجم وارد کنید.',
    });
  }

  const basePrice = variants.length > 0 ? variants[0].price : parseInt(price, 10) || 0;
  const totalStock = variants.length > 0 ? variants.reduce((s, v) => s + v.stock, 0) : parseInt(stock, 10) || 0;
  const slug = slugify(title) + '-' + Date.now().toString().slice(-6);

  const categoryRow = category_id ? db.prepare('SELECT name FROM categories WHERE id = ?').get(category_id) : null;
  const imageFilename = req.file
    ? req.file.filename
    : generateProductPoster({
        title: title.trim(),
        categoryLabel: categoryRow ? categoryRow.name : '',
        shopName: process.env.SHOP_NAME || 'AurevonFilter',
        isFeatured: !!is_featured,
      });

  const info = db.prepare(
    `INSERT INTO products (title, slug, description, price, stock, category_id, image, is_active, is_featured)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    title.trim(),
    slug,
    (description || '').trim(),
    basePrice,
    totalStock,
    category_id || null,
    imageFilename,
    is_active ? 1 : 0,
    is_featured ? 1 : 0
  );

  const insertVariant = db.prepare('INSERT INTO product_variants (product_id, label, price, stock, sort_order) VALUES (?, ?, ?, ?, ?)');
  variants.forEach((v, idx) => insertVariant.run(info.lastInsertRowid, v.label, v.price, v.stock, idx));

  req.session.flash = { type: 'success', text: 'محصول با موفقیت اضافه شد.' };
  res.redirect('/admin/products');
});

router.get('/products/:id/edit', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).render('error', { title: 'یافت نشد', message: 'محصول پیدا نشد.' });
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  const variants = db.prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY sort_order, id').all(product.id);
  res.render('admin/product-form', { title: 'ویرایش محصول', product, variants, categories, error: null });
});

router.post('/products/:id/edit', uploadProductImage.single('image'), (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).render('error', { title: 'یافت نشد', message: 'محصول پیدا نشد.' });

  const { title, description, price, stock, category_id, is_active, is_featured } = req.body;
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  const variants = parseVariantsFromBody(req.body);

  if (!title || (variants.length === 0 && !price)) {
    return res.render('admin/product-form', {
      title: 'ویرایش محصول',
      product: { ...product, ...req.body },
      variants,
      categories,
      error: 'عنوان محصول الزامی است و باید حداقل قیمت پایه یا یک پلن/حجم وارد کنید.',
    });
  }

  const basePrice = variants.length > 0 ? variants[0].price : parseInt(price, 10) || 0;
  const totalStock = variants.length > 0 ? variants.reduce((s, v) => s + v.stock, 0) : parseInt(stock, 10) || 0;

  let imageFilename = req.file ? req.file.filename : product.image;
  if (!imageFilename) {
    const categoryRow = category_id ? db.prepare('SELECT name FROM categories WHERE id = ?').get(category_id) : null;
    imageFilename = generateProductPoster({
      title: title.trim(),
      categoryLabel: categoryRow ? categoryRow.name : '',
      shopName: process.env.SHOP_NAME || 'AurevonFilter',
      isFeatured: !!is_featured,
    });
  }

  db.prepare(
    `UPDATE products SET title = ?, description = ?, price = ?, stock = ?, category_id = ?, is_active = ?, is_featured = ?, image = ?
     WHERE id = ?`
  ).run(
    title.trim(),
    (description || '').trim(),
    basePrice,
    totalStock,
    category_id || null,
    is_active ? 1 : 0,
    is_featured ? 1 : 0,
    imageFilename,
    product.id
  );

  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(product.id);
  const insertVariant = db.prepare('INSERT INTO product_variants (product_id, label, price, stock, sort_order) VALUES (?, ?, ?, ?, ?)');
  variants.forEach((v, idx) => insertVariant.run(product.id, v.label, v.price, v.stock, idx));

  req.session.flash = { type: 'success', text: 'محصول ویرایش شد.' };
  res.redirect('/admin/products');
});

router.post('/products/:id/delete', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  req.session.flash = { type: 'success', text: 'محصول حذف شد.' };
  res.redirect('/admin/products');
});

// ---------- دسته‌بندی‌ها ----------
router.get('/categories', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.render('admin/categories', { title: 'مدیریت دسته‌بندی‌ها', categories, error: null });
});

router.post('/categories', (req, res) => {
  const { name } = req.body;
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  if (!name || !name.trim()) {
    return res.render('admin/categories', { title: 'مدیریت دسته‌بندی‌ها', categories, error: 'نام دسته‌بندی الزامی است.' });
  }
  try {
    db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(name.trim(), slugify(name));
    req.session.flash = { type: 'success', text: 'دسته‌بندی اضافه شد.' };
    res.redirect('/admin/categories');
  } catch (e) {
    res.render('admin/categories', { title: 'مدیریت دسته‌بندی‌ها', categories, error: 'این دسته‌بندی قبلا ثبت شده.' });
  }
});

router.post('/categories/:id/delete', (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  req.session.flash = { type: 'success', text: 'دسته‌بندی حذف شد.' };
  res.redirect('/admin/categories');
});

// ---------- تنظیمات (پوستر + شماره کارت) ----------
router.get('/settings', (req, res) => {
  const settings = {
    banner_title: getSetting('banner_title'),
    banner_subtitle: getSetting('banner_subtitle'),
    banner_price_text: getSetting('banner_price_text'),
    banner_image: getSetting('banner_image'),
    card_number: getSetting('card_number'),
    card_holder: getSetting('card_holder'),
    card_bank: getSetting('card_bank'),
  };
  res.render('admin/settings', { title: 'تنظیمات فروشگاه', settings });
});

router.post('/settings', uploadBanner.single('banner_image_file'), (req, res) => {
  const { banner_title, banner_subtitle, banner_price_text, card_number, card_holder, card_bank } = req.body;
  setSetting('banner_title', (banner_title || '').trim());
  setSetting('banner_subtitle', (banner_subtitle || '').trim());
  setSetting('banner_price_text', (banner_price_text || '').trim());
  if (req.file) setSetting('banner_image', req.file.filename);
  setSetting('card_number', (card_number || '').trim());
  setSetting('card_holder', (card_holder || '').trim());
  setSetting('card_bank', (card_bank || '').trim());

  req.session.flash = { type: 'success', text: 'تنظیمات ذخیره شد.' };
  res.redirect('/admin/settings');
});

// ---------- سفارش‌ها ----------
router.get('/orders', (req, res) => {
  const statusFilter = req.query.status || null;
  let sql = `SELECT orders.*, users.name as user_name FROM orders JOIN users ON orders.user_id = users.id`;
  const params = [];
  if (statusFilter) {
    sql += ' WHERE orders.status = ?';
    params.push(statusFilter);
  }
  sql += ' ORDER BY orders.created_at DESC';
  const orders = db.prepare(sql).all(...params);
  res.render('admin/orders', { title: 'مدیریت سفارش‌ها', orders, statuses: ORDER_STATUSES, activeStatus: statusFilter });
});

router.get('/orders/:id', (req, res) => {
  const order = db
    .prepare(`SELECT orders.*, users.name as user_name, users.phone as user_phone FROM orders
               JOIN users ON orders.user_id = users.id WHERE orders.id = ?`)
    .get(req.params.id);
  if (!order) return res.status(404).render('error', { title: 'یافت نشد', message: 'سفارش پیدا نشد.' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.render('admin/order-detail', { title: 'جزئیات سفارش', order, items, statuses: ORDER_STATUSES });
});

router.post('/orders/:id/update', (req, res) => {
  const { status, tracking_code, admin_note, config_text } = req.body;
  db.prepare('UPDATE orders SET status = ?, tracking_code = ?, admin_note = ?, config_text = ? WHERE id = ?').run(
    status,
    (tracking_code || '').trim(),
    (admin_note || '').trim(),
    (config_text || '').trim(),
    req.params.id
  );
  req.session.flash = { type: 'success', text: 'سفارش به‌روزرسانی شد.' };
  res.redirect(`/admin/orders/${req.params.id}`);
});

module.exports = router;

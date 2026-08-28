const express = require('express');
const { db, getSetting } = require('../config/db');
const { requireLogin } = require('../middleware/auth');
const { uploadReceipt } = require('../utils/upload');

const router = express.Router();

// صفحه اصلی
router.get('/', (req, res) => {
  const categorySlug = req.query.cat || null;
  const q = (req.query.q || '').trim();
  const sort = ['newest', 'popular', 'price_asc', 'price_desc'].includes(req.query.sort) ? req.query.sort : 'newest';

  let categories = db.prepare('SELECT * FROM categories ORDER BY name').all();

  let sql = `SELECT products.*, categories.name as category_name, categories.slug as category_slug
             FROM products LEFT JOIN categories ON products.category_id = categories.id
             WHERE products.is_active = 1`;
  const params = [];

  if (categorySlug) {
    sql += ' AND categories.slug = ?';
    params.push(categorySlug);
  }
  if (q) {
    sql += ' AND products.title LIKE ?';
    params.push(`%${q}%`);
  }
  sql += ' ORDER BY products.created_at DESC';

  const products = db.prepare(sql).all(...params);
  const minPriceStmt = db.prepare('SELECT MIN(price) m FROM product_variants WHERE product_id = ?');

  const bestsellerRows = db
    .prepare(
      `SELECT product_id, SUM(quantity) as sold FROM order_items
       WHERE product_id IS NOT NULL GROUP BY product_id ORDER BY sold DESC LIMIT 3`
    )
    .all();
  const bestsellerIds = new Set(bestsellerRows.filter((r) => r.sold > 0).map((r) => r.product_id));
  const soldMap = new Map(bestsellerRows.map((r) => [r.product_id, r.sold]));

  products.forEach((p) => {
    const variantMin = minPriceStmt.get(p.id).m;
    p.displayPrice = variantMin !== null ? variantMin : p.price;
    p.hasVariants = variantMin !== null;
    p.isBestseller = bestsellerIds.has(p.id);
    p.isFeatured = !!p.is_featured;
    p.soldCount = soldMap.get(p.id) || 0;
  });

  if (sort === 'price_asc') products.sort((a, b) => a.displayPrice - b.displayPrice);
  else if (sort === 'price_desc') products.sort((a, b) => b.displayPrice - a.displayPrice);
  else if (sort === 'popular') products.sort((a, b) => b.soldCount - a.soldCount);

  const banner = {
    title: getSetting('banner_title', 'اینترنت آزاد، بدون محدودیت 🚀'),
    subtitle: getSetting('banner_subtitle', ''),
    priceText: getSetting('banner_price_text', ''),
    image: getSetting('banner_image', ''),
  };

  res.render('index', {
    title: 'صفحه اصلی',
    pageTitle: 'AurevonFilter | فروشگاه رسمی اروون فیلتر - اینترنت آزاد و VPN',
    metaDescription:
      'فروشگاه رسمی AurevonFilter (اروون فیلتر) — ارائه‌دهنده سرویس‌های VPN و اینترنت آزاد با پشتیبانی سریع و پرداخت امن. همین حالا اشتراک خود را تهیه کنید.',
    canonicalUrl: 'https://aurevonfilter-shop.up.railway.app/',
    products,
    categories,
    activeCat: categorySlug,
    q,
    sort,
    banner,
  });
});

// جزئیات محصول
router.get('/product/:slug', (req, res) => {
  const product = db
    .prepare(
      `SELECT products.*, categories.name as category_name FROM products
       LEFT JOIN categories ON products.category_id = categories.id
       WHERE products.slug = ? AND products.is_active = 1`
    )
    .get(req.params.slug);

  if (!product) {
    return res.status(404).render('error', { title: 'یافت نشد', message: 'محصول مورد نظر پیدا نشد.' });
  }

  const variants = db
    .prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY sort_order, id')
    .all(product.id);

  res.render('product', { title: product.title, product, variants });
});

// افزودن به سبد خرید
router.post('/cart/add', (req, res) => {
  const { product_id, variant_id, quantity } = req.body;
  const product = db
    .prepare(
      `SELECT products.*, categories.slug as category_slug FROM products
       LEFT JOIN categories ON products.category_id = categories.id
       WHERE products.id = ? AND products.is_active = 1`
    )
    .get(product_id);

  if (!product) {
    req.session.flash = { type: 'error', text: 'محصول یافت نشد.' };
    return res.redirect('back');
  }

  let variant = null;
  if (variant_id) {
    variant = db.prepare('SELECT * FROM product_variants WHERE id = ? AND product_id = ?').get(variant_id, product.id);
  }

  const hasVariants = db.prepare('SELECT COUNT(*) c FROM product_variants WHERE product_id = ?').get(product.id).c > 0;
  if (hasVariants && !variant) {
    req.session.flash = { type: 'error', text: 'لطفا یکی از حجم‌ها/پلن‌ها را انتخاب کنید.' };
    return res.redirect('/product/' + product.slug);
  }

  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  const cartKey = product.id + '-' + (variant ? variant.id : '0');
  const price = variant ? variant.price : product.price;

  if (!req.session.cart) req.session.cart = {};

  if (req.session.cart[cartKey]) {
    req.session.cart[cartKey].quantity += qty;
  } else {
    req.session.cart[cartKey] = {
      productId: product.id,
      variantId: variant ? variant.id : null,
      title: product.title,
      variantLabel: variant ? variant.label : null,
      price,
      image: product.image,
      slug: product.slug,
      categorySlug: product.category_slug || null,
      quantity: qty,
    };
  }

  req.session.flash = { type: 'success', text: 'محصول به سبد خرید اضافه شد.' };
  res.redirect('/cart');
});

// حذف از سبد خرید
router.post('/cart/remove', (req, res) => {
  const { cart_key } = req.body;
  if (req.session.cart && req.session.cart[cart_key]) {
    delete req.session.cart[cart_key];
  }
  res.redirect('/cart');
});

// آپدیت تعداد
router.post('/cart/update', (req, res) => {
  const { cart_key, quantity } = req.body;
  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  if (req.session.cart && req.session.cart[cart_key]) {
    req.session.cart[cart_key].quantity = qty;
  }
  res.redirect('/cart');
});

router.get('/cart', (req, res) => {
  const cart = req.session.cart || {};
  const items = Object.entries(cart).map(([key, item]) => ({ key, ...item }));
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  res.render('cart', { title: 'سبد خرید', items, total });
});

// مرحله ۱: اطلاعات گیرنده و ثبت سفارش
router.get('/checkout', requireLogin, (req, res) => {
  const cart = req.session.cart || {};
  const items = Object.entries(cart).map(([key, item]) => ({ key, ...item }));
  if (items.length === 0) {
    req.session.flash = { type: 'error', text: 'سبد خرید شما خالی است.' };
    return res.redirect('/cart');
  }
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  // اگر حداقل یک کالای فیزیکی (غیر از VPN/کانفیگ) در سبد باشد، آدرس پستی الزامی می‌شود
  const needsShipping = items.some((item) => item.categorySlug && item.categorySlug !== 'vpn');
  res.render('checkout', {
    title: 'تکمیل خرید',
    items,
    total,
    needsShipping,
    error: null,
  });
});

router.post('/checkout', requireLogin, (req, res) => {
  const cart = req.session.cart || {};
  const items = Object.entries(cart).map(([key, item]) => ({ key, ...item }));
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const needsShipping = items.some((item) => item.categorySlug && item.categorySlug !== 'vpn');

  if (items.length === 0) {
    req.session.flash = { type: 'error', text: 'سبد خرید شما خالی است.' };
    return res.redirect('/cart');
  }

  const { full_name, phone, postal_code, province, city, address } = req.body;
  if (!full_name || !phone) {
    return res.render('checkout', { title: 'تکمیل خرید', items, total, needsShipping, error: 'نام و شماره موبایل الزامی است.' });
  }
  if (needsShipping && (!postal_code || !province || !city || !address)) {
    return res.render('checkout', {
      title: 'تکمیل خرید',
      items,
      total,
      needsShipping,
      error: 'برای سفارش کالای فیزیکی، تکمیل کد پستی، استان، شهر و آدرس دقیق الزامی است.',
    });
  }

  const insertOrder = db.prepare(`
    INSERT INTO orders (user_id, full_name, phone, postal_code, province, city, address, total_price, status, payment_method)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'در انتظار پرداخت', 'card_to_card')
  `);
  const orderInfo = insertOrder.run(
    req.session.user.id,
    full_name.trim(),
    phone.trim(),
    (postal_code || '').trim(),
    (province || '').trim(),
    (city || '').trim(),
    (address || '').trim(),
    total
  );

  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, title_snapshot, variant_label, price, quantity)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  items.forEach((item) => {
    insertItem.run(orderInfo.lastInsertRowid, item.productId, item.title, item.variantLabel || null, item.price, item.quantity);
  });

  req.session.cart = {};
  res.redirect(`/checkout/pay/${orderInfo.lastInsertRowid}`);
});

// مرحله ۲: صفحه پرداخت - نمایش شماره کارت با قابلیت کپی
router.get('/checkout/pay/:id', requireLogin, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order || order.user_id !== req.session.user.id) {
    return res.status(404).render('error', { title: 'یافت نشد', message: 'سفارش پیدا نشد.' });
  }
  if (order.status !== 'در انتظار پرداخت') {
    return res.redirect(`/orders/${order.id}`);
  }

  res.render('checkout-pay', {
    title: 'پرداخت سفارش',
    order,
    cardNumber: getSetting('card_number', '----'),
    cardHolder: getSetting('card_holder', '----'),
    cardBank: getSetting('card_bank', ''),
  });
});

// مرحله ۳: آپلود رسید پرداخت
router.get('/checkout/receipt/:id', requireLogin, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order || order.user_id !== req.session.user.id) {
    return res.status(404).render('error', { title: 'یافت نشد', message: 'سفارش پیدا نشد.' });
  }
  if (order.status !== 'در انتظار پرداخت') {
    return res.redirect(`/orders/${order.id}`);
  }
  res.render('checkout-receipt', { title: 'آپلود رسید پرداخت', order, error: null });
});

router.post('/checkout/receipt/:id', requireLogin, uploadReceipt.single('receipt'), (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order || order.user_id !== req.session.user.id) {
    return res.status(404).render('error', { title: 'یافت نشد', message: 'سفارش پیدا نشد.' });
  }
  if (order.status !== 'در انتظار پرداخت') {
    return res.redirect(`/orders/${order.id}`);
  }

  if (!req.file) {
    return res.render('checkout-receipt', { title: 'آپلود رسید پرداخت', order, error: 'لطفا تصویر رسید پرداخت را آپلود کنید.' });
  }

  db.prepare(`UPDATE orders SET receipt_image = ?, status = 'در انتظار تایید پرداخت' WHERE id = ?`).run(
    req.file.filename,
    order.id
  );

  req.session.flash = {
    type: 'success',
    text: 'رسید شما با موفقیت ثبت شد. پس از تایید توسط ادمین، سفارش شما پردازش می‌شود.',
  };
  res.redirect(`/orders/${order.id}`);
});

router.get('/orders', requireLogin, (req, res) => {
  const orders = db
    .prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC')
    .all(req.session.user.id);
  res.render('orders', { title: 'سفارش‌های من', orders });
});

router.get('/orders/:id', requireLogin, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order || (order.user_id !== req.session.user.id && !req.session.user.is_admin)) {
    return res.status(404).render('error', { title: 'یافت نشد', message: 'سفارش پیدا نشد.' });
  }
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.render('order-detail', { title: 'جزئیات سفارش', order, items });
});

module.exports = router;

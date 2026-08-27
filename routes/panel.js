// روت مخفی ورود سریع به پنل ادمین - فقط با یک رمز، بدون نیاز به یوزرنیم/پسورد حساب کاربری.
// آدرس: /aurevonfilter
// بعد از وارد کردن رمز درست یک‌بار، همون دستگاه/مرورگر تا ۴۰۰ روز دیگه رمز نمی‌خواد.
// دستگاه‌های دیگه (یا وقتی کوکی پاک بشه) بازم رمز رو می‌خوان.

const express = require('express');
const crypto = require('crypto');
const { db } = require('../config/db');

const router = express.Router();

const COOKIE_NAME = 'aurevon_panel_trust';
const PANEL_PASSWORD = process.env.ADMIN_PANEL_PASSWORD || 'mehrsamrr';

// توکن اعتماد از هش رمز ساخته میشه (نه خود رمز)، پس اگه رمز رو عوض کنید
// همه دستگاه‌های قبلی خودکار نامعتبر میشن و دوباره رمز جدید رو می‌خوان.
function trustToken() {
  return crypto.createHmac('sha256', PANEL_PASSWORD).update('aurevon-trusted-device').digest('hex');
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const key = pair.slice(0, idx).trim();
      const val = decodeURIComponent(pair.slice(idx + 1).trim());
      cookies[key] = val;
    }
  });
  return cookies;
}

function isDeviceTrusted(req) {
  const cookies = parseCookies(req);
  return cookies[COOKIE_NAME] === trustToken();
}

// وقتی رمز درست بود، کاربر رو خودکار به‌عنوان همون ادمین موجود توی دیتابیس لاگین می‌کنیم
function logAdminIntoSession(req) {
  const adminUser = db.prepare('SELECT * FROM users WHERE is_admin = 1 ORDER BY id ASC LIMIT 1').get();
  if (adminUser) {
    req.session.user = {
      id: adminUser.id,
      name: adminUser.name,
      username: adminUser.username,
      phone: adminUser.phone,
      is_admin: 1,
    };
  }
  return adminUser;
}

router.get('/aurevonfilter', (req, res) => {
  if (isDeviceTrusted(req)) {
    logAdminIntoSession(req);
    return res.redirect('/admin');
  }
  res.render('panel-login', { title: 'ورود به پنل ادمین', error: null });
});

router.post('/aurevonfilter', (req, res) => {
  const { password } = req.body;

  if (password !== PANEL_PASSWORD) {
    return res.render('panel-login', { title: 'ورود به پنل ادمین', error: 'رمز اشتباه است.' });
  }

  res.cookie(COOKIE_NAME, trustToken(), {
    maxAge: 1000 * 60 * 60 * 24 * 400, // ۴۰۰ روز - حداکثر مجاز مرورگرها
    httpOnly: true,
    sameSite: 'lax',
  });

  const adminUser = logAdminIntoSession(req);
  if (!adminUser) {
    return res.render('panel-login', {
      title: 'ورود به پنل ادمین',
      error: 'هیچ اکانت ادمینی توی سایت پیدا نشد. اول باید یک اکانت ادمین بسازید.',
    });
  }

  res.redirect('/admin');
});

module.exports = router;

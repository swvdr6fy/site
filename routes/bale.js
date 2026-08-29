const express = require('express');
const { db } = require('../config/db');
const { requireLogin } = require('../middleware/auth');
const balePay = require('../utils/balePay');

const router = express.Router();

// صفحه اتصال حساب کاربری به بله (لازم قبل از اولین پرداخت با بله‌پی)
router.get('/bale/connect', requireLogin, (req, res) => {
  if (!balePay.isBalePayEnabled()) {
    return res.status(404).render('error', { title: 'یافت نشد', message: 'پرداخت با بله‌پی فعال نیست.' });
  }

  const connection = balePay.getConnection(req.session.user.id);
  const code = connection ? null : balePay.createLinkCode(req.session.user.id);
  const returnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : '/orders';

  res.render('bale-connect', {
    title: 'اتصال حساب به بله',
    connected: !!connection,
    deepLink: code ? balePay.connectDeepLink(code) : '',
    code,
    returnTo,
  });
});

// شروع پرداخت یک سفارش با بله‌پی: فاکتور ساخته و به چت کاربر در بله ارسال می‌شود
router.post('/checkout/pay/:id/bale', requireLogin, async (req, res) => {
  if (!balePay.isBalePayEnabled()) {
    req.session.flash = { type: 'error', text: 'پرداخت با بله‌پی فعال نیست.' };
    return res.redirect(`/checkout/pay/${req.params.id}`);
  }

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order || order.user_id !== req.session.user.id) {
    return res.status(404).render('error', { title: 'یافت نشد', message: 'سفارش پیدا نشد.' });
  }
  if (order.status !== 'در انتظار پرداخت') {
    return res.redirect(`/orders/${order.id}`);
  }

  try {
    await balePay.createAndSendInvoice(order, req.session.user);
    req.session.flash = {
      type: 'success',
      text: 'فاکتور پرداخت به چت شما در بله ارسال شد. لطفا اپلیکیشن بله را باز کنید و پرداخت را تکمیل کنید.',
    };
    return res.redirect(`/checkout/pay/${order.id}`);
  } catch (err) {
    if (err.code === 'NOT_CONNECTED') {
      return res.redirect(`/bale/connect?returnTo=${encodeURIComponent('/checkout/pay/' + order.id)}`);
    }
    req.session.flash = { type: 'error', text: 'ارسال فاکتور بله‌پی ناموفق بود: ' + err.message };
    return res.redirect(`/checkout/pay/${order.id}`);
  }
});

// وبهوک عمومی بله — بدون احراز هویت سشن؛ امنیت با رشته مخفی داخل مسیر و بررسی زمان‌ثابت تامین می‌شود
router.post('/webhook/bale/:secret', async (req, res) => {
  if (!balePay.verifySecret(req.params.secret)) {
    return res.status(404).end();
  }

  try {
    await balePay.handleWebhookUpdate(req.body || {});
  } catch (err) {
    console.error('bale webhook error:', err);
  }

  // همیشه 200 برگردانده می‌شود تا بله دوباره همان رویداد را رله نکند
  res.status(200).end();
});

module.exports = router;

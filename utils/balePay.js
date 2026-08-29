const crypto = require('crypto');
const { db } = require('../config/db');
const baleApi = require('./baleApi');

const LINK_CODE_MINUTES = 15;
const INVOICE_DEADLINE_MINUTES = 30;

const isBalePayEnabled = () => process.env.BALE_PAY_ENABLED === 'true' && baleApi.isConfigured();

function randomCode(bytes) {
  return crypto.randomBytes(bytes).toString('hex').toUpperCase();
}

function nowPlusMinutesIso(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function isExpired(isoString) {
  return new Date(isoString).getTime() < Date.now();
}

/* --------------------------------------------------------- account linking */

function getConnection(userId) {
  return db.prepare('SELECT * FROM bale_connections WHERE user_id = ?').get(userId) || null;
}

/** یک کد یک‌بارمصرف تازه برای اتصال حساب کاربر به چت بله می‌سازد (کدهای قبلیِ منقضی‌نشده حذف می‌شوند). */
function createLinkCode(userId) {
  db.prepare('DELETE FROM bale_link_codes WHERE user_id = ?').run(userId);
  const code = randomCode(4); // 8 کاراکتر هگز، به اندازه کافی کوتاه برای تایپ دستی
  db.prepare('INSERT INTO bale_link_codes (code, user_id, expires_at) VALUES (?, ?, ?)').run(
    code,
    userId,
    nowPlusMinutesIso(LINK_CODE_MINUTES)
  );
  return code;
}

function connectDeepLink(code) {
  const username = process.env.BALE_BOT_USERNAME || '';
  if (!username) return '';
  return `https://ble.ir/${encodeURIComponent(username)}?start=${encodeURIComponent(code)}`;
}

/** کد را مصرف کرده و حساب کاربر را به چت بله متصل می‌کند. خروجی: userId متصل‌شده یا null. */
function consumeLinkCode(code, chatId, baleUserId, username, firstName) {
  const link = db.prepare('SELECT * FROM bale_link_codes WHERE code = ?').get(code);
  if (!link) return null;

  db.prepare('DELETE FROM bale_link_codes WHERE code = ?').run(code);
  if (isExpired(link.expires_at)) return null;

  db.prepare(
    `INSERT INTO bale_connections (user_id, chat_id, bale_user_id, username, first_name)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET chat_id = excluded.chat_id, bale_user_id = excluded.bale_user_id,
       username = excluded.username, first_name = excluded.first_name`
  ).run(link.user_id, chatId, baleUserId, username, firstName);

  return link.user_id;
}

/* ------------------------------------------------------------ invoice flow */

/** فاکتور بله‌پی برای یک سفارش می‌سازد و به چت مشتری ارسال می‌کند. order.total_price به تومان است. */
async function createAndSendInvoice(order, user) {
  const connection = getConnection(user.id);
  if (!connection) {
    const err = new Error('حساب شما هنوز به بله متصل نشده است.');
    err.code = 'NOT_CONNECTED';
    throw err;
  }

  const publicId = randomCode(16);
  const amountRial = order.total_price * 10; // تومان -> ریال

  db.prepare(
    `INSERT INTO bale_payments (public_id, order_id, user_id, chat_id, amount_rial, status, expires_at)
     VALUES (?, ?, ?, ?, ?, 'sent', ?)`
  ).run(publicId, order.id, user.id, connection.chat_id, amountRial, nowPlusMinutesIso(INVOICE_DEADLINE_MINUTES));

  const shopName = process.env.SHOP_NAME || 'فروشگاه';
  await baleApi.sendInvoice(
    connection.chat_id,
    `سفارش #${order.id} - ${shopName}`,
    `پرداخت سفارش شماره ${order.id} در ${shopName}`,
    publicId,
    amountRial
  );

  return publicId;
}

function findPaymentByPublicId(publicId) {
  return db.prepare('SELECT * FROM bale_payments WHERE public_id = ?').get(publicId) || null;
}

/* ------------------------------------------------------------------ webhook */

function verifySecret(providedSecret) {
  const expected = process.env.BALE_WEBHOOK_SECRET || '';
  if (!expected || !providedSecret) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(providedSecret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function markOrderPaid(orderId, chargeId) {
  db.prepare(
    `UPDATE orders SET status = 'پرداخت تایید شد',
       admin_note = COALESCE(admin_note || char(10), '') || ?
     WHERE id = ?`
  ).run(`پرداخت بله‌پی تایید شد. شناسه تراکنش: ${chargeId}`, orderId);
}

function flagOrderForReview(orderId, note) {
  db.prepare(
    `UPDATE orders SET admin_note = COALESCE(admin_note || char(10), '') || ? WHERE id = ?`
  ).run(note, orderId);
}

function validatePayment(payment, chatId, currency, amount) {
  if (!payment) return 'درخواست پرداخت معتبر نیست.';
  if (payment.status !== 'sent') return 'این درخواست پرداخت قابل استفاده نیست.';
  if (isExpired(payment.expires_at)) return 'مهلت پرداخت این فاکتور پایان یافته است.';
  if (payment.chat_id !== String(chatId)) return 'این فاکتور متعلق به حساب بلهٔ دیگری است.';
  if (String(currency).toUpperCase() !== 'IRR' || payment.amount_rial !== amount) {
    return 'مبلغ یا واحد پول فاکتور با سفارش مطابقت ندارد.';
  }
  return null;
}

/** یک آبجکت update دریافتی از وبهوک بله را پردازش می‌کند. خروجی یک برچسب کوتاه برای لاگ است. */
async function handleWebhookUpdate(update) {
  if (update.pre_checkout_query) {
    return handlePreCheckout(update.pre_checkout_query);
  }
  if (update.message && update.message.successful_payment) {
    return handleSuccessfulPayment(update.message);
  }
  if (update.message) {
    return handleMessage(update.message);
  }
  return 'ignored';
}

async function handleMessage(message) {
  const text = String(message.text || '').trim();
  const match = text.match(/^\/start(?:\s+([A-Za-z0-9]+))?$/);
  if (!match) return 'ignored';

  const chatId = String((message.chat && message.chat.id) || '');
  const fromId = String((message.from && message.from.id) || '');
  if (!chatId || !fromId || chatId !== fromId) return 'ignored';

  const code = (match[1] || '').toUpperCase();
  if (!code) {
    await safely(() => baleApi.sendMessage(chatId, 'برای اتصال حساب، از صفحه پرداخت فروشگاه یک لینک اتصال بگیرید.'));
    return 'start_without_code';
  }

  const username = (message.from && message.from.username) || '';
  const firstName = (message.from && message.from.first_name) || '';
  const linkedUserId = consumeLinkCode(code, chatId, fromId, username, firstName);

  if (!linkedUserId) {
    await safely(() => baleApi.sendMessage(chatId, 'کد اتصال نامعتبر یا منقضی شده است. از فروشگاه یک کد جدید بگیرید.'));
    return 'bad_code';
  }

  await safely(() => baleApi.sendMessage(chatId, 'حساب شما با موفقیت به فروشگاه متصل شد ✅ اکنون به صفحه پرداخت برگردید.'));
  return 'linked';
}

async function handlePreCheckout(query) {
  const payment = findPaymentByPublicId(query.invoice_payload || '');
  const error = validatePayment(
    payment,
    (query.from && query.from.id) || '',
    query.currency || '',
    typeof query.total_amount === 'number' ? query.total_amount : -1
  );
  const queryId = query.id || '';

  if (error) {
    await safely(() => baleApi.answerPreCheckout(queryId, false, error));
    return 'pre_checkout_refused';
  }
  await safely(() => baleApi.answerPreCheckout(queryId, true));
  return 'pre_checkout_ok';
}

async function handleSuccessfulPayment(message) {
  const success = message.successful_payment;
  const payment = findPaymentByPublicId(success.invoice_payload || '');
  const chargeId = String(success.telegram_payment_charge_id || success.provider_payment_charge_id || '').trim();

  if (payment && payment.status === 'paid') {
    return payment.charge_id === chargeId ? 'duplicate_ignored' : 'duplicate_conflict';
  }

  const fromId = (message.from && message.from.id) || (message.chat && message.chat.id) || '';
  const error = validatePayment(payment, fromId, success.currency || '', success.total_amount);

  if (error) {
    if (payment) {
      db.prepare(`UPDATE bale_payments SET status = 'pending_review' WHERE id = ?`).run(payment.id);
      flagOrderForReview(
        payment.order_id,
        `رویداد پرداخت بله‌پی دریافت شد اما اعتبارسنجی ناموفق بود: ${error}${chargeId ? ' — شناسه: ' + chargeId : ''}`
      );
    }
    return 'needs_review';
  }

  if (!chargeId) {
    db.prepare(`UPDATE bale_payments SET status = 'pending_review' WHERE id = ?`).run(payment.id);
    return 'needs_review';
  }

  // ایندکس یکتای charge_id تضمین می‌کند تحویل تکراری وبهوک دوبار سفارش را تکمیل نکند.
  let updated;
  try {
    updated = db
      .prepare(`UPDATE bale_payments SET status = 'paid', charge_id = ? WHERE id = ? AND status = 'sent'`)
      .run(chargeId, payment.id);
  } catch {
    updated = { changes: 0 }; // برخورد با ایندکس یکتا روی charge_id تکراری
  }

  if (!updated.changes) {
    db.prepare(`UPDATE bale_payments SET status = 'pending_review' WHERE id = ?`).run(payment.id);
    return 'needs_review';
  }

  markOrderPaid(payment.order_id, chargeId);
  return 'paid';
}

async function safely(fn) {
  try {
    await fn();
  } catch {
    // ارتباط برگشتی با بله فقط یک لطف است؛ نباید ثبت سفارش را متوقف کند.
  }
}

module.exports = {
  isBalePayEnabled,
  getConnection,
  createLinkCode,
  connectDeepLink,
  createAndSendInvoice,
  findPaymentByPublicId,
  verifySecret,
  handleWebhookUpdate,
};

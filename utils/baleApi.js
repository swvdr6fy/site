// کلاینت ساده برای Bale Bot API (https://tapi.bale.ai)
// از fetch داخلی Node 20 استفاده می‌کند، بدون هیچ وابستگی اضافه‌ای.

const BASE = 'https://tapi.bale.ai/bot';

function getBotToken() {
  return process.env.BALE_BOT_TOKEN || '';
}

function getProviderToken() {
  return process.env.BALE_PROVIDER_TOKEN || '';
}

function isConfigured() {
  return !!(getBotToken() && getProviderToken() && process.env.BALE_BOT_USERNAME);
}

async function call(method, params = {}) {
  const token = getBotToken();
  if (!token) {
    throw new Error('توکن ربات بله (BALE_BOT_TOKEN) تنظیم نشده است.');
  }

  const url = `${BASE}${encodeURIComponent(token)}/${encodeURIComponent(method)}`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new Error('ارتباط با بله برقرار نشد: ' + err.message);
  }

  let decoded;
  try {
    decoded = await response.json();
  } catch {
    throw new Error(`پاسخ نامعتبر از بله دریافت شد (کد ${response.status}).`);
  }

  if (!response.ok || !decoded.ok) {
    const message = decoded && decoded.description ? decoded.description : 'پاسخ نامعتبر از بله دریافت شد.';
    throw new Error(message);
  }

  return decoded.result ?? true;
}

function sendMessage(chatId, text) {
  return call('sendMessage', { chat_id: chatId, text });
}

/**
 * ارسال فاکتور قابل‌پرداخت به چت مشتری در بله.
 * payload همان public_id مبهم پرداخت است؛ هیچ‌وقت شماره سفارش قابل‌حدس نیست.
 */
function sendInvoice(chatId, title, description, payload, amountRial) {
  const providerToken = getProviderToken();
  if (!providerToken) {
    throw new Error('توکن پذیرنده بله‌پی (BALE_PROVIDER_TOKEN) تنظیم نشده است.');
  }

  return call('sendInvoice', {
    chat_id: chatId,
    title: String(title).slice(0, 32),
    description: String(description).slice(0, 255),
    payload,
    provider_token: providerToken,
    start_parameter: String(payload).replace(/[^A-Za-z0-9_]/g, '').slice(0, 32),
    currency: 'IRR',
    prices: [{ label: String(title).slice(0, 32), amount: amountRial }],
  });
}

function answerPreCheckout(queryId, ok, errorMessage = '') {
  const params = { pre_checkout_query_id: queryId, ok };
  if (!ok) params.error_message = errorMessage;
  return call('answerPreCheckoutQuery', params);
}

function setWebhook(url) {
  return call('setWebhook', { url });
}

function getWebhookInfo() {
  return call('getWebhookInfo');
}

function getMe() {
  return call('getMe');
}

module.exports = {
  isConfigured,
  sendMessage,
  sendInvoice,
  answerPreCheckout,
  setWebhook,
  getWebhookInfo,
  getMe,
};

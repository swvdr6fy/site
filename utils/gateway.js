// این فایل محل آماده برای اتصال درگاه پرداخت آنلاین cartbecart.ir در آینده است.
// فعلا فقط روش «کارت به کارت + آپلود رسید» فعال است.
//
// وقتی خواستی درگاه آنلاین رو وصل کنی:
// 1) در فایل .env مقدار PAYMENT_GATEWAY_ENABLED=true کن و CARTBECART_MERCHANT_ID / CARTBECART_API_KEY رو پر کن.
// 2) داخل تابع createPaymentRequest، طبق مستندات cartbecart.ir یک درخواست به API اونها بزن و لینک پرداخت رو برگردون.
// 3) یک روت callback مثل POST /payment/callback برای verify شدن تراکنش اضافه کن و وضعیت سفارش رو آپدیت کن.

const isGatewayEnabled = () => process.env.PAYMENT_GATEWAY_ENABLED === 'true';

async function createPaymentRequest({ orderId, amount, callbackUrl }) {
  if (!isGatewayEnabled()) {
    throw new Error('درگاه پرداخت آنلاین هنوز فعال نشده است. لطفا از روش کارت به کارت استفاده کنید.');
  }

  // نمونه پیاده‌سازی آینده (باید طبق مستندات واقعی cartbecart.ir اصلاح بشه):
  //
  // const response = await fetch('https://cartbecart.ir/api/v1/payment/request', {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     Authorization: `Bearer ${process.env.CARTBECART_API_KEY}`,
  //   },
  //   body: JSON.stringify({
  //     merchant_id: process.env.CARTBECART_MERCHANT_ID,
  //     amount,
  //     order_id: orderId,
  //     callback_url: callbackUrl,
  //   }),
  // });
  // const data = await response.json();
  // return data.payment_url;

  throw new Error('پیاده‌سازی درگاه هنوز تکمیل نشده است.');
}

module.exports = { isGatewayEnabled, createPaymentRequest };

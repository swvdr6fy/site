// این اسکریپت یک یوزر موجود رو ادمین می‌کنه.
// اجرا روی سرور (یا لوکال، کنار همون فایل data/shop.db):
//   node config/make-admin.js mehrsam
// یا با شماره موبایل:
//   node config/make-admin.js --phone 09918180709

const { db } = require('./db');

const arg = process.argv[2];

if (!arg) {
  console.log('استفاده: node config/make-admin.js <username>');
  console.log('   یا:   node config/make-admin.js --phone <phone>');
  process.exit(1);
}

let user;
if (arg === '--phone') {
  const phone = process.argv[3];
  user = db.prepare('SELECT id, name, username, phone, is_admin FROM users WHERE phone = ?').get(phone);
} else {
  user = db.prepare('SELECT id, name, username, phone, is_admin FROM users WHERE username = ?').get(arg);
}

if (!user) {
  console.log('❌ کاربری با این مشخصات پیدا نشد.');
  process.exit(1);
}

if (user.is_admin) {
  console.log(`✔ کاربر «${user.username}» از قبل ادمین است.`);
  process.exit(0);
}

db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
console.log(`✔ کاربر «${user.username}» (${user.name} - ${user.phone}) با موفقیت ادمین شد.`);

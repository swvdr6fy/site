const bcrypt = require('bcryptjs');
const { db, setSetting, getSetting } = require('./db');
const { generateProductPoster } = require('../utils/poster');

function slugify(str) {
  return str
    .toString()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\u0600-\u06FFa-zA-Z0-9-]/g, '');
}

function seed() {
  // ادمین اولیه
  const adminPhone = process.env.ADMIN_PHONE || '09120000000';
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const existingAdmin = db.prepare('SELECT id, username FROM users WHERE phone = ?').get(adminPhone);
  if (!existingAdmin) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123456', 10);
    db.prepare(
      `INSERT INTO users (name, username, phone, email, password_hash, is_admin) VALUES (?, ?, ?, ?, ?, 1)`
    ).run(process.env.ADMIN_NAME || 'مدیر فروشگاه', adminUsername, adminPhone, '', hash);
    console.log('✔ ادمین اولیه ساخته شد. نام کاربری:', adminUsername, '- شماره:', adminPhone);
  } else if (!existingAdmin.username) {
    // بازسازی ادمین قدیمی که هنوز نام کاربری ندارد
    db.prepare('UPDATE users SET username = ? WHERE id = ?').run(adminUsername, existingAdmin.id);
    console.log('✔ نام کاربری ادمین قدیمی تنظیم شد:', adminUsername);
  }

  // ارتقای دستی یک اکانت مشخص به ادمین (برای رفع مشکل عدم دسترسی به پنل ادمین)
  // این بخش هر بار سرور بالا میاد چک می‌شه و اگر کاربر پیدا بشه و ادمین نباشه، ادمینش می‌کنه.
  const promoteUsername = 'mehrsam';
  const userToPromote = db.prepare('SELECT id, username, is_admin FROM users WHERE username = ?').get(promoteUsername);
  if (userToPromote && !userToPromote.is_admin) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(userToPromote.id);
    console.log('✔ کاربر', promoteUsername, 'به ادمین ارتقا یافت.');
  }

  // دسته‌بندی‌های پیش‌فرض - VPN و پوشاک
  db.prepare('INSERT OR IGNORE INTO categories (name, slug) VALUES (?, ?)').run('اکانت و کانفیگ VPN', 'vpn');
  db.prepare('INSERT OR IGNORE INTO categories (name, slug) VALUES (?, ?)').run('پوشاک', 'clothes');

  // محصول کانفیگ‌های گیگی (نرخ هر گیگ به‌آرومی صعودیه: از ۳,۰۰۰ تومان در ۱ گیگ تا ۴,۰۰۰ تومان در ۱۰۰ گیگ - برای جلوگیری از ضرر)
  const gigPricingSlug = 'kanfig-haye-gigi';
  const oldGigProduct = db.prepare('SELECT id FROM products WHERE slug = ?').get('kanfig-gigi');
  if (oldGigProduct) {
    // حذف نسخه قبلی محصول با قیمت‌گذاری اشتباه (تخفیف حجمی که باعث ضرر می‌شد)
    db.prepare('DELETE FROM products WHERE id = ?').run(oldGigProduct.id);
  }
  const existingGigProduct = db.prepare('SELECT id FROM products WHERE slug = ?').get(gigPricingSlug);
  if (!existingGigProduct) {
    const vpnCatForGig = db.prepare('SELECT id FROM categories WHERE slug = ?').get('vpn');
    const shopNameForGig = process.env.SHOP_NAME || 'AurevonFilter';
    const gigTitle = 'کانفیگ‌های گیگی';

    const gigPriceTable = {
      1: 3000, 2: 6300, 3: 9600, 4: 13000, 5: 16600,
      6: 20100, 7: 23700, 8: 27300, 9: 31000, 10: 34600,
      15: 53300, 20: 72300, 25: 91700, 30: 111200, 35: 131000,
      40: 151000, 45: 171200, 50: 191500, 60: 232300, 70: 273400,
      80: 315300, 90: 357300, 100: 400000, 200: 834000,
    };

    const gigVariants = Object.entries(gigPriceTable).map(([gb, price]) => ({
      label: `${gb} گیگابایت`,
      price,
    }));

    const gigPosterFile = generateProductPoster({
      title: gigTitle,
      categoryLabel: 'اکانت و کانفیگ VPN',
      shopName: shopNameForGig,
      isFeatured: true,
    });

    const gigInfo = db
      .prepare(
        `INSERT INTO products (title, slug, description, price, stock, category_id, image, is_active, is_featured)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`
      )
      .run(
        gigTitle,
        gigPricingSlug,
        'کانفیگ‌های گیگی از ۱ گیگ تا ۲۰۰ گیگ، شروع قیمت از ۳,۰۰۰ تومان. حجم دلخواه خودتون رو انتخاب کنید.',
        gigVariants[0].price,
        999,
        vpnCatForGig.id,
        gigPosterFile
      );

    const insertGigVariant = db.prepare(
      `INSERT INTO product_variants (product_id, label, price, stock, sort_order) VALUES (?, ?, ?, ?, ?)`
    );
    gigVariants.forEach((v, idx) => {
      insertGigVariant.run(gigInfo.lastInsertRowid, v.label, v.price, 999, idx);
    });

    console.log('✔ محصول «کانفیگ‌های گیگی» با', gigVariants.length, 'پلن ساخته شد.');
  }

  // چند محصول نمونه با پلن‌های حجمی مختلف - فقط اگر هیچ محصولی وجود نداره
  const productCount = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  if (productCount === 0) {
    const vpnCat = db.prepare('SELECT id FROM categories WHERE slug = ?').get('vpn');
    const clothesCat = db.prepare('SELECT id FROM categories WHERE slug = ?').get('clothes');
    const shopName = process.env.SHOP_NAME || 'AurevonFilter';

    const insertProduct = db.prepare(`
      INSERT INTO products (title, slug, description, price, stock, category_id, image, is_active, is_featured)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
    const insertVariant = db.prepare(`
      INSERT INTO product_variants (product_id, label, price, stock, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);

    const vpnSamples = [
      {
        title: 'کانفیگ V2Ray - چند حجمی',
        desc: 'اتصال پرسرعت و پایدار، سازگار با موبایل و کامپیوتر، پشتیبانی ۲۴ ساعته. حجم دلخواه خودتون رو انتخاب کنید.',
        featured: 1,
        variants: [
          { label: '30 گیگابایت - 1 ماهه', price: 150000, stock: 999 },
          { label: '60 گیگابایت - 1 ماهه', price: 250000, stock: 999 },
          { label: '120 گیگابایت - 2 ماهه', price: 420000, stock: 999 },
          { label: 'نامحدود - 1 ماهه', price: 550000, stock: 999 },
        ],
      },
      {
        title: 'اکانت VPN چند کاربره',
        desc: 'قابل استفاده روی چند دستگاه همزمان، سرعت بالا برای گیمینگ و استریم. مدت زمان اشتراک رو انتخاب کنید.',
        featured: 0,
        variants: [
          { label: '1 ماهه - 2 کاربره', price: 220000, stock: 999 },
          { label: '3 ماهه - 2 کاربره', price: 580000, stock: 999 },
          { label: '6 ماهه - 3 کاربره', price: 990000, stock: 999 },
        ],
      },
      {
        title: 'کانفیگ WireGuard فوق‌سریع',
        desc: 'مناسب گیمینگ و کارهای حساس به تاخیر (پینگ پایین)، پایداری بالا در ساعات پرترافیک.',
        featured: 0,
        variants: [
          { label: '50 گیگابایت - 1 ماهه', price: 180000, stock: 999 },
          { label: '100 گیگابایت - 1 ماهه', price: 300000, stock: 999 },
        ],
      },
    ];

    const clothesSamples = [
      {
        title: 'هودی اورجینال طرح ساده',
        desc: 'هودی نخی باکیفیت، دوخت درجه‌یک، مناسب استفاده روزمره. سایز مورد نظرتون رو انتخاب کنید.',
        featured: 1,
        variants: [
          { label: 'سایز M', price: 620000, stock: 20 },
          { label: 'سایز L', price: 620000, stock: 20 },
          { label: 'سایز XL', price: 650000, stock: 15 },
        ],
      },
      {
        title: 'تیشرت بیسیک پنبه‌ای',
        desc: 'تیشرت نخ پنبه ۱۰۰٪، رنگ ثابت، بدون رنگ‌پذیری. در چند سایز موجود.',
        featured: 0,
        variants: [
          { label: 'سایز S', price: 280000, stock: 30 },
          { label: 'سایز M', price: 280000, stock: 30 },
          { label: 'سایز L', price: 290000, stock: 25 },
        ],
      },
    ];

    const seedCategory = (samples, categoryId) => {
      samples.forEach((p) => {
        const slug = slugify(p.title) + '-' + Date.now().toString().slice(-5) + Math.floor(Math.random() * 90 + 10);
        const categoryName = categoryId === vpnCat.id ? 'اکانت و کانفیگ VPN' : 'پوشاک';
        const posterFile = generateProductPoster({ title: p.title, categoryLabel: categoryName, shopName });
        const info = insertProduct.run(
          p.title,
          slug,
          p.desc,
          p.variants[0].price,
          p.variants.reduce((s, v) => s + v.stock, 0),
          categoryId,
          posterFile,
          p.featured
        );
        p.variants.forEach((v, idx) => {
          insertVariant.run(info.lastInsertRowid, v.label, v.price, v.stock, idx);
        });
      });
    };

    seedCategory(vpnSamples, vpnCat.id);
    seedCategory(clothesSamples, clothesCat.id);
    console.log('✔ محصولات نمونه با پلن‌های حجمی اضافه شدند.');
  }

  // تنظیمات پیش‌فرض بنر/پوستر صفحه اصلی
  if (!getSetting('banner_title')) {
    setSetting('banner_title', 'اینترنت آزاد، بدون محدودیت 🚀');
    setSetting('banner_subtitle', 'بهترین کانفیگ‌ها و اکانت‌های VPN با سرعت بالا، هر حجمی که بخوای با بهترین قیمت.');
    setSetting('banner_price_text', 'شروع قیمت از 150,000 تومان');
    setSetting('banner_image', '');
  }

  // شماره کارت پیش‌فرض در صورت خالی بودن env
  if (!getSetting('card_number') && process.env.CARD_NUMBER) {
    setSetting('card_number', process.env.CARD_NUMBER);
    setSetting('card_holder', process.env.CARD_HOLDER || '');
    setSetting('card_bank', process.env.CARD_BANK || '');
  }
}

module.exports = { seed, slugify };

if (require.main === module) {
  seed();
  console.log('✔ Seed کامل شد.');
}

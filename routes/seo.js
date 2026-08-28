const express = require('express');
const { db } = require('../config/db');

const router = express.Router();

// آدرس پایه سایت — از متغیر محیطی SITE_URL قابل تغییر است،
// در صورت نبود آن، دامنه پیش‌فرض Railway استفاده می‌شود.
const SITE_URL = (process.env.SITE_URL || 'https://aurevonfilter-shop.up.railway.app').replace(/\/+$/, '');

function escapeXml(str) {
  return String(str).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case "'":
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}

router.get('/sitemap.xml', (req, res) => {
  const urls = [];

  // صفحه اصلی
  urls.push({ loc: `${SITE_URL}/`, changefreq: 'daily', priority: '1.0' });

  // دسته‌بندی‌ها (صفحه اصلی با فیلتر دسته‌بندی)
  try {
    const categories = db.prepare('SELECT slug FROM categories ORDER BY name').all();
    categories.forEach((c) => {
      urls.push({
        loc: `${SITE_URL}/?cat=${encodeURIComponent(c.slug)}`,
        changefreq: 'weekly',
        priority: '0.7',
      });
    });
  } catch (e) {
    console.error('sitemap: could not read categories', e);
  }

  // محصولات فعال
  try {
    const products = db
      .prepare('SELECT slug, created_at FROM products WHERE is_active = 1 ORDER BY created_at DESC')
      .all();
    products.forEach((p) => {
      const entry = {
        loc: `${SITE_URL}/product/${encodeURIComponent(p.slug)}`,
        changefreq: 'weekly',
        priority: '0.8',
      };
      if (p.created_at) {
        const d = new Date(p.created_at);
        if (!isNaN(d.getTime())) {
          entry.lastmod = d.toISOString().split('T')[0];
        }
      }
      urls.push(entry);
    });
  } catch (e) {
    console.error('sitemap: could not read products', e);
  }

  // صفحات عمومی ثابت (ورود و ثبت‌نام صفحات عمومی هستند، نیازی به لاگین ندارند)
  urls.push({ loc: `${SITE_URL}/login`, changefreq: 'monthly', priority: '0.3' });
  urls.push({ loc: `${SITE_URL}/register`, changefreq: 'monthly', priority: '0.3' });

  const xmlEntries = urls
    .map((u) => {
      let entry = `  <url>\n    <loc>${escapeXml(u.loc)}</loc>\n`;
      if (u.lastmod) entry += `    <lastmod>${u.lastmod}</lastmod>\n`;
      if (u.changefreq) entry += `    <changefreq>${u.changefreq}</changefreq>\n`;
      if (u.priority) entry += `    <priority>${u.priority}</priority>\n`;
      entry += '  </url>';
      return entry;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${xmlEntries}\n</urlset>\n`;

  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.status(200).send(xml);
});

router.get('/robots.txt', (req, res) => {
  const txt = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /aurevonfilter
Disallow: /cart
Disallow: /checkout
Disallow: /orders

Sitemap: ${SITE_URL}/sitemap.xml
`;
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.status(200).send(txt);
});

module.exports = router;

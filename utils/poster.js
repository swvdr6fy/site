const fs = require('fs');
const path = require('path');
const { PRODUCTS_UPLOAD_DIR } = require('../config/db');

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// شکستن عنوان طولانی به چند خط برای جا شدن داخل پوستر
function wrapTitle(title, maxChars) {
  const words = String(title).split(' ');
  const lines = [];
  let current = '';
  words.forEach((w) => {
    if ((current + ' ' + w).trim().length > maxChars) {
      if (current) lines.push(current.trim());
      current = w;
    } else {
      current = (current + ' ' + w).trim();
    }
  });
  if (current) lines.push(current.trim());
  return lines.slice(0, 3);
}

// هش ساده و پایدار از یک رشته، برای انتخاب یکنواخت رنگ/ترکیب هر محصول
function hashString(str) {
  let h = 0;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

// خانواده‌های رنگی هماهنگ با Design System سایت (Blue/Violet/Cyan/Purple/Magenta/Emerald/Amber)
const PALETTES = [
  { from: '#0f1f4d', mid: '#3b82f6', to: '#0c2b52', accent: '#60a5fa' }, // آبی الکتریک
  { from: '#1c0f4d', mid: '#7c3aed', to: '#0c2b52', accent: '#8b5cf6' }, // بنفش/ایندیگو
  { from: '#2a0f52', mid: '#a855f7', to: '#3b1d78', accent: '#c084fc' }, // پرپل
  { from: '#062f2c', mid: '#10b981', to: '#0c2b52', accent: '#34d399' }, // زمرد
  { from: '#3a0d3f', mid: '#d946ef', to: '#3b1d78', accent: '#e879f9' }, // مجنتا (ویژه)
  { from: '#3a2206', mid: '#f59e0b', to: '#7c3aed', accent: '#fbbf24' }, // امبر (پرفروش)
];

/**
 * پوستر برندی SVG برای محصولی که تصویر ندارد می‌سازد (هماهنگ با Design System چندرنگ سایت)
 * و آن را داخل پوشه آپلود محصولات ذخیره می‌کند. نام فایل ساخته‌شده را برمی‌گرداند.
 *
 * رنگ‌بندی بر اساس هش عنوان محصول به‌صورت پایدار انتخاب می‌شود تا محصولات مختلف
 * ترکیب‌های بصری متفاوتی داشته باشند، و پلن‌های ویژه/پرفروش پالت اختصاصی می‌گیرند.
 */
function generateProductPoster({ title, categoryLabel, shopName, isFeatured, isBestseller }) {
  const lines = wrapTitle(title || 'محصول', 16);
  const startY = 205 - (lines.length - 1) * 26;

  let palette;
  if (isFeatured) palette = PALETTES[4];
  else if (isBestseller) palette = PALETTES[5];
  else palette = PALETTES[hashString(title) % 4];

  const isVpn = /vpn|وی‌پی‌ان|کانفیگ|فیلتر/i.test(`${title} ${categoryLabel}`);

  const svg = `
<svg width="800" height="600" viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${palette.from}"/>
      <stop offset="55%" stop-color="${palette.mid}"/>
      <stop offset="100%" stop-color="${palette.to}"/>
    </linearGradient>
    <linearGradient id="brand" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${palette.mid}"/>
      <stop offset="100%" stop-color="${palette.accent}"/>
    </linearGradient>
    <radialGradient id="glow1" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${palette.accent}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${palette.accent}" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-width="1"/>
    </pattern>
    <linearGradient id="fade" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="55%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.4"/>
    </linearGradient>
  </defs>

  <rect width="800" height="600" fill="url(#bg)"/>
  <rect width="800" height="600" fill="url(#grid)"/>
  <circle cx="650" cy="80" r="230" fill="url(#glow1)"/>
  <circle cx="90" cy="530" r="230" fill="url(#glow2)"/>
  <rect width="800" height="600" fill="url(#fade)"/>

  <!-- لوگو -->
  <g transform="translate(60,54)">
    <rect width="54" height="54" rx="16" fill="url(#brand)"/>
    <text x="27" y="37" font-size="26" font-weight="900" fill="#ffffff" text-anchor="middle" font-family="Tahoma, sans-serif">A</text>
  </g>
  <text x="128" y="88" font-size="20" font-weight="800" fill="#ffffff" font-family="Tahoma, sans-serif">${escapeXml(shopName || 'AurevonFilter')}</text>

  ${isFeatured ? `<g transform="translate(600,50)"><rect width="140" height="34" rx="17" fill="#ffffff" fill-opacity="0.16" stroke="#ffffff" stroke-opacity="0.3"/><text x="70" y="23" font-size="14" font-weight="800" fill="#ffffff" text-anchor="middle" font-family="Tahoma, sans-serif">✦ پلن ویژه</text></g>` : ''}
  ${!isFeatured && isBestseller ? `<g transform="translate(600,50)"><rect width="140" height="34" rx="17" fill="#ffffff" fill-opacity="0.16" stroke="#ffffff" stroke-opacity="0.3"/><text x="70" y="23" font-size="14" font-weight="800" fill="#ffffff" text-anchor="middle" font-family="Tahoma, sans-serif">پرفروش‌ترین</text></g>` : ''}

  <!-- نشان دسته‌بندی -->
  ${categoryLabel ? `<rect x="60" y="130" width="${Math.min(260, 40 + categoryLabel.length * 13)}" height="34" rx="17" fill="#ffffff" fill-opacity="0.12" stroke="#ffffff" stroke-opacity="0.25"/>
  <text x="80" y="153" font-size="15" font-weight="700" fill="${palette.accent}" font-family="Tahoma, sans-serif">${escapeXml(categoryLabel)}</text>` : ''}

  <!-- آیکون مرکزی -->
  <g transform="translate(400,300)" opacity="0.98">
    <circle r="88" fill="#ffffff" fill-opacity="0.07" stroke="#ffffff" stroke-opacity="0.22" stroke-width="1.5"/>
    <circle r="70" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1"/>
    ${
      isVpn
        ? `<path d="M0,-38 L34,-22 V10 C34,34 17,50 0,58 C-17,50 -34,34 -34,10 V-22 Z" fill="#ffffff" fill-opacity="0.92"/><path d="M-14,4 L-4,16 L18,-10" fill="none" stroke="${palette.mid}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<rect x="-32" y="-30" width="64" height="60" rx="10" fill="#ffffff" fill-opacity="0.92"/><path d="M-32,-14 H32 M-16,-30 V-14 M16,-30 V-14" stroke="${palette.mid}" stroke-width="5" fill="none"/>`
    }
  </g>

  <!-- عنوان محصول -->
  <g font-family="Tahoma, sans-serif" font-weight="800" fill="#ffffff" text-anchor="middle">
    ${lines
      .map(
        (line, i) =>
          `<text x="400" y="${startY + i * 52}" font-size="34">${escapeXml(line)}</text>`
      )
      .join('\n    ')}
  </g>

  <text x="400" y="560" font-size="14" letter-spacing="3" fill="#dbe1ff" fill-opacity="0.75" text-anchor="middle" font-family="Tahoma, sans-serif">AUREVON • SECURE • PREMIUM</text>
</svg>`.trim();

  const filename = `poster-${Date.now()}-${Math.round(Math.random() * 1e6)}.svg`;
  fs.writeFileSync(path.join(PRODUCTS_UPLOAD_DIR, filename), svg, 'utf8');
  return filename;
}

module.exports = { generateProductPoster };

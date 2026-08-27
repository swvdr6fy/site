const multer = require('multer');
const path = require('path');
const { PRODUCTS_UPLOAD_DIR, RECEIPTS_UPLOAD_DIR, BANNERS_UPLOAD_DIR } = require('../config/db');

function makeStorage(dir) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? ext : '.jpg';
      cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + safeExt);
    },
  });
}

function imageFileFilter(req, file, cb) {
  if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('فقط فایل تصویر (jpg, png, webp, gif) مجاز است.'));
  }
}

const uploadProductImage = multer({
  storage: makeStorage(PRODUCTS_UPLOAD_DIR),
  fileFilter: imageFileFilter,
  limits: { fileSize: 4 * 1024 * 1024 },
});

const uploadReceipt = multer({
  storage: makeStorage(RECEIPTS_UPLOAD_DIR),
  fileFilter: imageFileFilter,
  limits: { fileSize: 4 * 1024 * 1024 },
});

const uploadBanner = multer({
  storage: makeStorage(BANNERS_UPLOAD_DIR),
  fileFilter: imageFileFilter,
  limits: { fileSize: 6 * 1024 * 1024 },
});

module.exports = { uploadProductImage, uploadReceipt, uploadBanner };

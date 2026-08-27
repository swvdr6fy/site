require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const { UPLOADS_DIR } = require('./config/db');
const { seed } = require('./config/seed');
const { attachUser } = require('./middleware/auth');

const authRoutes = require('./routes/auth');
const shopRoutes = require('./routes/shop');
const adminRoutes = require('./routes/admin');
const panelRoutes = require('./routes/panel');

seed();

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'aurevonfilter-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 روز
      secure: false, // پشت پراکسی Railway با trust proxy کار میکنه، نیازی به true نیست
    },
  })
);

app.use(attachUser);

app.use('/', panelRoutes);
app.use('/', authRoutes);
app.use('/', shopRoutes);
app.use('/admin', adminRoutes);

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'یافت نشد', message: 'صفحه مورد نظر پیدا نشد.' });
});

// خطای کلی (مثل خطای multer)
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', {
    title: 'خطا',
    message: err.message || 'خطایی رخ داد، لطفا دوباره تلاش کنید.',
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✔ AurevonFilter server is running on port ${PORT}`);
});

const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../config/db');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;

router.get('/register', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('register', { title: 'ثبت‌نام', error: null, old: {} });
});

router.post('/register', (req, res) => {
  const { name, username, phone, email, password, password2 } = req.body;

  if (!name || !username || !phone || !password) {
    return res.render('register', {
      title: 'ثبت‌نام',
      error: 'نام، نام کاربری، شماره موبایل و رمز عبور الزامی است.',
      old: req.body,
    });
  }
  if (!USERNAME_RE.test(username.trim())) {
    return res.render('register', {
      title: 'ثبت‌نام',
      error: 'نام کاربری باید بین ۳ تا ۲۰ کاراکتر و فقط شامل حروف انگلیسی، عدد، نقطه و آندرلاین باشد.',
      old: req.body,
    });
  }
  if (password.length < 6) {
    return res.render('register', { title: 'ثبت‌نام', error: 'رمز عبور باید حداقل ۶ کاراکتر باشد.', old: req.body });
  }
  if (password !== password2) {
    return res.render('register', { title: 'ثبت‌نام', error: 'رمز عبور و تکرار آن یکسان نیستند.', old: req.body });
  }

  const existingPhone = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone.trim());
  if (existingPhone) {
    return res.render('register', { title: 'ثبت‌نام', error: 'این شماره موبایل قبلا ثبت‌نام کرده است.', old: req.body });
  }

  const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
  if (existingUsername) {
    return res.render('register', { title: 'ثبت‌نام', error: 'این نام کاربری قبلا استفاده شده، یک نام دیگر انتخاب کنید.', old: req.body });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (name, username, phone, email, password_hash) VALUES (?, ?, ?, ?, ?)')
    .run(name.trim(), username.trim(), phone.trim(), (email || '').trim(), hash);

  req.session.user = {
    id: info.lastInsertRowid,
    name: name.trim(),
    username: username.trim(),
    phone: phone.trim(),
    is_admin: 0,
  };
  req.session.flash = { type: 'success', text: 'ثبت‌نام با موفقیت انجام شد. خوش آمدید!' };
  res.redirect('/');
});

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { title: 'ورود', error: null, old: {} });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get((username || '').trim());

  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.render('login', { title: 'ورود', error: 'نام کاربری یا رمز عبور اشتباه است.', old: req.body });
  }

  req.session.user = { id: user.id, name: user.name, username: user.username, phone: user.phone, is_admin: user.is_admin };
  const returnTo = req.session.returnTo;
  delete req.session.returnTo;
  req.session.flash = { type: 'success', text: `خوش آمدید ${user.name}!` };
  res.redirect(returnTo || (user.is_admin ? '/admin' : '/'));
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

module.exports = router;

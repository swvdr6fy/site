function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.session.returnTo = req.originalUrl;
    req.session.flash = { type: 'error', text: 'برای ادامه ابتدا وارد حساب کاربری خود شوید.' };
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.is_admin) {
    return res.status(403).render('error', {
      title: 'دسترسی غیرمجاز',
      message: 'شما اجازه دسترسی به این بخش را ندارید.',
    });
  }
  next();
}

function attachUser(req, res, next) {
  res.locals.currentUser = req.session.user || null;
  res.locals.cartCount = req.session.cart
    ? Object.values(req.session.cart).reduce((a, b) => a + b.quantity, 0)
    : 0;
  res.locals.flash = req.session.flash || null;
  res.locals.shopName = process.env.SHOP_NAME || 'AurevonFilter';
  delete req.session.flash;
  next();
}

module.exports = { requireLogin, requireAdmin, attachUser };

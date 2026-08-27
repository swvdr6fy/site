// اسکریپت‌های سمت کاربر: تم روشن/تاریک، افکت اسکرول هدر، منوی موبایل، انیمیشن ورود عناصر

(function initTheme() {
  // این بخش زودتر از DOMContentLoaded اجرا می‌شود تا از چشمک زدن صفحه هنگام تغییر تم جلوگیری شود
  try {
    var saved = localStorage.getItem('af-theme');
    var theme = saved === 'light' || saved === 'dark' ? saved : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();

document.addEventListener('DOMContentLoaded', () => {
  // --- تم روشن/تاریک ---
  const themeButtons = document.querySelectorAll('[data-theme-toggle]');
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('af-theme', theme); } catch (e) {}
    themeButtons.forEach((btn) => btn.setAttribute('aria-pressed', theme === 'light'));
  }
  themeButtons.forEach((btn) => {
    btn.setAttribute('aria-pressed', document.documentElement.getAttribute('data-theme') === 'light');
    btn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      setTheme(current === 'dark' ? 'light' : 'dark');
    });
  });

  // --- هدر: افکت شیشه‌ای هنگام اسکرول ---
  const header = document.querySelector('.site-header');
  if (header) {
    const onScroll = () => {
      if (window.scrollY > 8) header.classList.add('scrolled');
      else header.classList.remove('scrolled');
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // --- منوی موبایل ---
  const navToggle = document.querySelector('.nav-toggle');
  const mainNav = document.querySelector('.main-nav');
  if (navToggle && mainNav) {
    navToggle.addEventListener('click', () => {
      const open = mainNav.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }

  // --- منوی کاربر در موبایل (تپ به‌جای هاور) ---
  const userMenu = document.querySelector('.user-menu');
  if (userMenu && window.matchMedia('(max-width: 760px)').matches) {
    const nameEl = userMenu.querySelector('.user-name');
    if (nameEl) {
      nameEl.addEventListener('click', (e) => {
        e.preventDefault();
        userMenu.classList.toggle('open');
      });
    }
  }

  // --- انیمیشن ورود عناصر هنگام اسکرول ---
  const revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('in-view');
              io.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
      );
      revealEls.forEach((el) => io.observe(el));
    } else {
      revealEls.forEach((el) => el.classList.add('in-view'));
    }
  }

  // --- تولبار فروشگاه: تغییر خودکار مرتب‌سازی/فیلتر ---
  const sortSelect = document.querySelector('[data-shop-sort]');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      const url = new URL(window.location.href);
      url.searchParams.set('sort', sortSelect.value);
      window.location.href = url.toString();
    });
  }
});

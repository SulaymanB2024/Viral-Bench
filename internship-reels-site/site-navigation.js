(() => {
  const header = document.querySelector('.site-header');
  const menuButton = document.querySelector('.site-menu-button');
  const navigation = document.querySelector('.site-navigation');

  if (!header || !menuButton || !navigation) return;

  const workRoutes = new Set(['/work', '/analysis', '/dashboard', '/queue', '/operator', '/signals', '/ads']);
  const normalizedPath = window.location.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  const activeRoute = normalizedPath === '/'
    || normalizedPath === '/library'
      ? 'library'
      : normalizedPath === '/benchmarks'
        ? 'benchmarks'
        : normalizedPath === '/ask'
          ? 'ask'
          : workRoutes.has(normalizedPath)
            ? 'work'
            : null;

  navigation.querySelectorAll('[data-site-route]').forEach((link) => {
    if (link.dataset.siteRoute === activeRoute) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  function setMenuOpen(open, { restoreFocus = false } = {}) {
    header.toggleAttribute('data-menu-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('site-menu-open', open);
    if (restoreFocus) menuButton.focus();
  }

  menuButton.addEventListener('click', () => {
    setMenuOpen(menuButton.getAttribute('aria-expanded') !== 'true');
  });

  navigation.addEventListener('click', (event) => {
    if (event.target.closest('a')) setMenuOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
      event.preventDefault();
      setMenuOpen(false, { restoreFocus: true });
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (menuButton.getAttribute('aria-expanded') === 'true' && !header.contains(event.target)) {
      setMenuOpen(false);
    }
  });

  window.matchMedia('(min-width: 761px)').addEventListener('change', (event) => {
    if (event.matches) setMenuOpen(false);
  });
})();

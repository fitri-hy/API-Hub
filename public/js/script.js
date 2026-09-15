document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const openButton = document.getElementById('sidebar-toggle');
  const closeButton = document.querySelector('[data-sidebar-close]');

  if (sidebar && overlay) {
    const openSidebar = () => {
      sidebar.classList.remove('-translate-x-full');
      overlay.classList.remove('hidden');
      document.body.classList.add('overflow-hidden');
    };

    const closeSidebar = () => {
      sidebar.classList.add('-translate-x-full');
      overlay.classList.add('hidden');
      document.body.classList.remove('overflow-hidden');
    };

    if (openButton) openButton.addEventListener('click', openSidebar);
    if (closeButton) closeButton.addEventListener('click', closeSidebar);
    overlay.addEventListener('click', closeSidebar);

    window.addEventListener('resize', () => {
      if (window.innerWidth >= 768) {
        closeSidebar();
      }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeSidebar();
      }
    });
  }

  setTimeout(() => {
    const flashElements = document.querySelectorAll('.flash-alert');
    flashElements.forEach(el => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 500);
    });
  }, 3000);
});

(() => {
  const initPublicSidebar = () => {
    const sidebar = document.getElementById('public-sidebar');
    const overlay = document.getElementById('public-sidebar-overlay');
    const toggle = document.getElementById('public-sidebar-toggle');
    const close = document.querySelector('[data-public-sidebar-close]');

    if (!sidebar || !overlay || !toggle) return;

    const openSidebar = () => {
      if (window.innerWidth >= 1024) return;
      sidebar.classList.remove('-translate-x-full');
      overlay.classList.remove('hidden');
      document.body.classList.add('overflow-hidden');
    };

    const closeSidebar = () => {
      sidebar.classList.add('-translate-x-full');
      overlay.classList.add('hidden');
      document.body.classList.remove('overflow-hidden');
    };

    toggle.addEventListener('click', openSidebar);
    overlay.addEventListener('click', closeSidebar);
    if (close) close.addEventListener('click', closeSidebar);

    sidebar.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', closeSidebar);
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closeSidebar();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth >= 1024) closeSidebar();
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPublicSidebar);
  } else {
    initPublicSidebar();
  }
})();

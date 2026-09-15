(() => {
  const theme = localStorage.getItem('theme');
  const dark = theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();
	
document.addEventListener('DOMContentLoaded', () => {
  const flashes = document.querySelectorAll('[class*="bg-green-50"], [class*="bg-red-50"]');
  flashes.forEach(el => {
    if (!el.closest('form')) {
      setTimeout(() => {
        el.style.transition = 'opacity 300ms, transform 300ms';
        el.style.opacity = '0';
        el.style.transform = 'translateY(-10px)';
        setTimeout(() => el.remove(), 300);
      }, 5000);
    }
  });

  document.querySelectorAll('[data-confirm]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (!confirm(el.dataset.confirm || 'Are you sure?')) {
        e.preventDefault();
      }
    });
  });
});

document.addEventListener("DOMContentLoaded", () => {
    // Helper function untuk normalisasi path (menghapus trailing slash di akhir)
    const normalizePath = (path) => path.replace(/\/+$/, "") || "/";

    const currentPath = normalizePath(window.location.pathname);
    const sidebarLinks = document.querySelectorAll(".sidebar-link");
    const landingLinks = document.querySelectorAll(".navlink");

    const checkIsActive = (linkPath, exactOnlyPath = "/") => {
        const normalizedLinkPath = normalizePath(linkPath);

        // Untuk root/home path (misal "/" atau "/admin"), gunakan exact match
        if (normalizedLinkPath === exactOnlyPath) {
            return currentPath === normalizedLinkPath;
        }

        // Cek jika path persis sama ATAU currentPath diawali dengan linkPath + "/"
        return (
            currentPath === normalizedLinkPath ||
            currentPath.startsWith(`${normalizedLinkPath}/`)
        );
    };

    // Update kelas aktif untuk Sidebar Links
    sidebarLinks.forEach(link => {
        const linkPath = link.dataset.path || link.getAttribute("href");
        if (!linkPath) return;

        if (checkIsActive(linkPath, "/admin")) {
            link.classList.remove(
                "text-gray-600",
                "dark:text-gray-300",
                "hover:text-blue-600",
                "dark:hover:text-blue-100",
                "hover:bg-blue-100/70",
                "dark:hover:bg-blue-950/70"
            );
            link.classList.add(
                "bg-blue-500",
                "dark:bg-blue-600",
                "text-white",
                "font-semibold"
            );
        }
    });

    // Update kelas aktif untuk Landing Links
    landingLinks.forEach(link => {
        const linkPath = link.dataset.path || link.getAttribute("href");
        if (!linkPath) return;

        if (checkIsActive(linkPath, "/")) {
            link.classList.remove(
                "text-gray-600",
                "dark:text-gray-300",
                "hover:text-blue-600",
                "dark:hover:text-blue-100"
            );
            link.classList.add(
                "text-blue-600",
                "dark:text-blue-400",
                "font-semibold"
            );
        }
    });
});

document.addEventListener("DOMContentLoaded", () => {
  const html = document.documentElement;
  const button = document.getElementById("theme-toggle");

  if (!button) return;

  button.addEventListener("click", () => {
    const isDark = html.classList.toggle("dark");
    localStorage.setItem("theme", isDark ? "dark" : "light");
  });
});
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const helpers = {
  // Generate UUID
  uuid() {
    return uuidv4();
  },

  // Generate API key
  generateApiKey(prefix = 'sgw_live') {
    return `${prefix}_${crypto.randomBytes(24).toString('hex')}`;
  },

  // Generate API secret
  generateApiSecret() {
    return crypto.randomBytes(48).toString('hex');
  },

  // Generate slug from name
  slugify(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 120);
  },

  // Format currency IDR
  formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  },

  // Alias for formatCurrency
  formatRupiah(amount) {
    return this.formatCurrency(amount);
  },

  // Format number with separators
  formatNumber(num) {
    if (num === null || num === undefined) return '0';
    
    const n = Number(num);
    if (isNaN(n)) return '0';
    
    if (n >= 1000000) {
      const formatted = (n / 1000000).toFixed(1);
      return (formatted.endsWith('.0') ? parseInt(formatted) : formatted) + 'M';
    }
    
    if (n >= 1000) {
      const formatted = (n / 1000).toFixed(1);
      return (formatted.endsWith('.0') ? parseInt(formatted) : formatted) + 'k';
    }
    
    return new Intl.NumberFormat('id-ID').format(n);
  },

  // Time ago
  timeAgo(date) {
    if (!date) return '-';
    const now = new Date();
    const d = new Date(date);
    const seconds = Math.floor((now - d) / 1000);

    if (seconds < 60) return 'Only just';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
    if (seconds < 2592000) return `${Math.floor(seconds / 604800)} last week`;
    return `${Math.floor(seconds / 2592000)} last month`;
  },

  // Format date
  formatDate(date, format = 'full') {
    if (!date) return '-';
    const d = new Date(date);
    
    if (format === 'short' || format === 'datetime') {
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${day}/${month}/${year} ${hours}:${minutes}`;
    }

    const options = {
      full: { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' },
      date: { year: 'numeric', month: 'short', day: 'numeric' },
      time: { hour: '2-digit', minute: '2-digit', second: '2-digit' }
    };
    
    return d.toLocaleDateString('id-ID', options[format] || options.full);
  },

  // Pagination helper
  paginate(total, page, perPage = 20) {
    const totalPages = Math.ceil(total / perPage);
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const offset = (currentPage - 1) * perPage;

    return {
      total,
      perPage,
      currentPage,
      totalPages,
      offset,
      hasNext: currentPage < totalPages,
      hasPrev: currentPage > 1,
      pages: this.getPageNumbers(currentPage, totalPages)
    };
  },

  // Generate page numbers for pagination
  getPageNumbers(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const pages = [];
    if (current <= 3) {
      for (let i = 1; i <= 5; i++) pages.push(i);
      pages.push('...');
      pages.push(total);
    } else if (current >= total - 2) {
      pages.push(1);
      pages.push('...');
      for (let i = total - 4; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      pages.push('...');
      for (let i = current - 1; i <= current + 1; i++) pages.push(i);
      pages.push('...');
      pages.push(total);
    }
    return pages;
  },

  // Truncate text
  truncate(text, maxLen = 50) {
    if (!text || text.length <= maxLen) return text || '';
    return text.substring(0, maxLen) + '...';
  },

  // Escape HTML
  escapeHtml(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, c => map[c]);
  },

  // Get client IP
  getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.connection?.remoteAddress ||
           req.ip || 'unknown';
  },

  // API method badge class
  methodBadgeClass(method) {
	const classes = {
		GET: 'bg-emerald-50 text-emerald-500 border border-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20',
		POST: 'bg-blue-50 text-blue-500 border border-blue-200/70 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20',
		PUT: 'bg-amber-50 text-amber-500 border border-amber-200/70 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20',
		DELETE: 'bg-rose-50 text-rose-500 border border-rose-200/70 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20',
		PATCH: 'bg-purple-50 text-purple-500 border border-purple-200/70 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20'
	};

	return classes[method?.toUpperCase()] || 'bg-gray-50 text-gray-500 border border-gray-200/70 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700';
  },

  // Status badge class
  statusBadgeClass(status) {
	const classes = {
		active: 'bg-emerald-50 text-emerald-500 border border-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20',
		inactive: 'bg-rose-50 text-rose-500 border border-rose-200/70 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20',
		draft: 'bg-amber-50 text-amber-500 border border-amber-200/70 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20',
		success: 'bg-emerald-50 text-emerald-500 border border-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20',
		error: 'bg-rose-50 text-rose-500 border border-rose-200/70 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20',
		pending: 'bg-blue-50 text-blue-500 border border-blue-200/70 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20',

		deduct: 'bg-rose-50 text-rose-500 border border-rose-200/70 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20',
        add: 'bg-emerald-50 text-emerald-500 border border-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20',
        purchase: 'bg-blue-50 text-blue-500 border border-blue-200/70 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20',
        bonus: 'bg-purple-50 text-purple-500 border border-purple-200/70 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20',
        refund: 'bg-amber-50 text-amber-500 border border-amber-200/70 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20',
        subscription: 'bg-indigo-50 text-indigo-500 border border-indigo-200/70 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20',
		
		delete: 'bg-rose-50 text-rose-500 border border-rose-200/70 dark:bg-rose-500/10 dark:text-rose-400 dark:border-rose-500/20',
        create: 'bg-emerald-50 text-emerald-500 border border-emerald-200/70 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20',
        update: 'bg-blue-50 text-blue-500 border border-blue-200/70 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20',
        login: 'bg-purple-50 text-purple-500 border border-purple-200/70 dark:bg-purple-500/10 dark:text-purple-400 dark:border-purple-500/20',
        clear: 'bg-amber-50 text-amber-500 border border-amber-200/70 dark:bg-amber-500/10 dark:text-amber-400 dark:border-amber-500/20'
		};
    return classes[status?.toLowerCase()] || classes.draft;
  },
  
  verificationBadgeClass(status) {
	const classes = {
	  verified: 'bg-blue-50 text-blue-600 border border-blue-100/70 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-900/70',
	  pending: 'bg-amber-50 text-amber-600 border border-amber-100/70 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900/70',
	  unverified: 'bg-gray-100 border border-gray-200/70 dark:bg-gray-800 dark:border-gray-700/70'
	};

	return classes[status?.toLowerCase()] || classes.unverified;
  },

  // Parse JSON safely
  parseJSON(str, fallback = null) {
    try {
      return typeof str === 'string' ? JSON.parse(str) : str;
    } catch {
      return fallback;
    }
  },

  // Calculate response time color
  responseTimeColor(ms) {
    if (ms < 100) return 'text-emerald-600';
    if (ms < 500) return 'text-yellow-600';
    if (ms < 1000) return 'text-orange-600';
    return 'text-rose-600';
  }
};

module.exports = helpers;

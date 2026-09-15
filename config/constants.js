module.exports = {
  // User Roles
  ROLES: {
    ADMIN: 'admin',
    USER: 'user'
  },

  // Packages
  PACKAGES: {
    BASIC: { name: 'Basic', price: 0, credits: 50, rateLimit: 100, apis: 3, storage: 5 },
    BRONZE: { name: 'Bronze', price: 49900, credits: 500, rateLimit: 300, apis: 10, storage: 25 },
    SILVER: { name: 'Silver', price: 99900, credits: 2000, rateLimit: 500, apis: 50, storage: 100 },
    GOLD: { name: 'Gold', price: 199900, credits: 10000, rateLimit: 1000, apis: -1, storage: 500 },
    ENTERPRISE: { name: 'Enterprise', price: 499900, credits: 50000, rateLimit: 5000, apis: -1, storage: -1 }
  },

  // Credit system
  CREDIT_VALUE_RP: 50,
  DEFAULT_CREDITS: 100,

  // Rate limits
  DEFAULT_RATE_LIMIT: {
    windowMs: 60 * 1000,
    max: 500
  },

  // API Status
  API_STATUS: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    DRAFT: 'draft'
  },

  // Request Methods
  HTTP_METHODS: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],

  // Log types
  LOG_TYPES: {
    API_REQUEST: 'api_request',
    CREDIT_DEDUCT: 'credit_deduct',
    CREDIT_ADD: 'credit_add',
    CREDIT_PURCHASE: 'credit_purchase',
    AUTH_LOGIN: 'auth_login',
    AUTH_REGISTER: 'auth_register',
    API_CREATE: 'api_create',
    API_UPDATE: 'api_update',
    API_DELETE: 'api_delete',
    RATE_LIMIT_HIT: 'rate_limit_hit',
    ADMIN_ACTION: 'admin_action'
  },

  // Pagination
  PAGE_SIZE: 20,

  // File upload limits
  MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
  ALLOWED_DOC_TYPES: ['.md', '.txt', '.json', '.yaml', '.yml'],

  // Session
  SESSION_MAX_AGE: 24 * 60 * 60 * 1000, // 24 hours
};

const { marked } = require('marked');
const fs = require('fs');
const path = require('path');
const User = require('../../models/User');
const Api = require('../../models/Api');
const ApiKey = require('../../models/ApiKey');
const ApiRoute = require('../../models/ApiRoute');
const Credit = require('../../models/Credit');
const Package = require('../../models/Package');
const Transaction = require('../../models/Transaction');
const AdminSettings = require('../../models/AdminSettings');
const RequestLog = require('../../models/RequestLog');
const Referral = require('../../models/Referral');
const SystemLog = require('../../models/SystemLog');
const VerificationRequest = require('../../models/VerificationRequest');
const Notification = require('../../models/Notification');
const Webhook = require('../../models/Webhook');
const Favorite = require('../../models/Favorite');
const KeyScope = require('../../models/KeyScope');
const SupportTicket = require('../../models/SupportTicket');
const db = require('../../config/database');
const helpers = require('../../utils/helpers');

// Helper: emit notification to admins via Socket.IO
async function emitToAdmins(req, notificationData) {
  try {
    const io = req.app.get('io');
    if (!io) return;
    io.to('role:admin').emit('notification:new', { notification: notificationData });
  } catch (e) { console.error('Socket emit error:', e); }
}

// Helper: emit notification to a specific user via Socket.IO
async function emitToUser(req, userId, notificationData) {
  try {
    const io = req.app.get('io');
    if (!io) return;
    const Notification = require('../../models/Notification');
    const unreadCount = await Notification.getUnreadCount(userId, 'user');
    io.to(`user:${userId}`).emit('notification:new', { notification: { ...notificationData, user_id: userId }, unreadCount });
  } catch (e) { console.error('Socket emit error:', e); }
}

const userController = {
  // Dashboard
  async dashboard(req, res) {
    const user = await User.findById(req.session.userId);
    const creditStats = await Credit.getStats(user.id);
    const apiKeys = await ApiKey.listByUser(user.id);
    const stats = await RequestLog.getStats({ userId: user.id, days: 30 });
    const recentLogs = await RequestLog.listByUser(user.id, { page: 1, limit: 5 });
    const allPkgs = await Package.findActive();
    const packages = allPkgs.filter(p => p.slug !== 'custom');
    const { apis } = await Api.list({ limit: 50, status: 'active' });

    // Method breakdown
    const methodStats = stats.methods || [];
    const methodLabels = methodStats.map(m => m.method);
    const methodCounts = methodStats.map(m => m.count);

    // Status code breakdown
    const statusStats = stats.statusCodes || [];
    const statusLabels = statusStats.map(s => s.response_status);
    const statusCounts = statusStats.map(s => s.count);

    // Top APIs by usage (user-scoped)
    const [topApis] = await db.query(
      `SELECT a.name, a.slug, COUNT(*) as count, AVG(rl.response_time_ms) as avg_time
       FROM request_logs rl
       LEFT JOIN apis a ON rl.api_id = a.id
       WHERE rl.user_id = ?
       GROUP BY rl.api_id, a.name, a.slug
       ORDER BY count DESC LIMIT 5`,
      [user.id]
    );

    // Top routes by usage (user-scoped)
	const [topRoutes] = await db.query(
	  `SELECT a.slug, ar.path, rl.method, COUNT(*) as count, AVG(rl.response_time_ms) as avg_time
	   FROM request_logs rl
	   LEFT JOIN api_routes ar ON rl.route_id = ar.id
	   LEFT JOIN apis a ON rl.api_id = a.id
	   WHERE rl.user_id = ?
	   GROUP BY rl.route_id, a.slug, ar.path, rl.method
	   ORDER BY count DESC LIMIT 5`,
	  [user.id]
	);

    // Recent transactions
    const recentTransactions = await Credit.getTransactions(user.id, { page: 1, limit: 5 });

    // Bonus info (only for verified users when bonus is enabled)
    const bonusInfo = await Credit.getBonusInfo(user.id);

    res.render('user/dashboard', {
      title: 'Dashboard', layout: 'layouts/user',
      userData: user, creditStats, apiKeys, bonusInfo,
      stats: stats.overview,
      daily: stats.daily || [],
      methodStats: { labels: methodLabels, counts: methodCounts },
      statusStats: { labels: statusLabels, counts: statusCounts },
      topApis, topRoutes,
      recentLogs: recentLogs.logs,
      recentTransactions: recentTransactions.transactions,
      packages, availableApis: apis, helpers
    });
  },

  // ============ API KEYS ============
  async apiKeys(req, res) {
    const apiKeys = await ApiKey.listByUser(req.session.userId);
    const user = await User.findById(req.session.userId);

    // Get daily usage for each key (last 7 days)
    const keysWithStats = await Promise.all(apiKeys.map(async (key) => {
      const dailyUsage = await ApiKey.getDailyUsage(key.id, 7);
      return { ...key, dailyUsage };
    }));

    res.render('user/api-keys', { title: 'My API Keys', layout: 'layouts/user', userData: user, apiKeys: keysWithStats, helpers });
  },

  async apiKeyStats(req, res) {
    try {
      const key = await ApiKey.findById(req.params.keyId);
      if (!key || key.user_id !== req.session.userId) {
        return res.status(404).json({ error: 'API key not found' });
      }

      const [daily, weekly, monthly] = await Promise.all([
        ApiKey.getDailyUsage(key.id, 7),
        ApiKey.getWeeklyUsage(key.id, 4),
        ApiKey.getMonthlyUsage(key.id, 6)
      ]);

      return res.json({ daily, weekly, monthly });
    } catch (err) {
      console.error('ApiKey stats error:', err);
      return res.status(500).json({ error: 'Failed to load stats' });
    }
  },

  async updateApiKeyScopes(req, res) {
    try {
      const key = await ApiKey.findById(req.params.keyId);
      if (!key || key.user_id !== req.session.userId) {
        req.flash('error', 'API key not found');
        return res.redirect('/user/api-keys');
      }

      const { scope_apis, scopes } = req.body;
      let scopeData = [];

      if (scope_apis && scopes && Array.isArray(scope_apis) && Array.isArray(scopes)) {
        scope_apis.forEach((apiId, idx) => {
          const parsedApiId = parseInt(apiId);
          const methods = scopes[idx];

          if (!isNaN(parsedApiId) && parsedApiId > 0 && methods) {
            const methodArray = Array.isArray(methods) ? methods : [methods];
            if (methodArray.length > 0) {
              scopeData.push({ apiId: parsedApiId, methods: methodArray });
            }
          }
        });
      }

      await KeyScope.setScopes(key.id, scopeData);
      req.flash('success', 'API key scopes updated successfully');
      return res.redirect('/user/api-keys');
    } catch (err) {
      req.flash('error', 'Failed to update scopes');
      return res.redirect('/user/api-keys');
    }
  },

  async getApiKeyScopes(req, res) {
    try {
      const key = await ApiKey.findById(req.params.keyId);
      if (!key || key.user_id !== req.session.userId) {
        return res.status(404).json({ error: 'API key not found' });
      }

      const scopes = await KeyScope.listByKey(key.id);
      const apis = await Api.list({ limit: 100, status: 'active' });

      return res.json({ scopes, apis: apis.apis });
    } catch (err) {
      console.error('Get scopes error:', err);
      return res.status(500).json({ error: 'Failed to load scopes' });
    }
  },

  async createApiKey(req, res) {
    try {
      const { name, credit_limit } = req.body;
      const keyCount = await ApiKey.countByUser(req.session.userId);
      if (keyCount >= 20) {
        // Notify user about API key limit
        try {
          await Notification.apiKeyLimitWarning(req.session.userId);
          await emitToUser(req, req.session.userId, { type: 'api_key_limit_warning', title: 'API Key Limit Reached', message: 'You have reached the maximum number of API keys.', link: '/user/api-keys', icon: 'key', is_read: 0, created_at: new Date().toISOString() });
        } catch (e) { console.error('Notification error:', e); }
        req.flash('error', 'Maximum limit of 20 API keys reached');
        return res.redirect('/user/api-keys');
      }
      await ApiKey.create(req.session.userId, name || 'API Key', parseInt(credit_limit) || 0);
      // Webhook dispatch
      try {
        await Webhook.dispatch('api_key.created', { user_id: req.session.userId, name: name || 'API Key' });
      } catch (e) { console.error('Webhook dispatch error:', e); }
      req.flash('success', 'API key created successfully');
      return res.redirect('/user/api-keys');
    } catch (err) {
      req.flash('error', 'Failed to create API key');
      return res.redirect('/user/api-keys');
    }
  },

  async updateApiKey(req, res) {
    try {
      const key = await ApiKey.findById(req.params.keyId);
      if (!key || key.user_id !== req.session.userId) {
        req.flash('error', 'API key not found');
        return res.redirect('/user/api-keys');
      }
      const { name, credit_limit, is_active } = req.body;
      await ApiKey.update(key.id, {
        name,
        creditLimit: parseInt(credit_limit) || 0,
        isActive: is_active === 'on' || is_active === '1' ? 1 : 0
      });
      req.flash('success', 'API key updated successfully');
      return res.redirect('/user/api-keys');
    } catch (err) {
      req.flash('error', 'Failed to update API key');
      return res.redirect('/user/api-keys');
    }
  },

  async deleteApiKey(req, res) {
    try {
      const key = await ApiKey.findById(req.params.keyId);
      if (!key || key.user_id !== req.session.userId) {
        req.flash('error', 'API key not found');
        return res.redirect('/user/api-keys');
      }
      await ApiKey.delete(key.id);
      // Webhook dispatch
      try {
        await Webhook.dispatch('api_key.deleted', { user_id: req.session.userId, name: key.name });
      } catch (e) { console.error('Webhook dispatch error:', e); }
      req.flash('success', 'API key deleted successfully');
      return res.redirect('/user/api-keys');
    } catch (err) {
      req.flash('error', 'Failed to delete API key');
      return res.redirect('/user/api-keys');
    }
  },

  // ============ BROWSE APIs (admin-created) ============
  async browseApis(req, res) {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || '';
    const user = await User.findById(req.session.userId);
    const { apis, total } = await Api.list({ page, limit: 20, search, status: 'active' });
    const pagination = helpers.paginate(total, page, 20);
    const favoriteIds = await Favorite.getIds(user.id);

    // Sort: favorited APIs first, then by created_at desc
    apis.sort((a, b) => {
      const aFav = favoriteIds.includes(a.id) ? 0 : 1;
      const bFav = favoriteIds.includes(b.id) ? 0 : 1;
      if (aFav !== bFav) return aFav - bFav;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    res.render('user/browse-apis', { title: 'Browse APIs', layout: 'layouts/user', userData: user, apis, pagination, filters: { search }, favoriteIds, helpers });
  },

  async apiDetail(req, res) {
    const api = await Api.findBySlug(req.params.slug);
    if (!api) { req.flash('error', 'API not found'); return res.redirect('/user/browse-apis'); }
    const routes = await ApiRoute.findActiveByApiId(api.id);
    const balance = await Credit.getBalance(req.session.userId);
    const userData = { ...(await User.findById(req.session.userId)), credit_balance: balance.balance };
    
    // Menambahkan marked ke dalam objek render agar bisa dipakai di EJS
    res.render('user/api-detail', { 
      title: api.name, 
      layout: 'layouts/user', 
      api, 
      routes, 
      userData, 
      helpers,
      marked // <--- Ditambahkan di sini
    });
  },

  // ============ CREDITS ============
  async credits(req, res) {
    const page = parseInt(req.query.page) || 1;
    const limit = 30;
    const user = await User.findById(req.session.userId);
    const creditStats = await Credit.getStats(user.id);
    const txData = await Credit.getTransactions(user.id, { page, limit });
    const transactions = txData.transactions || txData;
    const totalTx = txData.total || transactions.length;

    const pagination = helpers.paginate(totalTx, page, limit);
    const allPackages = await Package.findActive();
    // Filter out internal 'custom' package — only show standard packages to users
    const packages = allPackages.filter(p => p.slug !== 'custom');

    // Get custom package settings
    const [rateLimitMin, rateLimitMax, rateLimitStep, rateLimitPricePerStep, creditValueRp] = await Promise.all([
      AdminSettings.get('custom_package_rate_limit_min'),
      AdminSettings.get('custom_package_rate_limit_max'),
      AdminSettings.get('custom_package_rate_limit_step'),
      AdminSettings.get('custom_package_rate_limit_price_per_step'),
      AdminSettings.get('credit_value_rp')
    ]);

    // Get bank info
    const [bankName, bankAccountNumber, bankAccountName] = await Promise.all([
      AdminSettings.get('bank_name'),
      AdminSettings.get('bank_account_number'),
      AdminSettings.get('bank_account_name')
    ]);

    // Get payment method settings
    const [transferEnabled, qrisEnabled, qrisImage] = await Promise.all([
      AdminSettings.get('payment_method_transfer_enabled'),
      AdminSettings.get('payment_method_qris_enabled'),
      AdminSettings.get('qris_image')
    ]);

    res.render('user/credits', {
      title: 'Credits & Wallet', layout: 'layouts/user',
      userData: user, creditStats, transactions, packages, pagination, helpers,
      customPackageSettings: {
        rateLimitMin: parseInt(rateLimitMin) || 50,
        rateLimitMax: parseInt(rateLimitMax) || 500,
        rateLimitStep: parseInt(rateLimitStep) || 50,
        rateLimitPricePerStep: parseInt(rateLimitPricePerStep) || 5000,
        creditValueRp: parseInt(creditValueRp) || 50
      },
      bankInfo: {
        bankName: bankName || 'Bank BCA',
        bankAccountNumber: bankAccountNumber || '-',
        bankAccountName: bankAccountName || '-'
      },
      paymentMethods: {
        transferEnabled: transferEnabled === true || transferEnabled === 'true',
        qrisEnabled: qrisEnabled === true || qrisEnabled === 'true',
        qrisImage: qrisImage || null
      }
    });
  },

  async calculateCustomPackage(req, res) {
    try {
      const { credits, rate_limit } = req.body;
      const result = await Transaction.calculateCustomPrice(parseInt(credits) || 0, parseInt(rate_limit) || 50);
      return res.json({ success: true, data: result });
    } catch (err) {
      return res.json({ success: false, message: 'Failed to calculate' });
    }
  },

  async checkout(req, res) {
    try {
      const user = await User.findById(req.session.userId);
      const { type, package_id, credits, rate_limit, notes } = req.query;

      let total_price = 0;
      let credits_requested = 0;
      let rate_limit_per_minute = 100;
      let packageId = null;
      let packageName = 'Custom Package';
      let packageDescription = '';

      if (type === 'standard_package' && package_id) {
        const pkg = await Package.findById(package_id);
        if (!pkg) {
          req.flash('error', 'Package not found');
          return res.redirect('/user/credits');
        }
        packageId = pkg.id;
        packageName = pkg.name;
        packageDescription = pkg.description || '';
        credits_requested = pkg.credits_included;
        rate_limit_per_minute = pkg.rate_limit_per_minute;
        total_price = pkg.price;
      } else if (type === 'custom_package') {
        const calc = await Transaction.calculateCustomPrice(parseInt(credits) || 100, parseInt(rate_limit) || 50);
        credits_requested = calc.credits;
        rate_limit_per_minute = calc.rateLimitPerMinute;
        total_price = calc.totalCost;
      } else {
        req.flash('error', 'Invalid checkout parameters');
        return res.redirect('/user/credits');
      }

      // Fetch payment method settings
      const [bankName, bankAccountNumber, bankAccountName, qrisImage, transferEnabled, qrisEnabled] = await Promise.all([
        AdminSettings.get('bank_name'),
        AdminSettings.get('bank_account_number'),
        AdminSettings.get('bank_account_name'),
        AdminSettings.get('qris_image'),
        AdminSettings.get('payment_method_transfer_enabled'),
        AdminSettings.get('payment_method_qris_enabled')
      ]);

      res.render('user/checkout', {
        title: 'Checkout', layout: 'layouts/user',
        userData: user, helpers,
        order: {
          type,
          package_id: packageId,
          package_name: packageName,
          package_description: packageDescription,
          credits_requested,
          rate_limit_per_minute,
          total_price,
          notes: notes || ''
        },
        bankInfo: {
          bankName: bankName || 'Bank BCA',
          bankAccountNumber: bankAccountNumber || '-',
          bankAccountName: bankAccountName || '-'
        },
        qrisImage: qrisImage || null,
        paymentMethods: {
          transferEnabled: transferEnabled === true || transferEnabled === 'true',
          qrisEnabled: qrisEnabled === true || qrisEnabled === 'true'
        }
      });
    } catch (err) {
      console.error('Checkout error:', err);
      req.flash('error', 'Something went wrong');
      return res.redirect('/user/credits');
    }
  },

  async purchasePackage(req, res) {
    try {
      const { package_id, credits, rate_limit, notes, type, payment_method } = req.body;
      const user = await User.findById(req.session.userId);

      // Require payment proof
      if (!req.file) {
        req.flash('error', 'Payment proof is required. Please upload your transfer/QRIS screenshot.');
        return res.redirect('/user/credits/checkout?type=' + (type || 'standard_package') + (package_id ? '&package_id=' + package_id : '') + (credits ? '&credits=' + credits : '') + (rate_limit ? '&rate_limit=' + rate_limit : ''));
      }

      let total_price = 0;
      let credits_requested = 0;
      let rate_limit_per_minute = 100;
      let packageId = null;

      if (type === 'standard_package' && package_id) {
        const pkg = await Package.findById(package_id);
        if (!pkg) {
          req.flash('error', 'Package not found');
          return res.redirect('/user/credits');
        }
        packageId = pkg.id;
        credits_requested = pkg.credits_included;
        rate_limit_per_minute = pkg.rate_limit_per_minute;
        total_price = pkg.price;
      } else if (type === 'custom_package') {
        const calc = await Transaction.calculateCustomPrice(parseInt(credits) || 100, parseInt(rate_limit) || 50);
        credits_requested = calc.credits;
        rate_limit_per_minute = calc.rateLimitPerMinute;
        total_price = calc.totalCost;
      } else {
        req.flash('error', 'Invalid purchase type');
        return res.redirect('/user/credits');
      }

      // Save payment proof
      const proofUrl = `/uploads/avatars/${req.file.filename}`;

      // Create transaction
      const transaction = await Transaction.create({
        user_id: user.id,
        package_id: packageId,
        type: type,
        credits_requested,
        rate_limit_per_minute,
        total_price,
        payment_method: (payment_method === 'qris') ? 'qris' : 'transfer',
        notes: notes || null
      });

      // Save payment proof
      await db.query('UPDATE transactions SET payment_proof = ? WHERE id = ?', [proofUrl, transaction.id]);

      await SystemLog.create({
        userId: user.id,
        action: 'purchase_create',
        details: { transaction_id: transaction.id, type, total_price },
        ipAddress: helpers.getClientIp(req)
      });

      // Notify admins about new transaction
      try {
        await Notification.transactionPending({ id: transaction.id, credits_requested }, user);
        await emitToAdmins(req, { type: 'transaction_pending', title: 'New Transaction', message: user.username + ' has submitted a transaction for ' + credits_requested + ' credits.', link: '/admin/transactions/' + transaction.id, icon: 'credit-card', is_read: 0, created_at: new Date().toISOString() });
      } catch (e) { console.error('Notification error:', e); }
      // Webhook dispatch
      try {
        await Webhook.dispatch('transaction.created', { transaction_id: transaction.id, user_id: user.id, total_price, credits_requested, payment_method: payment_method || 'transfer' });
      } catch (e) { console.error('Webhook dispatch error:', e); }

      req.flash('success', 'Purchase request submitted with payment proof. Waiting for admin review.');
      return res.redirect('/user/transactions/' + transaction.id);
    } catch (err) {
      console.error('Purchase error:', err);
      req.flash('error', 'Failed to create purchase request');
      return res.redirect('/user/credits');
    }
  },

  // ============ TRANSACTIONS ============
  async transactions(req, res) {
    const page = parseInt(req.query.page) || 1;
    const status = req.query.status || '';
    const user = await User.findById(req.session.userId);
    const { transactions, total } = await Transaction.listByUser(user.id, { page, limit: 20, status });
    const pagination = helpers.paginate(total, page, 20);
    res.render('user/transactions', { title: 'My Transactions', layout: 'layouts/user', userData: user, transactions, pagination, filters: { status }, helpers });
  },

  async transactionDetail(req, res) {
    const user = await User.findById(req.session.userId);
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction || transaction.user_id !== user.id) {
      req.flash('error', 'Transaction not found');
      return res.redirect('/user/transactions');
    }

    // Get bank info
    const [bankName, bankAccountNumber, bankAccountName] = await Promise.all([
      AdminSettings.get('bank_name'),
      AdminSettings.get('bank_account_number'),
      AdminSettings.get('bank_account_name')
    ]);

    // Get QRIS info
    const [qrisImage, transferEnabled, qrisEnabled] = await Promise.all([
      AdminSettings.get('qris_image'),
      AdminSettings.get('payment_method_transfer_enabled'),
      AdminSettings.get('payment_method_qris_enabled')
    ]);

    res.render('user/transaction-detail', {
      title: 'Transaction Detail', layout: 'layouts/user',
      userData: user, transaction, helpers,
      bankInfo: {
        bankName: bankName || 'Bank BCA',
        bankAccountNumber: bankAccountNumber || '-',
        bankAccountName: bankAccountName || '-'
      },
      qrisImage: qrisImage || null,
      paymentMethods: {
        transferEnabled: transferEnabled === true || transferEnabled === 'true',
        qrisEnabled: qrisEnabled === true || qrisEnabled === 'true'
      }
    });
  },

  async uploadPaymentProof(req, res) {
    try {
      const transaction = await Transaction.findById(req.params.id);
      if (!transaction || transaction.user_id !== req.session.userId) {
        req.flash('error', 'Transaction not found');
        return res.redirect('/user/transactions');
      }
      if (transaction.status !== 'pending') {
        req.flash('error', 'Transaction already processed');
        return res.redirect('/user/transactions');
      }
      if (!req.file) {
        req.flash('error', 'Please upload payment proof');
        return res.redirect('/user/transactions/' + req.params.id);
      }

      const proofUrl = `/uploads/avatars/${req.file.filename}`;
      await db.query('UPDATE transactions SET payment_proof = ? WHERE id = ?', [proofUrl, req.params.id]);

      // Notify admins about uploaded payment proof
      try {
        const user = await User.findById(req.session.userId);
        await Notification.paymentProofUploaded({ id: parseInt(req.params.id) }, user);
        await emitToAdmins(req, { type: 'payment_proof_uploaded', title: 'Payment Proof Uploaded', message: user.username + ' has uploaded payment proof for transaction #' + req.params.id + '.', link: '/admin/transactions/' + req.params.id, icon: 'upload', is_read: 0, created_at: new Date().toISOString() });
      } catch (e) { console.error('Notification error:', e); }

      // Webhook dispatch
      try {
        await Webhook.dispatch('transaction.proof_uploaded', { transaction_id: parseInt(req.params.id), user_id: req.session.userId });
      } catch (e) { console.error('Webhook dispatch error:', e); }

      req.flash('success', 'Payment proof uploaded. Waiting for admin review.');
      return res.redirect('/user/transactions/' + req.params.id);
    } catch (err) {
      req.flash('error', 'Failed to upload proof');
      return res.redirect('/user/transactions');
    }
  },

  // ============ LOGS ============
  async logs(req, res) {
    const page = parseInt(req.query.page) || 1;
    const apiId = req.query.api_id || null;
    const status = req.query.status || '';
    const user = await User.findById(req.session.userId);
    const { logs, total } = await RequestLog.listByUser(req.session.userId, { page, limit: 30, apiId, status });
    const pagination = helpers.paginate(total, page, 30);
    const { apis } = await Api.list({ limit: 100, status: 'active' });
    res.render('user/logs', { title: 'My Logs', layout: 'layouts/user', userData: user, logs, pagination, availableApis: apis, filters: { apiId, status }, helpers });
  },

  // ============ PROFILE ============
  async profile(req, res) {
    const user = await User.findById(req.session.userId);
    const creditStats = await Credit.getStats(user.id);
    const latestVerification = await VerificationRequest.getLatestByUser(user.id);
    res.render('user/profile', { 
      title: 'Profile', 
      layout: 'layouts/user', 
      userData: user, 
      creditStats,
      verificationRequest: latestVerification,
      helpers 
    });
  },

  async updateProfile(req, res) {
    try {
      const { full_name, email, current_password, new_password, confirm_password } = req.body;
      const user = await User.findById(req.session.userId);

      // Validate email uniqueness
      if (email && email !== user.email) {
        const existingEmail = await User.findByEmail(email);
        if (existingEmail) {
          req.flash('error', 'Email is already in use by another account.');
          return res.redirect('/user/profile');
        }
      }

      // Handle password change
      if (new_password) {
        if (!current_password) {
          req.flash('error', 'Current password is required to set new password.');
          return res.redirect('/user/profile');
        }
        const isValid = await User.verifyPassword(user, current_password);
        if (!isValid) {
          req.flash('error', 'Current password is incorrect.');
          return res.redirect('/user/profile');
        }
        if (new_password.length < 6) {
          req.flash('error', 'New password must be at least 6 characters.');
          return res.redirect('/user/profile');
        }
        if (new_password !== confirm_password) {
          req.flash('error', 'New password confirmation does not match.');
          return res.redirect('/user/profile');
        }
        await User.updatePassword(req.session.userId, new_password);
      }

      // Handle avatar upload
      if (req.file) {
        // Delete old avatar if exists
        if (user.avatar) {
          const oldAvatarPath = path.join(__dirname, '../../public', user.avatar);
          if (fs.existsSync(oldAvatarPath)) {
            fs.unlinkSync(oldAvatarPath);
          }
        }
        const avatarUrl = `/uploads/avatars/${req.file.filename}`;
        await User.update(req.session.userId, { full_name, email, avatar: avatarUrl });
      } else {
        await User.update(req.session.userId, { full_name, email });
      }

      // Update session username if full_name changed
      if (full_name) {
        req.session.fullName = full_name;
      }

      await SystemLog.create({
        userId: req.session.userId,
        action: 'profile_update',
        details: { full_name, email },
        ipAddress: helpers.getClientIp(req),
        userAgent: req.headers['user-agent']
      });
      // Webhook dispatch
      try {
        await Webhook.dispatch('profile.updated', { user_id: req.session.userId, full_name, email });
      } catch (e) { console.error('Webhook dispatch error:', e); }

      req.flash('success', 'Profile updated successfully.');
      return res.redirect('/user/profile');
    } catch (err) {
      console.error('Profile update error:', err);
      req.flash('error', 'Failed to update profile.');
      return res.redirect('/user/profile');
    }
  },

  // ============ VERIFICATION REQUEST ============
  async requestVerification(req, res) {
    try {
      const { verification_reason } = req.body;
      const result = await VerificationRequest.create(req.session.userId, verification_reason || null);
      if (result.success) {
        await SystemLog.create({
          userId: req.session.userId,
          action: 'verification_request',
          details: { requestId: result.id },
          ipAddress: helpers.getClientIp(req)
        });
        // Notify admins about verification request
        try {
          const user = await User.findById(req.session.userId);
          await Notification.verificationPending(user);
        await emitToAdmins(req, { type: 'verification_pending', title: 'New Verification Request', message: user.username + ' has requested account verification.', link: '/admin/users/' + user.uuid, icon: 'badge-check', is_read: 0, created_at: new Date().toISOString() });
        } catch (e) { console.error('Notification error:', e); }
        req.flash('success', 'Verification request submitted successfully. Please wait for admin review.');
      } else {
        req.flash('error', result.message);
      }
    } catch (err) {
      console.error('Verification request error:', err);
      req.flash('error', 'Failed to submit verification request.');
    }
    return res.redirect('/user/profile');
  },

  // ============ REFERRAL ============
  async referrals(req, res) {
    const user = await User.findById(req.session.userId);
    const referralStats = await Referral.getStats(user.id);
    const referralEnabled = await AdminSettings.get('referral_enabled');
    const referralDescription = await AdminSettings.get('referral_description');
    const referrerCredit = parseInt(await AdminSettings.get('referral_credit_amount')) || 50;
    const referredCredit = parseInt(await AdminSettings.get('new_referral_credit_amount')) || 0;
    const baseUrl = req.protocol + '://' + req.get('host');
    const referralLink = `${baseUrl}/auth/register?ref=${user.referral_code || ''}`;

    res.render('user/referrals', {
      title: 'Referrals',
      layout: 'layouts/user',
      userData: user,
      referralStats,
      referralEnabled,
      referralDescription,
      referrerCredit,
      referredCredit,
      referralLink,
      helpers
    });
  },

  // ============ PLAYGROUND ============
  async playground(req, res) {
    const user = await User.findById(req.session.userId);
    res.render('user/playground', {
      title: 'API Playground',
      layout: 'layouts/user',
      userData: user,
      helpers
    });
  },

  // ============ FAVORITES (Marketplace) ============
  async toggleFavorite(req, res) {
    const referrer = req.get('Referrer') || '/user/browse-apis';
    try {
      const user = await User.findById(req.session.userId);
      const apiId = parseInt(req.params.apiId);
      const api = await Api.findById(apiId);
      if (!api) {
        req.flash('error', 'API not found');
        return res.redirect(referrer);
      }
      const added = await Favorite.toggle(user.id, apiId);
      req.flash('success', added ? `${api.name} added to favorites` : `${api.name} removed from favorites`);
    } catch (err) {
      console.error('Toggle favorite error:', err);
      req.flash('error', 'Failed to update favorite');
    }
    return res.redirect(referrer);
  },

  // ============================================================
  // HELP CENTER - SUPPORT TICKETS
  // ============================================================

  /**
   * User: List my tickets
   */
  async tickets(req, res) {
    const page = parseInt(req.query.page) || 1;
    const { status, category, search } = req.query;
    const { tickets, total } = await SupportTicket.listByUser(req.session.userId, {
      page, limit: 20, status, category, search
    });
    const pagination = helpers.paginate(total, page, 20);
    const stats = await SupportTicket.getUserStats(req.session.userId);

    res.render('user/tickets', {
      title: 'Help Center', layout: 'layouts/user',
      tickets, pagination, stats,
      filters: { status, category, search },
      helpers, SupportTicket
    });
  },

  /**
   * User: Create ticket form
   */
  async ticketCreateForm(req, res) {
    const apis = await Api.list({ limit: 100, status: 'active' });
    res.render('user/ticket-create', {
      title: 'Submit Ticket', layout: 'layouts/user',
      apis: apis.apis || [], helpers
    });
  },

  /**
   * User: Submit new ticket
   */
  async ticketCreate(req, res) {
    try {
      const { subject, description, category, priority, related_api_id, api_endpoint, error_message, reproduction_steps } = req.body;

      if (!subject || !subject.trim()) {
        req.flash('error', 'Subject is required');
        return res.redirect('/user/tickets/create');
      }
      if (!description || !description.trim()) {
        req.flash('error', 'Description is required');
        return res.redirect('/user/tickets/create');
      }

      // Check ticket limit
      const maxTicketsSetting = await AdminSettings.get('ticket_max_per_user');
      const maxTickets = parseInt(maxTicketsSetting) || 10;
      const userStats = await SupportTicket.getUserStats(req.session.userId);
      if (userStats.open >= maxTickets) {
        req.flash('error', `You have reached the maximum limit of ${maxTickets} open tickets. Please close some before creating a new one.`);
        return res.redirect('/user/tickets');
      }

      const ticket = await SupportTicket.create({
        user_id: req.session.userId,
        subject: subject.trim(),
        description: description.trim(),
        category: category || 'technical',
        priority: priority || 'medium',
        related_api_id: related_api_id ? parseInt(related_api_id) : null,
        api_endpoint: api_endpoint || null,
        error_message: error_message || null,
        reproduction_steps: reproduction_steps || null,
        browser_info: req.headers['user-agent'] || null
      });

      // Notify admins + webhook
      const user = await User.findById(req.session.userId);
      await Notification.ticketCreated(ticket, user);
      await Webhook.dispatch('ticket.created', { ticket, user: { id: user.id, username: user.username, email: user.email } }, 'admin');

      req.flash('success', `Ticket ${ticket.ticket_number} has been created successfully`);
      return res.redirect(`/user/tickets/${ticket.id}`);
    } catch (err) {
      console.error('Ticket create error:', err);
      req.flash('error', 'Failed to create ticket');
      return res.redirect('/user/tickets/create');
    }
  },

  /**
   * User: View ticket detail
   */
  async ticketDetail(req, res) {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket || ticket.user_id !== req.session.userId) {
      req.flash('error', 'Ticket not found');
      return res.redirect('/user/tickets');
    }

    const messages = await SupportTicket.getMessages(ticket.id);
    await SupportTicket.markMessagesRead(ticket.id, 'user');

    res.render('user/ticket-detail', {
      title: `Ticket ${ticket.ticket_number}`, layout: 'layouts/user',
      ticket, messages, helpers, SupportTicket
    });
  },

  /**
   * User: Reply to ticket
   */
  async ticketReply(req, res) {
    try {
      const ticket = await SupportTicket.findById(req.params.id);
      if (!ticket || ticket.user_id !== req.session.userId) {
        req.flash('error', 'Ticket not found');
        return res.redirect('/user/tickets');
      }

      const { message } = req.body;
      if (!message || !message.trim()) {
        req.flash('error', 'Message cannot be empty');
        return res.redirect(`/user/tickets/${req.params.id}`);
      }

      await SupportTicket.addMessage({
        ticket_id: ticket.id,
        sender_id: req.session.userId,
        sender_role: 'user',
        message: message.trim()
      });

      // Update status to waiting_reply if currently in_progress
      const oldStatus = ticket.status;
      if (ticket.status === 'in_progress') {
        await SupportTicket.update(ticket.id, { status: 'waiting_reply' });
      }

      // Notify admins + webhook
      const sender = await User.findById(req.session.userId);
      await Notification.ticketRepliedToAdmins(ticket, sender);
      await Webhook.dispatch('ticket.replied', { ticket, sender: { id: sender.id, username: sender.username, role: 'user' } }, 'admin');

      req.flash('success', 'Reply sent successfully');
    } catch (err) {
      console.error('Ticket reply error:', err);
      req.flash('error', 'Failed to send reply');
    }
    return res.redirect(`/user/tickets/${req.params.id}`);
  },

  /**
   * User: Close ticket
   */
  async ticketClose(req, res) {
    try {
      const ticket = await SupportTicket.findById(req.params.id);
      if (!ticket || ticket.user_id !== req.session.userId) {
        req.flash('error', 'Ticket not found');
        return res.redirect('/user/tickets');
      }

      await SupportTicket.close(ticket.id);
      await Notification.ticketClosed(ticket);
      await Webhook.dispatch('ticket.closed', { ticket, closedBy: { id: req.session.userId, role: 'user' } }, 'admin');
      req.flash('success', 'Ticket has been closed');
    } catch (err) {
      console.error('Ticket close error:', err);
      req.flash('error', 'Failed to close ticket');
    }
    return res.redirect('/user/tickets');
  }
};

module.exports = userController;

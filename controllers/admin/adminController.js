const User = require('../../models/User');
const Api = require('../../models/Api');
const ApiRoute = require('../../models/ApiRoute');
const Credit = require('../../models/Credit');
const Package = require('../../models/Package');
const Transaction = require('../../models/Transaction');
const RequestLog = require('../../models/RequestLog');
const SystemLog = require('../../models/SystemLog');
const AdminSettings = require('../../models/AdminSettings');
const Referral = require('../../models/Referral');
const Email = require('../../utils/email');
const VerificationRequest = require('../../models/VerificationRequest');
const Notification = require('../../models/Notification');
const Webhook = require('../../models/Webhook');
const SupportTicket = require('../../models/SupportTicket');
const db = require('../../config/database');
const helpers = require('../../utils/helpers');
const { deleteAvatar, deleteSiteImage } = require('../../middleware/upload');

const adminController = {
  // Dashboard
  async dashboard(req, res) {
    const [userCount, apiCount, activeApiCount, keyCount, activeKeyCount, pkgCount] = await Promise.all([
      User.count(), Api.count(), Api.count({ status: 'active' }),
      db.query('SELECT COUNT(*) as c FROM api_keys').then(r => r[0][0].c),
      db.query('SELECT COUNT(*) as c FROM api_keys WHERE is_active = 1').then(r => r[0][0].c),
      db.query('SELECT COUNT(*) as c FROM packages WHERE is_active = 1').then(r => r[0][0].c)
    ]);

    const [stats30, statsToday] = await Promise.all([
      RequestLog.getStats({ days: 30 }),
      RequestLog.getStats({ days: 1 })
    ]);

    // Credit overview
    const [creditSummary] = await db.query(
      `SELECT SUM(balance) as total_balance, COUNT(*) as total_accounts FROM credits`
    );
    const [creditTxStats] = await db.query(
      `SELECT type, COUNT(*) as count, SUM(ABS(amount)) as total
       FROM credit_transactions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY type ORDER BY total DESC`
    );

    // Top users by credit usage
    const [topUsers] = await db.query(
      `SELECT u.username, u.email, u.avatar, SUM(rl.credit_cost) as total_credits, COUNT(*) as requests
       FROM request_logs rl LEFT JOIN users u ON rl.user_id = u.id
       WHERE rl.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY rl.user_id ORDER BY total_credits DESC LIMIT 5`
    );

    // Top APIs by usage
    const [topApis] = await db.query(
      `SELECT a.name, a.slug, COUNT(*) as requests, SUM(rl.credit_cost) as credits, AVG(rl.response_time_ms) as avg_time
       FROM request_logs rl LEFT JOIN apis a ON rl.api_id = a.id
       WHERE rl.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY rl.api_id ORDER BY requests DESC LIMIT 5`
    );

    // Method breakdown with stats
    const methodStats = stats30.methods || [];

    // Status code breakdown
    const statusStats = stats30.statusCodes || [];

    // Top routes
    const [topRoutesResult] = await db.query(
      `SELECT a.base_route, rl.path, rl.method, COUNT(*) as count, AVG(rl.response_time_ms) as avg_time
       FROM request_logs rl
       LEFT JOIN apis a ON rl.api_id = a.id
       WHERE rl.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY a.base_route, rl.path, rl.method
       ORDER BY count DESC LIMIT 5`
    );
    const topRoutes = topRoutesResult || [];
	
    // Recent logs and activity
    const [recentLogsResult, recentActivity] = await Promise.all([
      RequestLog.listAll({ page: 1, limit: 8 }),
      SystemLog.getRecent(10)
    ]);

    res.render('admin/dashboard', {
      title: 'Admin Dashboard', layout: 'layouts/admin',
      stats: {
        users: userCount, totalApis: apiCount, activeApis: activeApiCount,
        totalKeys: keyCount, activeKeys: activeKeyCount, activePackages: pkgCount,
        totalRequests: stats30.overview?.total_requests || 0,
        successRate: stats30.overview?.total_requests > 0
          ? ((stats30.overview?.successful / stats30.overview?.total_requests) * 100).toFixed(1) : 0,
        avgResponseTime: Math.round(stats30.overview?.avg_response_time || 0),
        minResponseTime: stats30.overview?.min_response_time || 0,
        maxResponseTime: stats30.overview?.max_response_time || 0,
        totalCreditsUsed: stats30.overview?.total_credits_used || 0,
        todayRequests: statsToday.overview?.total_requests || 0,
        todaySuccess: statsToday.overview?.successful || 0,
        todayFailed: statsToday.overview?.failed || 0,
        totalBalance: creditSummary[0]?.total_balance || 0,
        totalCreditAccounts: creditSummary[0]?.total_accounts || 0
      },
      creditTxStats, topUsers, topApis, methodStats, statusStats, topRoutes,
      chartData: stats30.daily,
      recentLogs: recentLogsResult.logs, recentActivity, helpers
    });
  },

  // Users
  async users(req, res) {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || '';
    const role = req.query.role || '';
    const status = req.query.status || '';
    const { users, total } = await User.listAll({ page, limit: 20, search, role, status });
    const pagination = helpers.paginate(total, page, 20);

    // Get user IDs with pending verification requests
    const pendingUserIds = await VerificationRequest.getPendingUserIds();
    const pendingSet = new Set(pendingUserIds);

    // Add pending request flag to each user
    users.forEach(u => { u.hasPendingVerification = pendingSet.has(u.id); });

    res.render('admin/users', { title: 'Manage Users', layout: 'layouts/admin', users, pagination, filters: { search, role, status }, helpers });
  },

  async userDetail(req, res) {
    const user = await User.findByUuid(req.params.uuid);
    if (!user) { req.flash('error', 'User not found'); return res.redirect('/admin/users'); }

    const ApiKeyModel = require('../../models/ApiKey');
    const TransactionModel = require('../../models/Transaction');
    const [creditStats, packages, apiKeys, userTransactions, verificationRequest] = await Promise.all([
      Credit.getStats(user.id), Package.findAll(), ApiKeyModel.listByUser(user.id),
      TransactionModel.listByUser(user.id, { page: 1, limit: 10 }),
      VerificationRequest.getPendingByUser(user.id)
    ]);

    res.render('admin/user-detail', {
      title: `User: ${user.username}`, layout: 'layouts/admin',
      userData: user, apiKeys, creditStats, packages, helpers,
      transactions: userTransactions.transactions || [],
      pendingVerification: verificationRequest
    });
  },

  async updateUser(req, res) {
    try {
      const user = await User.findByUuid(req.params.uuid);
      if (!user) { req.flash('error', 'User not found'); return res.redirect('/admin/users'); }
      const { full_name, email, role, is_active, is_verified, package_id, username } = req.body;
      const updateData = {
        full_name, email, role, username,
        is_active: is_active === '1' || is_active === 'on' ? 1 : 0,
        is_verified: Array.isArray(is_verified) ? (is_verified.includes('1') ? 1 : 0) : (is_verified === '1' || is_verified === 'on' ? 1 : 0),
        package_id: package_id ? parseInt(package_id) || null : null
      };
      if (req.file) {
        updateData.avatar = `/uploads/avatars/${req.file.filename}`;
      }
      // If package changed, add credits from the new package
      const oldPackageId = user.package_id;
      const newPackageId = package_id ? parseInt(package_id) || null : null;
      if (newPackageId && newPackageId !== oldPackageId) {
        const pkg = await Package.findById(newPackageId);
        if (pkg && pkg.credits_included > 0) {
          await Credit.add(user.id, pkg.credits_included, `Auto bonus: package ${pkg.name}`, 'package', pkg.id, req.session.userId);
        }
      }
      await User.update(user.id, updateData);
      await SystemLog.create({ userId: req.session.userId, action: 'admin_update_user', details: { targetUserId: user.id }, ipAddress: helpers.getClientIp(req) });
      // Notify user about profile update
      try {
        await Notification.profileUpdated(user.id, { adminNote: 'Your profile has been updated by an administrator.' });
      } catch (e) { console.error('Notification error:', e); }
      req.flash('success', 'User successfully updated');
      return res.redirect(`/admin/users/${req.params.uuid}`);
    } catch (err) {
      req.flash('error', 'Failed to update user');
      return res.redirect(`/admin/users/${req.params.uuid}`);
    }
  },

  async addCredits(req, res) {
    try {
      const user = await User.findByUuid(req.params.uuid);
      if (!user) { req.flash('error', 'User not found'); return res.redirect('/admin/users'); }
      const { amount, description } = req.body;
      const amt = parseInt(amount);
      if (!amt) { req.flash('error', 'Invalid credit amount'); return res.redirect(`/admin/users/${req.params.uuid}`); }
      let result;
      if (amt > 0) {
        result = await Credit.add(user.id, amt, description || 'Admin credit bonus', 'admin', null, req.session.userId);
      } else {
        result = await Credit.deduct(user.id, Math.abs(amt), description || 'Admin credit deduction', 'admin', null);
      }
      if (!result.success) {
        req.flash('error', result.message || 'Failed to change credit');
        return res.redirect(`/admin/users/${req.params.uuid}`);
      }
      await SystemLog.create({ userId: req.session.userId, action: 'admin_add_credits', details: { targetUserId: user.id, amount: amt }, ipAddress: helpers.getClientIp(req) });
      // Send notification to user
      try {
        await Notification.creditChanged(user.id, { amount: amt, type: amt > 0 ? 'admin_add' : 'admin_deduct', description: description || (amt > 0 ? 'Admin credit bonus' : 'Admin credit deduction') });
      } catch (e) { console.error('Notification error:', e); }
      // Webhook dispatch
      try {
        const event = amt > 0 ? 'credit.added' : 'credit.deducted';
        await Webhook.dispatch(event, { user_id: user.id, amount: Math.abs(amt), type: amt > 0 ? 'admin_add' : 'admin_deduct', description: description || '' });
        await Webhook.dispatch('credit.changed', { user_id: user.id, amount: Math.abs(amt), type: amt > 0 ? 'admin_add' : 'admin_deduct', description: description || '' });
      } catch (e) { console.error('Webhook dispatch error:', e); }
      req.flash('success', `${Math.abs(amt)} Credit successful ${amt > 0 ? 'added' : 'deducted'} (balance: ${result.balance})`);
      return res.redirect(`/admin/users/${req.params.uuid}`);
    } catch (err) {
      req.flash('error', 'Failed to add credit');
      return res.redirect(`/admin/users/${req.params.uuid}`);
    }
  },

  async deleteUser(req, res) {
	  try {
		const user = await User.findByUuid(req.params.uuid);

		if (!user) {
		  req.flash('error', 'User not found');
		  return res.redirect('/admin/users');
		}

		await deleteAvatar(user.avatar);
		await User.hardDeleteByUuid(req.params.uuid);

		await SystemLog.create({
		  userId: req.session.userId,
		  action: 'admin_delete_user',
		  details: {
			targetUuid: req.params.uuid
		  },
		  ipAddress: helpers.getClientIp(req)
		});

		req.flash(
		  'success',
		  `User ${user.username} and all related data successfully deleted`
		);

		return res.redirect('/admin/users');

	  } catch (err) {
		console.error('Delete user error:', err);

		req.flash(
		  'error',
		  `Failed to delete user: ${err.message}`
		);

		return res.redirect('/admin/users');
	  }
  },

  // ============ VERIFICATION REQUESTS ============
  async approveVerification(req, res) {
    try {
      const user = await User.findByUuid(req.params.uuid);
      if (!user) { req.flash('error', 'User not found'); return res.redirect('/admin/users'); }
      const { admin_note } = req.body;
      const result = await VerificationRequest.approve(req.params.requestId, req.session.userId, admin_note || null);
      if (result.success) {
        await SystemLog.create({
          userId: req.session.userId,
          action: 'admin_approve_verification',
          details: { targetUserId: user.id, requestId: req.params.requestId },
          ipAddress: helpers.getClientIp(req)
        });
        // Send notification to user
        try {
          await Notification.verificationStatus(user.id, { status: 'approved', adminNote: admin_note });
        } catch (e) { console.error('Notification error:', e); }
        // Webhook dispatch
        try {
          await Webhook.dispatch('user.verified', { user_id: user.id, username: user.username });
          await Webhook.dispatch('verification.status_changed', { user_id: user.id, username: user.username, status: 'approved' });
        } catch (e) { console.error('Webhook dispatch error:', e); }
        req.flash('success', `Verification request for ${user.username} has been approved.`);
      } else {
        req.flash('error', result.message);
      }
    } catch (err) {
      console.error('Approve verification error:', err);
      req.flash('error', 'Failed to approve verification request.');
    }
    return res.redirect(`/admin/users/${req.params.uuid}`);
  },

  async rejectVerification(req, res) {
    try {
      const user = await User.findByUuid(req.params.uuid);
      if (!user) { req.flash('error', 'User not found'); return res.redirect('/admin/users'); }
      const { admin_note } = req.body;
      const result = await VerificationRequest.reject(req.params.requestId, req.session.userId, admin_note || null);
      if (result.success) {
        await SystemLog.create({
          userId: req.session.userId,
          action: 'admin_reject_verification',
          details: { targetUserId: user.id, requestId: req.params.requestId },
          ipAddress: helpers.getClientIp(req)
        });
        // Send notification to user
        try {
          await Notification.verificationStatus(user.id, { status: 'rejected', adminNote: admin_note });
        } catch (e) { console.error('Notification error:', e); }
        // Webhook dispatch
        try {
          await Webhook.dispatch('user.verification_rejected', { user_id: user.id, username: user.username, admin_note });
          await Webhook.dispatch('verification.status_changed', { user_id: user.id, username: user.username, status: 'rejected', admin_note });
        } catch (e) { console.error('Webhook dispatch error:', e); }
        req.flash('success', `Verification request for ${user.username} has been rejected.`);
      } else {
        req.flash('error', result.message);
      }
    } catch (err) {
      console.error('Reject verification error:', err);
      req.flash('error', 'Failed to reject verification request.');
    }
    return res.redirect(`/admin/users/${req.params.uuid}`);
  },

  // ============ APIs (Admin CRUD) ============
  async apis(req, res) {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || '';
    const status = req.query.status || '';
    
    // Tetap gunakan Api.list seperti biasa (tidak ada yang diubah di model)
    const { apis, total } = await Api.list({ page, limit: 20, search, status });
    const pagination = helpers.paginate(total, page, 20);

    // Ambil total keseluruhan API langsung dari database menggunakan method count() yang sudah ada
    const totalAllApis = await Api.count();

    res.render('admin/apis', { 
      title: 'Manage APIs', 
      layout: 'layouts/admin', 
      apis, 
      pagination, 
      totalAllApis, // <-- Kirim ke view
      filters: { search, status }, 
      helpers 
    });
  },

  async apiCreateForm(req, res) {
    res.render('admin/api-create', { title: 'Create API', layout: 'layouts/admin', helpers });
  },

  async apiCreate(req, res) {
    try {
      const { name, description, version, credit_cost, rate_limit_per_minute, auth_required, is_public, status } = req.body;
      const api = await Api.create({
        name, description, version: version || '1.0.0',
        creditCost: parseInt(credit_cost) || 1,
        rateLimitPerMinute: parseInt(rate_limit_per_minute) || 500,
        authRequired: auth_required === 'on' || auth_required === '1',
        isPublic: is_public === 'on' || is_public === '1',
        status: status || 'draft'
      });
      await SystemLog.create({ userId: req.session.userId, action: 'admin_create_api', details: { apiId: api.id, name, slug: api.slug }, ipAddress: helpers.getClientIp(req) });
      req.flash('success', `API "${name}" successfully created`);
      return res.redirect(`/admin/apis/${api.id}`);
    } catch (err) {
      req.flash('error', 'Failed to create API');
      return res.redirect('/admin/apis');
    }
  },

	async apiDetail(req, res) {
	  const api = await Api.findById(req.params.id);

	  if (!api) {
		req.flash('error', 'API not found');
		return res.redirect('/admin/apis');
	  }

	  const [routes, logs] = await Promise.all([
		ApiRoute.findByApiId(api.id),
		RequestLog.listByApi(api.id, { page: 1, limit: 20 })
	  ]);

	  const stats = await RequestLog.getStats({
		apiId: api.id,
		days: 30
	  });

	  const [topRoutes] = await db.query(
		`SELECT
		   rl.method,
		   rl.path,
		   COUNT(*) AS count,
		   AVG(rl.response_time_ms) AS avg_time
		 FROM request_logs rl
		 WHERE rl.api_id = ?
		   AND rl.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
		 GROUP BY rl.method, rl.path
		 ORDER BY count DESC
		 LIMIT 5`,
		[api.id]
	  );

	  stats.topRoutes = topRoutes || [];

	  res.render('admin/api-detail', {
		title: `API: ${api.name}`,
		layout: 'layouts/admin',
		api,
		routes,
		logs: logs.logs,
		stats,
		helpers
	  });
	},

	async apiEdit(req, res) {
	  const api = await Api.findById(req.params.id);

	  if (!api) {
		req.flash('error', 'API not found');
		return res.redirect('/admin/apis');
	  }

	  const routes = await ApiRoute.findByApiId(api.id);

	  const stats = await RequestLog.getStats({
		apiId: api.id,
		days: 30
	  });

	  const [topRoutes] = await db.query(
		`SELECT
		   rl.method,
		   rl.path,
		   COUNT(*) AS count,
		   AVG(rl.response_time_ms) AS avg_time
		 FROM request_logs rl
		 WHERE rl.api_id = ?
		   AND rl.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
		 GROUP BY rl.method, rl.path
		 ORDER BY count DESC
		 LIMIT 5`,
		[api.id]
	  );

	  stats.topRoutes = topRoutes || [];

	  res.render('admin/api-edit', {
		title: `Edit: ${api.name}`,
		layout: 'layouts/admin',
		api,
		routes,
		stats,
		helpers
	  });
	},

  async apiUpdate(req, res) {
    try {
      const { name, description, version, status, credit_cost, rate_limit_per_minute, auth_required, is_public } = req.body;
      await Api.update(req.params.id, {
        name, description, version, status,
        credit_cost: parseInt(credit_cost) || 1,
        rate_limit_per_minute: parseInt(rate_limit_per_minute) || 500,
        auth_required: auth_required === 'on' || auth_required === '1' ? 1 : 0,
        is_public: is_public === 'on' || is_public === '1' ? 1 : 0
      });
      req.flash('success', 'The API was successfully updated.');
      return res.redirect(`/admin/apis/${req.params.id}`);
    } catch (err) {
      req.flash('error', 'Failed to update API');
      return res.redirect(`/admin/apis/${req.params.id}`);
    }
  },

  async apiDelete(req, res) {
    try {
      await Api.softDelete(req.params.id);
      await SystemLog.create({ userId: req.session.userId, action: 'admin_delete_api', details: { apiId: req.params.id }, ipAddress: helpers.getClientIp(req) });
      req.flash('success', 'API successfully deleted');
      return res.redirect('/admin/apis');
    } catch (err) {
      req.flash('error', 'Failed to delete API');
      return res.redirect('/admin/apis');
    }
  },

  // Route CRUD
  async routeCreate(req, res) {
    try {
      const api = await Api.findById(req.params.id);
      if (!api) { req.flash('error', 'API not found'); return res.redirect('/admin/apis'); }
      const { method, path, description, handler_code, sample_response, documentation } = req.body;
      if (!handler_code || !handler_code.trim()) {
        req.flash('error', 'The handler code cannot be empty');
        return res.redirect(`/admin/apis/${api.id}/edit`);
      }
      let parsedSample = null;
      try { if (sample_response && sample_response.trim()) parsedSample = JSON.parse(sample_response); } catch (parseErr) {
        console.error('Response JSON parse error:', parseErr.message);
      }
      await ApiRoute.create({
        apiId: api.id, method: (method || 'GET').toUpperCase(),
        path: path.startsWith('/') ? path : '/' + path,
        handlerCode: handler_code.trim(),
        description: description || '',
        sampleResponse: parsedSample,
        documentation: documentation || ''
      });
      req.flash('success', 'Route successfully added');
      return res.redirect(`/admin/apis/${api.id}/edit`);
    } catch (err) {
      console.error('Route create error:', err);
      req.flash('error', `Failed to add route: ${err.message}`);
      return res.redirect(`/admin/apis/${req.params.id}/edit`);
    }
  },

  async routeEdit(req, res) {
    try {
      const route = await ApiRoute.findById(req.params.routeId);
      if (!route) { req.flash('error', 'Route not found'); return res.redirect('/admin/apis'); }
      const { method, path, description, handler_code, sample_response, is_active, documentation } = req.body;
      if (!handler_code || !handler_code.trim()) {
        req.flash('error', 'The handler code cannot be empty');
        return res.redirect(`/admin/apis/${route.api_id}/edit`);
      }
      let parsedSample = null;
      try { if (sample_response && sample_response.trim()) parsedSample = JSON.parse(sample_response); } catch (parseErr) {
        console.error('Response JSON parse error:', parseErr.message);
      }
      await ApiRoute.update(route.id, {
        method: (method || 'GET').toUpperCase(),
        path: path.startsWith('/') ? path : '/' + path,
        handlerCode: handler_code.trim(),
        description: description || '',
        sampleResponse: parsedSample,
        documentation: documentation || '',
        isActive: is_active === 'on' || is_active === '1' ? 1 : 0
      });
      req.flash('success', 'Route successfully updated.');
      return res.redirect(`/admin/apis/${route.api_id}/edit`);
    } catch (err) {
      console.error('Route update error:', err);
      req.flash('error', `Failed to update route: ${err.message}`);
      return res.redirect(`/admin/apis/${req.params.id}/edit`);
    }
  },

  async routeDelete(req, res) {
    try {
      const route = await ApiRoute.findById(req.params.routeId);

      if (!route) {
        req.flash('error', 'Route not found');
        return res.redirect('/admin/apis');
      }

      await ApiRoute.delete(route.id);

      req.flash('success', 'Route successfully deleted.');
      return res.redirect(`/admin/apis/${req.params.id}/edit`);
    } catch (err) {
      req.flash('error', 'Failed to delete route');
      return res.redirect(`/admin/apis/${req.params.id}/edit`);
    }
  },

  // Packages
  async packages(req, res) {
    const packages = await Package.findAll();
    res.render('admin/packages', { title: 'Manage Packages', layout: 'layouts/admin', packages, helpers });
  },

  async createPackage(req, res) {
    try {
      const { slug, name, description, price, credits_included, rate_limit_per_minute, features, sort_order } = req.body;
      let parsedFeatures = null;
      try { if (features && features.trim()) parsedFeatures = JSON.parse(features); } catch (e) { /* ignore */ }
      await Package.create({ slug: slug || helpers.slugify(name), name, description, price: parseInt(price) || 0, creditsIncluded: parseInt(credits_included) || 0, rateLimitPerMinute: parseInt(rate_limit_per_minute) || 100, features: parsedFeatures, sortOrder: parseInt(sort_order) || 0 });
      // Webhook dispatch
      try {
        await Webhook.dispatch('package.changed', { action: 'created', name, slug: slug || helpers.slugify(name), price: parseInt(price) || 0 });
      } catch (e) { console.error('Webhook dispatch error:', e); }
      req.flash('success', 'Package successfully created');
      return res.redirect('/admin/packages');
    } catch (err) { req.flash('error', 'Failed to create package'); return res.redirect('/admin/packages'); }
  },

  async updatePackage(req, res) {
    try {
      const { name, description, price, credits_included, rate_limit_per_minute, features, is_active, sort_order } = req.body;
      let parsedFeatures = null;
      try { if (features && features.trim()) parsedFeatures = JSON.parse(features); } catch (e) { /* ignore */ }
      await Package.update(req.params.id, { name, description, price: parseInt(price) || 0, creditsIncluded: parseInt(credits_included) || 0, rateLimitPerMinute: parseInt(rate_limit_per_minute) || 100, features: parsedFeatures, isActive: is_active === 'on' || is_active === '1' ? 1 : 0, sortOrder: parseInt(sort_order) || 0 });
      // Notify users subscribed to this package about the change
      try {
        const affectedUsers = await db.query('SELECT id FROM users WHERE package_id = ? AND deleted_at IS NULL', [req.params.id]);
        for (const u of (affectedUsers[0] || [])) {
          await Notification.packageChanged(u.id, { packageName: name, credits: parseInt(credits_included) || 0 });
        }
      } catch (e) { console.error('Notification error:', e); }
      // Webhook dispatch
      try {
        await Webhook.dispatch('package.changed', { action: 'updated', package_id: req.params.id, name, price: parseInt(price) || 0 });
      } catch (e) { console.error('Webhook dispatch error:', e); }
      req.flash('success', 'Package successfully updated.');
      return res.redirect('/admin/packages');
    } catch (err) { req.flash('error', 'Failed to update package'); return res.redirect('/admin/packages'); }
  },

  async deletePackage(req, res) {
    try {
      const db = require('../../config/database');
      await db.query('UPDATE users SET package_id = NULL WHERE package_id = ?', [req.params.id]);
      await Package.delete(req.params.id);
      req.flash('success', 'Package successfully deleted');
      return res.redirect('/admin/packages');
    } catch (err) { req.flash('error', 'Failed to delete package'); return res.redirect('/admin/packages'); }
  },

  // Logs
  async logs(req, res) {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || '';
    const status = req.query.status || '';
    const method = req.query.method || '';
    const { logs, total } = await RequestLog.listAll({ page, limit: 30, search, status, method });
    const pagination = helpers.paginate(total, page, 30);
    res.render('admin/logs', { title: 'Request Logs', layout: 'layouts/admin', logs, pagination, filters: { search, status, method }, helpers });
  },

  async clearLogs(req, res) {
    try {
      await RequestLog.clearAll();
      await SystemLog.create({ userId: req.session.userId, action: 'admin_clear_request_logs', details: {}, ipAddress: helpers.getClientIp(req) });
      req.flash('success', 'All request logs were successfully deleted.');
    } catch (err) { req.flash('error', 'Failed to delete request logs'); }
    return res.redirect('/admin/logs');
  },

  async creditLogs(req, res) {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || '';
    const type = req.query.type || '';
    const { transactions, total } = await Credit.listAllTransactions({ page, limit: 30, search, type });
    const pagination = helpers.paginate(total, page, 30);
    res.render('admin/credit-logs', { title: 'Credit Transactions', layout: 'layouts/admin', transactions, pagination, filters: { search, type }, helpers });
  },

  async clearCreditLogs(req, res) {
    try {
      await Credit.clearAllTransactions();
      await SystemLog.create({ userId: req.session.userId, action: 'admin_clear_credit_logs', details: {}, ipAddress: helpers.getClientIp(req) });
      req.flash('success', 'All credit logs have been successfully deleted.');
    } catch (err) { req.flash('error', 'Failed to delete credit logs'); }
    return res.redirect('/admin/credit-logs');
  },

  async settings(req, res) {
    const settings = await AdminSettings.getAll();
    // Create a map for easy lookup in views
    const settingsMap = {};
    settings.forEach(s => { settingsMap[s.setting_key] = s.parsed !== undefined ? s.parsed : s.setting_value; });
    res.render('admin/settings', { title: 'System Settings', layout: 'layouts/admin', settings, settingsMap, helpers });
  },

  async updateSettings(req, res) {
    try {
      const { app_name, default_credits, credit_value_rp, global_rate_limit, registration_enabled, maintenance_mode, auth_captcha_enabled, auth_turnstile_enabled, notifications_enabled,
              credit_bonus_enabled, credit_bonus_threshold,
              credit_bonus_daily_enabled, credit_bonus_daily,
              credit_bonus_weekly_enabled, credit_bonus_weekly,
              credit_bonus_monthly_enabled, credit_bonus_monthly,
              bank_name, bank_account_number, bank_account_name,
              payment_method_transfer_enabled, payment_method_qris_enabled,
              custom_package_rate_limit_min, custom_package_rate_limit_max, custom_package_rate_limit_step, custom_package_rate_limit_price_per_step,
              smtp_host, smtp_port, smtp_encryption, smtp_username, smtp_password, smtp_from_email, smtp_from_name,
              site_title, site_description, site_keywords,
              seo_meta_title, seo_meta_description, seo_meta_keywords,
              og_title, og_description, og_url,
              referral_enabled, referral_credit_amount, new_referral_credit_amount, referral_description } = req.body;

      // Build settings object
      const settingsData = {
        app_name,
        default_credits: String(parseInt(default_credits) || 100),
        credit_value_rp: String(parseInt(credit_value_rp) || 50),
        global_rate_limit: String(parseInt(global_rate_limit) || 500),
        registration_enabled: registration_enabled === 'on' ? 'true' : 'false',
        maintenance_mode: maintenance_mode === 'on' ? 'true' : 'false',
        auth_captcha_enabled: auth_captcha_enabled === 'on' ? 'true' : 'false',
        auth_turnstile_enabled: auth_turnstile_enabled === 'on' ? 'true' : 'false',
        notifications_enabled: notifications_enabled === 'on' ? 'true' : 'false',
        bank_name: bank_name || 'Bank BCA',
        bank_account_number: bank_account_number || '',
        bank_account_name: bank_account_name || '',
        // Payment Methods
        payment_method_transfer_enabled: payment_method_transfer_enabled === 'on' ? 'true' : 'false',
        payment_method_qris_enabled: payment_method_qris_enabled === 'on' ? 'true' : 'false',
        custom_package_rate_limit_min: String(parseInt(custom_package_rate_limit_min) || 50),
        custom_package_rate_limit_max: String(parseInt(custom_package_rate_limit_max) || 500),
        custom_package_rate_limit_step: String(parseInt(custom_package_rate_limit_step) || 50),
        custom_package_rate_limit_price_per_step: String(parseInt(custom_package_rate_limit_price_per_step) || 5000),
        // SMTP
        smtp_host: smtp_host || '',
        smtp_port: String(parseInt(smtp_port) || 587),
        smtp_encryption: smtp_encryption || 'tls',
        smtp_username: smtp_username || '',
        smtp_password: smtp_password || '',
        smtp_from_email: smtp_from_email || '',
        smtp_from_name: smtp_from_name || 'SaaSGateway',
        // Site Identity
        site_title: site_title || '',
        site_description: site_description || '',
        site_keywords: site_keywords || '',
        // SEO
        seo_meta_title: seo_meta_title || '',
        seo_meta_description: seo_meta_description || '',
        seo_meta_keywords: seo_meta_keywords || '',
        // Open Graph
        og_title: og_title || '',
        og_description: og_description || '',
        og_url: og_url || '',
        // Credit Bonus
        credit_bonus_enabled: credit_bonus_enabled === 'on' ? 'true' : 'false',
        credit_bonus_threshold: String(parseInt(credit_bonus_threshold) || 5),
        credit_bonus_daily_enabled: credit_bonus_daily_enabled === 'on' ? 'true' : 'false',
        credit_bonus_daily: String(parseInt(credit_bonus_daily) || 5),
        credit_bonus_weekly_enabled: credit_bonus_weekly_enabled === 'on' ? 'true' : 'false',
        credit_bonus_weekly: String(parseInt(credit_bonus_weekly) || 15),
        credit_bonus_monthly_enabled: credit_bonus_monthly_enabled === 'on' ? 'true' : 'false',
        credit_bonus_monthly: String(parseInt(credit_bonus_monthly) || 50),
        // Referral
        referral_enabled: referral_enabled === 'on' ? 'true' : 'false',
        referral_credit_amount: String(parseInt(referral_credit_amount) || 50),
        new_referral_credit_amount: String(parseInt(new_referral_credit_amount) || 25),
        referral_description: referral_description || ''
      };

      // Handle file uploads — delete old image if new one uploaded
      const files = req.files || {};

      if (files.site_logo && files.site_logo[0]) {
        const oldLogo = await AdminSettings.get('site_logo');
        if (oldLogo) await deleteSiteImage(oldLogo);
        settingsData.site_logo = `/uploads/site/${files.site_logo[0].filename}`;
      }

      if (files.site_favicon && files.site_favicon[0]) {
        const oldFavicon = await AdminSettings.get('site_favicon');
        if (oldFavicon) await deleteSiteImage(oldFavicon);
        settingsData.site_favicon = `/uploads/site/${files.site_favicon[0].filename}`;
      }

      if (files.site_og_image && files.site_og_image[0]) {
        const oldOgImage = await AdminSettings.get('site_og_image');
        if (oldOgImage) await deleteSiteImage(oldOgImage);
        settingsData.site_og_image = `/uploads/site/${files.site_og_image[0].filename}`;
      }

      // QRIS image upload
      if (files.qris_image && files.qris_image[0]) {
        const oldQris = await AdminSettings.get('qris_image');
        if (oldQris) await deleteSiteImage(oldQris);
        settingsData.qris_image = `/uploads/site/${files.qris_image[0].filename}`;
      }

      await AdminSettings.setMany(settingsData);
      Notification.resetSettingsCache(); // Invalidate notification settings cache
      Email.resetCache(); // Invalidate SMTP settings cache
      await SystemLog.create({ userId: req.session.userId, action: 'admin_update_settings', details: { ...req.body, files: Object.keys(files) }, ipAddress: helpers.getClientIp(req) });
      req.flash('success', 'Settings successfully saved.');
      return res.redirect('/admin/settings');
    } catch (err) {
      console.error('Update settings error:', err);
      req.flash('error', 'Failed to save settings');
      return res.redirect('/admin/settings');
    }
  },

  // ============ TEST SMTP ============
  async testSmtp(req, res) {
    try {
      const { email } = req.body;
      const result = await Email.sendTestEmail(email);
      return res.json(result);
    } catch (err) {
      console.error('Test SMTP error:', err);
      return res.json({ success: false, message: 'An unexpected error occurred.' });
    }
  },

  // ============ TRANSACTIONS ============
  async transactions(req, res) {
    const page = parseInt(req.query.page) || 1;
    const status = req.query.status || '';
    const search = req.query.search || '';
    const { transactions, total } = await Transaction.listAll({ page, limit: 20, status, search });
    const pagination = helpers.paginate(total, page, 20);
    res.render('admin/transactions', { title: 'Transactions', layout: 'layouts/admin', transactions, pagination, filters: { status, search }, helpers });
  },

  async transactionDetail(req, res) {
    const transaction = await Transaction.findById(req.params.id);
    if (!transaction) {
      req.flash('error', 'Transaction not found');
      return res.redirect('/admin/transactions');
    }
    res.render('admin/transaction-detail', { title: 'Transaction Detail', layout: 'layouts/admin', transaction, helpers });
  },

  async approveTransaction(req, res) {
    try {
      const { admin_note } = req.body;
      const transaction = await Transaction.findById(req.params.id);
      const result = await Transaction.approve(req.params.id, req.session.userId, admin_note);
      if (result.success) {
        await SystemLog.create({ userId: req.session.userId, action: 'transaction_approve', details: { id: req.params.id }, ipAddress: helpers.getClientIp(req) });
        // Send notification to user
        if (transaction && transaction.user_id) {
          try {
            await Notification.transactionApproved({ id: req.params.id, user_id: transaction.user_id });
          } catch (e) { console.error('Notification error:', e); }
        }
        // Webhook dispatch
        try {
          await Webhook.dispatch('transaction.approved', { transaction_id: req.params.id, user_id: transaction.user_id, amount: transaction.amount });
        } catch (e) { console.error('Webhook dispatch error:', e); }
        req.flash('success', result.message);
      } else {
        req.flash('error', result.message);
      }
    } catch (err) {
      req.flash('error', 'Failed to approve transaction');
    }
    return res.redirect('/admin/transactions');
  },

  async rejectTransaction(req, res) {
    try {
      const { admin_note } = req.body;
      const transaction = await Transaction.findById(req.params.id);
      const result = await Transaction.reject(req.params.id, req.session.userId, admin_note);
      if (result) {
        await SystemLog.create({ userId: req.session.userId, action: 'transaction_reject', details: { id: req.params.id }, ipAddress: helpers.getClientIp(req) });
        // Send notification to user
        if (transaction && transaction.user_id) {
          try {
            await Notification.transactionRejected({ id: req.params.id, user_id: transaction.user_id }, admin_note);
          } catch (e) { console.error('Notification error:', e); }
        }
        // Webhook dispatch
        try {
          await Webhook.dispatch('transaction.rejected', { transaction_id: req.params.id, user_id: transaction.user_id, admin_note });
        } catch (e) { console.error('Webhook dispatch error:', e); }
        req.flash('success', 'Transaction rejected');
      } else {
        req.flash('error', 'Transaction not found or already processed');
      }
    } catch (err) {
      req.flash('error', 'Failed to reject transaction');
    }
    return res.redirect('/admin/transactions');
  },

  async systemLogs(req, res) {
    const page = parseInt(req.query.page) || 1;
    const action = req.query.action || '';
    const { logs, total } = await SystemLog.list({ page, limit: 30, action });
    const pagination = helpers.paginate(total, page, 30);
    const [actions] = await db.query('SELECT DISTINCT action FROM system_logs ORDER BY action');
    res.render('admin/system-logs', { title: 'System Logs', layout: 'layouts/admin', logs, pagination, filters: { action }, actions: actions.map(a => a.action), helpers });
  },

  async clearSystemLogs(req, res) {
    try {
      await SystemLog.clearAll();
      req.flash('success', 'All system logs were successfully deleted.');
    } catch (err) { req.flash('error', 'Failed to delete system logs'); }
    return res.redirect('/admin/system-logs');
  },

  // ============ REFERRAL REPORTS ============
  async referrals(req, res) {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || '';
    const { referrals, total } = await Referral.listAll({ page, limit: 20, search });
    const pagination = helpers.paginate(total, page, 20);
    const stats = await Referral.getAdminStats();
    res.render('admin/referrals', { title: 'Referral Report', layout: 'layouts/admin', referrals, pagination, stats, filters: { search }, helpers });
  },

  // ============================================================
  // HELP CENTER - SUPPORT TICKETS
  // ============================================================

  /**
   * Admin: List all support tickets
   */
  async tickets(req, res) {
    const page = parseInt(req.query.page) || 1;
    const { status, category, priority, assigned_to, search } = req.query;
    const { tickets, total } = await SupportTicket.listAll({
      page, limit: 20, status, category, priority, assigned_to, search
    });
    const pagination = helpers.paginate(total, page, 20);
    const stats = await SupportTicket.getStats();
    const admins = await User.listAll({ page: 1, limit: 100, role: 'admin' });

    res.render('admin/tickets', {
      title: 'Support Tickets', layout: 'layouts/admin',
      tickets, pagination, stats,
      filters: { status, category, priority, assigned_to, search },
      admins: admins.users, helpers, SupportTicket
    });
  },

  /**
   * Admin: View single ticket
   */
  async ticketDetail(req, res) {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) {
      req.flash('error', 'Ticket not found');
      return res.redirect('/admin/tickets');
    }

    const messages = await SupportTicket.getMessages(ticket.id, { includeInternal: true });
    await SupportTicket.markMessagesRead(ticket.id, 'admin');
    const admins = await User.listAll({ page: 1, limit: 100, role: 'admin' });
    const unassignedCount = await SupportTicket.getUnreadCount(ticket.id, 'user');

    res.render('admin/ticket-detail', {
      title: `Ticket ${ticket.ticket_number}`, layout: 'layouts/admin',
      ticket, messages, helpers, SupportTicket,
      admins: admins.users, unassignedCount
    });
  },

  /**
   * Admin: Update ticket status/priority/assignment
   */
  async ticketUpdate(req, res) {
    try {
      const ticket = await SupportTicket.findById(req.params.id);
      if (!ticket) {
        req.flash('error', 'Ticket not found');
        return res.redirect('/admin/tickets');
      }

      const { status, priority, assigned_to, admin_notes } = req.body;
      const updateData = {};

      if (status) {
        updateData.status = status;
        if (status === 'resolved') updateData.resolved_at = new Date();
        if (status === 'closed') updateData.closed_at = new Date();
      }
      if (priority) updateData.priority = priority;
      if (assigned_to !== undefined) {
        updateData.assigned_to = assigned_to === '' ? null : parseInt(assigned_to);
      }
      if (admin_notes !== undefined) updateData.admin_notes = admin_notes;

      await SupportTicket.update(ticket.id, updateData);

      // Notify the ticket owner about status change
      if (status && status !== ticket.status) {
        const updatedTicket = await SupportTicket.findById(ticket.id);
        await Notification.ticketStatusChanged(updatedTicket, ticket.status, status);
        await Webhook.dispatch('ticket.status_changed', { ticket: updatedTicket, oldStatus: ticket.status, newStatus: status, changedBy: { id: req.session.userId, role: 'admin' } }, 'admin');
      }

      req.flash('success', 'Ticket updated successfully');
    } catch (err) {
      console.error('Ticket update error:', err);
      req.flash('error', 'Failed to update ticket');
    }
    return res.redirect(`/admin/tickets/${req.params.id}`);
  },

  /**
   * Admin: Reply to ticket
   */
  async ticketReply(req, res) {
    try {
      const ticket = await SupportTicket.findById(req.params.id);
      if (!ticket) {
        req.flash('error', 'Ticket not found');
        return res.redirect('/admin/tickets');
      }

      const { message, is_internal_note } = req.body;
      if (!message || !message.trim()) {
        req.flash('error', 'Message cannot be empty');
        return res.redirect(`/admin/tickets/${req.params.id}`);
      }

      await SupportTicket.addMessage({
        ticket_id: ticket.id,
        sender_id: req.session.userId,
        sender_role: 'admin',
        message: message.trim(),
        is_internal_note: is_internal_note ? 1 : 0
      });

      // Update status to in_progress if currently open
      if (ticket.status === 'open') {
        await SupportTicket.update(ticket.id, { status: 'in_progress' });
      }

      // Notify user about admin reply (skip for internal notes)
      if (!is_internal_note) {
        const sender = await User.findById(req.session.userId);
        await Notification.ticketRepliedToUser(ticket, sender);
        await Webhook.dispatch('ticket.replied', { ticket, sender: { id: sender.id, username: sender.username, role: 'admin' } }, 'admin');
      }

      req.flash('success', is_internal_note ? 'Internal note added' : 'Reply sent successfully');
    } catch (err) {
      console.error('Ticket reply error:', err);
      req.flash('error', 'Failed to send reply');
    }
    return res.redirect(`/admin/tickets/${req.params.id}`);
  },

  /**
   * Admin: Clear/resolve old tickets
   */
  async ticketBulkAction(req, res) {
    try {
      const { action, ticket_ids } = req.body;
      if (!ticket_ids || !Array.isArray(ticket_ids)) {
        req.flash('error', 'No tickets selected');
        return res.redirect('/admin/tickets');
      }

      for (const id of ticket_ids) {
        if (action === 'close') {
          await SupportTicket.close(id);
        } else if (action === 'resolve') {
          await SupportTicket.update(id, { status: 'resolved', resolved_at: new Date() });
        }
      }

      req.flash('success', `${ticket_ids.length} ticket(s) updated`);
    } catch (err) {
      console.error('Bulk action error:', err);
      req.flash('error', 'Failed to perform bulk action');
    }
    return res.redirect('/admin/tickets');
  },

  /**
   * DELETE /admin/tickets/:id/delete
   */
  async ticketDelete(req, res) {
    try {
      const ticket = await SupportTicket.findById(req.params.id);
      if (!ticket) {
        req.flash('error', 'Ticket not found');
        return res.redirect('/admin/tickets');
      }

      await SupportTicket.delete(req.params.id);
      await Webhook.dispatch('ticket.deleted', { ticket }, 'admin');
      req.flash('success', `Ticket ${ticket.ticket_number} deleted`);
    } catch (err) {
      console.error('Delete ticket error:', err);
      req.flash('error', 'Failed to delete ticket');
    }
    return res.redirect('/admin/tickets');
  }
};

module.exports = adminController;

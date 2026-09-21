const Webhook = require('../models/Webhook');
const ApiKey = require('../models/ApiKey');
const helpers = require('../utils/helpers');

const webhookController = {
  // ============================================================
  // ADMIN: Webhook Management
  // ============================================================

  async adminList(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const search = req.query.search || '';
      const role = req.query.role || '';
      const { webhooks, total } = await Webhook.listAll({ page, limit: 20, role, search });
      const pagination = helpers.paginate(total, page, 20);
      const stats = await Webhook.getStats();

      res.render('admin/webhooks', {
        title: 'Webhooks',
        layout: 'layouts/admin',
        userData: req.session,
        webhooks,
        pagination,
        filters: { search, role },
        stats,
        helpers
      });
    } catch (err) {
      console.error('Admin webhook list error:', err);
      req.flash('error', 'Failed to load webhooks');
      res.redirect('/admin/dashboard');
    }
  },

  async adminCreate(req, res) {
    try {
      const user = req.session;
      const events = Webhook.getEvents('admin');
      const apiKeys = await ApiKey.listAll();
      res.render('admin/webhook-form', {
        title: 'Create Webhook',
        layout: 'layouts/admin',
        userData: user,
        webhook: null,
        events,
        apiKeys,
        helpers
      });
    } catch (err) {
      req.flash('error', 'Failed to load form');
      res.redirect('/admin/webhooks');
    }
  },

  async adminStore(req, res) {
    try {
      const { name, url, events, auth_type, auth_header_name, auth_param_name, api_key_id } = req.body;
      const selectedEvents = Array.isArray(events) ? events : (events ? [events] : []);

      if (!name || !url || selectedEvents.length === 0) {
        req.flash('error', 'Name, URL, and at least one event are required');
        return res.redirect('/admin/webhooks/create');
      }

      // Validate URL
      try { new URL(url); } catch {
        req.flash('error', 'Invalid webhook URL');
        return res.redirect('/admin/webhooks/create');
      }

      await Webhook.create(req.session.userId, {
        name,
        url,
        events: selectedEvents,
        role: 'admin',
        apiKeyId: api_key_id ? parseInt(api_key_id) : null,
        authType: auth_type || 'header',
        authHeaderName: auth_header_name || 'X-API-Key',
        authParamName: auth_param_name || 'api_key'
      });

      req.flash('success', 'Webhook created successfully');
      res.redirect('/admin/webhooks');
    } catch (err) {
      console.error('Admin webhook store error:', err);
      req.flash('error', 'Failed to create webhook');
      res.redirect('/admin/webhooks/create');
    }
  },

  async adminEdit(req, res) {
    try {
      const webhook = await Webhook.findById(req.params.id);
      if (!webhook) {
        req.flash('error', 'Webhook not found');
        return res.redirect('/admin/webhooks');
      }

      const events = Webhook.getEvents(webhook.role);
      const apiKeys = await ApiKey.listAll();

      res.render('admin/webhook-form', {
        title: 'Edit Webhook',
        layout: 'layouts/admin',
        userData: req.session,
        webhook,
        events,
        apiKeys,
        helpers
      });
    } catch (err) {
      req.flash('error', 'Failed to load webhook');
      res.redirect('/admin/webhooks');
    }
  },

  async adminUpdate(req, res) {
    try {
      const { name, url, events, auth_type, auth_header_name, auth_param_name, api_key_id } = req.body;
      const selectedEvents = Array.isArray(events) ? events : (events ? [events] : []);

      await Webhook.update(req.params.id, {
        name,
        url,
        events: selectedEvents,
        isActive: req.body.is_active === 'on',
        apiKeyId: api_key_id ? parseInt(api_key_id) : null,
        authType: auth_type || 'header',
        authHeaderName: auth_header_name || 'X-API-Key',
        authParamName: auth_param_name || 'api_key'
      });

      req.flash('success', 'Webhook updated');
      res.redirect('/admin/webhooks');
    } catch (err) {
      console.error('Admin webhook update error:', err);
      req.flash('error', 'Failed to update webhook');
      res.redirect('/admin/webhooks');
    }
  },

  async adminDelete(req, res) {
    try {
      await Webhook.delete(req.params.id);
      req.flash('success', 'Webhook deleted');
      res.redirect('/admin/webhooks');
    } catch (err) {
      req.flash('error', 'Failed to delete webhook');
      res.redirect('/admin/webhooks');
    }
  },

  async adminToggle(req, res) {
    try {
      const webhook = await Webhook.findById(req.params.id);
      if (!webhook) {
        req.flash('error', 'Webhook not found');
        return res.redirect('/admin/webhooks');
      }

      await Webhook.update(req.params.id, { isActive: !webhook.is_active });
      req.flash('success', `Webhook ${webhook.is_active ? 'disabled' : 'enabled'}`);
      res.redirect('/admin/webhooks');
    } catch (err) {
      req.flash('error', 'Failed to toggle webhook');
      res.redirect('/admin/webhooks');
    }
  },

  async adminRotateSecret(req, res) {
    try {
      await Webhook.rotateSecret(req.params.id);
      req.flash('success', 'Webhook secret rotated. Update your endpoint with the new secret.');
      res.redirect('/admin/webhooks/' + req.params.id + '/edit');
    } catch (err) {
      req.flash('error', 'Failed to rotate secret');
      res.redirect('/admin/webhooks');
    }
  },

  async adminLogs(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const status = req.query.status || '';
      const event = req.query.event || '';
      const { logs, total } = await Webhook.getRecentLogs({ page, limit: 30, status, event });
      const pagination = helpers.paginate(total, page, 30);

      res.render('admin/webhook-logs', {
        title: 'Webhook Delivery Logs',
        layout: 'layouts/admin',
        userData: req.session,
        logs,
        pagination,
        filters: { status, event },
        helpers
      });
    } catch (err) {
      console.error('Admin webhook logs error:', err);
      req.flash('error', 'Failed to load webhook logs');
      res.redirect('/admin/webhooks');
    }
  },

  async adminClearLogs(req, res) {
    try {
      await Webhook.clearAllLogs();
      req.flash('success', 'All webhook logs cleared');
      res.redirect('/admin/webhooks/logs');
    } catch (err) {
      console.error('Admin clear webhook logs error:', err);
      req.flash('error', 'Failed to clear logs');
      res.redirect('/admin/webhooks/logs');
    }
  },

  async adminDetailLogs(req, res) {
    try {
      const webhook = await Webhook.findById(req.params.id);
      if (!webhook) {
        req.flash('error', 'Webhook not found');
        return res.redirect('/admin/webhooks');
      }

      const page = parseInt(req.query.page) || 1;
      const { logs, total } = await Webhook.getLogs(req.params.id, { page, limit: 20 });
      const pagination = helpers.paginate(total, page, 20);

      res.render('admin/webhook-detail', {
        title: 'Webhook Details',
        layout: 'layouts/admin',
        userData: req.session,
        webhook,
        logs,
        pagination,
        helpers
      });
    } catch (err) {
      req.flash('error', 'Failed to load webhook details');
      res.redirect('/admin/webhooks');
    }
  },

  // ============================================================
  // USER: Webhook Management
  // ============================================================

  async userList(req, res) {
    try {
      const userId = req.session.userId;
      const page = parseInt(req.query.page) || 1;
      const search = req.query.search || '';
      const { webhooks, total } = await Webhook.listByUser(userId, { page, limit: 20, search });
      const pagination = helpers.paginate(total, page, 20);
      const stats = await Webhook.getStats(userId);

      res.render('user/webhooks', {
        title: 'My Webhooks',
        layout: 'layouts/user',
        userData: req.session,
        webhooks,
        pagination,
        filters: { search },
        stats,
        helpers
      });
    } catch (err) {
      console.error('User webhook list error:', err);
      req.flash('error', 'Failed to load webhooks');
      res.redirect('/user/dashboard');
    }
  },

  async userCreate(req, res) {
    try {
      const userId = req.session.userId;
      const events = Webhook.getEvents('user');
      const apiKeys = await ApiKey.listByUser(userId);

      res.render('user/webhook-form', {
        title: 'Create Webhook',
        layout: 'layouts/user',
        userData: req.session,
        webhook: null,
        events,
        apiKeys,
        helpers
      });
    } catch (err) {
      req.flash('error', 'Failed to load form');
      res.redirect('/user/webhooks');
    }
  },

  async userStore(req, res) {
    try {
      const { name, url, events, auth_type, auth_header_name, auth_param_name, api_key_id } = req.body;
      const selectedEvents = Array.isArray(events) ? events : (events ? [events] : []);

      if (!name || !url || selectedEvents.length === 0) {
        req.flash('error', 'Name, URL, and at least one event are required');
        return res.redirect('/user/webhooks/create');
      }

      try { new URL(url); } catch {
        req.flash('error', 'Invalid webhook URL');
        return res.redirect('/user/webhooks/create');
      }

      await Webhook.create(req.session.userId, {
        name,
        url,
        events: selectedEvents,
        role: 'user',
        apiKeyId: api_key_id ? parseInt(api_key_id) : null,
        authType: auth_type || 'header',
        authHeaderName: auth_header_name || 'X-API-Key',
        authParamName: auth_param_name || 'api_key'
      });

      req.flash('success', 'Webhook created successfully');
      res.redirect('/user/webhooks');
    } catch (err) {
      console.error('User webhook store error:', err);
      req.flash('error', 'Failed to create webhook');
      res.redirect('/user/webhooks/create');
    }
  },

  async userEdit(req, res) {
    try {
      const webhook = await Webhook.findById(req.params.id);
      if (!webhook || webhook.user_id !== req.session.userId) {
        req.flash('error', 'Webhook not found');
        return res.redirect('/user/webhooks');
      }

      const events = Webhook.getEvents('user');
      const apiKeys = await ApiKey.listByUser(req.session.userId);

      res.render('user/webhook-form', {
        title: 'Edit Webhook',
        layout: 'layouts/user',
        userData: req.session,
        webhook,
        events,
        apiKeys,
        helpers
      });
    } catch (err) {
      req.flash('error', 'Failed to load webhook');
      res.redirect('/user/webhooks');
    }
  },

  async userUpdate(req, res) {
    try {
      const webhook = await Webhook.findById(req.params.id);
      if (!webhook || webhook.user_id !== req.session.userId) {
        req.flash('error', 'Webhook not found');
        return res.redirect('/user/webhooks');
      }

      const { name, url, events, auth_type, auth_header_name, auth_param_name, api_key_id } = req.body;
      const selectedEvents = Array.isArray(events) ? events : (events ? [events] : []);

      await Webhook.update(req.params.id, {
        name,
        url,
        events: selectedEvents,
        isActive: req.body.is_active === 'on',
        apiKeyId: api_key_id ? parseInt(api_key_id) : null,
        authType: auth_type || 'header',
        authHeaderName: auth_header_name || 'X-API-Key',
        authParamName: auth_param_name || 'api_key'
      });

      req.flash('success', 'Webhook updated');
      res.redirect('/user/webhooks');
    } catch (err) {
      console.error('User webhook update error:', err);
      req.flash('error', 'Failed to update webhook');
      res.redirect('/user/webhooks');
    }
  },

  async userDelete(req, res) {
    try {
      const webhook = await Webhook.findById(req.params.id);
      if (!webhook || webhook.user_id !== req.session.userId) {
        req.flash('error', 'Webhook not found');
        return res.redirect('/user/webhooks');
      }

      await Webhook.delete(req.params.id);
      req.flash('success', 'Webhook deleted');
      res.redirect('/user/webhooks');
    } catch (err) {
      req.flash('error', 'Failed to delete webhook');
      res.redirect('/user/webhooks');
    }
  },

  async userToggle(req, res) {
    try {
      const webhook = await Webhook.findById(req.params.id);
      if (!webhook || webhook.user_id !== req.session.userId) {
        req.flash('error', 'Webhook not found');
        return res.redirect('/user/webhooks');
      }

      await Webhook.update(req.params.id, { isActive: !webhook.is_active });
      req.flash('success', `Webhook ${webhook.is_active ? 'disabled' : 'enabled'}`);
      res.redirect('/user/webhooks');
    } catch (err) {
      req.flash('error', 'Failed to toggle webhook');
      res.redirect('/user/webhooks');
    }
  },

  async userRotateSecret(req, res) {
    try {
      const webhook = await Webhook.findById(req.params.id);
      if (!webhook || webhook.user_id !== req.session.userId) {
        req.flash('error', 'Webhook not found');
        return res.redirect('/user/webhooks');
      }

      await Webhook.rotateSecret(req.params.id);
      req.flash('success', 'Webhook secret rotated. Update your endpoint with the new secret.');
      res.redirect('/user/webhooks/' + req.params.id + '/edit');
    } catch (err) {
      req.flash('error', 'Failed to rotate secret');
      res.redirect('/user/webhooks');
    }
  },

  async userLogs(req, res) {
    try {
      const userId = req.session.userId;
      const page = parseInt(req.query.page) || 1;
      const status = req.query.status || '';
      const event = req.query.event || '';

      const { logs, total } = await Webhook.getUserRecentLogs(userId, { page, limit: 30, status, event });
      const pagination = helpers.paginate(total, page, 30);

      res.render('user/webhook-logs', {
        title: 'Webhook Logs',
        layout: 'layouts/user',
        userData: req.session,
        logs,
        pagination,
        filters: { status, event },
        helpers
      });
    } catch (err) {
      console.error('User webhook logs error:', err);
      req.flash('error', 'Failed to load webhook logs');
      res.redirect('/user/webhooks');
    }
  },

  async userClearLogs(req, res) {
    try {
      await Webhook.clearUserLogs(req.session.userId);
      req.flash('success', 'All your webhook logs cleared');
      res.redirect('/user/webhooks/logs');
    } catch (err) {
      console.error('User clear webhook logs error:', err);
      req.flash('error', 'Failed to clear logs');
      res.redirect('/user/webhooks/logs');
    }
  },

  async userDetailLogs(req, res) {
    try {
      const webhook = await Webhook.findById(req.params.id);
      if (!webhook || webhook.user_id !== req.session.userId) {
        req.flash('error', 'Webhook not found');
        return res.redirect('/user/webhooks');
      }

      const page = parseInt(req.query.page) || 1;
      const { logs, total } = await Webhook.getLogs(req.params.id, { page, limit: 20 });
      const pagination = helpers.paginate(total, page, 20);

      res.render('user/webhook-detail', {
        title: 'Webhook Details',
        layout: 'layouts/user',
        userData: req.session,
        webhook,
        logs,
        pagination,
        helpers
      });
    } catch (err) {
      req.flash('error', 'Failed to load webhook details');
      res.redirect('/user/webhooks');
    }
  }
};

module.exports = webhookController;

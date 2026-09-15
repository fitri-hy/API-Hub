const helpers = require('../utils/helpers');
const AdminSettings = require('../models/AdminSettings');
const Notification = require('../models/Notification');

module.exports = (app) => {
  app.use(async (req, res, next) => {
    try {
      // Load settings from database — core + site identity + SEO
      const [appName, creditValue, siteSettings] = await Promise.all([
        AdminSettings.get('app_name'),
        AdminSettings.get('credit_value_rp'),
        // Fetch all site/SEO related settings in one query
        AdminSettings.getAll()
      ]);

      // Build a quick lookup map
      const sMap = {};
      siteSettings.forEach(s => { sMap[s.setting_key] = s.parsed !== undefined ? s.parsed : s.setting_value; });

      res.locals.appname = appName || process.env.APP_NAME || 'My App';
      res.locals.baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      res.locals.creditValueRp = creditValue || 50;
      res.locals.helpers = helpers;
      res.locals.currentPath = req.path;
      res.locals.isAuthenticated = !!req.session.userId;
      res.locals.userRole = req.session.role || null;

      // Notification settings
      res.locals.notificationsEnabled = sMap.notifications_enabled !== false; // default true

      // Site Identity
      res.locals.site_title = sMap.site_title || '';
      res.locals.site_description = sMap.site_description || '';
      res.locals.site_keywords = sMap.site_keywords || '';
      res.locals.site_logo = sMap.site_logo || '';
      res.locals.site_favicon = sMap.site_favicon || '';

      // SEO
      res.locals.seo_meta_title = sMap.seo_meta_title || '';
      res.locals.seo_meta_description = sMap.seo_meta_description || '';
      res.locals.seo_meta_keywords = sMap.seo_meta_keywords || '';

      // Open Graph
      res.locals.og_title = sMap.og_title || '';
      res.locals.og_description = sMap.og_description || '';
      res.locals.og_url = sMap.og_url || '';
      res.locals.site_og_image = sMap.site_og_image || '';

      // Notification unread count (role-specific) — skip if disabled
      let notificationUnreadCount = 0;
      if (req.session.userId && res.locals.notificationsEnabled) {
        try {
          const target = req.session.role === 'admin' ? 'admin' : 'user';
          notificationUnreadCount = await Notification.getUnreadCount(req.session.userId, target);
        } catch (e) { /* ignore */ }
      }
      res.locals.notificationUnreadCount = notificationUnreadCount;

      res.locals.flash = {
        success: req.flash('success'),
        error: req.flash('error'),
        info: req.flash('info')
      };

      next();
    } catch (err) {
      console.error('Locals middleware error:', err);
      // Fallback to env values
      res.locals.appname = process.env.APP_NAME || 'My App';
      res.locals.baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
      res.locals.creditValueRp = 50;
      res.locals.helpers = helpers;
      res.locals.currentPath = req.path;
      res.locals.site_title = '';
      res.locals.site_description = '';
      res.locals.site_keywords = '';
      res.locals.site_logo = '';
      res.locals.site_favicon = '';
      res.locals.seo_meta_title = '';
      res.locals.seo_meta_description = '';
      res.locals.seo_meta_keywords = '';
      res.locals.og_title = '';
      res.locals.og_description = '';
      res.locals.og_url = '';
      res.locals.site_og_image = '';
      res.locals.notificationsEnabled = true;
      res.locals.notificationUnreadCount = 0;
      res.locals.flash = {
        success: req.flash('success'),
        error: req.flash('error'),
        info: req.flash('info')
      };
      next();
    }
  });
};

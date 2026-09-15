const AdminSettings = require('../models/AdminSettings');

const maintenanceMode = async (req, res, next) => {
  try {
    const isMaintenance = await AdminSettings.get('maintenance_mode');
    
    if (isMaintenance) {
      if (req.session && req.session.role === 'admin') {
        return next();
      }
      
      if (req.path === '/auth/login' || req.path === '/auth/logout') {
        return next();
      }
      
      return res.status(503).render('errors/maintenance', {
        title: 'Maintenance Mode',
        layout: 'layouts/auth'
      });
    }
    
    next();
  } catch (err) {
    console.error('Maintenance mode check failed:', err);
    next();
  }
};

module.exports = maintenanceMode;

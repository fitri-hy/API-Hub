const { loadUser } = require('../middleware/auth');

module.exports = (app) => {
  app.use('/', require('./public'));

  app.use('/auth', require('./auth'));
  app.use('/notifications', require('./notifications'));
  app.use('/admin', loadUser, require('./admin/index'));
  app.use('/user', loadUser, require('./user/index'));
  
  app.use('/gateway', require('./gateway'));
};
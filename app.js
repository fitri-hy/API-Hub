const express = require('express');

const securityMiddleware = require('./middleware/security');
const bodyParserMiddleware = require('./middleware/bodyParser');
const sessionMiddleware = require('./config/session');
const viewMiddleware = require('./config/view');
const localsMiddleware = require('./middleware/locals');
const maintenanceMiddleware = require('./middleware/maintenance');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

securityMiddleware(app);
bodyParserMiddleware(app);
sessionMiddleware(app);
viewMiddleware(app);
localsMiddleware(app);
app.use(maintenanceMiddleware);
routes(app);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
const express = require('express');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');

module.exports = (app) => {
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.set('view cache', false);

  app.use(expressLayouts);

  app.set('layout', 'layouts/public');
  app.set('layout extractScripts', true);
  app.set('layout extractStyles', true);

  app.use(express.static(path.join(__dirname, '..', 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader(
        'Cache-Control',
        'no-store, no-cache, must-revalidate, proxy-revalidate'
      );
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }));
};
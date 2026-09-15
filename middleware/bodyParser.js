const express = require('express');
const methodOverride = require('method-override');

module.exports = (app) => {
  app.use(express.json({
    limit: process.env.BODY_JSON_LIMIT || '1mb'
  }));

  app.use(express.urlencoded({
    extended: process.env.BODY_EXTENDED !== 'false',
    limit: process.env.BODY_URLENCODED_LIMIT || '1mb'
  }));

  app.use(
    methodOverride(
      process.env.METHOD_OVERRIDE_KEY || '_method'
    )
  );
};
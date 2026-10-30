'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const path = require('path');
const env = require('./config/env');
const { attachSession, originGuard } = require('./middleware/auth');
const { apiRouter } = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const { notFound } = require('./middleware/notFound');

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: false, // Allow simple local dev without complex CSP restrictions for static files
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(
    cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    })
  );

  if (env.NODE_ENV !== 'test') {
    app.use(morgan('dev'));
  }

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));
  app.use(cookieParser());

  // Attach active user or admin session if cookie is present
  app.use(attachSession);

  // Serve static public assets (HTML, CSS, JS)
  const publicDir = path.resolve(__dirname, '../public');
  app.use(express.static(publicDir));

  // Mount API router
  app.use('/api', originGuard);
  app.use('/api', apiRouter);

  // Fallback for API routes
  app.use('/api/*', notFound);

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };

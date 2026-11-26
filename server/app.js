'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const path = require('path');
const env = require('./config/env');
const { attachSession, originGuard, isTrustedOrigin } = require('./middleware/auth');
const { apiRouter } = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const { notFound } = require('./middleware/notFound');

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // Hardened Content Security Policy and security headers
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'", 'https://accounts.google.com'],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );

  // Strict CORS: only reflect allowed origins; untrusted cross-origins are denied
  app.use(
    cors((req, callback) => {
      const origin = req.get('origin');
      if (!origin || isTrustedOrigin(origin, req)) {
        callback(null, {
          origin: true,
          credentials: true,
          methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
          allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Authorization'],
        });
      } else {
        callback(null, {
          origin: false,
          credentials: false,
        });
      }
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

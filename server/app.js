'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const path = require('path');
const env = require('./config/env');
const { isDBConnected } = require('./config/database');
const { attachSession, originGuard, isTrustedOrigin } = require('./middleware/auth');
const { apiRouter } = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const { notFound } = require('./middleware/notFound');

/**
 * Recursive sanitizer to strip MongoDB query operator keys ($gt, $ne, etc.)
 * from request payloads to prevent NoSQL injection attacks.
 */
function sanitizeMongoQuery(req, res, next) {
  function sanitize(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        if (typeof obj[i] === 'object') sanitize(obj[i]);
      }
      return;
    }
    for (const key of Object.keys(obj)) {
      if (key.startsWith('$')) {
        delete obj[key];
      } else if (typeof obj[key] === 'object') {
        sanitize(obj[key]);
      }
    }
  }
  if (req.body) sanitize(req.body);
  if (req.query) sanitize(req.query);
  if (req.params) sanitize(req.params);
  next();
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // Reverse proxy support (Render, Railway, Nginx, Cloudflare)
  const trustProxyVal = Number(env.TRUST_PROXY);
  if (!isNaN(trustProxyVal)) {
    app.set('trust proxy', trustProxyVal);
  } else if (env.TRUST_PROXY === 'true') {
    app.set('trust proxy', true);
  }

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
    app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  }

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));
  app.use(sanitizeMongoQuery);
  app.use(cookieParser());

  // Top-level Hosting Health-Check (supports Render, Railway, K8s, Uptime monitors)
  app.get('/health', (req, res) => {
    const isDbUp = isDBConnected();
    const statusCode = isDbUp ? 200 : 503;
    res.status(statusCode).json({
      status: isDbUp ? 'ok' : 'degraded',
      database: isDbUp ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
    });
  });

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

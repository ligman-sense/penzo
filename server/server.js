'use strict';

const { createApp } = require('./app');
const { connectDB } = require('./config/database');
const env = require('./config/env');
const { purgeExpired } = require('./services/sessionService');
const { startAlertScheduler, stopAlertScheduler } = require('./services/alertSchedulerService');
const { bootstrapAdminIfNeeded } = require('./services/adminAuthService');

// Capture unexpected process-level rejections and exceptions safely
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err?.message || err);
  process.exit(1);
});

async function start() {
  await connectDB();

  // Idempotently provision the Super-Admin account if configured in environment
  try {
    await bootstrapAdminIfNeeded();
  } catch (err) {
    console.warn('[BOOTSTRAP WARNING] Could not auto-bootstrap administrator:', err.message);
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    const baseUrl = env.APP_URL || `http://localhost:${env.PORT}`;
    console.log(`\n=================================================`);
    console.log(` PENZO Application Server running`);
    console.log(` Base URL : ${baseUrl}`);
    console.log(` Health   : ${baseUrl}/health`);
    console.log(` Portals  : ${baseUrl}/login.html`);
    console.log(` Admin    : ${baseUrl}/admin/login.html`);
    console.log(` Mode     : ${env.NODE_ENV}`);
    console.log(` Scheduler: ${env.ENABLE_BACKGROUND_SCHEDULER ? 'Enabled' : 'Disabled'}`);
    console.log(`=================================================\n`);
  });

  // Housekeeping: purge expired sessions periodically
  void purgeExpired().catch((err) => console.error('[SESSION PURGE ERROR]', err.message));
  setInterval(() => purgeExpired().catch((err) => console.error('[SESSION PURGE ERROR]', err.message)), 3_600_000).unref();

  // Automated 2-day unresolved-request alert scheduler
  if (env.ENABLE_BACKGROUND_SCHEDULER) {
    startAlertScheduler(15);
  }

  const shutdown = (signal) => {
    console.log(`\n${signal} received. Closing HTTP server gracefully...`);
    if (env.ENABLE_BACKGROUND_SCHEDULER) {
      stopAlertScheduler();
    }
    server.close(async () => {
      const mongoose = require('mongoose');
      try {
        await mongoose.disconnect();
        console.log('MongoDB disconnected cleanly. Exiting.');
      } catch (err) {
        console.error('Error during database disconnect:', err.message);
      }
      process.exit(0);
    });
    setTimeout(() => {
      console.error('Forcefully exiting after shutdown timeout.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('Fatal startup error:', err?.message || err);
  process.exit(1);
});

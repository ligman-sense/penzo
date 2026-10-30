'use strict';

const { createApp } = require('./app');
const { connectDB } = require('./config/database');
const env = require('./config/env');
const { purgeExpired } = require('./services/sessionService');

async function start() {
  await connectDB();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`\n=================================================`);
    console.log(` PENZO API & Frontend Server running`);
    console.log(` URL      : http://localhost:${env.PORT}`);
    console.log(` Portals  : http://localhost:${env.PORT}/login.html`);
    console.log(` Admin    : http://localhost:${env.PORT}/admin/login.html`);
    console.log(` Mode     : ${env.NODE_ENV}`);
    console.log(` OTP Mode : ${env.OTP_PROVIDER}`);
    console.log(`=================================================\n`);
  });

  // Housekeeping: purge expired sessions periodically
  void purgeExpired().catch(console.error);
  setInterval(() => purgeExpired().catch(console.error), 3_600_000).unref();

  const shutdown = (signal) => {
    console.log(`\n${signal} received. Closing HTTP server gracefully...`);
    server.close(async () => {
      const mongoose = require('mongoose');
      await mongoose.disconnect();
      console.log('MongoDB disconnected. Exiting.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

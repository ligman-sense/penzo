'use strict';

const { Router } = require('express');
const { authRouter } = require('./auth');
const { adminAuthRouter } = require('./adminAuth');
const { adminRouter } = require('./admin');
const { profileRouter } = require('./profile');
const { requestsRouter } = require('./requests');
const { interestsRouter, availabilityRouter } = require('./volunteer');
const {
  dashboardRouter,
  historyRouter,
  assignmentsRouter,
  notificationsRouter,
} = require('./account');
const { publicExaminationsRouter } = require('./publicExaminations');
const { publicFaqsRouter } = require('./publicFaqs');

const { isDBConnected } = require('../config/database');

const apiRouter = Router();

apiRouter.get('/health', (req, res) => {
  const isDbUp = isDBConnected();
  const statusCode = isDbUp ? 200 : 503;
  res.status(statusCode).json({
    status: isDbUp ? 'ok' : 'degraded',
    database: isDbUp ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
  });
});

apiRouter.use('/public/examinations', publicExaminationsRouter);
apiRouter.use('/public/faqs', publicFaqsRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/admin/auth', adminAuthRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/profile', profileRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/requests', requestsRouter);
apiRouter.use('/interests', interestsRouter);
apiRouter.use('/availability', availabilityRouter);
apiRouter.use('/assignments', assignmentsRouter);
apiRouter.use('/history', historyRouter);
apiRouter.use('/notifications', notificationsRouter);

module.exports = { apiRouter };

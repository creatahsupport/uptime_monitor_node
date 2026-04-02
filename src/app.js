require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { testConnection } = require('./config/database');
const { syncDb } = require('./models');
const { startCronJob } = require('./jobs/monitorJob');
const { startMonthlyReportJob } = require('./jobs/monthlyReportJob');
const { runAllChecks } = require('./services/monitorService');
const { authenticate } = require('./middleware/authMiddleware');
const errorHandler = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth');
const urlRoutes = require('./routes/urls');
const recipientRoutes = require('./routes/recipients');
const dashboardRoutes = require('./routes/dashboard');
const reportRoutes = require('./routes/reports');
const settingsRoutes = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Public routes
app.use('/api/auth', authRoutes);
app.get('/api/health', (_req, res) => res.json({ success: true, status: 'ok' }));

// Protected routes — all require JWT
app.use('/api/urls', authenticate, urlRoutes);
app.use('/api/recipients', authenticate, recipientRoutes);
app.use('/api/dashboard', authenticate, dashboardRoutes);
app.use('/api/reports', authenticate, reportRoutes);
app.use('/api/settings', authenticate, settingsRoutes);

app.post('/api/monitor/run', authenticate, (_req, res) => {
  runAllChecks().catch(err => console.error('Manual run error:', err.message));
  res.json({ success: true, message: 'Monitor run started' });
});

app.use(errorHandler);

async function start() {
  await testConnection();
  await syncDb();
  startCronJob();
  startMonthlyReportJob();
  app.listen(PORT, () => console.log(`🚀 API running on http://localhost:${PORT}`));
}

start();

require('dotenv').config();

// Validate required environment variables before anything else
const REQUIRED_ENV = ['JWT_SECRET', 'DB_HOST', 'DB_USER', 'DB_NAME'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length) {
  console.error(`Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const express = require('express');
const http = require('http');
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
const server = http.createServer(app);
const PORT = process.env.PORT || 4000;

const FRONTEND_ORIGIN = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
app.use(cors({
  origin: FRONTEND_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
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

app.post('/api/monitor/run', authenticate, async (_req, res) => {
  try {
    await runAllChecks();
    res.json({ success: true, message: 'Monitor run completed' });
  } catch (err) {
    console.error('Manual run error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// cPanel cron trigger — secured by CRON_SECRET, no JWT needed
app.post('/api/cron/trigger', async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers['x-cron-secret'] !== secret) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  try {
    await runAllChecks();
    res.json({ success: true, message: 'Cron run completed' });
  } catch (err) {
    console.error('Cron trigger error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.use(errorHandler);

async function start() {
  await testConnection();
  await syncDb();
  startCronJob();
  await startMonthlyReportJob();
  server.listen(PORT, () => console.log(`🚀 API running on http://localhost:${PORT}`));
}

start();

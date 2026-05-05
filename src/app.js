require('dotenv').config();

// ✅ Validate required environment variables
const REQUIRED_ENV = ['JWT_SECRET', 'DB_HOST', 'DB_USER', 'DB_NAME'];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length) {
  console.error(`❌ Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

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
const adminRoutes = require('./routes/admin');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 4000;


// =====================
// ✅ CORS CONFIG (FIXED)
// =====================

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.FRONTEND_URL, // 👈 MUST be set in Render
  'https://www.' + (process.env.FRONTEND_URL || '').replace(/^https?:\/\//, '') // optional www support
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // allow Postman / server-to-server

    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    } else {
      console.log('❌ CORS blocked:', origin);
      return callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));


// =====================
// ✅ MIDDLEWARE
// =====================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


// =====================
// ✅ SERVE FRONTEND (OPTIONAL)
// =====================

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));


// =====================
// ✅ ROUTES
// =====================

// Public
app.use('/api/auth', authRoutes);
app.get('/api/health', (_req, res) => res.json({ success: true, status: 'ok' }));

// Protected
app.use('/api/urls', authenticate, urlRoutes);
app.use('/api/recipients', authenticate, recipientRoutes);
app.use('/api/dashboard', authenticate, dashboardRoutes);
app.use('/api/reports', authenticate, reportRoutes);
app.use('/api/settings', authenticate, settingsRoutes);
app.use('/api/admin/users', authenticate, adminRoutes);


// =====================
// ✅ MANUAL MONITOR TRIGGER
// =====================

app.post('/api/monitor/run', authenticate, async (_req, res) => {
  try {
    await runAllChecks({ force: true });
    res.json({ success: true, message: 'Monitor run completed' });
  } catch (err) {
    console.error('❌ Manual run error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});


// =====================
// ✅ CRON TRIGGER (cPanel)
// =====================

app.post('/api/cron/trigger', async (req, res) => {
  const secret = process.env.CRON_SECRET;

  if (!secret || req.headers['x-cron-secret'] !== secret) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    await runAllChecks();
    res.json({ success: true, message: 'Cron run completed' });
  } catch (err) {
    console.error('❌ Cron trigger error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});


// =====================
// ✅ ERROR HANDLER
// =====================

app.use(errorHandler);


// =====================
// ✅ SPA FALLBACK
// =====================

app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  }
});


// =====================
// ✅ SERVER START
// =====================

async function start() {
  try {
    await testConnection();
    console.log('✅ MySQL connected via Sequelize');

    await syncDb();
    console.log('✅ All tables synced');

    startCronJob();
    await startMonthlyReportJob();

    server.listen(PORT, () => {
      console.log(`🚀 API running on port ${PORT}`);
    });

  } catch (err) {
    console.error('❌ Server start failed:', err);
    process.exit(1);
  }
}

start();

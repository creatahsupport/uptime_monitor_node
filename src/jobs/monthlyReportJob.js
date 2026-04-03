const cron = require('node-cron');
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const { Setting } = require('../models');
const { buildReportData, generatePdf } = require('../services/reportService');
const { sendMonthlyReport } = require('../services/emailService');

let currentMonthlyJob = null;
const DEFAULT_REPORT_DAY    = 1;
const DEFAULT_REPORT_HOUR   = 0;
const DEFAULT_REPORT_MINUTE = 0;

function getPreviousMonthString() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

async function runMonthlyReportProcess() {
  const month = getPreviousMonthString();
  console.log(`[MonthlyReportJob] ── Starting for month: ${month} ──`);

  try {
    const clients = await sequelize.query(
      `SELECT DISTINCT client_email FROM monitored_urls WHERE client_email IS NOT NULL AND client_email != '' AND is_deleted = 0`,
      { type: QueryTypes.SELECT }
    );

    if (!clients || clients.length === 0) {
      console.log(`[MonthlyReportJob] No client emails found. Skipping.`);
      return;
    }

    console.log(`[MonthlyReportJob] Found ${clients.length} client(s).`);

    for (const client of clients) {
      const email = client.client_email;

      const urls = await sequelize.query(
        `SELECT id, name FROM monitored_urls WHERE client_email = :email AND is_deleted = 0`,
        { replacements: { email }, type: QueryTypes.SELECT }
      );

      if (!urls.length) {
        console.log(`[MonthlyReportJob] No URLs for ${email}. Skipping.`);
        continue;
      }

      for (const u of urls) {
        try {
          const reportData = await buildReportData(month, u.id);
          console.log(`[MonthlyReportJob] URL ${u.id} → ${reportData.checks.length} checks found for ${month}`);

          const pdfBuffer = await generatePdf(reportData);
          await sendMonthlyReport({
            clientEmail: email,
            urlName: u.name,
            month,
            pdfBuffer
          });
          console.log(`[MonthlyReportJob] ✅ Report sent for URL ${u.id} to ${email}`);
        } catch (error) {
          console.error(`[MonthlyReportJob] ❌ Error for URL ${u.id}:`, error.message);
        }
      }
    }

    console.log(`[MonthlyReportJob] ── Done ──`);
  } catch (err) {
    console.error('[MonthlyReportJob] Fatal error:', err.message);
  }
}

function scheduleMonthlyJob(day, hour, minute) {
  if (currentMonthlyJob) {
    currentMonthlyJob.stop();
  }
  const cronExpr = `${minute} ${hour} ${day} * *`;
  const tz = process.env.TZ || 'Asia/Kolkata';
  currentMonthlyJob = cron.schedule(cronExpr, () => {
    runMonthlyReportProcess();
  }, { timezone: tz });
  console.log(`⏰ Monthly Report Cron job scheduled: day ${day} at ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')} ${tz} (${cronExpr})`);
}

async function startMonthlyReportJob() {
  let day = DEFAULT_REPORT_DAY, hour = DEFAULT_REPORT_HOUR, minute = DEFAULT_REPORT_MINUTE;
  try {
    const [daySetting] = await Setting.findOrCreate({
      where: { key: 'monthly_report_day' },
      defaults: { value: String(DEFAULT_REPORT_DAY) },
    });
    const [hourSetting] = await Setting.findOrCreate({
      where: { key: 'monthly_report_hour' },
      defaults: { value: String(DEFAULT_REPORT_HOUR) },
    });
    const [minuteSetting] = await Setting.findOrCreate({
      where: { key: 'monthly_report_minute' },
      defaults: { value: String(DEFAULT_REPORT_MINUTE) },
    });
    day    = parseInt(daySetting.value)    || DEFAULT_REPORT_DAY;
    hour   = parseInt(hourSetting.value)   ?? DEFAULT_REPORT_HOUR;
    minute = parseInt(minuteSetting.value) ?? DEFAULT_REPORT_MINUTE;
  } catch (err) {
    console.error('[MonthlyReportJob] Failed to read settings:', err.message);
  }
  scheduleMonthlyJob(day, hour, minute);
}

async function rescheduleMonthlyReportJob(day, hour, minute) {
  await Promise.all([
    Setting.upsert({ key: 'monthly_report_day',    value: String(day) }),
    Setting.upsert({ key: 'monthly_report_hour',   value: String(hour) }),
    Setting.upsert({ key: 'monthly_report_minute', value: String(minute) }),
  ]);
  scheduleMonthlyJob(day, hour, minute);
}

module.exports = { startMonthlyReportJob, runMonthlyReportProcess, rescheduleMonthlyReportJob };

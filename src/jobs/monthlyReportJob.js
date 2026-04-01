const cron = require('node-cron');
const { sequelize } = require('../models');
const { QueryTypes } = require('sequelize');
const { buildReportData, generatePdf } = require('../services/reportService');
const { sendMonthlyReport } = require('../services/emailService');

function getPreviousMonthString() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

async function runMonthlyReportProcess() {
  const month = getPreviousMonthString();
  console.log(`[MonthlyReportJob] Starting report generation for ${month}...`);

  try {
    // Get all unique client emails that have monitored URLs
    const clients = await sequelize.query(
      `SELECT DISTINCT client_email FROM monitored_urls WHERE client_email IS NOT NULL AND client_email != ''`,
      { type: QueryTypes.SELECT }
    );

    if (!clients || clients.length === 0) {
      console.log(`[MonthlyReportJob] No client emails configured. Skipping.`);
      return;
    }

    for (const client of clients) {
      const email = client.client_email;
      
      // Get all URLs belonging to this client to see if they had activity
      const urls = await sequelize.query(
        `SELECT id FROM monitored_urls WHERE client_email = :email`,
        { replacements: { email }, type: QueryTypes.SELECT }
      );

      if (!urls.length) continue;

      // We generate the report by not filtering a specific urlId, but since a client could have multiple URLs, 
      // the `buildReportData` function currently generates it for almost everything if urlId is omitted.
      // Wait, if we want to send the client ONLY their URLs, we'd need to modify `buildReportData` to accept a clientEmail, 
      // or we just call buildReportData for each url and merge them. But `buildReportData` already supports an array or we can just fetch all data and generate.
      // Let's modify `buildReportData` later or we can call it for the specific URL.
      // Wait, the prompt says "start the month report sent to corresponding url owner every month 1 date full month report"
      
      for (const u of urls) {
        try {
          const reportData = await buildReportData(month, u.id);
          if (reportData.checks && reportData.checks.length > 0) {
            const pdfBuffer = await generatePdf(reportData);
            await sendMonthlyReport({
              clientEmail: email,
              urlName: reportData.summary[0]?.name || 'Your Website',
              month,
              pdfBuffer
            });
            console.log(`[MonthlyReportJob] Sent report for URL ${u.id} to ${email}`);
          }
        } catch (error) {
          console.error(`[MonthlyReportJob] Error generating report for URL ${u.id}:`, error);
        }
      }
    }
  } catch (err) {
    console.error('[MonthlyReportJob] Fatal error:', err.message);
  }
}

function startMonthlyReportJob() {
  // Run on the 1st of every month at 00:00 (midnight)
  cron.schedule('0 0 1 * *', () => {
    runMonthlyReportProcess();
  });
  console.log(`⏰ Monthly Report Cron job scheduled for the 1st of every month at 00:00.`);
}

module.exports = { startMonthlyReportJob, runMonthlyReportProcess };

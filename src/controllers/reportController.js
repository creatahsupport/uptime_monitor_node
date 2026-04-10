const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');
const reportService = require('../services/reportService');

// GET /api/reports/months
async function getAvailableMonths(_req, res) {
  try {
    const rows = await sequelize.query(
      `SELECT DISTINCT
         DATE_FORMAT(checked_at, '%Y-%m') AS month_key,
         DATE_FORMAT(checked_at, '%M %Y') AS month_label
       FROM monitor_checks
       ORDER BY month_key DESC`,
      { type: QueryTypes.SELECT }
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

function validateMonth(month, res) {
  if (!month) {
    res.status(400).json({ success: false, message: 'month is required (YYYY-MM)' });
    return false;
  }
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ success: false, message: 'month must be in YYYY-MM format' });
    return false;
  }
  const mon = parseInt(month.split('-')[1]);
  if (mon < 1 || mon > 12) {
    res.status(400).json({ success: false, message: 'month value must be between 01 and 12' });
    return false;
  }
  return true;
}

// GET /api/reports/preview?month=2026-03&url_id=1
async function previewReport(req, res) {
  const { month, url_id } = req.query;
  if (!validateMonth(month, res)) return;
  try {
    const data = await reportService.buildReportData(month, url_id || null);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/reports/download?month=2026-03&url_id=1&format=pdf|csv
async function downloadReport(req, res) {
  const { month, url_id, format = 'csv' } = req.query;
  if (!validateMonth(month, res)) return;
  try {
    const data = await reportService.buildReportData(month, url_id || null);
    if (format === 'pdf') {
      const buf = await reportService.generatePdf(data);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="uptime-report-${month}.pdf"`);
      return res.send(buf);
    }
    const csv = await reportService.generateCsv(data);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="uptime-report-${month}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getAvailableMonths, previewReport, downloadReport };

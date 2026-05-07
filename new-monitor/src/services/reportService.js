const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');
const PDFDocument = require('pdfkit');
const { Parser } = require('json2csv');

async function buildReportData(month, urlId) {
  const [year, mon] = month.split('-');
  const startDate   = `${year}-${mon}-01`;
  const endDate     = `${year}-${mon}-31`;

  const urlFilter      = urlId ? 'AND mc.url_id = :urlId' : '';
  const replacements   = { startDate, endDate, ...(urlId ? { urlId: parseInt(urlId) } : {}) };

  const summary = await sequelize.query(
    `SELECT
       u.id,
       u.name,
       u.url,
       COUNT(mc.id)                                                AS total_checks,
       SUM(CASE WHEN mc.status = 'up'   THEN 1 ELSE 0 END)       AS up_count,
       SUM(CASE WHEN mc.status = 'down' THEN 1 ELSE 0 END)       AS down_count,
       ROUND(
         SUM(CASE WHEN mc.status = 'up' THEN 1 ELSE 0 END) * 100.0 /
         NULLIF(COUNT(mc.id), 0), 2
       )                                                           AS uptime_pct,
       ROUND(AVG(mc.load_time_ms), 0)                             AS avg_load_ms,
       (SELECT COUNT(*) FROM incidents i
        WHERE i.url_id = u.id
          AND i.started_at BETWEEN :startDate AND :endDate
       )                                                           AS incident_count
     FROM monitored_urls u
     JOIN monitor_checks mc ON mc.url_id = u.id
     WHERE mc.checked_at BETWEEN :startDate AND :endDate
       ${urlFilter}
     GROUP BY u.id, u.name, u.url
     ORDER BY u.name`,
    { replacements, type: QueryTypes.SELECT }
  );

  const checks = await sequelize.query(
    `SELECT
       u.name  AS url_name,
       u.url,
       mc.checked_at,
       mc.status,
       mc.load_time_ms,
       mc.html_load_ms,
       mc.css_load_ms,
       mc.js_load_ms,
       mc.image_load_ms,
       mc.full_load_ms,
       mc.lcp_ms,
       mc.performance_label,
       mc.http_status_code,
       mc.error_message
     FROM monitor_checks mc
     JOIN monitored_urls u ON u.id = mc.url_id
     WHERE mc.checked_at BETWEEN :startDate AND :endDate
       ${urlFilter}
     ORDER BY mc.checked_at DESC`,
    { replacements, type: QueryTypes.SELECT }
  );

  return {
    period: { month, year: parseInt(year), mon: parseInt(mon) },
    summary,
    checks,
  };
}

function formatCsvDate(dateStr) {
  if (!dateStr) return '';
  const TZ = process.env.TZ || 'Asia/Kolkata';
  const d = new Date(dateStr);
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: TZ }).toLowerCase();
  // Include a comma so json2csv wraps the value in quotes — prevents Excel from auto-converting to a date
  return `${date}, ${time}`;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

async function generateCsv({ checks }) {
  const fields = [
    { label: 'URL Name',        value: 'url_name' },
    { label: 'URL',             value: 'url' },
    { label: 'Checked At',      value: 'checked_at' },
    { label: 'Status',          value: 'status' },
    { label: 'HTML Load (ms)',  value: 'html_load_ms' },
    { label: 'CSS Load (ms)',   value: 'css_load_ms' },
    { label: 'JS Load (ms)',    value: 'js_load_ms' },
    { label: 'Image Load (ms)', value: 'image_load_ms' },
    { label: 'Full Load (ms)',  value: 'full_load_ms' },
    { label: 'Performance',     value: 'performance_label' },
    { label: 'HTTP Status',     value: 'http_status_code' },
    { label: 'Error',           value: 'error_message' },
  ];

  const rows = checks.map(c => ({
    ...c,
    checked_at:        formatCsvDate(c.checked_at),
    status:            capitalize(c.status),
    performance_label: capitalize(c.performance_label),
    html_load_ms:      c.html_load_ms ?? '-',
    css_load_ms:       c.css_load_ms  ?? '-',
    js_load_ms:        c.js_load_ms   ?? '-',
    image_load_ms:     c.image_load_ms ?? '-',
    full_load_ms:      c.full_load_ms ?? '-',
    error_message:     c.error_message || '-',
  }));

  return new Parser({ fields }).parse(rows);
}

async function generatePdf({ period, summary, checks }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', c => buffers.push(c));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // Helpers — all use configured timezone (TZ env var), never raw UTC
    const TZ = process.env.TZ || 'Asia/Kolkata';
    const formatDateTime = (dateStr) => {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ }) + ' ' +
             d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ }).toLowerCase();
    };
    const formatDate = (dateStr) => new Date(dateStr).toLocaleDateString('en-CA', { timeZone: TZ }); // en-CA → YYYY-MM-DD
    const formatTime = (dateStr) => new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ });

    const blueTheme = '#1E65B5';

    // 1. PAGE HEADER (Blue block)
    doc.rect(40, 40, 762, 70).fill(blueTheme);
    doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold')
       .text(`Website Availability Report — ${period.month}`, 40, 55, { align: 'center', width: 762 });
    doc.fontSize(10).font('Helvetica')
       .text(`Generated: ${formatDateTime(new Date())}   |   Creatah Software Technologies`, 40, 80, { align: 'center', width: 762 });

    // 2. STATS ROW (4 boxes)
    // We aggregate all summary data for these specific top-level stats
    const totalChecks = summary.reduce((acc, row) => acc + parseInt(row.total_checks || 0), 0);
    const totalDown   = summary.reduce((acc, row) => acc + parseInt(row.down_count || 0), 0);
    const uptimePct   = totalChecks ? ((totalChecks - totalDown) / totalChecks * 100).toFixed(2) : 0;
    const avgResponse = summary.length ? Math.round(summary.reduce((acc, row) => acc + parseInt(row.avg_load_ms || 0), 0) / summary.length) : 0;

    const boxWidth = 190.5; // 762 / 4
    const boxY = 110;
    
    // Draw box outlines
    doc.lineWidth(1).strokeColor('#EAF0FB');
    for (let i = 0; i < 4; i++) {
      doc.rect(40 + Math.floor(i * boxWidth), boxY, Math.ceil(boxWidth), 55).stroke();
    }

    const drawStat = (index, label, value, valueColor) => {
      const centerX = 40 + (index * boxWidth);
      doc.fillColor('#6B7280').fontSize(10).font('Helvetica').text(label, centerX, boxY + 12, { width: boxWidth, align: 'center' });
      doc.fillColor(valueColor).fontSize(14).font('Helvetica-Bold').text(value, centerX, boxY + 30, { width: boxWidth, align: 'center' });
    };

    drawStat(0, 'Total Checks',   totalChecks.toString(), '#374151');
    drawStat(1, 'Total Failures', totalDown.toString(),   '#DC2626');
    drawStat(2, 'Uptime %',       `${uptimePct}%`,        '#16A34A');
    drawStat(3, 'Avg Response',   `${avgResponse}ms`,     '#374151');

    doc.moveDown(3);

    // 3. DETAILED REPORT TABLE
    doc.fillColor('#1E3A5F').fontSize(12).font('Helvetica-Bold').text('Detailed Report', 40, 185);

    const dColW  = [50, 35, 120, 45, 45, 45, 45, 50, 45, 45, 100];
    const dHdrs  = ['Date', 'Time', 'URL', 'HTML', 'CSS', 'JS', 'Img', 'Full', 'Rating', 'OK?', 'Error'];
    let y = 205;

    // Header Row
    doc.rect(40, y, 762, 18).fill(blueTheme);
    doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
    let x = 40;
    dHdrs.forEach((h, i) => { doc.text(h, x + 4, y + 4, { width: dColW[i] - 4, lineBreak: false }); x += dColW[i]; });
    
    // Header borders
    doc.lineWidth(0.5).strokeColor('#ffffff');
    x = 40;
    dHdrs.forEach((_h, i) => { x += dColW[i]; doc.moveTo(x, y).lineTo(x, y + 18).stroke(); });
    y += 18;

    // Table Rows
    doc.font('Helvetica');
    checks.forEach((row, idx) => {
      if (y > 540) { doc.addPage(); y = 40; } // New page logic
      
      const isAlt = idx % 2 === 1;
      doc.rect(40, y, 762, 18).fill(isAlt ? '#F9FAFB' : '#FFFFFF');

      // Borders
      doc.lineWidth(0.5).strokeColor('#EAF0FB');
      doc.moveTo(40, y).lineTo(802, y).stroke();
      doc.moveTo(40, y+18).lineTo(802, y+18).stroke();
      
      let curX = 40;
      const t = (text, i, color = '#374151', align = 'left') => {
        doc.fillColor(color).text(String(text || '-'), curX + 4, y + 5, { width: dColW[i] - 4, lineBreak: false, align });
        doc.moveTo(curX + dColW[i], y).lineTo(curX + dColW[i], y + 18).stroke(); // vertical borders
        curX += dColW[i];
      };

      // Draw vertical line for the very first column
      doc.moveTo(40, y).lineTo(40, y + 18).stroke();

      const ratingColor = row.performance_label === 'good' ? '#16A34A' : row.performance_label === 'poor' ? '#DC2626' : '#6B7280';
      const successColor = row.status === 'up' ? '#16A34A' : '#DC2626';

      curX = 40;
      t(formatDate(row.checked_at),                       0);
      t(formatTime(row.checked_at),                       1);
      t(row.url,                                          2);
      t(row.html_load_ms  ? `${row.html_load_ms}`  : '-', 3);
      t(row.css_load_ms   ? `${row.css_load_ms}`   : '-', 4);
      t(row.js_load_ms    ? `${row.js_load_ms}`    : '-', 5);
      t(row.image_load_ms ? `${row.image_load_ms}` : '-', 6);
      t(row.full_load_ms  ? `${row.full_load_ms}`  : '-', 7);
      t((row.performance_label || '-').toUpperCase(),     8, ratingColor);
      t(row.status === 'up' ? 'YES' : 'NO',              9, successColor);
      t(row.error_message || '-',                        10);

      y += 18;
    });

    doc.end();
  });
}

module.exports = { buildReportData, generateCsv, generatePdf };

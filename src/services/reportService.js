const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models');
const PDFDocument = require('pdfkit');
const { Parser } = require('json2csv');

async function buildReportData(month, urlId) {
  const [year, mon] = month.split('-');
  const startDate   = `${year}-${mon}-01`;
  // Last day of the actual month — avoids invalid dates like April-31
  const lastDay     = new Date(parseInt(year), parseInt(mon), 0).getDate();
  const endDate     = `${year}-${mon}-${String(lastDay).padStart(2, '0')} 23:59:59`;

  const urlFilter    = urlId ? 'AND mc.url_id = :urlId' : '';
  const replacements = { startDate, endDate, ...(urlId ? { urlId: parseInt(urlId) } : {}) };

  // ── Summary (uptime checks only) ──────────────────────────────────────────
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
     WHERE mc.check_type = 'uptime'
       AND mc.checked_at BETWEEN :startDate AND :endDate
       ${urlFilter}
     GROUP BY u.id, u.name, u.url
     ORDER BY u.name`,
    { replacements, type: QueryTypes.SELECT }
  );

  // ── Uptime checks (every N minutes, response time + status) ───────────────
  const checks = await sequelize.query(
    `SELECT
       u.name  AS url_name,
       u.url,
       mc.checked_at,
       mc.status,
       mc.load_time_ms,
       mc.performance_label,
       mc.http_status_code,
       mc.error_message
     FROM monitor_checks mc
     JOIN monitored_urls u ON u.id = mc.url_id
     WHERE mc.check_type = 'uptime'
       AND mc.checked_at BETWEEN :startDate AND :endDate
       ${urlFilter}
     ORDER BY mc.checked_at DESC`,
    { replacements, type: QueryTypes.SELECT }
  );

  // ── Daily load time checks (PageSpeed, once per day) ──────────────────────
  const loadChecks = await sequelize.query(
    `SELECT
       u.name  AS url_name,
       u.url,
       mc.checked_at,
       mc.full_load_ms,
       mc.performance_label,
       mc.http_status_code,
       mc.status,
       mc.error_message
     FROM monitor_checks mc
     JOIN monitored_urls u ON u.id = mc.url_id
     WHERE mc.check_type = 'load_time'
       AND mc.checked_at BETWEEN :startDate AND :endDate
       ${urlFilter}
     ORDER BY mc.checked_at DESC`,
    { replacements, type: QueryTypes.SELECT }
  );

  return {
    period: { month, year: parseInt(year), mon: parseInt(mon) },
    summary,
    checks,
    loadChecks,
  };
}

function formatCsvDate(dateStr) {
  if (!dateStr) return '';
  const TZ = process.env.TZ || 'Asia/Kolkata';
  const d = new Date(dateStr);
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true, timeZone: TZ }).toLowerCase();
  return `${date}, ${time}`;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

async function generateCsv({ checks, loadChecks }) {
  const fields = [
    { label: 'Date & Time',    value: 'checked_at' },
    { label: 'Type',           value: 'type' },
    { label: 'URL Name',       value: 'url_name' },
    { label: 'URL',            value: 'url' },
    { label: 'Load Time (ms)', value: 'load_time' },
    { label: 'Rating',         value: 'performance_label' },
    { label: 'HTTP Status',    value: 'http_status_code' },
    { label: 'Error',          value: 'error_message' },
  ];

  const merged = [
    ...loadChecks.map(c => ({
      checked_at:        formatCsvDate(c.checked_at),
      type:              'Load Time',
      url_name:          c.url_name,
      url:               c.url,
      load_time:         c.full_load_ms ?? '-',
      performance_label: capitalize(c.performance_label),
      http_status_code:  c.http_status_code || '-',
      error_message:     (c.error_message || '-').replace(/^PageSpeed API:\s*/i, ''),
      _sort:             new Date(c.checked_at),
    })),
    ...checks.map(c => ({
      checked_at:        formatCsvDate(c.checked_at),
      type:              c.status === 'up' ? 'Up Time' : 'Down Time',
      url_name:          c.url_name,
      url:               c.url,
      load_time:         '-',
      performance_label: c.status === 'up' ? capitalize(c.performance_label) : '-',
      http_status_code:  c.http_status_code || '-',
      error_message:     c.error_message || '-',
      _sort:             new Date(c.checked_at),
    })),
  ].sort((a, b) => b._sort - a._sort);

  return new Parser({ fields }).parse(merged);
}

async function generatePdf({ period, summary, checks, loadChecks }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const buffers = [];
    doc.on('data', c => buffers.push(c));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const TZ = process.env.TZ || 'Asia/Kolkata';
    const formatDateTime = (dateStr) => {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: TZ }) + ' ' +
             d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ }).toLowerCase();
    };
    const formatDate = (dateStr) => new Date(dateStr).toLocaleDateString('en-CA', { timeZone: TZ });
    const formatTime = (dateStr) => new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ });

    const blueTheme = '#1E65B5';

    // ── PAGE HEADER ──────────────────────────────────────────────────────────
    doc.rect(40, 40, 762, 70).fill(blueTheme);
    doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold')
       .text(`Website Availability Report — ${period.month}`, 40, 55, { align: 'center', width: 762 });
    doc.fontSize(10).font('Helvetica')
       .text(`Generated: ${formatDateTime(new Date())}   |   Creatah Software Technologies`, 40, 80, { align: 'center', width: 762 });

    // ── SUMMARY STATS ────────────────────────────────────────────────────────
    const totalChecks = summary.reduce((acc, row) => acc + parseInt(row.total_checks || 0), 0);
    const totalDown   = summary.reduce((acc, row) => acc + parseInt(row.down_count || 0), 0);
    const uptimePct   = totalChecks ? ((totalChecks - totalDown) / totalChecks * 100).toFixed(2) : 0;
    const avgResponse = summary.length ? Math.round(summary.reduce((acc, row) => acc + parseInt(row.avg_load_ms || 0), 0) / summary.length) : 0;

    const boxWidth = 190.5;
    const boxY = 110;
    doc.lineWidth(1).strokeColor('#EAF0FB');
    for (let i = 0; i < 4; i++) {
      doc.rect(40 + Math.floor(i * boxWidth), boxY, Math.ceil(boxWidth), 55).stroke();
    }
    const drawStat = (index, label, value, valueColor) => {
      const cx = 40 + (index * boxWidth);
      doc.fillColor('#6B7280').fontSize(10).font('Helvetica').text(label, cx, boxY + 12, { width: boxWidth, align: 'center' });
      doc.fillColor(valueColor).fontSize(14).font('Helvetica-Bold').text(value, cx, boxY + 30, { width: boxWidth, align: 'center' });
    };
    drawStat(0, 'Total Checks',   totalChecks.toString(), '#374151');
    drawStat(1, 'Total Failures', totalDown.toString(),   '#DC2626');
    drawStat(2, 'Uptime %',       `${uptimePct}%`,        '#16A34A');
    drawStat(3, 'Avg Response',   `${avgResponse}ms`,     '#374151');

    // ── MERGE & SORT all records ──────────────────────────────────────────────
    const merged = [
      ...loadChecks.map(c => ({
        _sort:       new Date(c.checked_at),
        dateTime:    `${formatDate(c.checked_at)} ${formatTime(c.checked_at)}`,
        type:        'Load Time',
        url_name:    c.url_name,
        url:         c.url,
        load_time:   c.full_load_ms ? `${c.full_load_ms}ms` : '-',
        rating:      (c.performance_label || '-').toUpperCase(),
        ratingColor: c.performance_label === 'good' ? '#16A34A' : c.performance_label === 'bad' ? '#DC2626' : '#6B7280',
        typeColor:   '#166534',
        http:        c.http_status_code ? String(c.http_status_code) : '-',
        error:       (c.error_message || '-').replace(/^PageSpeed API:\s*/i, ''),
      })),
      ...checks.map(c => ({
        _sort:       new Date(c.checked_at),
        dateTime:    `${formatDate(c.checked_at)} ${formatTime(c.checked_at)}`,
        type:        c.status === 'up' ? 'Up Time' : 'Down Time',
        url_name:    c.url_name,
        url:         c.url,
        load_time:   '-',
        rating:      c.status === 'up' ? (c.performance_label || '-').toUpperCase() : '-',
        ratingColor: c.status === 'up'
          ? (c.performance_label === 'good' ? '#16A34A' : c.performance_label === 'bad' ? '#DC2626' : '#6B7280')
          : '#6B7280',
        typeColor:   c.status === 'up' ? '#16A34A' : '#DC2626',
        http:        c.http_status_code ? String(c.http_status_code) : '-',
        error:       c.error_message || '-',
      })),
    ].sort((a, b) => b._sort - a._sort);

    // ── TABLE ─────────────────────────────────────────────────────────────────
    // Columns: Date & Time | Type | URL Name | URL | Load Time | Rating | HTTP | Error
    // Total width = 762
    const colW = [120, 58, 100, 150, 68, 52, 50, 164];
    const hdrs = ['Date & Time', 'Type', 'URL Name', 'URL', 'Load Time', 'Rating', 'HTTP', 'Error'];

    let y = 185;
    doc.fillColor('#1E3A5F').fontSize(12).font('Helvetica-Bold').text('Monitoring Report', 40, y);
    y += 20;

    const drawTableHeader = () => {
      doc.rect(40, y, 762, 18).fill(blueTheme);
      doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
      let x = 40;
      hdrs.forEach((h, i) => { doc.text(h, x + 4, y + 4, { width: colW[i] - 4, lineBreak: false }); x += colW[i]; });
      doc.lineWidth(0.5).strokeColor('#ffffff');
      x = 40;
      hdrs.forEach((_h, i) => { x += colW[i]; doc.moveTo(x, y).lineTo(x, y + 18).stroke(); });
      y += 18;
    };

    drawTableHeader();

    doc.font('Helvetica');
    merged.forEach((row, idx) => {
      if (y > 540) { doc.addPage(); y = 40; drawTableHeader(); }
      const isAlt = idx % 2 === 1;
      doc.rect(40, y, 762, 18).fill(isAlt ? '#F9FAFB' : '#FFFFFF');
      doc.lineWidth(0.5).strokeColor('#EAF0FB');
      doc.moveTo(40, y).lineTo(802, y).stroke();
      doc.moveTo(40, y + 18).lineTo(802, y + 18).stroke();
      doc.moveTo(40, y).lineTo(40, y + 18).stroke();

      // Dynamic row height based on error text length
      const errorText   = String(row.error || '-');
      const charsPerLine = Math.floor((colW[7] - 8) / 4.3);
      const numLines    = Math.ceil(errorText.length / charsPerLine);
      const rowH        = Math.max(18, numLines * 11 + 6);

      doc.rect(40, y, 762, rowH).fill(isAlt ? '#F9FAFB' : '#FFFFFF');
      doc.lineWidth(0.5).strokeColor('#EAF0FB');
      doc.moveTo(40, y).lineTo(802, y).stroke();
      doc.moveTo(40, y + rowH).lineTo(802, y + rowH).stroke();
      doc.moveTo(40, y).lineTo(40, y + rowH).stroke();

      let curX = 40;
      const t = (text, i, color = '#374151', wrap = false) => {
        doc.fillColor(color).text(String(text || '-'), curX + 4, y + 5, {
          width: colW[i] - 8,
          lineBreak: wrap,
          height: rowH - 6,
        });
        doc.moveTo(curX + colW[i], y).lineTo(curX + colW[i], y + rowH).stroke();
        curX += colW[i];
      };

      t(row.dateTime,    0);
      t(row.type,        1, row.typeColor);
      t(row.url_name,    2);
      t(row.url,         3);
      t(row.load_time,   4);
      t(row.rating,      5, row.ratingColor);
      t(row.http,        6);
      t(row.error,       7, '#374151', true);
      y += rowH;
    });

    doc.end();
  });
}

module.exports = { buildReportData, generateCsv, generatePdf };

const { Op, fn, col, literal, QueryTypes } = require('sequelize');
const { sequelize, MonitoredUrl, MonitorCheck, Incident } = require('../models');
const PDFDocument = require('pdfkit');

// GET /api/dashboard/monthly-stats?month=2026-03&url_id=1
async function getMonthlyStats(req, res) {
  const { month, url_id } = req.query;

  const urlFilter      = url_id ? 'AND mc.url_id = :urlId' : '';
  const replacements   = { ...(month ? { month } : {}), ...(url_id ? { urlId: parseInt(url_id) } : {}) };

  // When a specific URL is selected, show 1; otherwise count all active non-deleted URLs
  const total_urls = url_id
    ? await MonitoredUrl.count({ where: { id: parseInt(url_id), is_active: true, is_deleted: false } })
    : await MonitoredUrl.count({ where: { is_active: true, is_deleted: false } });

  try {
    const monthFilter = month ? "AND DATE_FORMAT(mc.checked_at, '%Y-%m') = :month" : '';

    const [stats] = await sequelize.query(
      `SELECT
         COUNT(*)                                                     AS total_checks,
         SUM(CASE WHEN mc.status = 'down' THEN 1 ELSE 0 END)        AS failures,
         ROUND(
           SUM(CASE WHEN mc.status = 'up' THEN 1 ELSE 0 END) * 100.0 /
           NULLIF(COUNT(*), 0), 1
         )                                                            AS uptime_pct,
         ROUND(AVG(mc.load_time_ms), 0)                              AS avg_response_ms,
         ROUND(AVG(mc.html_load_ms), 0)                              AS avg_html_ms,
         ROUND(AVG(mc.css_load_ms), 0)                               AS avg_css_ms,
         ROUND(AVG(mc.js_load_ms), 0)                                AS avg_js_ms,
         ROUND(AVG(mc.image_load_ms), 0)                             AS avg_image_ms,
         ROUND(AVG(mc.full_load_ms), 0)                              AS avg_full_load_ms,
         ROUND(AVG(mc.lcp_ms), 0)                                    AS avg_lcp_ms
       FROM monitor_checks mc
       JOIN monitored_urls u ON u.id = mc.url_id AND u.is_deleted = 0
       WHERE mc.check_type = 'uptime' ${monthFilter} ${urlFilter}`,
      { replacements, type: QueryTypes.SELECT }
    );

    // Daily trend data for chart (uptime checks only)
    const dailyTrend = await sequelize.query(
      `SELECT
         DATE(mc.checked_at)                                          AS check_date,
         ROUND(
           SUM(CASE WHEN mc.status = 'up' THEN 1 ELSE 0 END) * 100.0 /
           NULLIF(COUNT(*), 0), 1
         )                                                            AS uptime_pct,
         ROUND(AVG(mc.load_time_ms), 0)                              AS avg_load_ms
       FROM monitor_checks mc
       JOIN monitored_urls u ON u.id = mc.url_id AND u.is_deleted = 0
       WHERE mc.check_type = 'uptime' ${monthFilter} ${urlFilter}
       GROUP BY DATE(mc.checked_at)
       ORDER BY check_date ASC`,
      { replacements, type: QueryTypes.SELECT }
    );

    res.json({
      success: true,
      data: {
        total_urls,
        failures:        parseInt(stats?.failures)     || 0,
        uptime_pct:      parseFloat(stats?.uptime_pct) || 0,
        avg_response_ms: parseInt(stats?.avg_response_ms) || 0,
        avg_html_ms:      parseInt(stats?.avg_html_ms)      || null,
        avg_css_ms:       parseInt(stats?.avg_css_ms)       || null,
        avg_js_ms:        parseInt(stats?.avg_js_ms)        || null,
        avg_image_ms:     parseInt(stats?.avg_image_ms)     || null,
        avg_full_load_ms: parseInt(stats?.avg_full_load_ms) || null,
        avg_lcp_ms:       parseInt(stats?.avg_lcp_ms)       || null,
        daily_trend:     dailyTrend,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/dashboard/recent-failures?month=2026-03&url_id=1&limit=50
async function getRecentFailures(req, res) {
  const { month, url_id } = req.query;
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);

  const monthFilter = month ? "AND DATE_FORMAT(mc.checked_at, '%Y-%m') = :month" : '';
  const urlFilter   = url_id ? 'AND mc.url_id = :urlId' : '';
  const replacements = {
    ...(month  ? { month }              : {}),
    ...(url_id ? { urlId: parseInt(url_id) } : {}),
    limit,
  };

  try {
    const rows = await sequelize.query(
      `SELECT
         mc.id,
         mc.check_type,
         DATE(mc.checked_at)           AS date,
         TIME(mc.checked_at)           AS time,
         u.url,
         u.name                        AS url_name,
         mc.http_status_code,
         mc.load_time_ms,
         mc.full_load_ms,
         mc.performance_label,
         mc.error_message,
         mc.checked_at
       FROM monitor_checks mc
       JOIN monitored_urls u ON u.id = mc.url_id AND u.is_deleted = 0
       WHERE mc.status = 'down'
         AND mc.check_type IN ('uptime', 'load_time')
         ${monthFilter} ${urlFilter}
       ORDER BY mc.checked_at DESC
       LIMIT :limit`,
      { replacements, type: QueryTypes.SELECT }
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/dashboard/stats  (kept for backward compat)
async function getStats(_req, res) {
  try {
    const total_urls    = await MonitoredUrl.count({ where: { is_active: true, is_deleted: false } });
    const urls_up       = await MonitoredUrl.count({ where: { is_active: true, is_deleted: false, current_status: 'up' } });
    const urls_down     = await MonitoredUrl.count({ where: { is_active: true, is_deleted: false, current_status: 'down' } });
    const open_incidents = await Incident.count({ where: { resolved_at: null } });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const url_stats = await MonitoredUrl.findAll({
      where: { is_active: true, is_deleted: false },
      attributes: [
        'id', 'name', 'url', 'current_status', 'last_checked_at',
        [fn('COUNT', col('checks.id')), 'total_checks'],
        [literal("ROUND(SUM(CASE WHEN `checks`.`status` = 'up' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(`checks`.`id`), 0), 2)"), 'uptime_pct'],
        [fn('AVG', col('checks.load_time_ms')), 'avg_load_ms'],
      ],
      include: [{
        model: MonitorCheck, as: 'checks', attributes: [],
        where: { checked_at: { [Op.gte]: thirtyDaysAgo } },
        required: false,
      }],
      group: ['MonitoredUrl.id'],
      subQuery: false,
    });

    res.json({ success: true, data: { total_urls, urls_up, urls_down, open_incidents, url_stats } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/dashboard/recent-checks
async function getRecentChecks(_req, res) {
  try {
    const checks = await MonitorCheck.findAll({
      include: [{ model: MonitoredUrl, as: 'monitoredUrl', attributes: ['name', 'url'] }],
      order: [['checked_at', 'DESC']],
      limit: 20,
    });
    const data = checks.map(c => ({ ...c.toJSON(), url_name: c.monitoredUrl?.name, url: c.monitoredUrl?.url }));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/dashboard/incidents?status=open|resolved&url_id=1&days=30&limit=100
async function getIncidents(req, res) {
  const limit  = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = parseInt(req.query.offset) || 0;
  const { status, url_id, days } = req.query;

  const where = {};
  if (status === 'open')     where.resolved_at = null;
  if (status === 'resolved') where.resolved_at = { [Op.ne]: null };
  if (url_id)                where.url_id = parseInt(url_id);
  if (days)                  where.started_at = { [Op.gte]: new Date(Date.now() - parseInt(days) * 86400000) };

  try {
    const [incidents, total] = await Promise.all([
      Incident.findAll({
        where,
        include: [{ model: MonitoredUrl, as: 'monitoredUrl', attributes: ['name', 'url', 'client_email'] }],
        order: [['started_at', 'DESC']],
        limit,
        offset,
      }),
      Incident.count({ where }),
    ]);

    const data = incidents.map(i => ({
      ...i.toJSON(),
      url_name:     i.monitoredUrl?.name,
      url:          i.monitoredUrl?.url,
      client_email: i.monitoredUrl?.client_email,
    }));
    res.json({ success: true, data, total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/dashboard/uptime-chart/:urlId
async function getUptimeChart(req, res) {
  const days  = Math.min(parseInt(req.query.days) || 7, 90);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  try {
    const rows = await sequelize.query(
      `SELECT DATE(checked_at) AS check_date,
         COUNT(*) AS total,
         SUM(CASE WHEN status='up' THEN 1 ELSE 0 END) AS up_count,
         ROUND(AVG(load_time_ms),0) AS avg_load_ms
       FROM monitor_checks
       WHERE url_id=:urlId AND checked_at>=:since
       GROUP BY DATE(checked_at) ORDER BY check_date ASC`,
      { replacements: { urlId: req.params.urlId, since }, type: QueryTypes.SELECT }
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// GET /api/dashboard/incidents/download?status=open|resolved&days=30
async function downloadIncidentsPdf(req, res) {
  const { status, url_id, days } = req.query;
  const TZ = process.env.TZ || 'Asia/Kolkata';

  const where = {};
  if (status === 'open')     where.resolved_at = null;
  if (status === 'resolved') where.resolved_at = { [Op.ne]: null };
  if (url_id)                where.url_id = parseInt(url_id);
  if (days)                  where.started_at = { [Op.gte]: new Date(Date.now() - parseInt(days) * 86400000) };

  try {
    const incidents = await Incident.findAll({
      where,
      include: [{ model: MonitoredUrl, as: 'monitoredUrl', attributes: ['name', 'url', 'client_email'] }],
      order: [['started_at', 'DESC']],
      limit: 500,
    });

    const data = incidents.map(i => ({
      ...i.toJSON(),
      url_name:     i.monitoredUrl?.name,
      url:          i.monitoredUrl?.url,
      client_email: i.monitoredUrl?.client_email,
    }));

    const fmtDT = (d) => {
      if (!d) return '—';
      return new Date(d).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: TZ,
      });
    };
    const fmtDur = (mins) => {
      if (mins == null) return '—';
      if (mins < 1)   return '< 1 min';
      if (mins < 60)  return `${mins} min${mins !== 1 ? 's' : ''}`;
      const h = Math.floor(mins / 60), m = mins % 60;
      if (h < 24) return m > 0 ? `${h}h ${m}m` : `${h}h`;
      return `${Math.floor(h / 24)}d ${h % 24}h`;
    };

    const openCount     = data.filter(i => !i.resolved_at).length;
    const resolvedCount = data.filter(i =>  i.resolved_at).length;
    const resolved      = data.filter(i => i.duration_minutes != null);
    const avgDur        = resolved.length
      ? Math.round(resolved.reduce((s, i) => s + i.duration_minutes, 0) / resolved.length)
      : null;

    const blue  = '#1E65B5';
    const doc   = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });
    const bufs  = [];
    doc.on('data', c => bufs.push(c));

    await new Promise((resolve, reject) => {
      doc.on('end', resolve);
      doc.on('error', reject);

      // ── Header ──────────────────────────────────────────────────────────────
      const pageW = 762;
      doc.rect(40, 40, pageW, 65).fill(blue);
      doc.fillColor('#ffffff').fontSize(16).font('Helvetica-Bold')
         .text('Incident Report', 40, 52, { align: 'center', width: pageW });
      const filterLabel = days ? `Last ${days} day${days > 1 ? 's' : ''}` : 'All Time';
      const statusLabel = status === 'open' ? 'Open' : status === 'resolved' ? 'Resolved' : 'All';
      doc.fontSize(9).font('Helvetica')
         .text(`Generated: ${fmtDT(new Date())}   |   Filter: ${statusLabel} · ${filterLabel}`, 40, 76, { align: 'center', width: pageW });

      // ── Summary boxes ────────────────────────────────────────────────────────
      const boxW = pageW / 4;
      const summaryY = 115;
      [
        { label: 'Total Incidents', value: String(data.length), color: '#1E65B5' },
        { label: 'Open',            value: String(openCount),     color: '#DC2626' },
        { label: 'Resolved',        value: String(resolvedCount), color: '#16A34A' },
        { label: 'Avg Duration',    value: fmtDur(avgDur),        color: '#D97706' },
      ].forEach((box, i) => {
        const x = 40 + i * boxW;
        doc.rect(x, summaryY, boxW - 6, 44).fill('#F3F6FB');
        doc.fillColor(box.color).fontSize(18).font('Helvetica-Bold')
           .text(box.value, x + 8, summaryY + 6, { width: boxW - 20 });
        doc.fillColor('#6B7280').fontSize(8).font('Helvetica')
           .text(box.label, x + 8, summaryY + 28, { width: boxW - 20 });
      });

      // ── Table ────────────────────────────────────────────────────────────────
      const tableY    = summaryY + 60;
      const cols = [
        { label: '#',          width: 28 },
        { label: 'Domain',     width: 160 },
        { label: 'Status',     width: 60 },
        { label: 'Started At', width: 130 },
        { label: 'Resolved At',width: 130 },
        { label: 'Duration',   width: 80 },
        { label: 'Notified',   width: 60 },
        { label: 'Client Email',width: 160 },
      ];
      const rowH = 22;

      // Header row
      doc.rect(40, tableY, pageW, rowH).fill(blue);
      let cx = 40;
      cols.forEach(c => {
        doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold')
           .text(c.label, cx + 4, tableY + 7, { width: c.width - 6, ellipsis: true });
        cx += c.width;
      });

      // Data rows
      data.forEach((inc, idx) => {
        const y = tableY + rowH + idx * rowH;
        if (y > 530) return; // overflow guard (landscape A4 ~545px content height)

        doc.rect(40, y, pageW, rowH).fill(idx % 2 === 0 ? '#FAFBFF' : '#FFFFFF');
        doc.rect(40, y, 3, rowH).fill(inc.resolved_at ? '#16A34A' : '#DC2626');

        const hostname = inc.url ? (() => { try { return new URL(inc.url).hostname.replace(/^www\./, ''); } catch { return inc.url_name || '—'; } })() : (inc.url_name || '—');
        const statusTxt = inc.resolved_at ? 'Resolved' : 'Open';
        const durMins   = inc.resolved_at
          ? inc.duration_minutes
          : Math.floor((Date.now() - new Date(inc.started_at)) / 60000);

        const cells = [
          String(idx + 1),
          hostname,
          statusTxt,
          fmtDT(inc.started_at),
          inc.resolved_at ? fmtDT(inc.resolved_at) : 'Ongoing…',
          fmtDur(durMins),
          inc.notified_client ? 'Yes' : 'No',
          inc.client_email || '—',
        ];

        cx = 40;
        cells.forEach((val, ci) => {
          const colColor = ci === 2
            ? (inc.resolved_at ? '#16A34A' : '#DC2626')
            : '#374151';
          doc.fillColor(colColor).fontSize(8).font(ci === 2 ? 'Helvetica-Bold' : 'Helvetica')
             .text(val, cx + 6, y + 7, { width: cols[ci].width - 8, ellipsis: true });
          cx += cols[ci].width;
        });
      });

      // Footer
      const footerY = 555;
      doc.moveTo(40, footerY).lineTo(802, footerY).strokeColor('#E5E7EB').stroke();
      doc.fillColor('#9CA3AF').fontSize(8).font('Helvetica')
         .text(`Creatah Uptime Monitor  ·  ${data.length} incident${data.length !== 1 ? 's' : ''}  ·  ${fmtDT(new Date())}`, 40, footerY + 5, { align: 'center', width: pageW });

      doc.end();
    });

    const dateTag = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="incident-report-${dateTag}.pdf"`);
    res.send(Buffer.concat(bufs));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getMonthlyStats, getRecentFailures, getStats, getRecentChecks, getIncidents, getUptimeChart, downloadIncidentsPdf };

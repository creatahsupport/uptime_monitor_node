const { Op, fn, col, literal, QueryTypes } = require('sequelize');
const { sequelize, MonitoredUrl, MonitorCheck, Incident } = require('../models');

// GET /api/dashboard/monthly-stats?month=2026-03&url_id=1
async function getMonthlyStats(req, res) {
  const { month, url_id } = req.query;

  const urlFilter      = url_id ? 'AND mc.url_id = :urlId' : '';
  const replacements   = { ...(month ? { month } : {}), ...(url_id ? { urlId: parseInt(url_id) } : {}) };

  // Always return total active URL count (unfiltered)
  const total_urls = await MonitoredUrl.count({ where: { is_active: true, is_deleted: false } });

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
         ROUND(AVG(mc.load_time_ms), 0)                              AS avg_response_ms
       FROM monitor_checks mc
       WHERE 1=1 ${monthFilter} ${urlFilter}`,
      { replacements, type: QueryTypes.SELECT }
    );

    // Daily trend data for chart
    const dailyTrend = await sequelize.query(
      `SELECT
         DATE(mc.checked_at)                                          AS check_date,
         ROUND(
           SUM(CASE WHEN mc.status = 'up' THEN 1 ELSE 0 END) * 100.0 /
           NULLIF(COUNT(*), 0), 1
         )                                                            AS uptime_pct,
         ROUND(AVG(mc.load_time_ms), 0)                              AS avg_load_ms
       FROM monitor_checks mc
       WHERE 1=1 ${monthFilter} ${urlFilter}
       GROUP BY DATE(mc.checked_at)
       ORDER BY check_date ASC`,
      { replacements, type: QueryTypes.SELECT }
    );

    res.json({
      success: true,
      data: {
        total_urls,
        failures:        parseInt(stats?.failures)  || 0,
        uptime_pct:      parseFloat(stats?.uptime_pct) || 0,
        avg_response_ms: parseInt(stats?.avg_response_ms) || 0,
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
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);

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
         DATE(mc.checked_at)           AS date,
         TIME(mc.checked_at)           AS time,
         u.url,
         u.name                        AS url_name,
         mc.http_status_code,
         mc.load_time_ms,
         mc.performance_label,
         mc.error_message,
         mc.checked_at
       FROM monitor_checks mc
       JOIN monitored_urls u ON u.id = mc.url_id AND u.is_deleted = 0
       WHERE mc.status = 'down'
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

// GET /api/dashboard/incidents?status=open|resolved
async function getIncidents(req, res) {
  const limit  = Math.min(parseInt(req.query.limit) || 20, 200);
  const status = req.query.status;
  const where  = {};
  if (status === 'open')     where.resolved_at = null;
  if (status === 'resolved') where.resolved_at = { [Op.ne]: null };

  try {
    const incidents = await Incident.findAll({
      where,
      include: [{ model: MonitoredUrl, as: 'monitoredUrl', attributes: ['name', 'url'] }],
      order: [['started_at', 'DESC']],
      limit,
    });
    const data = incidents.map(i => ({ ...i.toJSON(), url_name: i.monitoredUrl?.name, url: i.monitoredUrl?.url }));
    res.json({ success: true, data });
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

module.exports = { getMonthlyStats, getRecentFailures, getStats, getRecentChecks, getIncidents, getUptimeChart };

const { fn, col } = require('sequelize');
const { MonitoredUrl, MonitorCheck } = require('../models');

async function getAll(_req, res) {
  try {
    const urls = await MonitoredUrl.findAll({
      order: [['created_at', 'DESC']],
      attributes: {
        include: [[fn('COUNT', col('checks.id')), 'total_checks']],
      },
      include: [{ model: MonitorCheck, as: 'checks', attributes: [] }],
      group: ['MonitoredUrl.id'],
      subQuery: false,
    });
    res.json({ success: true, data: urls });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getOne(req, res) {
  try {
    const url = await MonitoredUrl.findByPk(req.params.id);
    if (!url) return res.status(404).json({ success: false, message: 'URL not found' });
    res.json({ success: true, data: url });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function create(req, res) {
  const { url, client_email } = req.body;
  if (!url) return res.status(400).json({ success: false, message: 'url is required' });

  // Auto-derive name from hostname if not provided
  let name = req.body.name;
  if (!name) {
    try { name = new URL(url.trim()).hostname; } catch { name = url.trim(); }
  }

  try {
    const record = await MonitoredUrl.create({ name, url: url.trim(), client_email: (client_email || '').trim() });
    res.status(201).json({ success: true, data: record });
  } catch (err) {
    const msg = err.errors ? err.errors.map(e => e.message).join(', ') : err.message;
    res.status(400).json({ success: false, message: msg });
  }
}

async function update(req, res) {
  try {
    const url = await MonitoredUrl.findByPk(req.params.id);
    if (!url) return res.status(404).json({ success: false, message: 'URL not found' });

    const allowed = ['name', 'url', 'client_email', 'is_active'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    if (!Object.keys(updates).length)
      return res.status(400).json({ success: false, message: 'No valid fields to update' });

    await url.update(updates);
    res.json({ success: true, data: url });
  } catch (err) {
    const msg = err.errors ? err.errors.map(e => e.message).join(', ') : err.message;
    res.status(400).json({ success: false, message: msg });
  }
}

async function remove(req, res) {
  try {
    const url = await MonitoredUrl.findByPk(req.params.id);
    if (!url) return res.status(404).json({ success: false, message: 'URL not found' });
    await url.destroy();
    res.json({ success: true, message: 'URL deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getChecks(req, res) {
  const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  try {
    const url = await MonitoredUrl.findByPk(req.params.id);
    if (!url) return res.status(404).json({ success: false, message: 'URL not found' });
    const checks = await MonitorCheck.findAll({
      where: { url_id: req.params.id },
      order: [['checked_at', 'DESC']],
      limit, offset,
    });
    res.json({ success: true, data: checks });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getAll, getOne, create, update, remove, getChecks };

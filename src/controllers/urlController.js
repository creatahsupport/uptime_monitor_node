const { fn, col } = require('sequelize');
const { MonitoredUrl, MonitorCheck } = require('../models');

function normalizeUrl(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return trimmed;
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)) return trimmed;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function validateEmailValue(raw) {
  const email = (raw || '').trim();
  if (!email) return 'Client email is required';
  if (/[<>()"';]/.test(email)) return 'Please enter a valid email address';
  if (/%[0-9A-Fa-f]{2}/.test(email)) return 'Please enter a valid email address';
  if (!/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/i.test(email)) return 'Please enter a valid email address';
  return null;
}

async function getAll(_req, res) {
  try {
    const urls = await MonitoredUrl.findAll({
      where: { is_deleted: false },
      order: [['created_at', 'ASC']],
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
    const url = await MonitoredUrl.findOne({ where: { id: req.params.id, is_deleted: false } });
    if (!url) return res.status(404).json({ success: false, message: 'URL not found' });
    res.json({ success: true, data: url });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function create(req, res) {
  const rawUrl = req.body.url;
  const client_email = req.body.client_email;
  if (!rawUrl) return res.status(400).json({ success: false, message: 'URL is required' });

  const url = normalizeUrl(rawUrl);
  const emailError = validateEmailValue(client_email);
  if (emailError) return res.status(400).json({ success: false, message: emailError });

  let name = req.body.name;
  if (!name) {
    try { name = new URL(url.trim()).hostname; } catch { name = url.trim(); }
  }

  try {
    const record = await MonitoredUrl.create({ name, url: url.trim(), client_email: client_email.trim() });
    res.status(201).json({ success: true, data: record });
  } catch (err) {
    const msg = err.errors ? err.errors.map(e => e.message).join(', ') : err.message;
    res.status(400).json({ success: false, message: msg });
  }
}

async function update(req, res) {
  try {
    const url = await MonitoredUrl.findOne({ where: { id: req.params.id, is_deleted: false } });
    if (!url) return res.status(404).json({ success: false, message: 'URL not found' });

    const allowed = ['name', 'url', 'client_email', 'is_active'];
    const updates = {};
    allowed.forEach(k => {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    });

    if (req.body.url !== undefined) {
      updates.url = normalizeUrl(req.body.url);
    }
    if (req.body.client_email !== undefined) {
      const emailError = validateEmailValue(req.body.client_email);
      if (emailError) return res.status(400).json({ success: false, message: emailError });
      updates.client_email = req.body.client_email.trim();
    }

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
    const url = await MonitoredUrl.findOne({ where: { id: req.params.id, is_deleted: false } });
    if (!url) return res.status(404).json({ success: false, message: 'URL not found' });
    await url.update({ is_deleted: true });
    res.json({ success: true, message: 'URL deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

async function getChecks(req, res) {
  const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  try {
    const url = await MonitoredUrl.findOne({ where: { id: req.params.id, is_deleted: false } });
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

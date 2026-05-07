const { InternalRecipient } = require('../models');

function validateRecipientEmail(raw) {
  const email = (raw || '').trim();
  if (!email) return 'email is required';
  if (/%[0-9A-Fa-f]{2}/.test(email)) return 'Must be a valid email address';
  if (/[<>()"';]/.test(email)) return 'Must be a valid email address';
  if (!/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/i.test(email)) return 'Must be a valid email address';
  return null;
}

// GET /api/recipients
async function getAll(_req, res) {
  try {
    const recipients = await InternalRecipient.findAll({ order: [['created_at', 'DESC']] });
    res.json({ success: true, data: recipients });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// POST /api/recipients
async function create(req, res) {
  const { name, email } = req.body;
  const validationError = validateRecipientEmail(email);
  if (validationError) return res.status(400).json({ success: false, message: validationError });
  try {
    const recipient = await InternalRecipient.create({ name: name || null, email: email.trim() });
    res.status(201).json({ success: true, data: recipient });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, message: 'This email is already registered' });
    }
    const msg = err.errors ? err.errors.map(e => e.message).join(', ') : err.message;
    res.status(400).json({ success: false, message: msg });
  }
}

// DELETE /api/recipients/:id
async function remove(req, res) {
  try {
    const recipient = await InternalRecipient.findByPk(req.params.id);
    if (!recipient) return res.status(404).json({ success: false, message: 'Recipient not found' });
    await recipient.destroy();
    res.json({ success: true, message: 'Recipient deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = { getAll, create, remove };

const { InternalRecipient } = require('../models');

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
  if (!email) return res.status(400).json({ success: false, message: 'email is required' });
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

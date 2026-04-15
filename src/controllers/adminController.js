const bcrypt = require('bcryptjs');
const { User } = require('../models');

// GET /api/admin/users
async function listUsers(req, res) {
  try {
    const users = await User.findAll({
      attributes: ['id', 'username', 'role', 'totp_enabled', 'created_at'],
      order: [['id', 'ASC']],
    });
    res.json({ success: true, users });
  } catch (error) {
    console.error('List users error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// POST /api/admin/users
async function createUser(req, res) {
  const { username: rawUsername, password } = req.body;
  if (!rawUsername || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required' });
  }

  const username = rawUsername.trim();
  if (username.length < 3) {
    return res.status(400).json({ success: false, message: 'Username must be at least 3 characters' });
  }
  if (password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
  }

  try {
    const existing = await User.findOne({ where: { username } });
    if (existing) {
      return res.status(409).json({ success: false, message: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashedPassword, role: 'admin' });

    res.status(201).json({
      success: true,
      user: { id: user.id, username: user.username, role: user.role, created_at: user.created_at },
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// DELETE /api/admin/users/:id
async function deleteUser(req, res) {
  const targetId = parseInt(req.params.id, 10);

  if (targetId === req.user.id) {
    return res.status(400).json({ success: false, message: 'You cannot delete your own account' });
  }

  try {
    const user = await User.findByPk(targetId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (user.role === 'super_admin') {
      return res.status(403).json({ success: false, message: 'Cannot delete a super admin account' });
    }

    await user.destroy();
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// PUT /api/admin/users/:id/password
async function updatePassword(req, res) {
  const targetId = parseInt(req.params.id, 10);
  const { password } = req.body;

  if (!password || password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
  }

  try {
    const user = await User.findByPk(targetId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const hashedPassword = await bcrypt.hash(password, 10);
    await user.update({ password: hashedPassword });
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// POST /api/admin/users/:id/disable-2fa
async function disable2faForUser(req, res) {
  const targetId = parseInt(req.params.id, 10);

  if (targetId === req.user.id) {
    return res.status(400).json({ success: false, message: 'Use the Profile page to manage your own 2FA' });
  }

  try {
    const user = await User.findByPk(targetId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (!user.totp_enabled) return res.status(400).json({ success: false, message: '2FA is not enabled for this user' });

    await user.update({ totp_secret: null, totp_enabled: false });
    res.json({ success: true, message: '2FA disabled for user' });
  } catch (error) {
    console.error('Disable 2FA for user error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { listUsers, createUser, deleteUser, updatePassword, disable2faForUser };

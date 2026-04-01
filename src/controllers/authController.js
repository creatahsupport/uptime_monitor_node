const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { User } = require('../models');
require('dotenv').config();

async function login(req, res) {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    const user = await User.findOne({ where: { username } });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid username' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid password' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET || 'uptime-monitor-secret',
      { expiresIn: '24h' }
    );

    res.json({ success: true, token, username: user.username });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

module.exports = { login };

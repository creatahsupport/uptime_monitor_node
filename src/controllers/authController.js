const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { User } = require('../models');
require('dotenv').config();

// Single active session store: userId → token
// Only one session allowed at a time per user
const activeSessions = new Map();

async function login(req, res) {
  try {
    const { username: rawUsername, password } = req.body;
    if (!rawUsername || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required' });
    }

    const username = rawUsername.trim();

    const user = await User.findOne({ where: { username } });
    if (!user || user.username !== username) {
      return res.status(401).json({ success: false, message: 'No account found with this username' });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid password' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Overwrite any existing session — old token becomes invalid
    activeSessions.set(user.id, token);

    res.json({ success: true, token, username: user.username });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

function logout(req, res) {
  if (req.user?.id) activeSessions.delete(req.user.id);
  res.json({ success: true, message: 'Logged out' });
}

module.exports = { login, logout, activeSessions };

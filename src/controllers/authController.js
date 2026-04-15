const jwt      = require('jsonwebtoken');
const bcrypt   = require('bcryptjs');
const speakeasy = require('speakeasy');
const qrcode   = require('qrcode');
const { User } = require('../models');
require('dotenv').config();

// Single active session store: userId → token
const activeSessions = new Map();

// Issue a short-lived pre-2FA temp token (5 min) — cannot access protected routes
function issueTempToken(userId) {
  return jwt.sign(
    { id: userId, pre_2fa: true },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );
}

// Verify temp token from Authorization header
function verifyTempToken(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, message: 'Temp token required' });
    return null;
  }
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    if (!decoded.pre_2fa) {
      res.status(401).json({ success: false, message: 'Invalid temp token' });
      return null;
    }
    return decoded;
  } catch {
    res.status(401).json({ success: false, message: 'Temp token expired — please log in again' });
    return null;
  }
}

// POST /api/auth/login
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

    const tempToken = issueTempToken(user.id);

    if (user.totp_enabled) {
      // 2FA set up — require OTP verification
      return res.json({ success: true, step: '2fa', temp_token: tempToken });
    }

    // 2FA not yet set up — force setup during login
    return res.json({ success: true, step: '2fa_setup', temp_token: tempToken });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// POST /api/auth/2fa/setup — generate TOTP secret + QR code
async function setup2fa(req, res) {
  const decoded = verifyTempToken(req, res);
  if (!decoded) return;

  try {
    const user = await User.findByPk(decoded.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const secret = speakeasy.generateSecret({
      name: `Uptime Monitor (${user.username})`,
      length: 20,
    });

    // Save secret temporarily (not enabled yet — enabled after verification)
    await user.update({ totp_secret: secret.base32 });

    const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url);

    res.json({
      success: true,
      secret: secret.base32,
      qr_code: qrDataUrl,
    });
  } catch (error) {
    console.error('2FA setup error:', error);
    res.status(500).json({ success: false, message: 'Failed to generate 2FA secret' });
  }
}

// POST /api/auth/2fa/verify-setup — verify OTP and enable 2FA, return full token
async function verifySetup(req, res) {
  const decoded = verifyTempToken(req, res);
  if (!decoded) return;

  const { otp } = req.body;
  if (!otp) return res.status(400).json({ success: false, message: 'OTP is required' });

  try {
    const user = await User.findByPk(decoded.id);
    if (!user || !user.totp_secret) {
      return res.status(400).json({ success: false, message: '2FA setup not initiated' });
    }

    const valid = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token: otp,
      window: 1,
    });

    if (!valid) {
      return res.status(401).json({ success: false, message: 'Please enter the valid OTP from your authenticator app.' });
    }

    await user.update({ totp_enabled: true, totp_required: false });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    activeSessions.set(user.id, token);

    res.json({ success: true, token, username: user.username, role: user.role });
  } catch (error) {
    console.error('2FA verify setup error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// POST /api/auth/2fa/verify — verify OTP during login, return full token
async function verify2fa(req, res) {
  const decoded = verifyTempToken(req, res);
  if (!decoded) return;

  const { otp } = req.body;
  if (!otp) return res.status(400).json({ success: false, message: 'OTP is required' });

  try {
    const user = await User.findByPk(decoded.id);
    if (!user || !user.totp_secret || !user.totp_enabled) {
      return res.status(400).json({ success: false, message: '2FA not configured' });
    }

    const valid = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token: otp,
      window: 1,
    });

    if (!valid) {
      return res.status(401).json({ success: false, message: 'Please enter the valid OTP from your authenticator app.' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    activeSessions.set(user.id, token);

    res.json({ success: true, token, username: user.username, role: user.role });
  } catch (error) {
    console.error('2FA verify error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// POST /api/auth/2fa/disable — disable 2FA (requires full JWT + OTP)
async function disable2fa(req, res) {
  const { otp } = req.body;
  if (!otp) return res.status(400).json({ success: false, message: 'OTP is required' });

  try {
    const user = await User.findByPk(req.user.id);
    if (!user || !user.totp_enabled) {
      return res.status(400).json({ success: false, message: '2FA is not enabled' });
    }

    const valid = speakeasy.totp.verify({
      secret: user.totp_secret,
      encoding: 'base32',
      token: otp,
      window: 1,
    });

    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid OTP' });
    }

    await user.update({ totp_secret: null, totp_enabled: false });
    res.json({ success: true, message: '2FA disabled successfully' });
  } catch (error) {
    console.error('Disable 2FA error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// POST /api/auth/2fa/setup-profile — generate QR for enabling 2FA from profile (uses full JWT)
async function setup2faProfile(req, res) {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    const secret = speakeasy.generateSecret({ name: `Uptime Monitor (${user.username})`, length: 20 });
    await user.update({ totp_secret: secret.base32 });
    const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url);
    res.json({ success: true, secret: secret.base32, qr_code: qrDataUrl });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to generate 2FA secret' });
  }
}

// POST /api/auth/2fa/enable-profile — verify OTP and enable 2FA from profile (uses full JWT)
async function enable2faProfile(req, res) {
  const { otp } = req.body;
  if (!otp) return res.status(400).json({ success: false, message: 'OTP is required' });
  try {
    const user = await User.findByPk(req.user.id);
    if (!user || !user.totp_secret) return res.status(400).json({ success: false, message: '2FA setup not initiated' });
    const valid = speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: otp, window: 1 });
    if (!valid) return res.status(401).json({ success: false, message: 'Invalid OTP. Please try again.' });
    await user.update({ totp_enabled: true, totp_required: false });
    res.json({ success: true, message: '2FA enabled successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

// GET /api/auth/2fa/status — get current 2FA status
async function get2faStatus(req, res) {
  try {
    const user = await User.findByPk(req.user.id);
    res.json({ success: true, enabled: !!user?.totp_enabled });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
}

function logout(req, res) {
  if (req.user?.id) activeSessions.delete(req.user.id);
  res.json({ success: true, message: 'Logged out' });
}

module.exports = { login, logout, setup2fa, verifySetup, verify2fa, disable2fa, get2faStatus, setup2faProfile, enable2faProfile, activeSessions };

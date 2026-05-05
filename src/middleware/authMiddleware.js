const jwt = require('jsonwebtoken');
const { activeSessions } = require('../controllers/authController');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized — no token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Block pre-2FA temp tokens from accessing protected routes
    if (decoded.pre_2fa) {
      return res.status(401).json({ success: false, message: '2FA verification required' });
    }
    // Check if this is still the active session for this user
    if (activeSessions.get(decoded.id) !== token) {
      return res.status(401).json({ success: false, code: 'SESSION_EXPIRED', message: 'Your session was ended because the account was logged in elsewhere.' });
    }
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

module.exports = { authenticate };

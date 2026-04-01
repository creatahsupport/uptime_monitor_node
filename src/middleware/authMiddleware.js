const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Unauthorized — no token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'uptime-monitor-secret');
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

module.exports = { authenticate };

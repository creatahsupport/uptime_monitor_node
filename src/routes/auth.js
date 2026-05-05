const express = require('express');
const router  = express.Router();
const { login, logout, setup2fa, verifySetup, verify2fa, disable2fa, get2faStatus, setup2faProfile, enable2faProfile } = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');

router.post('/login',            login);
router.post('/logout',           authenticate, logout);
router.post('/2fa/setup',        setup2fa);
router.post('/2fa/verify-setup', verifySetup);
router.post('/2fa/verify',       verify2fa);
router.post('/2fa/disable',      authenticate, disable2fa);
router.get('/2fa/status',          authenticate, get2faStatus);
router.post('/2fa/setup-profile',  authenticate, setup2faProfile);
router.post('/2fa/enable-profile', authenticate, enable2faProfile);

module.exports = router;

const express = require('express');
const router  = express.Router();
const { listUsers, createUser, deleteUser, updatePassword, disable2faForUser } = require('../controllers/adminController');

// All routes here already have authenticate applied in app.js
// Extra guard: super_admin only
function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'super_admin') {
    return res.status(403).json({ success: false, message: 'Access denied — super admin only' });
  }
  next();
}

router.get('/',    requireSuperAdmin, listUsers);
router.post('/',   requireSuperAdmin, createUser);
router.delete('/:id',              requireSuperAdmin, deleteUser);
router.put('/:id/password',       requireSuperAdmin, updatePassword);
router.post('/:id/disable-2fa',   requireSuperAdmin, disable2faForUser);

module.exports = router;

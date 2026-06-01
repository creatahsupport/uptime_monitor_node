const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/urlController');

router.get('/', ctrl.getAll);
router.get('/expiry/all', ctrl.getAllExpiry);
router.get('/:id', ctrl.getOne);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);
router.get('/:id/checks', ctrl.getChecks);
router.get('/:id/expiry', ctrl.getExpiry);
router.patch('/:id/pause', ctrl.togglePause);

module.exports = router;

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/reportController');

router.get('/months', ctrl.getAvailableMonths);
router.get('/preview', ctrl.previewReport);
router.get('/download', ctrl.downloadReport);

module.exports = router;

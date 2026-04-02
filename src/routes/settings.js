const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');

router.get('/cron', settingsController.getCronSetting);
router.put('/cron', settingsController.updateCronSetting);
router.put('/cron/status', settingsController.toggleCronStatus);

module.exports = router;

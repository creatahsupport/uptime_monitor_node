const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');

router.get('/cron', settingsController.getCronSetting);
router.put('/cron', settingsController.updateCronSetting);

module.exports = router;

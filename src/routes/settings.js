const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');

router.get('/cron', settingsController.getCronSetting);
router.put('/cron', settingsController.updateCronSetting);
router.put('/cron/status', settingsController.toggleCronStatus);
router.get('/monthly-report-day', settingsController.getMonthlyReportDay);
router.put('/monthly-report-day', settingsController.updateMonthlyReportDay);
router.post('/monthly-report/run', settingsController.runMonthlyReportNow);

module.exports = router;

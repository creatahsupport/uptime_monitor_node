const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/dashboardController');

router.get('/monthly-stats',    ctrl.getMonthlyStats);
router.get('/recent-failures',  ctrl.getRecentFailures);
router.get('/stats',            ctrl.getStats);
router.get('/recent-checks',    ctrl.getRecentChecks);
router.get('/incidents',        ctrl.getIncidents);
router.get('/uptime-chart/:urlId', ctrl.getUptimeChart);

module.exports = router;

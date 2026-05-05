const { Setting } = require('../models');
const { rescheduleCronJob } = require('../jobs/monitorJob');
const { rescheduleMonthlyReportJob, runMonthlyReportProcess } = require('../jobs/monthlyReportJob');

exports.getCronSetting = async (req, res) => {
  try {
    const schedule = await Setting.findOne({ where: { key: 'cron_schedule' } });
    const enabled  = await Setting.findOne({ where: { key: 'cron_enabled' } });

    res.json({ 
      success: true, 
      data: {
        schedule: schedule ? schedule.value : '0 * * * *',
        enabled: enabled ? enabled.value === 'true' : true
      }
    });
  } catch (error) {
    console.error('Error fetching cron setting:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateCronSetting = async (req, res) => {
  try {
    const { schedule } = req.body;
    if (!schedule) {
      return res.status(400).json({ success: false, message: 'Schedule is required' });
    }

    const cron = require('node-cron');
    if (!cron.validate(schedule)) {
      return res.status(400).json({ success: false, message: `Invalid cron expression: "${schedule}"` });
    }

    await rescheduleCronJob(schedule);
    res.json({ success: true, message: 'Cron schedule updated successfully', data: schedule });
  } catch (error) {
    console.error('Error updating cron setting:', error);
    res.status(500).json({ success: false, message: 'Server error updating cron' });
  }
};

exports.runMonthlyReportNow = async (req, res) => {
  try {
    // Use provided month or fall back to current month for manual runs
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const month = req.body?.month || currentMonth;

    runMonthlyReportProcess(month).catch(err =>
      console.error('[MonthlyReport] Manual run error:', err.message)
    );
    res.json({ success: true, message: `Monthly report process started for ${month}` });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.getMonthlyReportDay = async (req, res) => {
  try {
    const [daySetting, hourSetting, minuteSetting] = await Promise.all([
      Setting.findOne({ where: { key: 'monthly_report_day' } }),
      Setting.findOne({ where: { key: 'monthly_report_hour' } }),
      Setting.findOne({ where: { key: 'monthly_report_minute' } }),
    ]);
    res.json({
      success: true,
      data: {
        day:    daySetting    ? parseInt(daySetting.value)    : 1,
        hour:   hourSetting   ? parseInt(hourSetting.value)   : 0,
        minute: minuteSetting ? parseInt(minuteSetting.value) : 0,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateMonthlyReportDay = async (req, res) => {
  try {
    const day    = parseInt(req.body.day);
    const hour   = parseInt(req.body.hour);
    const minute = parseInt(req.body.minute);

    if (!day || day < 1 || day > 28)
      return res.status(400).json({ success: false, message: 'Day must be between 1 and 28' });
    if (isNaN(hour) || hour < 0 || hour > 23)
      return res.status(400).json({ success: false, message: 'Hour must be between 0 and 23' });
    if (isNaN(minute) || minute < 0 || minute > 59)
      return res.status(400).json({ success: false, message: 'Minute must be between 0 and 59' });

    await rescheduleMonthlyReportJob(day, hour, minute);
    res.json({ success: true, message: 'Monthly report schedule updated', data: { day, hour, minute } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.toggleCronStatus = async (req, res) => {
  try {
    const { enabled } = req.body;
    const { setCronEnabled } = require('../jobs/monitorJob');
    
    await setCronEnabled(enabled);
    res.json({ success: true, message: `Monitoring ${enabled ? 'resumed' : 'paused'} successfully` });
  } catch (error) {
    console.error('Error toggling cron status:', error);
    res.status(500).json({ success: false, message: 'Server error toggling status' });
  }
};

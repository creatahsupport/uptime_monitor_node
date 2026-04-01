const { Setting } = require('../models');
const { rescheduleCronJob } = require('../jobs/monitorJob');

exports.getCronSetting = async (req, res) => {
  try {
    const setting = await Setting.findOne({ where: { key: 'cron_schedule' } });
    if (!setting) {
      return res.json({ success: true, data: '0 * * * *' });
    }
    res.json({ success: true, data: setting.value });
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
    
    // Apply new schedule immediately
    await rescheduleCronJob(schedule);
    
    res.json({ success: true, message: 'Cron schedule updated successfully', data: schedule });
  } catch (error) {
    console.error('Error updating cron setting:', error);
    res.status(500).json({ success: false, message: 'Server error updating cron' });
  }
};

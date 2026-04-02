const { Setting } = require('../models');
const { rescheduleCronJob } = require('../jobs/monitorJob');

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

    // Apply new schedule immediately
    await rescheduleCronJob(schedule);

    res.json({ success: true, message: 'Cron schedule updated successfully', data: schedule });
  } catch (error) {
    console.error('Error updating cron setting:', error);
    res.status(500).json({ success: false, message: 'Server error updating cron' });
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

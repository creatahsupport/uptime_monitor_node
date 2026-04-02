const cron = require('node-cron');
const { Setting } = require('../models');
const { runAllChecks } = require('../services/monitorService');

let currentJob = null;
let isCronEnabled = true;
const DEFAULT_CRON = '0 * * * *';

async function startCronJob() {
  let schedule = process.env.CRON_SCHEDULE || DEFAULT_CRON;
  try {
    const [scheduleSetting] = await Setting.findOrCreate({
      where: { key: 'cron_schedule' },
      defaults: { value: schedule }
    });
    schedule = scheduleSetting.value || schedule;

    const [enabledSetting] = await Setting.findOrCreate({
      where: { key: 'cron_enabled' },
      defaults: { value: 'true' }
    });
    isCronEnabled = enabledSetting.value === 'true';
  } catch (err) {
    console.error('Failed to read cron setting from DB:', err.message);
  }

  scheduleJob(schedule);
}

function scheduleJob(schedule) {
  if (currentJob) {
    currentJob.stop();
  }

  console.log(`⏰ Cron job scheduled: "${schedule}" (Enabled: ${isCronEnabled})`);
  currentJob = cron.schedule(schedule, async () => {
    if (!isCronEnabled) {
      console.log('🔇 Cron job skipped (Monitoring is PAUSED)');
      return;
    }
    try {
      await runAllChecks();
    } catch (err) {
      console.error('Cron job error:', err.message);
    }
  });
}

async function rescheduleCronJob(newSchedule) {
  await Setting.upsert({ key: 'cron_schedule', value: newSchedule });
  scheduleJob(newSchedule);
}

async function setCronEnabled(enabled) {
  isCronEnabled = enabled;
  await Setting.upsert({ key: 'cron_enabled', value: String(enabled) });
  console.log(`🔌 Monitoring ${enabled ? 'RESUMED' : 'PAUSED'}`);
}

module.exports = { startCronJob, rescheduleCronJob, setCronEnabled };

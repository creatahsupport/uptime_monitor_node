require('dotenv').config();
const cron = require('node-cron');
const { Setting } = require('../models');
const { runAllChecks, runDailyLoadTimeChecks } = require('../services/monitorService');

let currentJob = null;
let currentLoadTimeJob = null;
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
  scheduleLoadTimeJob();
}

function scheduleJob(schedule) {
  if (currentJob) {
    currentJob.stop();
  }

  const tz = process.env.TZ || 'Asia/Kolkata';
  console.log(`⏰ Cron job scheduled: "${schedule}" (Enabled: ${isCronEnabled}) (${tz})`);
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
  }, { timezone: tz });
}

function scheduleLoadTimeJob() {
  if (currentLoadTimeJob) {
    currentLoadTimeJob.stop();
  }
  const loadTimeCron = process.env.LOAD_TIME_CRON || '47 14 * * *';
  const tz = process.env.TZ || 'Asia/Kolkata';
  currentLoadTimeJob = cron.schedule(loadTimeCron, async () => {
    try {
      await runDailyLoadTimeChecks();
    } catch (err) {
      console.error('Daily load time job error:', err.message);
    }
  }, { timezone: tz });
  console.log(`⏰ Daily load time job scheduled: "${loadTimeCron}" (${tz})`);
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

const cron = require('node-cron');
const { Setting } = require('../models');
const { runAllChecks } = require('../services/monitorService');

let currentJob = null;
const DEFAULT_CRON = '0 * * * *';

async function startCronJob() {
  let schedule = process.env.CRON_SCHEDULE || DEFAULT_CRON;
  try {
    const [setting] = await Setting.findOrCreate({
      where: { key: 'cron_schedule' },
      defaults: { value: schedule }
    });
    schedule = setting.value || schedule;
  } catch (err) {
    console.error('Failed to read cron setting from DB:', err.message);
  }

  scheduleJob(schedule);
}

function scheduleJob(schedule) {
  if (currentJob) {
    currentJob.stop();
  }

  console.log(`⏰ Cron job scheduled: "${schedule}"`);
  currentJob = cron.schedule(schedule, async () => {
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

module.exports = { startCronJob, rescheduleCronJob };

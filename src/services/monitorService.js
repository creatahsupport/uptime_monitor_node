const puppeteer = require('puppeteer-core');
const path      = require('path');
const { MonitoredUrl, MonitorCheck, Incident, InternalRecipient } = require('../models');
const emailService = require('./emailService');
require('dotenv').config();

const GOOD_MS    = parseInt(process.env.LOAD_TIME_GOOD)    || 2000;
const AVERAGE_MS = parseInt(process.env.LOAD_TIME_AVERAGE) || 4000;

const CHROME_PATH = process.env.CHROME_PATH ||
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

// Persist Chrome profile/cache across runs so repeat checks use cached assets
const CHROME_CACHE_DIR = path.join(__dirname, '../../.chrome-cache');

function classifyLoadTime(ms) {
  if (ms == null) return null;
  if (ms <= GOOD_MS)    return 'good';
  if (ms <= AVERAGE_MS) return 'average';
  return 'bad';
}

async function launchBrowser() {
  return puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    userDataDir: CHROME_CACHE_DIR,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });
}

async function checkUrl(urlRow, browser) {
  let status         = 'down';
  let loadTimeMs     = null;
  let httpStatusCode = null;
  let errorMessage   = null;

  try {
    const page = await browser.newPage();

    // Capture HTTP status from the main navigation response
    let mainStatus = null;
    page.on('response', response => {
      if (mainStatus === null && response.url() === urlRow.url) {
        mainStatus = response.status();
      }
    });

    const response = await page.goto(urlRow.url, {
      waitUntil: 'load',
      timeout:   120000,
    });

    // Use browser's Navigation Timing Level 2 API — matches Chrome DevTools "Load" time
    const navTiming = await page.evaluate(() => {
      const t = performance.getEntriesByType('navigation')[0];
      return t ? Math.round(t.loadEventEnd - t.startTime) : null;
    });
    loadTimeMs     = navTiming > 0 ? navTiming : null;
    httpStatusCode = mainStatus || (response ? response.status() : null);

    if (httpStatusCode && httpStatusCode < 400) {
      status = 'up';
    } else {
      errorMessage = `HTTP ${httpStatusCode}`;
    }

    await page.close();
  } catch (err) {
    errorMessage = err.message.slice(0, 255);
  }

  const performanceLabel = status === 'up' ? classifyLoadTime(loadTimeMs) : null;

  await MonitorCheck.create({
    url_id:            urlRow.id,
    status,
    load_time_ms:      loadTimeMs,
    performance_label: performanceLabel,
    http_status_code:  httpStatusCode,
    error_message:     errorMessage,
    checked_at:        new Date(),
  });

  return { status, loadTimeMs, performanceLabel, httpStatusCode, errorMessage };
}

async function handleStatusTransition(urlRow, newStatus) {
  const prevStatus = urlRow.current_status;

  await urlRow.update({ current_status: newStatus, last_checked_at: new Date() });

  // UP → DOWN: open incident + notify client
  if (prevStatus !== 'down' && newStatus === 'down') {
    const incident = await Incident.create({
      url_id:     urlRow.id,
      started_at: new Date(),
    });

    try {
      console.log(`[ALERT] Attempting to send downtime alert for ${urlRow.name} to ${urlRow.client_email}`);
      await emailService.sendDowntimeAlert({
        clientEmail: urlRow.client_email,
        urlName:     urlRow.name,
        url:         urlRow.url,
        detectedAt:  new Date(),
      });
      await incident.update({ notified_client: true });
      console.log(`[ALERT] Downtime alert sent successfully to ${urlRow.client_email}`);
    } catch (e) {
      console.error(`[ALERT ERROR] Failed to send downtime alert for ${urlRow.name}:`, e);
    }

    return 'down_started';
  }

  // DOWN → UP: close incident + notify client recovery
  if (prevStatus === 'down' && newStatus === 'up') {
    const incident = await Incident.findOne({
      where:  { url_id: urlRow.id, resolved_at: null },
      order:  [['started_at', 'DESC']],
    });

    if (incident) {
      const durationMinutes = Math.round(
        (Date.now() - new Date(incident.started_at).getTime()) / 60000
      );
      await incident.update({ resolved_at: new Date(), duration_minutes: durationMinutes });

      try {
        await emailService.sendRecoveryAlert({
          clientEmail:     urlRow.client_email,
          urlName:         urlRow.name,
          url:             urlRow.url,
          recoveredAt:     new Date(),
          downtimeMinutes: durationMinutes,
        });
      } catch (e) {
        console.error('Failed to send recovery alert:', e.message);
      }
    }

    return 'recovered';
  }

  return 'unchanged';
}

async function runAllChecks() {
  console.log(`[${new Date().toISOString()}] Starting monitor run…`);

  const urls = await MonitoredUrl.findAll({ where: { is_active: true, is_deleted: false } });

  if (!urls.length) {
    console.log('No active URLs to check.');
    return;
  }

  const browser = await launchBrowser();
  const failures = [];

  for (const urlRow of urls) {
    try {
      const result     = await checkUrl(urlRow, browser);
      const transition = await handleStatusTransition(urlRow, result.status);

      console.log(
        `  [${result.status.toUpperCase()}] ${urlRow.name} — ${result.loadTimeMs}ms — ${transition}`
      );

      if (result.status === 'down') {
        failures.push({ name: urlRow.name, url: urlRow.url, detected_at: new Date() });
      }
    } catch (err) {
      console.error(`  Error checking ${urlRow.url}:`, err.message);
    }
  }

  await browser.close();

  // Send one internal summary email for all failures this run
  if (failures.length) {
    try {
      const recipients = await InternalRecipient.findAll({ attributes: ['email'] });
      const emails     = recipients.map(r => r.email);
      if (emails.length) {
        await emailService.sendInternalFailureSummary({ recipients: emails, failures });
        console.log(`  Internal summary sent to ${emails.length} recipient(s).`);
      }
    } catch (e) {
      console.error('  Failed to send internal summary:', e.message);
    }
  }

  console.log(
    `[${new Date().toISOString()}] Run complete — ${urls.length} checked, ${failures.length} down.`
  );
}

async function checkUrlSingle(urlRow) {
  const browser = await launchBrowser();
  try {
    return await checkUrl(urlRow, browser);
  } finally {
    await browser.close();
  }
}

module.exports = { runAllChecks, checkUrl: checkUrlSingle };

const axios = require('axios');
const { MonitoredUrl, MonitorCheck, Incident, InternalRecipient } = require('../models');
const emailService = require('./emailService');
require('dotenv').config();

const GOOD_MS    = parseInt(process.env.LOAD_TIME_GOOD)    || 1000;  // ≤1s Good
const AVERAGE_MS = parseInt(process.env.LOAD_TIME_AVERAGE) || 3000;  // ≤3s Average, >3s Poor

function classifyLoadTime(ms) {
  if (ms == null) return null;
  if (ms <= GOOD_MS)    return 'good';
  if (ms <= AVERAGE_MS) return 'average';
  return 'bad';
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
};

const REQUEST_OPTIONS = {
  // No timeout — slow sites should not be marked DOWN just because they take long.
  // Only a real network error (DNS fail, connection refused, etc.) marks a site DOWN.
  maxRedirects: 5,
  validateStatus: () => true,
  headers: BROWSER_HEADERS,
};

async function checkUrl(urlRow) {
  let status         = 'down';
  let httpStatusCode = null;
  let errorMessage   = null;
  let loadTimeMs     = null;

  const start = Date.now();
  try {
    // Full GET request so we measure page load time instead of just response headers.
    const response = await axios.get(urlRow.url, { ...REQUEST_OPTIONS, responseType: 'stream' });
    await new Promise((resolve, reject) => {
      response.data.on('data', () => {});
      response.data.on('end', resolve);
      response.data.on('error', reject);
    });

    loadTimeMs     = Date.now() - start;
    httpStatusCode = response.status;

    // 2xx and 3xx = UP, 4xx and 5xx = DOWN
    if (httpStatusCode >= 200 && httpStatusCode < 400) {
      status = 'up';
    } else {
      status       = 'down';
      errorMessage = `HTTP ${httpStatusCode}`;
    }
  } catch (err) {
    // Only real errors (DNS failure, connection refused, etc.) reach here.
    // Timeouts won't occur because we removed the timeout limit.
    loadTimeMs   = Date.now() - start;
    status       = 'down';
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
      url_id: urlRow.id,
      started_at: new Date(),
    });

    try {
      console.log(`[ALERT] Attempting to send downtime alert for ${urlRow.name} to ${urlRow.client_email}`);
      await emailService.sendDowntimeAlert({
        clientEmail: urlRow.client_email,
        urlName: urlRow.name,
        url: urlRow.url,
        detectedAt: new Date(),
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
      where: { url_id: urlRow.id, resolved_at: null },
      order: [['started_at', 'DESC']],
    });

    if (incident) {
      const durationMinutes = Math.round(
        (Date.now() - new Date(incident.started_at).getTime()) / 60000
      );
      await incident.update({ resolved_at: new Date(), duration_minutes: durationMinutes });

      try {
        await emailService.sendRecoveryAlert({
          clientEmail: urlRow.client_email,
          urlName: urlRow.name,
          url: urlRow.url,
          recoveredAt: new Date(),
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

let isRunning = false;

async function runAllChecks() {
  if (isRunning) {
    console.log('⏭  Monitor run skipped — previous run still in progress.');
    return;
  }
  isRunning = true;
  console.log(`[${new Date().toISOString()}] Starting monitor run…`);

  try {
    const urls = await MonitoredUrl.findAll({ where: { is_active: true, is_deleted: false } });

    if (!urls.length) {
      console.log('No active URLs to check.');
      return;
    }

    const results = await Promise.allSettled(
      urls.map(async (urlRow) => {
        const result = await checkUrl(urlRow);
        const transition = await handleStatusTransition(urlRow, result.status);
        console.log(`  [${result.status.toUpperCase()}] ${urlRow.name} — HTTP ${result.httpStatusCode ?? 'ERR'} — ${result.loadTimeMs}ms — ${transition}`);
        return { urlRow, result };
      })
    );

    const failures = results
      .filter(r => r.status === 'fulfilled' && r.value.result.status === 'down')
      .map(r => ({ name: r.value.urlRow.name, url: r.value.urlRow.url, detected_at: new Date() }));

    results
      .filter(r => r.status === 'rejected')
      .forEach(r => console.error('  Check error:', r.reason?.message));

    if (failures.length) {
      try {
        const recipients = await InternalRecipient.findAll({ attributes: ['email'] });
        const emails = recipients.map(r => r.email);
        if (emails.length) {
          await emailService.sendInternalFailureSummary({ recipients: emails, failures });
          console.log(`  Internal summary sent to ${emails.length} recipient(s).`);
        }
      } catch (e) {
        console.error('  Failed to send internal summary:', e.message);
      }
    }

    console.log(`[${new Date().toISOString()}] Run complete — ${urls.length} checked, ${failures.length} down.`);
  } finally {
    isRunning = false;
  }
}

module.exports = { runAllChecks, checkUrl };

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

const BASE_OPTIONS = {
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
    // Step 1 — Quick HEAD request (5s) to check if server is alive
    // This determines UP/DOWN without waiting for the full page body
    const headResponse = await axios.head(urlRow.url, { ...BASE_OPTIONS, timeout: 5000 });
    httpStatusCode = headResponse.status;

    // Any HTTP response means the server is reachable — mark UP
    // Only connection-level errors (timeout, DNS, ECONNRESET) mark DOWN
    status = 'up';

    // Step 2 — Full GET to measure actual load time (up to 120s)
    try {
      const getStart = Date.now();
      const getResponse = await axios.get(urlRow.url, { ...BASE_OPTIONS, timeout: 120000, responseType: 'stream' });
      httpStatusCode = getResponse.status;
      await new Promise((resolve, reject) => {
        getResponse.data.on('data', () => {});
        getResponse.data.on('end', resolve);
        getResponse.data.on('error', reject);
      });
      loadTimeMs = Date.now() - getStart;
    } catch {
      // GET failed but HEAD succeeded — site is UP, use HEAD time
      loadTimeMs = Date.now() - start;
    }
  } catch (err) {
    // HEAD request failed — server truly unreachable
    loadTimeMs   = Date.now() - start;
    status       = 'down';
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      errorMessage = 'Connection timed out — server not responding';
    } else {
      errorMessage = err.message.slice(0, 255);
    }
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

const CONFIRM_FAILURES = 2; // number of consecutive failures before marking DOWN

async function handleStatusTransition(urlRow, newStatus, result) {
  const prevStatus = urlRow.current_status;

  if (newStatus === 'down') {
    const failures = (urlRow.consecutive_failures || 0) + 1;
    // Always update status immediately so URL Management shows correct status
    await urlRow.update({ consecutive_failures: failures, current_status: 'down', last_checked_at: new Date() });

    // Not enough consecutive failures yet — don't alert
    if (failures < CONFIRM_FAILURES) {
      console.log(`  [WARN] ${urlRow.name} failed (${failures}/${CONFIRM_FAILURES}) — waiting for confirmation`);
      return 'failure_pending';
    }

    // Confirmed DOWN (already was down — don't re-alert)
    if (prevStatus === 'down') {
      return 'still_down';
    }

    // Transition to DOWN confirmed — alert only

    const incident = await Incident.create({
      url_id: urlRow.id,
      started_at: new Date(),
    });

    try {
      console.log(`[ALERT] Sending downtime alert for ${urlRow.name} to ${urlRow.client_email}`);
      await emailService.sendDowntimeAlert({
        clientEmail:  urlRow.client_email,
        url:          urlRow.url,
        detectedAt:   new Date(),
        httpStatus:   result.httpStatusCode,
        errorMessage: result.errorMessage,
      });
      await incident.update({ notified_client: true });
      console.log(`[ALERT] Downtime alert sent successfully to ${urlRow.client_email}`);
    } catch (e) {
      console.error(`[ALERT ERROR] Failed to send downtime alert for ${urlRow.name}:`, e);
    }

    return 'down_started';
  }

  // Site is UP — reset consecutive failures counter
  await urlRow.update({ consecutive_failures: 0, current_status: 'up', last_checked_at: new Date() });

  // DOWN → UP: close incident + notify client recovery
  if (prevStatus === 'down') {
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
          url:         urlRow.url,
          recoveredAt: new Date(),
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
        const transition = await handleStatusTransition(urlRow, result.status, result);
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

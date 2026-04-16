const net   = require('net');
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
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Cache-Control': 'max-age=0',
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

  try {
    const startTime = Date.now();
    // Step 1 — GET (10s): any HTTP response = server is reachable
    const response = await axios.get(urlRow.url, { ...BASE_OPTIONS, timeout: 10000, responseType: 'stream' });
    loadTimeMs = Date.now() - startTime;
    httpStatusCode = response.status;
    response.data.destroy(); // abort body — we only need the status code

    if (httpStatusCode >= 200 && httpStatusCode < 400) {
      status = 'up';
    } else {
      status       = 'down';
      errorMessage = `HTTP ${httpStatusCode}`;
      
      // If we get a 403 or 404, the server is CLEARLY reachable.
      // We'll mark it as down (as the page is missing), but let's record it.
    }
  } catch (err) {
    // Step 2 — GET failed (timeout/blocked): try TCP fallback
    // Some servers block HTTP bots but the port is still open
    try {
      const parsed   = new URL(urlRow.url);
      const hostname = parsed.hostname;
      const port     = parsed.port ? parseInt(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);

      const tcpUp = await new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(5000);
        socket
          .on('connect', () => { socket.destroy(); resolve(true); })
          .on('timeout', () => { socket.destroy(); resolve(false); })
          .on('error',   () => { socket.destroy(); resolve(false); })
          .connect(port, hostname);
      });

      if (tcpUp) {
        status = 'up'; // port open — server running, HTTP was blocked
      } else {
        status       = 'down';
        errorMessage = 'Connection timed out — server not responding';
      }
    } catch (tcpErr) {
      status       = 'down';
      errorMessage = tcpErr.message.slice(0, 255);
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
    // ALWAYS update status immediately so dashboard shows 'down' on the very first fail
    await urlRow.update({ consecutive_failures: failures, current_status: 'down', last_checked_at: new Date() });

    // Not enough consecutive failures yet — don't alert
    if (failures < CONFIRM_FAILURES) {
      console.log(`  [WARN] ${urlRow.name} failed (${failures}/${CONFIRM_FAILURES}) — waiting for confirmation`);
      return 'failure_pending';
    }

    // Only alert if there is no existing open incident (avoids re-alerting on every check while down)
    const existingIncident = await Incident.findOne({
      where: { url_id: urlRow.id, resolved_at: null },
    });
    if (existingIncident) {
      return 'still_down';
    }

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

module.exports = { runAllChecks, checkUrl, handleStatusTransition };

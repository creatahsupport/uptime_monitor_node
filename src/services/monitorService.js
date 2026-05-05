const axios     = require('axios');
const { Op }    = require('sequelize');
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

// ── UptimeRobot API ───────────────────────────────────────────────────────────

async function fetchUptimeRobotMonitors() {
  const apiKey = process.env.UPTIMEROBOT_API_KEY;
  if (!apiKey) return null;
  const res = await axios.post(
    'https://api.uptimerobot.com/v2/getMonitors',
    new URLSearchParams({ api_key: apiKey, format: 'json', response_times: '1', response_times_limit: '1' }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 }
  );
  if (res.data?.stat !== 'ok') throw new Error(`UptimeRobot: ${res.data?.error?.message || 'API error'}`);
  return res.data.monitors || [];
}

async function ensureUptimeRobotMonitor(urlRow, monitors) {
  const apiKey = process.env.UPTIMEROBOT_API_KEY;
  const normalize = (u) => u.replace(/\/$/, '').toLowerCase();
  const existing = monitors.find(m => normalize(m.url) === normalize(urlRow.url));
  if (existing) return existing;
  const res = await axios.post(
    'https://api.uptimerobot.com/v2/newMonitor',
    new URLSearchParams({ api_key: apiKey, format: 'json', friendly_name: urlRow.name, url: urlRow.url, type: '1' }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 30000 }
  );
  console.log(`  [UPTIMEROBOT] Monitor created for ${urlRow.name} — status: ${res.data?.stat}`);
  return null; // newly created, not checked yet
}

// ── PageSpeed Insights — full page load + resource breakdown ──────────────────

async function getPageSpeedMetrics(pageUrl) {
  const apiKey   = process.env.PAGESPEED_API_KEY || '';
  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(pageUrl)}&strategy=desktop&category=performance${apiKey ? `&key=${apiKey}` : ''}`;
  const { data } = await axios.get(endpoint, { timeout: 180000, validateStatus: () => true });

  if (data?.error) {
    throw new Error(`PageSpeed API: ${data.error.message || data.error.status}`);
  }
  if (!data?.lighthouseResult?.audits) {
    throw new Error('PageSpeed API returned no lighthouse data');
  }

  const audits = data.lighthouseResult.audits;
  const num = (key) => {
    const v = audits[key]?.numericValue;
    return v != null ? Math.round(v) : null;
  };

  return {
    full_load_ms:  num('speed-index'),
    html_load_ms:  num('first-contentful-paint'),
    css_load_ms:   num('first-meaningful-paint'),
    js_load_ms:    num('total-blocking-time'),
    image_load_ms: num('largest-contentful-paint'),
  };
}

async function checkUrl(urlRow, uptimeMonitors = null) {
  let status         = 'down';
  let httpStatusCode = null;
  let errorMessage   = null;
  let errorType      = null;
  let loadTimeMs     = null;

  if (uptimeMonitors !== null) {
    // ── UptimeRobot mode ────────────────────────────────────────────────────
    try {
      const monitor = await ensureUptimeRobotMonitor(urlRow, uptimeMonitors);
      if (!monitor) {
        // Newly created monitor — not checked yet, skip this run
        console.log(`  [UPTIMEROBOT] ${urlRow.name} — monitor just created, skipping this run`);
        return { status: 'up', loadTimeMs: null, performanceLabel: null, httpStatusCode: null, errorMessage: null, errorType: null };
      }
      // UptimeRobot statuses: 2=up, 8=seems down, 9=down
      if (monitor.status === 2) {
        status = 'up';
        loadTimeMs = monitor.response_times?.[0]?.value || null;
      } else if (monitor.status === 9) {
        status = 'down';
        errorType = 'network_error';
        errorMessage = 'Site is down';
      } else if (monitor.status === 8) {
        status = 'down';
        errorType = 'network_error';
        errorMessage = 'Site seems down';
      } else {
        // paused or not checked yet
        status = 'up';
      }
    } catch (err) {
      errorType    = 'network_error';
      errorMessage = `UptimeRobot error: ${err.message}`;
      status       = 'down';
    }
  } else {
    // ── Axios mode (fallback if no API key) ─────────────────────────────────
    const startTime = Date.now();
    try {
      const response = await axios.get(urlRow.url, {
        ...BASE_OPTIONS,
        timeout: 60000,
        validateStatus: () => true,
      });
      loadTimeMs     = Date.now() - startTime;
      httpStatusCode = response.status;
      if (httpStatusCode >= 400) {
        status       = 'down';
        errorType    = httpStatusCode >= 500 ? 'server_error' : 'client_error';
        errorMessage = `HTTP ${httpStatusCode} ${response.statusText || ''}`.trim();
      } else if (httpStatusCode >= 200 && httpStatusCode < 400) {
        status = 'up';
      } else {
        status       = 'down';
        errorType    = 'http_error';
        errorMessage = `Unexpected HTTP ${httpStatusCode}`;
      }
    } catch (err) {
      loadTimeMs = Date.now() - startTime;
      if (err.code === 'ENOTFOUND')                      { errorType = 'dns_error';           errorMessage = 'DNS resolution failed - domain not found'; }
      else if (err.code === 'ECONNREFUSED')              { errorType = 'connection_refused';   errorMessage = 'Connection refused - server not accepting connections'; }
      else if (err.code === 'ECONNRESET')                { errorType = 'connection_reset';     errorMessage = 'Connection reset by server'; }
      else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') { errorType = 'timeout'; errorMessage = 'Site is down'; }
      else if (err.code === 'CERT_HAS_EXPIRED')          { errorType = 'ssl_expired';          errorMessage = 'SSL certificate has expired'; }
      else if (err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') { errorType = 'ssl_invalid';   errorMessage = 'SSL certificate is invalid or untrusted'; }
      else if (err.response) { httpStatusCode = err.response.status; errorType = httpStatusCode >= 500 ? 'server_error' : 'client_error'; errorMessage = `HTTP ${httpStatusCode}: ${err.response.statusText || 'Unknown error'}`; }
      else                                               { errorType = 'network_error';        errorMessage = 'Site is down'; }
      status = 'down';
    }
  }

  const performanceLabel = status === 'up' ? classifyLoadTime(loadTimeMs) : null;

  // Duplicate guard — skip if this URL was already checked in the last 60 seconds
  const sixtySecsAgo = new Date(Date.now() - 60 * 1000);
  const recentCheck = await MonitorCheck.findOne({
    where: { url_id: urlRow.id, check_type: 'uptime', checked_at: { [Op.gte]: sixtySecsAgo } },
  });
  if (recentCheck) {
    console.log(`  [SKIP] ${urlRow.url} — already checked within last 60s`);
    return { status, loadTimeMs, performanceLabel, httpStatusCode, errorMessage, errorType };
  }

  await MonitorCheck.create({
    url_id:            urlRow.id,
    status,
    check_type:        'uptime',
    load_time_ms:      loadTimeMs,
    full_load_ms:      null,
    css_load_ms:       null,
    js_load_ms:        null,
    image_load_ms:     null,
    performance_label: performanceLabel,
    http_status_code:  httpStatusCode,
    error_message:     errorMessage,
    error_type:        errorType,
    checked_at:        new Date(),
  });

  return { status, loadTimeMs, performanceLabel, httpStatusCode, errorMessage, errorType };
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

let isRunning  = false;
let lastRunAt  = 0;
const MIN_INTERVAL_MS = 5 * 60 * 1000; // minimum 5 minutes between runs

async function runAllChecks({ force = false } = {}) {
  if (isRunning) {
    console.log('⏭  Monitor run skipped — previous run still in progress.');
    return;
  }
  const now = Date.now();
  if (!force && now - lastRunAt < MIN_INTERVAL_MS) {
    const waitSec = Math.round((MIN_INTERVAL_MS - (now - lastRunAt)) / 1000);
    console.log(`⏭  Monitor run skipped — last run was ${Math.round((now - lastRunAt)/1000)}s ago (next allowed in ${waitSec}s).`);
    return;
  }
  isRunning = true;
  lastRunAt  = now;
  console.log(`[${new Date().toISOString()}] Starting monitor run…`);

  try {
    const urls = await MonitoredUrl.findAll({ where: { is_active: true, is_deleted: false } });

    if (!urls.length) {
      console.log('No active URLs to check.');
      return;
    }

    // Fetch UptimeRobot monitors once for all URLs (null if no API key)
    let uptimeMonitors = null;
    if (process.env.UPTIMEROBOT_API_KEY) {
      try {
        uptimeMonitors = await fetchUptimeRobotMonitors();
        console.log(`  [UPTIMEROBOT] Fetched ${uptimeMonitors.length} monitors`);
      } catch (err) {
        console.error('  [UPTIMEROBOT] Failed to fetch monitors — skipping run:', err.message);
        return;
      }
    }

    const results = await Promise.allSettled(
      urls.map(async (urlRow) => {
        const result = await checkUrl(urlRow, uptimeMonitors);
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

async function runDailyLoadTimeChecks() {
  console.log(`[${new Date().toISOString()}] Starting daily load time checks…`);
  try {
    const urls = await MonitoredUrl.findAll({ where: { is_active: true, is_deleted: false } });

    if (!urls.length) {
      console.log('No active URLs for load time check.');
      return;
    }

    // Run sequentially with a 3s gap to avoid PageSpeed API rate limits
    const results = [];
    for (const urlRow of urls) {
      // Skip if already checked today (first run only)
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      const alreadyChecked = await MonitorCheck.findOne({
        where: { url_id: urlRow.id, check_type: 'load_time', checked_at: { [Op.gte]: todayStart } },
      });
      if (alreadyChecked) {
        console.log(`  [LOAD] ${urlRow.name} — already checked today, skipping`);
        continue;
      }

      try {
        const metrics = await getPageSpeedMetrics(urlRow.url);
        const performanceLabel = metrics.full_load_ms ? classifyLoadTime(metrics.full_load_ms) : null;

        await MonitorCheck.create({
          url_id:            urlRow.id,
          status:            'up',
          check_type:        'load_time',
          load_time_ms:      metrics.full_load_ms,
          full_load_ms:      metrics.full_load_ms,
          html_load_ms:      metrics.html_load_ms,
          css_load_ms:       metrics.css_load_ms,
          js_load_ms:        metrics.js_load_ms,
          image_load_ms:     metrics.image_load_ms,
          performance_label: performanceLabel,
          http_status_code:  null,
          error_message:     null,
          error_type:        null,
          checked_at:        new Date(),
        });

        console.log(`  [LOAD] ${urlRow.name} — full=${metrics.full_load_ms}ms html=${metrics.html_load_ms}ms css=${metrics.css_load_ms}ms js=${metrics.js_load_ms}ms img=${metrics.image_load_ms}ms`);
        results.push({ urlRow, metrics });
      } catch (err) {
        console.error(`  [LOAD ERROR] ${urlRow.name}:`, err.message);
        await MonitorCheck.create({
          url_id:        urlRow.id,
          status:        'down',
          check_type:    'load_time',
          error_message: err.message,
          checked_at:    new Date(),
        });
      }
      // 3-second gap between requests to avoid rate limiting
      await new Promise(r => setTimeout(r, 3000));
    }

    console.log(`[${new Date().toISOString()}] Daily load time checks complete — ${urls.length} URLs checked.`);
  } catch (err) {
    console.error('Daily load time check failed:', err.message);
  }
}

module.exports = { runAllChecks, runDailyLoadTimeChecks, checkUrl, handleStatusTransition };

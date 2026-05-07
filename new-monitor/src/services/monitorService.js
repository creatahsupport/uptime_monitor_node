const axios     = require('axios');
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

// ── PageSpeed Insights — full page load + resource breakdown ──────────────────

async function getPageSpeedMetrics(pageUrl) {
  try {
    const apiKey   = process.env.PAGESPEED_API_KEY || '';
    const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(pageUrl)}&strategy=desktop&category=performance${apiKey ? `&key=${apiKey}` : ''}`;
    const { data } = await axios.get(endpoint, { timeout: 60000, validateStatus: () => true });
    const audits   = data?.lighthouseResult?.audits || {};

    // Speed Index = how quickly all visible content finishes loading
    const speedIndex = audits['speed-index']?.numericValue;

    // Individual resource timings from network requests
    const networkItems = audits['network-requests']?.details?.items || [];
    const avg = (items) => {
      const durations = items.map(i => (i.endTime || 0) - (i.startTime || 0)).filter(d => d > 0);
      return durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
    };

    return {
      full_load_ms:  speedIndex ? Math.round(speedIndex) : null,
      css_load_ms:   avg(networkItems.filter(r => r.resourceType === 'Stylesheet')),
      js_load_ms:    avg(networkItems.filter(r => r.resourceType === 'Script')),
      image_load_ms: avg(networkItems.filter(r => r.resourceType === 'Image')),
    };
  } catch (err) {
    console.warn(`  [WARN] PageSpeed API failed for ${pageUrl}: ${err.message}`);
    return { full_load_ms: null, css_load_ms: null, js_load_ms: null, image_load_ms: null };
  }
}

async function checkUrl(urlRow) {
  let status         = 'down';
  let httpStatusCode = null;
  let errorMessage   = null;
  let errorType      = null;
  let loadTimeMs     = null;
  let htmlLoadMs     = null;
  let cssLoadMs      = null;
  let jsLoadMs       = null;
  let imageLoadMs    = null;
  let fullLoadMs     = null;
  let lcpMs          = null;

  try {
    const startTime = Date.now();
    // GET full HTML body for cheerio parsing
    const response = await axios.get(urlRow.url, {
      ...BASE_OPTIONS,
      timeout: 15000,
      validateStatus: () => true, // Don't throw on any status code
    });

    htmlLoadMs = Date.now() - startTime;
    loadTimeMs = htmlLoadMs;
    httpStatusCode = response.status;

    // Check for HTTP error status codes
    if (httpStatusCode >= 400) {
      status = 'down';
      errorType = httpStatusCode >= 500 ? 'server_error' : 'client_error';
      errorMessage = `HTTP ${httpStatusCode} ${response.statusText || ''}`.trim();
    } else if (httpStatusCode >= 200 && httpStatusCode < 400) {
      status = 'up';
    } else {
      status = 'down';
      errorType = 'http_error';
      errorMessage = `Unexpected HTTP ${httpStatusCode}`;
    }

  } catch (err) {
    loadTimeMs = Date.now() - (Date.now() - 15000); // Approximate timeout time

    // Categorize different types of errors
    if (err.code === 'ENOTFOUND') {
      errorType = 'dns_error';
      errorMessage = 'DNS resolution failed - domain not found';
    } else if (err.code === 'ECONNREFUSED') {
      errorType = 'connection_refused';
      errorMessage = 'Connection refused - server not accepting connections';
    } else if (err.code === 'ECONNRESET') {
      errorType = 'connection_reset';
      errorMessage = 'Connection reset by server';
    } else if (err.code === 'ETIMEDOUT') {
      errorType = 'timeout';
      errorMessage = 'Connection timed out';
    } else if (err.code === 'CERT_HAS_EXPIRED') {
      errorType = 'ssl_expired';
      errorMessage = 'SSL certificate has expired';
    } else if (err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
      errorType = 'ssl_invalid';
      errorMessage = 'SSL certificate is invalid or untrusted';
    } else if (err.response) {
      // Server responded with error status
      httpStatusCode = err.response.status;
      errorType = httpStatusCode >= 500 ? 'server_error' : 'client_error';
      errorMessage = `HTTP ${httpStatusCode}: ${err.response.statusText || 'Unknown error'}`;
    } else {
      errorType = 'network_error';
      errorMessage = `Network error: ${err.message}`;
    }

    status = 'down';
  }

  // Collect full page load + resource breakdown via PageSpeed API (works on cPanel — never affects up/down status)
  if (status === 'up') {
    const metrics = await getPageSpeedMetrics(urlRow.url);
    fullLoadMs  = metrics.full_load_ms;
    cssLoadMs   = metrics.css_load_ms;
    jsLoadMs    = metrics.js_load_ms;
    imageLoadMs = metrics.image_load_ms;
  }

  const performanceLabel = status === 'up' ? classifyLoadTime(fullLoadMs ?? loadTimeMs) : null;

  await MonitorCheck.create({
    url_id:            urlRow.id,
    status,
    load_time_ms:      loadTimeMs,
    html_load_ms:      htmlLoadMs,
    css_load_ms:       cssLoadMs,
    js_load_ms:        jsLoadMs,
    image_load_ms:     imageLoadMs,
    full_load_ms:      fullLoadMs,
    lcp_ms:            lcpMs,
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

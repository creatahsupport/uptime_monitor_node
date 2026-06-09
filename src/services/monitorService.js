const axios = require("axios");
const puppeteer = require("puppeteer");
const { Op } = require("sequelize");
const {fmtDate} = require("./cliqService");
const {
  MonitoredUrl,
  MonitorCheck,
  Incident,
  InternalRecipient,
} = require("../models");
const emailService = require("./emailService");
require("dotenv").config();

const GOOD_MS = parseInt(process.env.LOAD_TIME_GOOD) || 1000;
const AVERAGE_MS = parseInt(process.env.LOAD_TIME_AVERAGE) || 3000;

function classifyLoadTime(ms) {
  if (ms == null) return null;
  if (ms <= GOOD_MS) return "good";
  if (ms <= AVERAGE_MS) return "average";
  return "bad";
}

function mapErrorTypeToHttpStatus(errorType) {
  const statusMap = {
    dns_error: 404,                  // No connection - domain not found
    connection_refused: 502,         // Bad Gateway - server not accepting connections
    connection_reset: 502,           // Bad Gateway - connection reset
    timeout: 504,                    // Gateway Timeout
    ssl_expired: 495,                // SSL Certificate Error
    server_error: 503,               // Service Unavailable (5xx errors)
    client_error: 400,               // Bad Request (4xx errors)
    network_error: 0,                // No connection - generic network error
    ssl_error: 495,                  // SSL Certificate Error (generic)
  };
  return statusMap[errorType] || 400;
}

const PUPPETEER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--no-first-run",
  "--no-zygote",
  "--disable-extensions",
  "--disable-background-networking",
];

// ── Puppeteer — up/down check (runs every cron tick) ─────────────────────────

async function checkUrl(urlRow) {
  let browser = null;
  let status = "down";
  let httpStatus = null;
  let errorMsg = null;
  let errorType = null;
  let loadTimeMs = null;
  const navStart = Date.now();

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: PUPPETEER_ARGS,
      timeout: 30000,
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    const response = await page.goto(urlRow.url, {
      waitUntil: "load",
      timeout: 60000,
    });
    loadTimeMs = Date.now() - navStart;
    httpStatus = response.status();

    if (httpStatus >= 400) {
      status = "down";
      errorType = httpStatus >= 500 ? "server_error" : "client_error";
      errorMsg = `HTTP ${httpStatus}`;
    } else {
      status = "up";
    }
  } catch (err) {
    loadTimeMs = Date.now() - navStart;
    status = "down";
    const msg = err.message || "";

    if (msg.includes("ERR_NAME_NOT_RESOLVED") || msg.includes("ENOTFOUND")) {
      errorType = "dns_error";
      errorMsg = "DNS resolution failed - domain not found";
    } else if (msg.includes("ERR_CONNECTION_REFUSED")) {
      errorType = "connection_refused";
      errorMsg = "Connection refused - server not accepting connections";
    } else if (msg.includes("ERR_CONNECTION_RESET")) {
      errorType = "connection_reset";
      errorMsg = "Connection reset by server";
    } else if (
      msg.includes("TimeoutError") ||
      msg.includes("Navigation timeout")
    ) {
      errorType = "timeout";
      errorMsg = "Page load timed out";
    } else if (
      msg.includes("ERR_CERT") ||
      msg.includes("SSL") ||
      msg.includes("certificate")
    ) {
      errorType = "ssl_expired";
      errorMsg = "SSL certificate error";
    } else {
      errorType = "network_error";
      errorMsg = `Network error: ${msg}`;
    }
    httpStatus = mapErrorTypeToHttpStatus(errorType);
  } finally {
    if (browser) await browser.close();
  }

  const performanceLabel =
    status === "up" ? classifyLoadTime(loadTimeMs) : null;

  await MonitorCheck.create({
    url_id: urlRow.id,
    status,
    load_time_ms: loadTimeMs,
    html_load_ms: loadTimeMs,
    css_load_ms: null,
    js_load_ms: null,
    image_load_ms: null,
    full_load_ms: null,
    lcp_ms: null,
    performance_label: performanceLabel,
    http_status_code: httpStatus,
    error_message: errorMsg,
    error_type: errorType,
    checked_at: fmtDate(new Date()),
  });

  return {
    status,
    loadTimeMs,
    performanceLabel,
    httpStatusCode: httpStatus,
    errorMessage: errorMsg,
    errorType,
  };
}

// ── PageSpeed API — full load metrics (runs once at midnight) ─────────────────

async function getPageSpeedMetrics(pageUrl) {
  try {
    const apiKey = process.env.PAGESPEED_API_KEY || "";
    const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(pageUrl)}&strategy=desktop&category=performance${apiKey ? `&key=${apiKey}` : ""}`;
    const { data } = await axios.get(endpoint, {
      timeout: 60000,
      validateStatus: () => true,
    });
    const audits = data?.lighthouseResult?.audits || {};

    const speedIndex = audits["speed-index"]?.numericValue;
    const networkItems = audits["network-requests"]?.details?.items || [];

    const avg = (items) => {
      const durations = items
        .map((i) => (i.endTime || 0) - (i.startTime || 0))
        .filter((d) => d > 0);
      return durations.length
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : null;
    };

    return {
      full_load_ms: speedIndex ? Math.round(speedIndex) : null,
      css_load_ms: avg(
        networkItems.filter((r) => r.resourceType === "Stylesheet"),
      ),
      js_load_ms: avg(networkItems.filter((r) => r.resourceType === "Script")),
      image_load_ms: avg(
        networkItems.filter((r) => r.resourceType === "Image"),
      ),
    };
  } catch (err) {
    console.warn(
      `  [WARN] PageSpeed API failed for ${pageUrl}: ${err.message}`,
    );
    return {
      full_load_ms: null,
      css_load_ms: null,
      js_load_ms: null,
      image_load_ms: null,
    };
  }
}

let isPageSpeedRunning = false;

async function runPageSpeedChecks() {
  if (isPageSpeedRunning) {
    console.log("⏭  PageSpeed run skipped — previous run still in progress.");
    return;
  }
  isPageSpeedRunning = true;
  console.log(`[${new Date().toISOString()}] Starting nightly PageSpeed run…`);

  try {
    const urls = await MonitoredUrl.findAll({
      where: { is_active: true, is_deleted: false, current_status: "up" },
    });

    if (!urls.length) {
      console.log("No active UP URLs for PageSpeed check.");
      return;
    }

    for (const urlRow of urls) {
      const metrics = await getPageSpeedMetrics(urlRow.url);
      const performanceLabel = classifyLoadTime(metrics.full_load_ms);

      await MonitorCheck.create({
        url_id: urlRow.id,
        status: "up",
        load_time_ms: metrics.full_load_ms,
        html_load_ms: null,
        css_load_ms: metrics.css_load_ms,
        js_load_ms: metrics.js_load_ms,
        image_load_ms: metrics.image_load_ms,
        full_load_ms: metrics.full_load_ms,
        lcp_ms: null,
        performance_label: performanceLabel,
        http_status_code: null,
        error_message: null,
        error_type: null,
        checked_at: fmtDate(new Date()),
      });

      console.log(
        `  [PAGESPEED] ${urlRow.name} — full: ${metrics.full_load_ms}ms | css: ${metrics.css_load_ms}ms | js: ${metrics.js_load_ms}ms | img: ${metrics.image_load_ms}ms`,
      );
    }

    console.log(
      `[${new Date().toISOString()}] Nightly PageSpeed run complete — ${urls.length} URLs checked.`,
    );
  } finally {
    isPageSpeedRunning = false;
  }
}

// ── Status transition + alerting ──────────────────────────────────────────────

const CONFIRM_FAILURES = 2;

async function handleStatusTransition(urlRow, newStatus, result) {
  const prevStatus = urlRow.current_status;

  if (newStatus === "down") {
    const failures = (urlRow.consecutive_failures || 0) + 1;
    await urlRow.update({
      consecutive_failures: failures,
      current_status: "down",
      last_checked_at: new Date(),
    });

    if (failures < CONFIRM_FAILURES) {
      console.log(
        `  [WARN] ${urlRow.name} failed (${failures}/${CONFIRM_FAILURES}) — waiting for confirmation`,
      );
      return "failure_pending";
    }

    const existingIncident = await Incident.findOne({
      where: { url_id: urlRow.id, resolved_at: null },
    });
    if (existingIncident) return "still_down";

    const incident = await Incident.create({
      url_id: urlRow.id,
      started_at: new Date(),
    });

    try {
      console.log(
        `[ALERT] Sending downtime alert for ${urlRow.name} to ${urlRow.client_email}`,
      );
      await emailService.sendDowntimeAlert({
        clientEmail: urlRow.client_email,
        url: urlRow.url,
        detectedAt: fmtDate(new Date()),
        httpStatus: result.httpStatusCode,
        errorMessage: result.errorMessage,
      });
      await incident.update({ notified_client: true });
      console.log(
        `[ALERT] Downtime alert sent successfully to ${urlRow.client_email}`,
      );
    } catch (e) {
      console.error(
        `[ALERT ERROR] Failed to send downtime alert for ${urlRow.name}:`,
        e,
      );
    }

    return "down_started";
  }

  await urlRow.update({
    consecutive_failures: 0,
    current_status: "up",
    last_checked_at: new Date(),
  });

  if (prevStatus === "down") {
    const incident = await Incident.findOne({
      where: { url_id: urlRow.id, resolved_at: null },
      order: [["started_at", "DESC"]],
    });

    if (incident) {
      const durationMinutes = Math.round(
        (Date.now() - new Date(incident.started_at).getTime()) / 60000,
      );
      await incident.update({
        resolved_at: new Date(),
        duration_minutes: durationMinutes,
      });

      try {
        await emailService.sendRecoveryAlert({
          clientEmail: urlRow.client_email,
          url: urlRow.url,
          recoveredAt: fmtDate(new Date()),
        });
      } catch (e) {
        console.error("Failed to send recovery alert:", e.message);
      }
    }

    return "recovered";
  }

  return "unchanged";
}

let isRunning = false;

async function runAllChecks() {
  if (isRunning) {
    console.log("⏭  Monitor run skipped — previous run still in progress.");
    return;
  }
  isRunning = true;
  console.log(`[${new Date().toISOString()}] Starting monitor run…`);

  try {
    const urls = await MonitoredUrl.findAll({
      where: { is_active: true, is_deleted: false },
    });

    if (!urls.length) {
      console.log("No active URLs to check.");
      return;
    }

    // Sequential — avoid launching multiple Chrome instances simultaneously
    const results = [];
    for (const urlRow of urls) {
      try {
        const result = await checkUrl(urlRow);
        const transition = await handleStatusTransition(
          urlRow,
          result.status,
          result,
        );
        console.log(
          `  [${result.status.toUpperCase()}] ${urlRow.name} — HTTP ${result.httpStatusCode ?? "ERR"} — ${result.loadTimeMs}ms — ${transition}`,
        );
        results.push({ status: "fulfilled", value: { urlRow, result } });
      } catch (err) {
        console.error(`  Check error for ${urlRow.name}:`, err.message);
        results.push({ status: "rejected", reason: err });
      }
    }

    const failures = results
      .filter(
        (r) => r.status === "fulfilled" && r.value.result.status === "down",
      )
      .map((r) => ({
        name: r.value.urlRow.name,
        url: r.value.urlRow.url,
        detected_at: fmtDate(new Date())  ,
      }));

    if (failures.length) {
      try {
        const recipients = await InternalRecipient.findAll({
          attributes: ["email"],
        });
        const emails = recipients.map((r) => r.email);
        if (emails.length) {
          await emailService.sendInternalFailureSummary({
            recipients: emails,
            failures,
          });
          console.log(
            `  Internal summary sent to ${emails.length} recipient(s).`,
          );
        }
      } catch (e) {
        console.error("  Failed to send internal summary:", e.message);
      }
    }

    console.log(
      `[${new Date().toISOString()}] Run complete — ${urls.length} checked, ${failures.length} down.`,
    );
  } finally {
    isRunning = false;
  }
}

async function runDailyLoadTimeChecks() {
  console.log(`[${new Date().toISOString()}] Starting daily load time checks…`);
  try {
    const urls = await MonitoredUrl.findAll({
      where: { is_active: true, is_deleted: false, is_paused: false },
    });

    if (!urls.length) {
      console.log("No active URLs for load time check.");
      return;
    }

    // Run sequentially with a 3s gap to avoid PageSpeed API rate limits
    const results = [];
    for (const urlRow of urls) {
      // Skip if already checked today (first run only)
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const alreadyChecked = await MonitorCheck.findOne({
        where: {
          url_id: urlRow.id,
          check_type: "load_time",
          checked_at: { [Op.gte]: todayStart },
        },
      });
      if (alreadyChecked) {
        console.log(
          `  [LOAD] ${urlRow.name} — already checked today, skipping`,
        );
        continue;
      }

      try {
        const metrics = await getPageSpeedMetrics(urlRow.url);
        const performanceLabel = metrics.full_load_ms
          ? classifyLoadTime(metrics.full_load_ms)
          : null;

        await MonitorCheck.create({
          url_id: urlRow.id,
          status: "up",
          check_type: "load_time",
          load_time_ms: metrics.full_load_ms,
          full_load_ms: metrics.full_load_ms,
          html_load_ms: metrics.html_load_ms,
          css_load_ms: metrics.css_load_ms,
          js_load_ms: metrics.js_load_ms,
          image_load_ms: metrics.image_load_ms,
          performance_label: performanceLabel,
          http_status_code: null,
          error_message: null,
          error_type: null,
          checked_at: fmtDate(new Date()),
        });

        console.log(
          `  [LOAD] ${urlRow.name} — full=${metrics.full_load_ms}ms html=${metrics.html_load_ms}ms css=${metrics.css_load_ms}ms js=${metrics.js_load_ms}ms img=${metrics.image_load_ms}ms`,
        );
        results.push({ urlRow, metrics });
      } catch (err) {
        console.error(`  [LOAD ERROR] ${urlRow.name}:`, err.message);
        await MonitorCheck.create({
          url_id: urlRow.id,
          status: "down",
          check_type: "load_time",
          error_message: err.message,
          checked_at: fmtDate(new Date()),
        });
      }
      // 3-second gap between requests to avoid rate limiting
      await new Promise((r) => setTimeout(r, 3000));
    }

    console.log(
      `[${new Date().toISOString()}] Daily load time checks complete — ${urls.length} URLs checked.`,
    );
  } catch (err) {
    console.error("Daily load time check failed:", err.message);
  }
}

module.exports = {
  runAllChecks,
  runDailyLoadTimeChecks,
  runPageSpeedChecks,
  checkUrl,
  handleStatusTransition,
};

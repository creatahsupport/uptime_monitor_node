const axios = require('axios');
const { Op } = require('sequelize');
const { MonitoredUrl, MonitorCheck, Incident, InternalRecipient } = require('../models');
const emailService = require('./emailService');
require('dotenv').config();

const GOOD_MS    = parseInt(process.env.LOAD_TIME_GOOD)    || 1000;
const AVERAGE_MS = parseInt(process.env.LOAD_TIME_AVERAGE) || 3000;

function classifyLoadTime(ms) {
  if (ms == null) return null;
  if (ms <= GOOD_MS)    return 'good';
  if (ms <= AVERAGE_MS) return 'average';
  return 'bad';
}

async function checkUrl(urlRow) {
  const start = Date.now();
  let status          = 'down';
  let loadTimeMs      = null;
  let httpStatusCode  = null;
  let errorMessage    = null;

  try {
    const response = await axios.get(urlRow.url, {
      timeout: 15000,
      validateStatus: s => s < 500,
    });
    if (response.status < 400) {
      status        = 'up';
      loadTimeMs    = Date.now() - start;
      httpStatusCode = response.status;
    } else {
      httpStatusCode = response.status;
      errorMessage   = `HTTP ${response.status}`;
    }
  } catch (err) {
    errorMessage = err.message.slice(0, 255);
    loadTimeMs   = Date.now() - start;
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

  const failures = [];

  for (const urlRow of urls) {
    try {
      const result     = await checkUrl(urlRow);
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

module.exports = { runAllChecks, checkUrl };

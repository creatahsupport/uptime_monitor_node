const cron = require("node-cron");
const moment = require("moment");

const { MonitoredUrl, Setting } = require("../models");
const expiryService = require("../services/expiryService");
const { sendSSLExpiryAlert, sendDomainExpiryAlert } = require("../services/emailService");
const { sendExpiryReport } = require("../services/cliqService");

const runExpiryCheck = async () => {
  try {
    console.log("Running Expiry Check Job...");

    // Read alert thresholds from DB settings
    const [sslSetting, domainSetting] = await Promise.all([
      Setting.findOne({ where: { key: "ssl_warn_days" } }),
      Setting.findOne({ where: { key: "domain_warn_days" } }),
    ]);
    const SSL_THRESHOLD    = parseInt(sslSetting?.value)    || 30;
    const DOMAIN_THRESHOLD = parseInt(domainSetting?.value) || 30;

    console.log(`[EXPIRY] Thresholds — SSL: ${SSL_THRESHOLD} days | Domain: ${DOMAIN_THRESHOLD} days`);

    const urls = await MonitoredUrl.findAll({
      where: { is_active: true, is_deleted: false },
    });

    const sslAlerts    = [];
    const domainAlerts = [];

    for (const urlRecord of urls) {
      const domain = new URL(urlRecord.url).hostname;
      await new Promise((resolve) => setTimeout(resolve, 5000));

      let sslExpiryDate    = null;
      let sslIssuer        = null;
      let sslDaysLeft      = null;
      let domainExpiryDate = null;
      let domainDaysLeft   = null;

      try {
        const sslData = await expiryService.checkSSL(domain);
        sslExpiryDate = sslData.sslExpiryDate;
        sslIssuer     = sslData.sslIssuer;
        sslDaysLeft   = moment(sslExpiryDate).diff(moment(), "days");
      } catch (err) {
        console.log(`[EXPIRY] SSL check failed for ${domain}: ${err.message}`);
      }

      try {
        const domainData = await expiryService.checkDomain(domain);
        domainExpiryDate = domainData.domainExpiryDate;
        domainDaysLeft   = domainExpiryDate ? moment(domainExpiryDate).diff(moment(), "days") : null;
      } catch (err) {
        console.log(`[EXPIRY] Domain check failed for ${domain}: ${err.message}`);
      }

      try {
        await urlRecord.update({
          ssl_expiry_date:        sslExpiryDate,
          ssl_issuer:             sslIssuer,
          ssl_days_remaining:     sslDaysLeft,
          domain_expiry_date:     domainExpiryDate,
          domain_days_remaining:  domainDaysLeft,
          last_expiry_checked_at: new Date(),
        });
        console.log(`[EXPIRY] Updated: ${domain} | SSL: ${sslDaysLeft ?? 'N/A'} days | Domain: ${domainDaysLeft ?? 'N/A'} days`);
      } catch (err) {
        console.log(`[EXPIRY] DB update failed for ${domain}: ${err.message}`);
      }

      // SSL expiry alert — send every time cron runs if within threshold
      if (sslDaysLeft !== null && sslDaysLeft <= SSL_THRESHOLD) {
        let emailOk = false;
        try {
          await sendSSLExpiryAlert({
            clientEmail:   urlRecord.client_email,
            url:           urlRecord.url,
            sslExpiryDate: sslExpiryDate,
            daysRemaining: sslDaysLeft,
            sslIssuer:     sslIssuer,
          });
          emailOk = true;
          console.log(`[EXPIRY] SSL email sent to ${urlRecord.client_email} for ${domain} (${sslDaysLeft} days left)`);
        } catch (err) {
          console.error(`[EXPIRY] SSL email FAILED for ${domain} → ${urlRecord.client_email}: ${err.message}`);
        }

        sslAlerts.push({
          domain:        domain,
          daysRemaining: sslDaysLeft,
          expiryDate:    new Date(sslExpiryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        });

        if (emailOk) await urlRecord.update({ ssl_alert_sent_at: new Date() });
      }

      // Domain expiry alert — send every time cron runs if within threshold
      if (domainDaysLeft !== null && domainDaysLeft <= DOMAIN_THRESHOLD) {
        let emailOk = false;
        try {
          await sendDomainExpiryAlert({
            clientEmail:      urlRecord.client_email,
            url:              urlRecord.url,
            domainExpiryDate: domainExpiryDate,
            daysRemaining:    domainDaysLeft,
          });
          emailOk = true;
          console.log(`[EXPIRY] Domain email sent to ${urlRecord.client_email} for ${domain} (${domainDaysLeft} days left)`);
        } catch (err) {
          console.error(`[EXPIRY] Domain email FAILED for ${domain} → ${urlRecord.client_email}: ${err.message}`);
        }

        domainAlerts.push({
          domain:        domain,
          daysRemaining: domainDaysLeft,
          expiryDate:    new Date(domainExpiryDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
        });

        if (emailOk) await urlRecord.update({ domain_alert_sent_at: new Date() });
      }
    }

    // Send ONE consolidated Cliq message for all expiry alerts
    if (sslAlerts.length > 0 || domainAlerts.length > 0) {
      await sendExpiryReport({ sslAlerts, domainAlerts });
    }

  } catch (error) {
    console.log("Expiry Job Failed:", error.message);
  }
};

let expiryTask = null;

function scheduleExpiryJob(cronTime) {
  if (expiryTask) expiryTask.stop();
  expiryTask = cron.schedule(cronTime, async () => {
    await runExpiryCheck();
  });
  console.log(`Expiry Cron Job scheduled: "${cronTime}"`);
}

const startExpiryJob = async () => {
  const setting  = await Setting.findOne({ where: { key: "expiry_cron_time" } });
  const cronTime = setting?.value || "0 9 * * *";
  scheduleExpiryJob(cronTime);
};

async function rescheduleExpiryJob(newSchedule) {
  await Setting.upsert({ key: "expiry_cron_time", value: newSchedule });
  scheduleExpiryJob(newSchedule);
}

module.exports = { startExpiryJob, runExpiryCheck, rescheduleExpiryJob };

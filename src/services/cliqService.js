const axios = require("axios");

const WEBHOOK_URL = process.env.ZOHO_CLIQ_WEBHOOK_URL; // expiry alerts

function fmtDate(d) {
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

async function sendCliqMessage(webhookUrl, text) {
  if (!webhookUrl) {
    console.warn("[CLIQ] Webhook URL not set — skipping notification");
    return;
  }

  const res = await axios.post(
    webhookUrl,
    { text },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    },
  );

  if (res.status !== 200) {
    throw new Error(
      `Cliq responded with ${res.status}: ${JSON.stringify(res.data)}`,
    );
  }
}

async function sendDowntimeAlert({
  url,
  detectedAt,
  httpStatus,
  errorMessage,
}) {
  const text =
    `🔴 WEBSITE DOWN ALERT\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🌐 URL: ${url}\n` +
    `📅 Detected At: ${fmtDate(detectedAt)}\n` +
    `🔢 HTTP Status: ${httpStatus || "N/A"}\n` +
    `❌ Error: ${errorMessage || "Unknown error"}`;

  try {
    await sendCliqMessage(WEBHOOK_URL, text);
    console.log(`[CLIQ] Downtime alert sent for ${url}`);
  } catch (err) {
    const detail = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;
    console.error(`[CLIQ ERROR] Downtime alert failed for ${url}: ${detail}`);
  }
}

async function sendRecoveryAlert({ url, recoveredAt }) {
  const text =
    `✅ WEBSITE RECOVERED\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🌐 URL: ${url}\n` +
    `📅 Recovered At: ${fmtDate(recoveredAt)}`;

  try {
    await sendCliqMessage(WEBHOOK_URL, text);
    console.log(`[CLIQ] Recovery alert sent for ${url}`);
  } catch (err) {
    const detail = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;
    console.error(`[CLIQ ERROR] Recovery alert failed for ${url}: ${detail}`);
  }
}

async function sendSSLExpiryAlert({
  url,
  sslExpiryDate,
  daysRemaining,
  sslIssuer,
}) {
  const icon = daysRemaining <= 7 ? "🚨" : daysRemaining <= 30 ? "⚠️" : "🔔";
  const level =
    daysRemaining <= 7
      ? "CRITICAL"
      : daysRemaining <= 30
        ? "WARNING"
        : "NOTICE";
  const hostname = new URL(url).hostname;

  const text =
    `${icon} SSL CERTIFICATE EXPIRY ${level}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🌐 Domain: ${hostname}\n` +
    `🏢 Issuer: ${sslIssuer || "Unknown"}\n` +
    `📅 Expires On: ${new Date(sslExpiryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}\n` +
    `⏳ Days Remaining: ${daysRemaining} days\n` +
    `🔗 URL: ${url}`;

  try {
    await sendCliqMessage(WEBHOOK_URL, text);
    console.log(
      `[CLIQ] SSL expiry alert sent for ${hostname} (${daysRemaining} days left)`,
    );
  } catch (err) {
    const detail = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;
    console.error(
      `[CLIQ ERROR] SSL expiry alert failed for ${hostname}: ${detail}`,
    );
  }
}

async function sendDomainExpiryAlert({ url, domainExpiryDate, daysRemaining }) {
  const icon = daysRemaining <= 7 ? "🚨" : daysRemaining <= 30 ? "⚠️" : "🔔";
  const level =
    daysRemaining <= 7
      ? "CRITICAL"
      : daysRemaining <= 30
        ? "WARNING"
        : "NOTICE";
  const hostname = new URL(url).hostname;

  const text =
    `${icon} DOMAIN EXPIRY ${level}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🌐 Domain: ${hostname}\n` +
    `📅 Expires On: ${new Date(domainExpiryDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}\n` +
    `⏳ Days Remaining: ${daysRemaining} days\n` +
    `🔗 URL: ${url}`;

  try {
    await sendCliqMessage(WEBHOOK_URL, text);
    console.log(
      `[CLIQ] Domain expiry alert sent for ${hostname} (${daysRemaining} days left)`,
    );
  } catch (err) {
    const detail = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;
    console.error(
      `[CLIQ ERROR] Domain expiry alert failed for ${hostname}: ${detail}`,
    );
  }
}

async function sendExpiryReport({ sslAlerts, domainAlerts }) {
  const lines = [
    `EXPIRY STATUS ALERT`,
    ``,
    `Generated At:  ${fmtDate(new Date())}`,
  ];

  if (sslAlerts.length > 0) {
    lines.push(
      `\n SSL CERTIFICATE EXPIRY (${sslAlerts.length} Site's ${sslAlerts.length > 1 ? "s" : ""})`,
    );
    lines.push(" ");
    sslAlerts.forEach((a, i) => {
      const icon =
        a.daysRemaining <= 7 ? "🚨" : a.daysRemaining <= 30 ? "⚠️" : "🔔";
      lines.push(
        `${i + 1}. ${icon} ${a.domain} — ${a.daysRemaining} days (Exp: ${a.expiryDate})`,
      );
    });
  }

  if (domainAlerts.length > 0) {
    lines.push(
      `\n DOMAIN EXPIRY (${domainAlerts.length} Domain ${domainAlerts.length > 1 ? "'s" : ""})`,
    );
    lines.push(" ");
    domainAlerts.forEach((a, i) => {
      const icon =
        a.daysRemaining <= 7 ? "🚨" : a.daysRemaining <= 30 ? "⚠️" : "🔔";
      lines.push(
        `${i + 1}. ${icon} ${a.domain} — ${a.daysRemaining} days (Exp: ${a.expiryDate})`,
      );
    });
  }

  try {
    await sendCliqMessage(WEBHOOK_URL, lines.join("\n"));
    console.log(
      `[CLIQ] Expiry report sent — SSL: ${sslAlerts.length}, Domain: ${domainAlerts.length}`,
    );
  } catch (err) {
    const detail = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;
    console.error(`[CLIQ ERROR] Expiry report failed: ${detail}`);
  }
}

async function sendDowntimeSummary(failures) {
  const timestamp = fmtDate(new Date());
  const formattedDate = timestamp
    .toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
    .replace(",", "");

  const lines = [
    "",
    " WEBSITE DOWNTIME ALERT ",
    "",
    `Generated At : ${formattedDate}`,
    `Sites Down : ${failures.length}`,
    "",
  ];

  lines.push(
    "Below is the summary of websites that are currently down. Please investigate the issues and take necessary actions to restore their uptime.",
    "",
  );

  failures.forEach((f, index) => {
    lines.push(
      `[${index + 1}] ${f.url}`,
      `Status : ${f.httpStatus || "N/A"}`,
      `Error  : ${f.errorMessage || "Connection Failed"}`,
      "",
    );
  });

  try {
    await sendCliqMessage(WEBHOOK_URL, lines.join("\n"));
    console.log(
      `[CLIQ] Downtime summary sent — ${failures.length} site(s) down`,
    );
  } catch (err) {
    const detail = err.response?.data
      ? JSON.stringify(err.response.data)
      : err.message;
    console.error(`[CLIQ ERROR] Downtime summary failed: ${detail}`);
  }
}

module.exports = {
  sendDowntimeAlert,
  sendRecoveryAlert,
  sendSSLExpiryAlert,
  sendDomainExpiryAlert,
  sendExpiryReport,
  sendDowntimeSummary,
};

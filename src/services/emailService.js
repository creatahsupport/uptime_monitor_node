const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

transporter.verify((error, success) => {
  if (error) {
    console.error('❌ SMTP Transporter Error:', error);
  } else {
    console.log('✅ SMTP Transporter is ready to deliver messages');
  }
});

const FROM = `"${process.env.EMAIL_FROM_NAME || 'Uptime Monitor'}" <${process.env.EMAIL_FROM_ADDRESS}>`;

// ── Client: site is DOWN ──────────────────────────────────────────────────────
async function sendDowntimeAlert({ clientEmail, urlName, url, detectedAt }) {
  await transporter.sendMail({
    from: FROM,
    to: clientEmail,
    subject: `🔴 [Creatah Monitor] Site DOWN: ${urlName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <div style="background:#dc2626;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0">
          <h2 style="margin:0">⚠️ Your website is DOWN</h2>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
          <p style="font-size:16px;color:#374151">We detected that your website is <strong>unreachable</strong>.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;color:#6b7280;width:140px">Website</td><td style="padding:8px;font-weight:600">${urlName}</td></tr>
            <tr style="background:#f9fafb"><td style="padding:8px;color:#6b7280">URL</td><td style="padding:8px"><a href="${url}" style="color:#2563eb">${url}</a></td></tr>
            <tr><td style="padding:8px;color:#6b7280">Detected at</td><td style="padding:8px">${new Date(detectedAt).toUTCString()}</td></tr>
          </table>
          <p style="color:#374151">Please investigate as soon as possible. We will notify you again once the site recovers.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
          <p style="color:#9ca3af;font-size:12px">Uptime Monitor — automated alert</p>
        </div>
      </div>`,
  });
}

// ── Client: site has RECOVERED ────────────────────────────────────────────────
async function sendRecoveryAlert({ clientEmail, urlName, url, recoveredAt, downtimeMinutes }) {
  const dur = downtimeMinutes
    ? `${Math.floor(downtimeMinutes / 60)}h ${downtimeMinutes % 60}m`
    : 'unknown';

  await transporter.sendMail({
    from: FROM,
    to: clientEmail,
    subject: `✅ [Creatah Monitor] Site Recovered: ${urlName}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <div style="background:#16a34a;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0">
          <h2 style="margin:0">✅ Your website is back ONLINE</h2>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
          <p style="font-size:16px;color:#374151">Great news — your website has <strong>recovered</strong> and is now reachable.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;color:#6b7280;width:140px">Website</td><td style="padding:8px;font-weight:600">${urlName}</td></tr>
            <tr style="background:#f9fafb"><td style="padding:8px;color:#6b7280">URL</td><td style="padding:8px"><a href="${url}" style="color:#2563eb">${url}</a></td></tr>
            <tr><td style="padding:8px;color:#6b7280">Recovered at</td><td style="padding:8px">${new Date(recoveredAt).toUTCString()}</td></tr>
            <tr style="background:#f9fafb"><td style="padding:8px;color:#6b7280">Total downtime</td><td style="padding:8px">${dur}</td></tr>
          </table>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
          <p style="color:#9ca3af;font-size:12px">Uptime Monitor — automated alert</p>
        </div>
      </div>`,
  });
}

// ── Internal: failure summary ─────────────────────────────────────────────────
async function sendInternalFailureSummary({ recipients, failures }) {
  if (!recipients.length || !failures.length) return;

  const rows = failures
    .map(
      f => `<tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb">${f.name}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb"><a href="${f.url}" style="color:#2563eb">${f.url}</a></td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb">${new Date(f.detected_at).toUTCString()}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;color:#dc2626">DOWN</td>
      </tr>`
    )
    .join('');

  await transporter.sendMail({
    from: FROM,
    to: recipients.join(', '),
    subject: `🔴 [Internal Alert] ${failures.length} site(s) down`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:24px">
        <div style="background:#1e3a5f;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0">
          <h2 style="margin:0">Internal Uptime Alert — ${failures.length} failure(s) detected</h2>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:#f3f4f6">
                <th style="padding:8px;text-align:left">Name</th>
                <th style="padding:8px;text-align:left">URL</th>
                <th style="padding:8px;text-align:left">Detected At</th>
                <th style="padding:8px;text-align:left">Status</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
          <p style="color:#9ca3af;font-size:12px">Uptime Monitor — internal team summary</p>
        </div>
      </div>`,
  });
}

// ── Client: Automated Monthly Report ──────────────────────────────────────────
async function sendMonthlyReport({ clientEmail, urlName, month, pdfBuffer }) {
  await transporter.sendMail({
    from: FROM,
    to: clientEmail,
    subject: `📊 [Creatah Monitor] Monthly Report: ${urlName} (${month})`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <div style="background:#1E65B5;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0">
          <h2 style="margin:0">📊 Monthly Availability Report</h2>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 8px 8px">
          <p style="font-size:16px;color:#374151">Hello,</p>
          <p style="font-size:16px;color:#374151">We've generated the comprehensive monthly uptime and performance report for <strong>${urlName}</strong> covering <strong>${month}</strong>.</p>
          <p style="color:#374151">Please find the detailed PDF report attached to this email.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
          <p style="color:#9ca3af;font-size:12px">Uptime Monitor — automated reporting system</p>
        </div>
      </div>`,
    attachments: [
      {
        filename: `Website-Report-${urlName.replace(/[^a-z0-9]/gi, '_')}-${month}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  });
}

module.exports = { sendDowntimeAlert, sendRecoveryAlert, sendInternalFailureSummary, sendMonthlyReport };

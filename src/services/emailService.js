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

transporter.verify((error) => {
  if (error) console.error('❌ SMTP Transporter Error:', error);
  else        console.log('✅ SMTP Transporter is ready to deliver messages');
});

const FROM = `"${process.env.EMAIL_FROM_NAME || 'Website Monitor - Creatah'}" <${process.env.EMAIL_FROM_ADDRESS}>`;

function fmtDate(d) {
  return new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });
}

// ── Shared outer wrapper ──────────────────────────────────────────────────────
function emailWrapper(header, banner, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f0ede8;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0ede8;padding:32px 16px;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
      <tr><td>${header}</td></tr>
      <tr><td>${banner}</td></tr>
      <tr><td style="background:#ffffff;border:1px solid #e8e8e8;border-top:none;">${body}</td></tr>
      <tr><td style="background:#f2f2f2;padding:13px 32px;text-align:center;border-top:1px solid #ddd;border-radius:0 0 8px 8px;">
        <p style="margin:0;font-size:12px;color:#999;font-family:Arial,sans-serif;">Website Availability Monitor &bull; Creatah Software Technologies</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Client: site is DOWN ──────────────────────────────────────────────────────
async function sendDowntimeAlert({ clientEmail, url, detectedAt, httpStatus, errorMessage }) {
  const header = `
    <div style="background:#a32d2d;padding:24px 32px;text-align:center;border-radius:8px 8px 0 0;">
      <p style="color:#fcebeb;font-size:18px;font-weight:bold;font-family:Arial,sans-serif;margin:0;">&#9888; Website Down Alert</p>
      <p style="color:#f09595;font-size:12px;margin:6px 0 0;font-family:Arial,sans-serif;">Creatah Software Technologies &bull; Automated Monitor</p>
    </div>`;

  const banner = `
    <div style="background:#fcebeb;padding:11px 32px;border-left:4px solid #a32d2d;">
      <span style="color:#791f1f;font-size:13px;font-weight:bold;font-family:Arial,sans-serif;">Your website is currently DOWN or unreachable.</span>
    </div>`;

  const body = `
    <div style="padding:26px 32px;font-family:Arial,sans-serif;">
      <p style="color:#333;font-size:14px;margin:0 0 8px;">Dear Customer,</p>
      <p style="color:#555;font-size:13px;line-height:1.65;margin:0 0 20px;">
        Our monitoring system has detected that your website is currently
        <strong style="color:#a32d2d;">DOWN</strong>.
        We are notifying you so that you can take immediate action.
      </p>

      <p style="color:#333;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:.6px;margin:0 0 8px;font-family:Arial,sans-serif;">Incident Details</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:22px;font-size:12px;font-family:Arial,sans-serif;">
        <tr>
          <td style="padding:9px 12px;border:1px solid #ddd;color:#555;font-weight:bold;width:35%;background:#f2f2f2;">URL</td>
          <td style="padding:9px 12px;border:1px solid #ddd;color:#333;"><a href="${url}" style="color:#185fa5;">${url}</a></td>
        </tr>
        <tr style="background:#f9f9f9;">
          <td style="padding:9px 12px;border:1px solid #ddd;color:#555;font-weight:bold;background:#f2f2f2;">Status</td>
          <td style="padding:9px 12px;border:1px solid #ddd;">
            <span style="background:#a32d2d;color:#fff;padding:2px 9px;border-radius:12px;font-size:11px;">${httpStatus || 'ERR'}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:9px 12px;border:1px solid #ddd;color:#555;font-weight:bold;background:#f2f2f2;">Detected At</td>
          <td style="padding:9px 12px;border:1px solid #ddd;color:#333;">${fmtDate(detectedAt)}</td>
        </tr>
        ${errorMessage ? `<tr style="background:#f9f9f9;">
          <td style="padding:9px 12px;border:1px solid #ddd;color:#555;font-weight:bold;background:#f2f2f2;">Error</td>
          <td style="padding:9px 12px;border:1px solid #ddd;color:#a32d2d;">${errorMessage}</td>
        </tr>` : ''}
      </table>

      <div style="background:#fff8f8;border-radius:6px;border:1px solid #f5c6c6;padding:14px 18px;margin-bottom:10px;">
        <p style="margin:0 0 5px;font-size:12px;color:#a32d2d;font-weight:bold;font-family:Arial,sans-serif;">&#9888; Action Required</p>
        <p style="margin:0;font-size:12px;color:#555;line-height:1.6;font-family:Arial,sans-serif;">
          Please check your hosting provider or server and take steps to restore your website as soon as possible.
        </p>
      </div>
      <p style="margin:10px 0 0;font-size:11px;color:#999;font-family:Arial,sans-serif;">This is an automated alert. Do not reply to this email.</p>
    </div>`;

  await transporter.sendMail({
    from: FROM,
    to: clientEmail,
    subject: `[ALERT] Your website is currently DOWN | ${fmtDate(detectedAt)}`,
    html: emailWrapper(header, banner, body),
  });
}

// ── Client: site has RECOVERED ────────────────────────────────────────────────
async function sendRecoveryAlert({ clientEmail, url, recoveredAt }) {
  const header = `
    <div style="background:#1d6e4e;padding:24px 32px;text-align:center;border-radius:8px 8px 0 0;">
      <p style="color:#eafaf4;font-size:18px;font-weight:bold;font-family:Arial,sans-serif;margin:0;">&#10003; Website Resolved</p>
      <p style="color:#a3d9c2;font-size:12px;margin:6px 0 0;font-family:Arial,sans-serif;">Creatah Software Technologies &bull; Automated Monitor</p>
    </div>`;

  const banner = `
    <div style="background:#eafaf4;padding:11px 32px;border-left:4px solid #1d6e4e;">
      <span style="color:#0f5132;font-size:13px;font-weight:bold;font-family:Arial,sans-serif;">Good news! Your website is back UP and responding normally.</span>
    </div>`;

  const body = `
    <div style="padding:26px 32px;font-family:Arial,sans-serif;">
      <p style="color:#333;font-size:14px;margin:0 0 8px;">Dear Customer,</p>
      <p style="color:#555;font-size:13px;line-height:1.65;margin:0 0 20px;">
        We are pleased to inform you that your website is back
        <strong style="color:#1d6e4e;">ONLINE</strong>
        and responding normally. No further action is required at this time.
      </p>

      <p style="color:#333;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:.6px;margin:0 0 8px;font-family:Arial,sans-serif;">Resolution Details</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:22px;font-size:12px;font-family:Arial,sans-serif;">
        <tr>
          <td style="padding:9px 12px;border:1px solid #ddd;color:#555;font-weight:bold;width:35%;background:#f2f2f2;">URL</td>
          <td style="padding:9px 12px;border:1px solid #ddd;color:#333;"><a href="${url}" style="color:#185fa5;">${url}</a></td>
        </tr>
        <tr style="background:#f9f9f9;">
          <td style="padding:9px 12px;border:1px solid #ddd;color:#555;font-weight:bold;background:#f2f2f2;">Status</td>
          <td style="padding:9px 12px;border:1px solid #ddd;">
            <span style="background:#1d6e4e;color:#fff;padding:2px 9px;border-radius:12px;font-size:11px;">UP</span>
          </td>
        </tr>
        <tr>
          <td style="padding:9px 12px;border:1px solid #ddd;color:#555;font-weight:bold;background:#f2f2f2;">Resolved At</td>
          <td style="padding:9px 12px;border:1px solid #ddd;color:#333;">${fmtDate(recoveredAt)}</td>
        </tr>
      </table>

      <div style="background:#f0fdf8;border-radius:6px;border:1px solid #b7e4d0;padding:14px 18px;margin-bottom:10px;">
        <p style="margin:0;font-size:12px;color:#0f5132;line-height:1.6;font-family:Arial,sans-serif;">
          &#10003; Your website has been automatically verified as operational. If you continue to experience issues, please contact your hosting provider.
        </p>
      </div>
      <p style="margin:10px 0 0;font-size:11px;color:#999;font-family:Arial,sans-serif;">This is an automated alert. Do not reply to this email.</p>
    </div>`;

  await transporter.sendMail({
    from: FROM,
    to: clientEmail,
    subject: `[RESOLVED] Your website is back UP | ${fmtDate(recoveredAt)}`,
    html: emailWrapper(header, banner, body),
  });
}

// ── Internal: failure summary ─────────────────────────────────────────────────
async function sendInternalFailureSummary({ recipients, failures }) {
  if (!recipients.length || !failures.length) return;

  const now = fmtDate(new Date());

  const rows = failures.map((f, i) => `
    <tr>
      <td style="padding:9px 12px;border:1px solid #ddd;color:#777;${i % 2 === 1 ? 'background:#f9f9f9;' : ''}">${i + 1}</td>
      <td style="padding:9px 12px;border:1px solid #ddd;${i % 2 === 1 ? 'background:#f9f9f9;' : ''}"><a href="${f.url}" style="color:#185fa5;">${f.url}</a></td>
      <td style="padding:9px 12px;border:1px solid #ddd;${i % 2 === 1 ? 'background:#f9f9f9;' : ''}">
        <span style="background:#a32d2d;color:#fff;padding:2px 9px;border-radius:12px;font-size:11px;">${f.status || f.detected_at && 'ERR' || 'ERR'}</span>
      </td>
    </tr>`).join('');

  const header = `
    <div style="background:#a32d2d;padding:24px 32px;text-align:center;border-radius:8px 8px 0 0;">
      <p style="color:#fcebeb;font-size:18px;font-weight:bold;font-family:Arial,sans-serif;margin:0;">&#9888; Website Availability Alert</p>
      <p style="color:#f09595;font-size:12px;margin:6px 0 0;font-family:Arial,sans-serif;">Automated Monitoring System &bull; Creatah Software Technologies</p>
    </div>`;

  const banner = `
    <div style="background:#fcebeb;padding:11px 32px;border-left:4px solid #a32d2d;">
      <span style="color:#791f1f;font-size:13px;font-weight:bold;font-family:Arial,sans-serif;">${failures.length} website(s) are currently DOWN or unreachable.</span>
    </div>`;

  const body = `
    <div style="padding:26px 32px;font-family:Arial,sans-serif;">
      <p style="color:#333;font-size:14px;margin:0 0 8px;">Hi Team,</p>
      <p style="color:#555;font-size:13px;line-height:1.65;margin:0 0 20px;">
        Our automated monitor has detected that the following website(s) are currently
        <strong style="color:#a32d2d;">DOWN or unreachable</strong>. Please investigate immediately.
      </p>

      <p style="color:#333;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:.6px;margin:0 0 8px;font-family:Arial,sans-serif;">Failed Websites (${failures.length})</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:22px;font-size:12px;font-family:Arial,sans-serif;">
        <thead>
          <tr>
            <th style="padding:8px 10px;text-align:left;color:#555;border:1px solid #ddd;background:#f2f2f2;font-weight:bold;width:32px;">#</th>
            <th style="padding:8px 10px;text-align:left;color:#555;border:1px solid #ddd;background:#f2f2f2;font-weight:bold;">URL</th>
            <th style="padding:8px 10px;text-align:left;color:#555;border:1px solid #ddd;background:#f2f2f2;font-weight:bold;">Status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <p style="color:#333;font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:.6px;margin:0 0 8px;font-family:Arial,sans-serif;">Summary</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:22px;font-size:12px;font-family:Arial,sans-serif;">
        <tr>
          <td style="padding:9px 12px;border:1px solid #ddd;color:#555;font-weight:bold;width:35%;background:#f2f2f2;">Total Failed</td>
          <td style="padding:9px 12px;border:1px solid #ddd;color:#a32d2d;font-weight:bold;">${failures.length} site(s)</td>
        </tr>
        <tr style="background:#f9f9f9;">
          <td style="padding:9px 12px;border:1px solid #ddd;color:#555;font-weight:bold;background:#f2f2f2;">Detected At</td>
          <td style="padding:9px 12px;border:1px solid #ddd;color:#333;">${now}</td>
        </tr>
        <tr>
          <td style="padding:9px 12px;border:1px solid #ddd;color:#555;font-weight:bold;background:#f2f2f2;">Monitored By</td>
          <td style="padding:9px 12px;border:1px solid #ddd;color:#333;">Website Availability Monitor</td>
        </tr>
      </table>

      <div style="background:#fff8f8;border-radius:6px;border:1px solid #f5c6c6;padding:14px 18px;margin-bottom:10px;">
        <p style="margin:0 0 5px;font-size:12px;color:#a32d2d;font-weight:bold;font-family:Arial,sans-serif;">&#9888; Action Required</p>
        <p style="margin:0;font-size:12px;color:#555;line-height:1.6;font-family:Arial,sans-serif;">
          Please investigate the above URLs immediately and take necessary action to restore availability.
        </p>
      </div>
      <p style="margin:10px 0 0;font-size:11px;color:#999;font-family:Arial,sans-serif;">This is an automated alert. Do not reply to this email.</p>
    </div>`;

  await transporter.sendMail({
    from: FROM,
    to: recipients.join(', '),
    subject: `[ALERT] Website Availability Alert! — ${failures.length} site(s) DOWN | ${now}`,
    html: emailWrapper(header, banner, body),
  });
}

// ── Client: Monthly Report ────────────────────────────────────────────────────
async function sendMonthlyReport({ clientEmail, urlName, month, pdfBuffer }) {
  const header = `
    <div style="background:#1a56db;padding:24px 32px;text-align:center;border-radius:8px 8px 0 0;">
      <p style="color:#e8f0fe;font-size:18px;font-weight:bold;font-family:Arial,sans-serif;margin:0;">&#128202; Monthly Availability Report</p>
      <p style="color:#a8c4f8;font-size:12px;margin:6px 0 0;font-family:Arial,sans-serif;">Creatah Software Technologies &bull; Automated Reporting</p>
    </div>`;

  const banner = `
    <div style="background:#e8f0fe;padding:11px 32px;border-left:4px solid #1a56db;">
      <span style="color:#1a3a8f;font-size:13px;font-weight:bold;font-family:Arial,sans-serif;">Your monthly availability report is attached.</span>
    </div>`;

  const body = `
    <div style="padding:26px 32px;font-family:Arial,sans-serif;">
      <p style="color:#333;font-size:14px;margin:0 0 8px;">Dear Customer,</p>
      <p style="color:#555;font-size:13px;line-height:1.65;margin:0 0 20px;">
        Please find attached the monthly availability report for <strong>${urlName}</strong> covering <strong>${month}</strong>.
      </p>
      <p style="margin:10px 0 0;font-size:11px;color:#999;font-family:Arial,sans-serif;">This is an automated report. Do not reply to this email.</p>
    </div>`;

  await transporter.sendMail({
    from: FROM,
    to: clientEmail,
    subject: `[REPORT] Monthly Availability Report — ${urlName} (${month})`,
    html: emailWrapper(header, banner, body),
    attachments: [{
      filename: `Website-Report-${urlName.replace(/[^a-z0-9]/gi, '_')}-${month}.pdf`,
      content: pdfBuffer,
      contentType: 'application/pdf',
    }],
  });
}

module.exports = { sendDowntimeAlert, sendRecoveryAlert, sendInternalFailureSummary, sendMonthlyReport };

const nodemailer = require('nodemailer');
require('dotenv').config();

async function testEmail() {
  console.log('Testing SMTP connection with settings:');
  console.log('Host:', process.env.SMTP_HOST);
  console.log('Port:', process.env.SMTP_PORT);
  console.log('User:', process.env.SMTP_USER);
  console.log('Secure:', process.env.SMTP_SECURE);

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Adding logger/debug for more info
    logger: true,
    debug: true
  });

  try {
    console.log('Verifying connection...');
    await transporter.verify();
    console.log('✅ Connection verified successfully!');

    console.log('Sending test mail...');
    const info = await transporter.sendMail({
      from: `"${process.env.EMAIL_FROM_NAME}" <${process.env.EMAIL_FROM_ADDRESS}>`,
      to: process.env.SMTP_USER, // send to self
      subject: 'Uptime Monitor SMTP Test',
      text: 'This is a test email from your Uptime Monitor application.'
    });
    console.log('✅ Message sent: %s', info.messageId);
  } catch (error) {
    console.error('❌ SMTP Error Detail:');
    console.error(error);
  }
}

testEmail();

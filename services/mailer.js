const nodemailer = require('nodemailer');

function smtpEnabled() {
  return process.env.SMTP_ENABLED === 'true'
    && process.env.SMTP_HOST
    && process.env.SMTP_USER
    && process.env.SMTP_PASS;
}

function createTransporter() {
  if (!smtpEnabled()) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendMail({ to, subject, text, html }) {
  const transporter = createTransporter();
  if (!transporter) {
    return { ok: false, skipped: true, reason: 'SMTP is not enabled.' };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const info = await transporter.sendMail({ from, to, subject, text, html });
  return { ok: true, messageId: info.messageId };
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendOtpEmail({ to, purpose, otp }) {
  const code = otp || generateOtp();
  const label = purpose || 'verification';
  const result = await sendMail({
    to,
    subject: `SSC Tracker ${label} OTP`,
    text: `Your SSC Tracker ${label} OTP is ${code}. It expires shortly.`,
    html: `<p>Your SSC Tracker ${label} OTP is <b>${code}</b>.</p><p>It expires shortly.</p>`,
  });
  return { ...result, otp: code };
}

module.exports = {
  smtpEnabled,
  sendMail,
  sendOtpEmail,
  generateOtp,
};

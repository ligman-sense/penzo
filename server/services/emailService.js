'use strict';

const { Resend } = require('resend');
const env = require('../config/env');

let _resendClient = null;

function getResendClient() {
  if (!_resendClient && env.RESEND_API_KEY && env.RESEND_API_KEY !== 're_replace_with_your_resend_api_key' && env.RESEND_API_KEY !== 're_placeholder_for_local_dev') {
    try {
      _resendClient = new Resend(env.RESEND_API_KEY);
    } catch (err) {
      console.error('[Resend Service] Failed to initialize Resend client:', err.message);
    }
  }
  return _resendClient;
}

/**
 * Send Password Reset OTP email.
 * Safe fallback for local development if Resend API key is mock/placeholder.
 */
async function sendPasswordResetOtp({ toEmail, otpCode, expiryMinutes = 5 }) {
  const from = env.EMAIL_FROM || 'PENZO <onboarding@resend.dev>';
  const subject = 'Your PENZO Password Reset Code';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px; background-color: #ffffff;">
      <div style="border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 20px;">
        <h1 style="color: #1e293b; font-size: 22px; margin: 0;">PENZO — Password Recovery</h1>
        <p style="color: #64748b; font-size: 13px; margin: 4px 0 0;">Scribe Coordination &amp; Assistance Platform</p>
      </div>

      <p style="color: #334155; font-size: 15px; line-height: 1.5;">Hello,</p>
      <p style="color: #334155; font-size: 15px; line-height: 1.5;">
        We received a request to reset the password for your PENZO account. Use the following verification code to complete your password reset:
      </p>

      <div style="text-align: center; margin: 28px 0; padding: 18px; background-color: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 6px;">
        <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #2563eb; font-family: monospace;">${otpCode}</span>
      </div>

      <p style="color: #475569; font-size: 13.5px; line-height: 1.5;">
        ⏱ <strong>This code is valid for ${expiryMinutes} minutes</strong> and can only be used once.
      </p>
      <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin-top: 20px;">
        🛡 <strong>Security Tip:</strong> Never share this code with anyone. PENZO administrators and support staff will never ask for your verification code or password.
      </p>
      <p style="color: #94a3b8; font-size: 12px; line-height: 1.5; margin-top: 24px; border-top: 1px solid #f1f5f9; padding-top: 16px;">
        If you did not request a password reset, you can safely ignore this email. Your current password remains secure.
      </p>
    </div>
  `;

  const text = `PENZO Password Recovery\n\nYour 6-digit password reset code is: ${otpCode}\n\nThis code expires in ${expiryMinutes} minutes and can only be used once. Never share this code with anyone.\nIf you did not request this, please ignore this email.`;

  const client = getResendClient();
  if (!client) {
    // In local development without a live Resend key, simulate delivery safely
    console.log(`[Development Mock Email] Password reset code for <${toEmail}>: [${otpCode}] (Sender: ${from})`);
    return { success: true, id: 'mock-email-id-dev' };
  }

  try {
    const result = await client.emails.send({
      from,
      to: [toEmail],
      subject,
      html,
      text,
    });

    if (result.error) {
      console.warn(`[Resend Notice] ${result.error.message}`);
      // In development, print code to console so testing is never blocked
      console.log(`[Development OTP Console Fallback] Code for <${toEmail}> is: [${otpCode}]`);
      return { success: false, error: result.error.message, fallbackCode: otpCode };
    }

    console.log(`[Resend Success] Email delivered to <${toEmail}> with ID: ${result?.data?.id}`);
    return { success: true, id: result?.data?.id || 'resend-sent' };
  } catch (err) {
    console.error('[Resend Error] Failed to deliver password reset email:', err.message);
    console.log(`[Development OTP Console Fallback] Code for <${toEmail}> is: [${otpCode}]`);
    return { success: false, fallbackCode: otpCode };
  }
}

module.exports = {
  sendPasswordResetOtp,
  getResendClient,
};

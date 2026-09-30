import nodemailer from 'nodemailer';

import { env } from '../../config/env.config.js';
import { logger } from '../utils/logger.js';

/**
 * Outbound email.
 * ---------------------------------------------------------------------------
 * One transport decision, made at boot:
 *
 *   • SMTP configured  → send for real
 *   • not configured   → log the message, including any link it contains
 *
 * The fallback is deliberate and it is not a stub. Password reset is
 * unusable while you are building if every test needs a live mail server, and
 * a developer who cannot see the link will paste tokens out of the database
 * instead — which is how "just log the token to the response" ends up shipped.
 *
 * Printing the link to the server console keeps development workable while
 * keeping the token off the wire, where a browser extension or a proxy log
 * would capture it.
 *
 * Production refuses to fall back. Silently not sending a reset email in
 * production is worse than crashing: the customer waits for a message that will
 * never arrive, and nothing in the logs looks wrong.
 */

let transport = null;
let usingRealSmtp = false;

function buildTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = env;

  if (SMTP_HOST && SMTP_USER && SMTP_PASSWORD) {
    usingRealSmtp = true;
    return nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT ?? 587,
      // 465 is implicit TLS; everything else upgrades with STARTTLS.
      secure: (SMTP_PORT ?? 587) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    });
  }

  if (env.isProduction) {
    // Fail at boot, not at the first password reset. A misconfigured mailer
    // discovered by a locked-out customer is a support incident; discovered at
    // deploy time it is a two-minute fix.
    throw new Error(
      'SMTP is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD — ' +
        'email cannot fall back to the console in production.',
    );
  }

  logger.warn('No SMTP configured — emails will be printed to this console instead of sent.');
  return null;
}

export const mailer = {
  /** Called once at boot so misconfiguration surfaces immediately. */
  init() {
    transport = buildTransport();
    return { usingRealSmtp };
  },

  /**
   * @param {object} message
   * @param {string} message.to
   * @param {string} message.subject
   * @param {string} message.text  Plain text — always provided.
   * @param {string} [message.html]
   */
  async send({ to, subject, text, html }) {
    if (!transport) {
      // Development: print it where the developer is already looking.
      logger.info(`EMAIL (not sent — no SMTP)\n  To: ${to}\n  Subject: ${subject}\n\n${text}\n`);
      return { delivered: false, reason: 'no-smtp' };
    }

    try {
      await transport.sendMail({
        from: env.MAIL_FROM ?? `"${env.APP_NAME ?? 'Feather & Bone'}" <${env.SMTP_USER}>`,
        to,
        subject,
        text,
        html,
      });
      return { delivered: true };
    } catch (error) {
      /*
       * Logged, not thrown.
       *
       * The caller decides what a failure means. For password reset the answer
       * is "say nothing different" — see auth.service: revealing that the email
       * failed would confirm the address exists, which is the enumeration leak
       * the generic response exists to prevent.
       */
      logger.error('Email delivery failed', { to, subject, message: error.message });
      return { delivered: false, reason: error.message };
    }
  },
};

export default mailer;

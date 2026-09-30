import { ApiError } from '../../core/errors/ApiError.js';
import { escapeRegex } from '../../core/utils/regex.util.js';
import { logger } from '../../core/utils/logger.js';
import { mailer } from '../../core/mail/mailer.js';
import { businessDetails, settingsService } from '../settings/settings.service.js';
import { env } from '../../config/env.config.js';
import { Message } from './message.model.js';

/**
 * Contact messages: stored first, then emailed, so an enquiry survives a mail
 * outage.
 */
export const messageService = {
  async submit(payload, { ip } = {}) {
    // Saved first. If the email fails, the message still exists in the back
    // office — the customer is not silently dropped because SMTP had a bad day.
    const record = await Message.create({
      name: payload.name,
      email: payload.email,
      phone: payload.phone || undefined,
      subject: payload.subject || undefined,
      message: payload.message,
      ip,
    });

    const business = businessDetails();
    // Settings → Contact page → "Send messages to", else the business email.
    const notifyTo = settingsService.get('contactNotifyEmail') || business.email || env.SMTP_USER;

    if (notifyTo) {
      const delivery = await mailer.send({
        to: notifyTo,
        subject: `Website enquiry: ${payload.subject || 'No subject'}`,
        // `replyTo` is not set here because the mailer keeps a single sender —
        // the address is in the body instead, which is enough to reply.
        text: [
          `From: ${payload.name} <${payload.email}>`,
          payload.phone ? `Phone: ${payload.phone}` : null,
          '',
          payload.message,
          '',
          '---',
          'Sent from the website contact form.',
        ]
          .filter(Boolean)
          .join('\n'),
      });

      if (delivery.delivered) {
        await Message.updateOne({ _id: record._id }, { $set: { emailDelivered: true } });
      }
    } else {
      // Worth a warning: the message is safe in the database, but nobody will
      // be told it arrived until someone opens the back office.
      logger.warn('Contact message stored but no notification address is configured', {
        messageId: String(record._id),
      });
    }

    logger.info('Contact message received', { messageId: String(record._id) });

    // The id is returned so the UI can quote a reference if it wants to; the
    // stored message itself is not echoed back.
    return { reference: String(record._id).slice(-8).toUpperCase() };
  },

  async list({ status, search, page = 1, limit = 50 } = {}) {
    const filter = status ? { status } : {};
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }, { subject: rx }, { message: rx }];
    }

    const [items, total, unread] = await Promise.all([
      Message.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Message.countDocuments(filter),
      Message.countDocuments({ status: 'new' }),
    ]);

    return {
      items: items.map((m) => ({
        id: String(m._id),
        name: m.name,
        email: m.email,
        phone: m.phone ?? null,
        subject: m.subject ?? null,
        message: m.message,
        status: m.status,
        emailDelivered: m.emailDelivered,
        at: m.createdAt,
      })),
      total,
      unread,
    };
  },

  async setStatus(id, status, actor) {
    const message = await Message.findById(id);
    if (!message) throw ApiError.notFound('Message');

    message.status = status;
    // Recorded so two people do not both reply to the same enquiry.
    message.handledBy = actor?.id ?? null;
    message.handledAt = new Date();
    await message.save();

    return { id: String(message._id), status: message.status };
  },
};

export default messageService;

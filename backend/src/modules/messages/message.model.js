import mongoose from 'mongoose';

/**
 * Contact-form messages.
 * ---------------------------------------------------------------------------
 * Stored first, emailed second.
 *
 * The obvious implementation forwards the form straight to an inbox. Then the
 * mail provider has an outage, or the address changes, or it lands in spam —
 * and the message is gone with nothing to recover. A customer who asked about
 * a wrong order gets silence.
 *
 * Writing to the database first means the message survives every one of those,
 * and the owner can read it in the back office whether or not the email arrived.
 */

export const MESSAGE_STATUS = Object.freeze(['new', 'read', 'replied', 'archived']);

const messageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 160 },
    phone: { type: String, trim: true, maxlength: 30 },
    subject: { type: String, trim: true, maxlength: 200 },
    message: { type: String, required: true, trim: true, maxlength: 4000 },

    status: { type: String, enum: MESSAGE_STATUS, default: 'new', index: true },

    /**
     * Whether the notification email actually went out.
     * Recorded so the owner can tell "nobody has written" apart from "the
     * mailer is broken and I have been ignoring people for a week".
     */
    emailDelivered: { type: Boolean, default: false },

    /** Set when someone marks it handled, so two people do not both reply. */
    handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    handledAt: { type: Date, default: null },

    // Kept for abuse investigation only, never displayed.
    ip: { type: String, default: null },
  },
  { timestamps: true },
);

// The inbox is "newest first, optionally unread only".
messageSchema.index({ status: 1, createdAt: -1 });

export const Message = mongoose.model('Message', messageSchema);
export default Message;

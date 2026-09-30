import { formatDateTime } from '@/lib/format.js';
import { kitchenQuantity, orderTypeLine } from '@/features/kitchen/labels.js';

/**
 * Kitchen order ticket (KOT) — the paper version of a kitchen card.
 * ---------------------------------------------------------------------------
 * Printed from the Kitchen Display (a cook's own copy for the rail) or from the
 * till when "print a kitchen ticket" is switched on in Settings → POS.
 *
 * Written for a thermal printer across a hot kitchen: the ticket number is
 * huge, quantities are bold and first, there are no prices (the kitchen does
 * not need them and they only add lines), and everything is solid black — no
 * greys, which a thermal head renders as nothing.
 */
export function KitchenTicketSlip({ ticket, business, paperWidth = '80', bold = true }) {
  if (!ticket) return null;
  const narrow = String(paperWidth).startsWith('58');

  return (
    <div
      className={`print-slip kot-slip mx-auto bg-white p-3 font-mono text-black ${bold ? 'slip-bold' : ''}`}
      data-paper={narrow ? '58' : '80'}
      style={{ width: narrow ? 219 : 302 }}
    >
      <div className="text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em]">Kitchen ticket</p>
        {business?.name && <p className="text-[11px] font-bold">{business.name}</p>}
        <p className="mt-1 text-5xl font-black leading-none">#{ticket.ticketNumber ?? '—'}</p>
        <p className="mt-1 text-base font-extrabold uppercase">{orderTypeLine(ticket)}</p>
      </div>

      <div className="my-2 border-t-2 border-dashed border-black" />

      <dl className="space-y-0.5 text-[12px] font-bold">
        <Row label="Order" value={ticket.orderNumber} />
        <Row label="Time" value={formatDateTime(ticket.firedAt)} />
        <Row
          label="From"
          value={
            ticket.channel === 'online' ? 'Website' : (ticket.terminalName ?? ticket.terminalId ?? 'Till')
          }
        />
        {ticket.customerName && <Row label="Customer" value={ticket.customerName} />}
      </dl>

      <div className="my-2 border-t-2 border-dashed border-black" />

      <ul className="space-y-1.5">
        {ticket.items.map((item, index) => (
          <li key={`${item.name}-${index}`} className="flex gap-2 text-[15px] font-extrabold leading-snug">
            <span className="shrink-0 tabular-nums">{kitchenQuantity(item)}</span>
            <span className="break-words">{item.name}</span>
          </li>
        ))}
      </ul>

      {(ticket.kitchenNote || ticket.deliveryNote) && (
        <>
          <div className="my-2 border-t-2 border-dashed border-black" />
          {ticket.kitchenNote && (
            <p className="border-2 border-black p-1.5 text-[13px] font-extrabold uppercase">
              Note: {ticket.kitchenNote}
            </p>
          )}
          {ticket.deliveryNote && (
            <p className="mt-1 text-[12px] font-bold">Customer: {ticket.deliveryNote}</p>
          )}
        </>
      )}

      <div className="my-2 border-t-2 border-dashed border-black" />
      <p className="text-center text-[11px] font-bold">
        {ticket.items.length} line{ticket.items.length === 1 ? '' : 's'} · printed{' '}
        {formatDateTime(new Date())}
      </p>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-2">
      <dt>{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

export default KitchenTicketSlip;

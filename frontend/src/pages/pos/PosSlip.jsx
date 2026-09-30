import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

import { config } from '@/config/env.js';
import { formatCurrency, formatDateTime, formatQuantity } from '@/lib/format.js';
import { mediaUrl } from '@/lib/media.js';
import { orderTypeLine } from '@/features/kitchen/labels.js';
import { cn } from '@/lib/utils.js';

/**
 * Thermal receipt / printed slip.
 * ---------------------------------------------------------------------------
 * Brand lockup, invoice and ticket number, date, cashier, customer, itemised
 * lines, subtotal, GST, total payable, how it was paid, and a scannable
 * barcode of the invoice number (for reprints and returns).
 *
 * Printing notes — a receipt is not a web page:
 *  • Black on white regardless of the app theme; thermal printers have no colour.
 *  • Bold by default. Regular-weight 9px type on an 80mm thermal head prints
 *    faint and broken — the reason slips "came out too light". The print
 *    stylesheet (index.css, "print") forces every glyph to pure black at full
 *    opacity, and `receipt.bold` (Settings → POS, on by default) makes it bold.
 *  • Size and paper width come from Settings → POS too: normal / large / extra
 *    large text, 80mm or 58mm rolls.
 *  • Monospace keeps the amount column aligned.
 */
const PAYMENT_LABEL = {
  cash: 'Cash',
  card: 'Card',
  jazzcash: 'JazzCash',
  easypaisa: 'EasyPaisa',
  cod: 'Cash on Delivery',
};

const DEFAULT_RECEIPT = {
  paperWidth: '80',
  fontSize: 'large',
  bold: true,
  showLogo: true,
  showBarcode: true,
  headerNote: '',
};

/**
 * @param {object} props
 * @param {object} props.sale      the slip from the server (never local state)
 * @param {object} [props.business] name, address, phone, logo, footer
 * @param {object} [props.receipt]  Settings → POS receipt options
 */
export function PosSlip({ sale, business, receipt: receiptSettings }) {
  const barcodeRef = useRef(null);
  const receipt = { ...DEFAULT_RECEIPT, ...receiptSettings };
  const narrow = String(receipt.paperWidth) === '58';

  useEffect(() => {
    if (!barcodeRef.current || !sale?.invoiceNumber || !receipt.showBarcode) return;

    try {
      JsBarcode(barcodeRef.current, sale.invoiceNumber, {
        format: 'CODE128', // Handles letters and digits, unlike EAN/UPC.
        // Thicker bars scan reliably off a thermal print.
        width: narrow ? 1.4 : 1.8,
        height: 50,
        displayValue: true,
        fontSize: 13,
        fontOptions: receipt.bold ? 'bold' : '',
        margin: 0,
        background: '#ffffff',
        lineColor: '#000000',
      });
    } catch {
      // A malformed invoice number must not blank the whole receipt.
    }
  }, [sale?.invoiceNumber, receipt.showBarcode, receipt.bold, narrow]);

  if (!sale) return null;

  const { invoiceNumber, at, cashierName, customer, lines, totals, terminalId } = sale;
  const isPaid = sale.paymentStatus ? sale.paymentStatus === 'paid' : true;

  return (
    <div
      // `print-slip` is what the print stylesheet isolates and sizes.
      className={cn(
        'print-slip mx-auto bg-white p-4 font-mono leading-tight text-black',
        receipt.bold && 'slip-bold',
        receipt.fontSize === 'large' && 'slip-size-large',
        receipt.fontSize === 'xlarge' && 'slip-size-xlarge',
        receipt.bold ? 'font-bold' : 'font-medium',
        'text-[12px]',
      )}
      data-paper={narrow ? '58' : '80'}
      style={{ width: narrow ? 219 : 302 }}
    >
      {/* --- Brand --- every line from Settings → Business Details. */}
      <div className="text-center">
        {receipt.showLogo && business?.logoUrl && (
          <img
            src={mediaUrl(business.logoUrl)}
            alt=""
            className="mx-auto mb-1.5 h-14 w-auto object-contain grayscale"
          />
        )}
        <h1 className="text-xl font-black tracking-tight">{business?.name || config.brand.name}</h1>
        {business?.tagline && (
          <p className="mt-0.5 text-[10px] uppercase tracking-[0.12em]">{business.tagline}</p>
        )}
        {(business?.address || business?.phone) && (
          <p className="mt-1.5 text-[11px] leading-snug">
            {business.address}
            {business.address && business.phone && <br />}
            {business.phone && `Ph: ${business.phone}`}
          </p>
        )}
        {business?.taxNumber && <p className="text-[11px] leading-snug">NTN: {business.taxNumber}</p>}
        {receipt.headerNote && <p className="mt-1.5 text-[11px] leading-snug">{receipt.headerNote}</p>}
      </div>

      {/* --- Ticket number: what the customer listens for at the counter --- */}
      {sale.ticketNumber != null && (
        <>
          <Divider />
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-[0.2em]">Order no.</p>
            <p className="slip-strong text-4xl font-black leading-none">#{sale.ticketNumber}</p>
            <p className="mt-1 text-[12px] font-extrabold uppercase">{orderTypeLine(sale)}</p>
          </div>
        </>
      )}

      <Divider />

      {/* --- Sale metadata --- */}
      <dl className="space-y-0.5 text-[11px]">
        <MetaRow label="Invoice No" value={invoiceNumber} />
        <MetaRow label="Date" value={formatDateTime(at)} />
        <MetaRow label="Cashier" value={cashierName} />
        <MetaRow label="Customer" value={customer} />
        {sale.customerPhone && <MetaRow label="Phone" value={sale.customerPhone} />}
        {terminalId && <MetaRow label="Till" value={terminalId} />}
      </dl>

      <Divider />

      {/* --- Items: the name gets the full width, the arithmetic its own row,
          so a long name wraps and the amount column never does. --- */}
      <div className="border-b-2 border-black pb-1 text-[11px] font-extrabold uppercase tracking-wider">
        <div className="flex justify-between">
          <span>Item</span>
          <span>Amount</span>
        </div>
      </div>

      <ul className="divide-y divide-dashed divide-black">
        {lines.map((line, index) => (
          <li key={`${line.productId}-${index}`} className="py-1.5">
            <p className="font-bold leading-snug break-words">{line.name}</p>
            <div className="mt-0.5 flex items-baseline justify-between gap-2 tabular-nums">
              {/* The unit on every line: "2 × 850" is ambiguous — kilos or pieces? */}
              <span className="whitespace-nowrap text-[11px]">
                {formatQuantity(line.quantity, line.unit)} ×{' '}
                {formatCurrency(line.unitPrice, { withSymbol: false })}/{line.unitLabel}
              </span>
              <span className="whitespace-nowrap font-extrabold">
                {formatCurrency(line.lineTotal, { withSymbol: false })}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <Divider />

      {/* --- Totals --- */}
      <dl className="space-y-0.5 text-[12px]">
        <MetaRow label="Subtotal" value={formatCurrency(totals.subtotal, { withSymbol: false })} numeric />
        {totals.discount > 0 && (
          <MetaRow
            label="Discount"
            value={`-${formatCurrency(totals.discount, { withSymbol: false })}`}
            numeric
          />
        )}
        <MetaRow
          label={`GST (${Math.round(totals.taxRate * 100)}%)`}
          value={formatCurrency(totals.tax, { withSymbol: false })}
          numeric
        />
      </dl>

      <div className="mt-1.5 flex items-center justify-between border-y-2 border-black py-1.5 text-base font-black">
        <span>TOTAL</span>
        <span className="slip-strong tabular-nums">
          Rs {formatCurrency(totals.total, { withSymbol: false })}
        </span>
      </div>

      <Divider />

      {/* --- How it was paid --- */}
      <dl className="space-y-0.5 text-[12px]">
        {isPaid ? (
          <>
            <MetaRow label="Paid via" value={PAYMENT_LABEL[sale.paymentMethod] ?? sale.paymentMethod} />
            {sale.tendered != null && (
              <MetaRow
                label="Cash received"
                value={formatCurrency(sale.tendered, { withSymbol: false })}
                numeric
              />
            )}
            {sale.changeDue != null && (
              <MetaRow label="Change" value={formatCurrency(sale.changeDue, { withSymbol: false })} numeric />
            )}
            <MetaRow label="Status" value="PAID" />
          </>
        ) : (
          // A bill printed for the table before paying.
          <p className="border-2 border-black py-1 text-center text-sm font-black uppercase tracking-widest">
            Bill — not paid
          </p>
        )}
      </dl>

      <Divider />

      <p className="text-center text-[12px] font-bold">
        {business?.receiptFooter || `Thank you for choosing ${business?.name || config.brand.name}!`}
      </p>
      {business?.email && <p className="mt-1 text-center text-[11px]">{business.email}</p>}

      {receipt.showBarcode && (
        <div className="mt-3 flex justify-center">
          <svg ref={barcodeRef} aria-label={`Barcode for invoice ${invoiceNumber}`} />
        </div>
      )}

      <p className="mt-2 text-center text-[10px]">Keep this slip for returns and exchanges</p>
    </div>
  );
}

function Divider() {
  return <div className="my-2 border-t-2 border-dashed border-black" />;
}

function MetaRow({ label, value, numeric = false }) {
  return (
    <div className="flex justify-between gap-2">
      <dt>{label}</dt>
      <dd className={numeric ? 'tabular-nums' : 'text-right'}>{value}</dd>
    </div>
  );
}

export default PosSlip;

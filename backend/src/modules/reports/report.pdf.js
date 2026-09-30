/**
 * Report → PDF.
 * ---------------------------------------------------------------------------
 * Renders the same report "document" the screen and the CSV use — KPIs, then
 * one table per section — so the three can never disagree about a figure.
 *
 * Built on PDFKIT'S standard fonts, deliberately. They are embedded in every
 * PDF reader, so the file stays small and needs no font asset on the server —
 * which matters on shared hosting. The trade-off is the character set:
 * Helvetica covers Latin (WinAnsi) only, so text outside it (Urdu, arrows) is
 * substituted rather than printed as missing-glyph boxes. The CSV export
 * carries the original text untouched.
 *
 * Layout rules that make a report readable on paper:
 *   • wide tables switch the whole document to landscape
 *   • the header row repeats on every page a table spills onto
 *   • money and numbers are right-aligned so their digits line up
 *   • every page says which report, which range and which page it is
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import PDFDocument from 'pdfkit';

import { env } from '../../config/env.config.js';
import { logger } from '../../core/utils/logger.js';

const TZ = 'Asia/Karachi';

const COLORS = {
  ink: '#111111',
  muted: '#5c5c5c',
  rule: '#d4d4d4',
  zebra: '#f4f4f2',
  head: '#1c1a17',
  headText: '#ffffff',
  accent: '#b37a06',
  kpiBg: '#faf7ef',
};

/*
 * WinAnsi covers Latin-1 plus these typographic characters. Anything else is
 * replaced — standard fonts have no glyph for it and would print garbage.
 */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const REPLACEMENTS = { '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '×': 'x', '·': '-', '✓': 'Y' };

export function pdfSafe(value) {
  const text = value === null || value === undefined ? '' : String(value);
  let out = '';
  for (const char of text) {
    if (REPLACEMENTS[char]) out += REPLACEMENTS[char];
    else if (char.codePointAt(0) <= 0xff || WIN_ANSI_EXTRA.has(char)) out += char;
    else out += '?';
  }
  return out;
}

const moneyFormat = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });
const numberFormat = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: TZ,
});
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: TZ,
});

/** One cell's printed text, by column type. Shared with the CSV writer. */
export function formatCell(column, value) {
  if (value === null || value === undefined || value === '') return column.money || column.numeric ? '0' : '';
  if (column.money) return `Rs ${moneyFormat.format(Number(value) || 0)}`;
  if (column.numeric) return numberFormat.format(Number(value) || 0);
  if (column.datetime) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : dateTimeFormat.format(date);
  }
  if (column.date) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : dateFormat.format(date);
  }
  return String(value);
}

/** Relative width of a column, by what it holds. */
function weightOf(column) {
  if (column.width) return column.width;
  if (column.money) return 1.1;
  if (column.numeric) return 0.8;
  if (column.datetime) return 1.35;
  if (column.date) return 1;
  return 1.5;
}

/**
 * The logo, if it can be had quickly. A local upload is read from disk; a
 * remote one (Cloudinary) is fetched with a short timeout. Anything slow,
 * missing or not PNG/JPEG is simply left out — a report without a logo is
 * still a report.
 */
async function loadLogo(url) {
  if (!url) return null;
  try {
    if (url.startsWith('/uploads/')) {
      const root = path.resolve(env.uploadDir);
      const file = path.resolve(root, url.replace(/^\/uploads\//, ''));
      if (!file.startsWith(root + path.sep)) return null;
      const buffer = await fs.readFile(file);
      return isPngOrJpeg(buffer) ? buffer : null;
    }
    if (/^https:\/\//i.test(url)) {
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!response.ok) return null;
      const buffer = Buffer.from(await response.arrayBuffer());
      return isPngOrJpeg(buffer) ? buffer : null;
    }
  } catch (error) {
    logger.debug('Report logo skipped', { url, message: error.message });
  }
  return null;
}

function isPngOrJpeg(buffer) {
  return (
    (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) ||
    (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
  );
}

/**
 * Render a report document to a PDF buffer.
 *
 * @param {object} report   output of reportService.run
 * @param {object} business businessDetails()
 */
export async function renderReportPdf(report, business = {}) {
  const pdfColumns = (section) => section.columns.filter((c) => c.pdf !== false);
  const widest = Math.max(1, ...report.sections.map((s) => pdfColumns(s).length));
  const landscape = widest > 7;

  const doc = new PDFDocument({
    size: 'A4',
    layout: landscape ? 'landscape' : 'portrait',
    margins: { top: 40, bottom: 44, left: 36, right: 36 },
    bufferPages: true,
    info: {
      Title: pdfSafe(`${report.label} — ${business.name ?? ''}`),
      Author: pdfSafe(business.name ?? 'Feather & Bone'),
      Creator: 'Feather & Bone Back Office',
    },
  });

  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const contentWidth = () => doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  // --- Cover header --------------------------------------------------------
  const logo = await loadLogo(business.logoUrl);
  let titleX = left;
  if (logo) {
    try {
      doc.image(logo, left, 36, { fit: [46, 46] });
      titleX = left + 56;
    } catch {
      /* Unsupported image variant — carry on without it. */
    }
  }

  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(17)
    .text(pdfSafe(business.name ?? ''), titleX, 38);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
  const contact = [business.address, business.phone, business.email].filter(Boolean).join('  |  ');
  if (contact) doc.text(pdfSafe(contact), titleX, doc.y + 1);

  doc.moveDown(0.8);
  doc.x = left;
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.accent).text(pdfSafe(report.label), left);
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
  const meta = [
    report.range?.label === 'current'
      ? `As of: ${dateTimeFormat.format(new Date(report.generatedAt))}`
      : report.range?.label
        ? `Period: ${report.range.display ?? report.range.label}`
        : null,
    report.scope?.label ? `Scope: ${report.scope.label}` : null,
    `Generated: ${dateTimeFormat.format(new Date(report.generatedAt))}`,
  ].filter(Boolean);
  doc.text(pdfSafe(meta.join('     ')), left);
  if (report.description) doc.text(pdfSafe(report.description), left);
  doc.moveDown(0.6);

  // --- KPIs ----------------------------------------------------------------
  if (report.kpis?.length) {
    const perRow = landscape ? 6 : 4;
    const gap = 8;
    const boxWidth = (contentWidth() - gap * (perRow - 1)) / perRow;
    const boxHeight = 42;

    report.kpis.forEach((kpi, index) => {
      const col = index % perRow;
      if (col === 0 && index > 0) doc.y += boxHeight + gap;
      if (doc.y + boxHeight > bottom()) doc.addPage();
      const x = left + col * (boxWidth + gap);
      const y = doc.y;
      doc.save().roundedRect(x, y, boxWidth, boxHeight, 4).fill(COLORS.kpiBg).restore();
      doc.save().roundedRect(x, y, boxWidth, boxHeight, 4).lineWidth(0.6).stroke(COLORS.rule).restore();
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(COLORS.muted)
        .text(pdfSafe(kpi.label.toUpperCase()), x + 7, y + 7, {
          width: boxWidth - 14,
          lineBreak: false,
          ellipsis: true,
        });
      doc
        .font('Helvetica-Bold')
        .fontSize(12.5)
        .fillColor(COLORS.ink)
        .text(pdfSafe(formatCell(kpi, kpi.value)), x + 7, y + 20, {
          width: boxWidth - 14,
          lineBreak: false,
          ellipsis: true,
        });
      doc.y = y;
    });
    doc.y += boxHeight + 14;
    doc.x = left;
  }

  // --- Sections ------------------------------------------------------------
  for (const section of report.sections) {
    const columns = pdfColumns(section);
    if (!columns.length) continue;

    const fontSize = columns.length > 10 ? 7.2 : columns.length > 7 ? 7.8 : 8.8;
    const padX = 4;
    const padY = 3.5;
    const totalWeight = columns.reduce((sum, c) => sum + weightOf(c), 0);
    const widths = columns.map((c) => (weightOf(c) / totalWeight) * contentWidth());
    const alignOf = (c) => (c.money || c.numeric ? 'right' : 'left');

    // Section title — never orphaned at the foot of a page.
    if (doc.y + 60 > bottom()) doc.addPage();
    doc.x = left;
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.ink).text(pdfSafe(section.title), left);
    if (section.note) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor(COLORS.muted).text(pdfSafe(section.note), left);
    }
    doc.moveDown(0.3);

    const drawHeader = () => {
      doc.font('Helvetica-Bold').fontSize(fontSize);
      const height =
        Math.max(
          ...columns.map((c, i) => doc.heightOfString(pdfSafe(c.label), { width: widths[i] - padX * 2 })),
        ) +
        padY * 2;
      const y = doc.y;
      doc.save().rect(left, y, contentWidth(), height).fill(COLORS.head).restore();
      let x = left;
      columns.forEach((c, i) => {
        doc.fillColor(COLORS.headText).text(pdfSafe(c.label), x + padX, y + padY, {
          width: widths[i] - padX * 2,
          align: alignOf(c),
        });
        x += widths[i];
      });
      doc.y = y + height;
    };

    const drawRow = (cells, { zebra = false, bold = false, topRule = false } = {}) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
      const height =
        Math.max(...cells.map((text, i) => doc.heightOfString(text, { width: widths[i] - padX * 2 }))) +
        padY * 2;

      if (doc.y + height > bottom()) {
        doc.addPage();
        drawHeader();
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
      }

      const y = doc.y;
      if (zebra) doc.save().rect(left, y, contentWidth(), height).fill(COLORS.zebra).restore();
      if (topRule) {
        doc
          .save()
          .moveTo(left, y)
          .lineTo(left + contentWidth(), y)
          .lineWidth(1)
          .stroke(COLORS.ink)
          .restore();
      }

      let x = left;
      cells.forEach((text, i) => {
        doc
          .fillColor(COLORS.ink)
          .text(text, x + padX, y + padY, { width: widths[i] - padX * 2, align: alignOf(columns[i]) });
        x += widths[i];
      });
      doc.y = y + height;
    };

    drawHeader();

    if (!section.rows.length) {
      drawRow(columns.map((_, i) => (i === 0 ? 'No records in this period' : '')));
    } else {
      section.rows.forEach((row, index) => {
        drawRow(
          columns.map((c) => pdfSafe(formatCell(c, row[c.key]))),
          { zebra: index % 2 === 1 },
        );
      });
    }

    if (section.totals && Object.keys(section.totals).length && section.rows.length) {
      drawRow(
        columns.map((c, i) =>
          i === 0 ? 'TOTAL' : c.key in section.totals ? pdfSafe(formatCell(c, section.totals[c.key])) : '',
        ),
        { bold: true, topRule: true },
      );
    }

    if (section.truncated) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(7.5)
        .fillColor(COLORS.muted)
        .text(
          pdfSafe(
            `Showing ${section.rows.length} of ${section.totalRows} rows. The CSV export contains every row.`,
          ),
          left,
        );
    }

    doc.moveDown(1.2);
    doc.x = left;
  }

  // --- Running footer on every page ----------------------------------------
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const y = doc.page.height - doc.page.margins.bottom + 16;
    // Writing inside the bottom margin must not trigger an automatic new page.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted);
    doc.text(pdfSafe(`${business.name ?? ''} — ${report.label}`), left, y, {
      width: contentWidth() / 2,
      lineBreak: false,
    });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, left + contentWidth() / 2, y, {
      width: contentWidth() / 2,
      align: 'right',
      lineBreak: false,
    });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
  return finished;
}

export default renderReportPdf;

import { escapePdfString, fixed, normalizePdfText, textWidth } from "./pdfText";

/** Invoice of one paid TicketPro subscription, already formatted for display. */
export type InvoicePdfInput = {
  amountLabel: string;
  customerEmail: string;
  customerName: string;
  /** "Abonnement TicketPro — Ultra" */
  description: string;
  /** "10 routeurs · 3 postes · 1 an" */
  details: string;
  invoiceNumber: string;
  issuedAtLabel: string;
  organizationName: string;
  paidAtLabel: string;
  /** "Mobile Money (**** 9090)" */
  paymentMethod: string;
  paymentReference: string;
  /** "Du 01/10/2026 au 01/10/2027" */
  periodLabel: string;
};

type Rgb = readonly [number, number, number];

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const RIGHT = PAGE_WIDTH - MARGIN;

const colors = {
  border: hex("#dce5f2"),
  brand: hex("#0666fd"),
  brandSoft: hex("#eef4ff"),
  muted: hex("#53627a"),
  success: hex("#168a55"),
  successSoft: hex("#e8f6ef"),
  text: hex("#0b1739"),
  white: hex("#ffffff")
} as const;

/**
 * One-page A4 invoice: brand header, who is billed and the payment details,
 * one line for the subscription, the total paid and the payment receipt.
 */
export function generateInvoicePdf(input: InvoicePdfInput): Uint8Array {
  const page = new PdfPage();

  // Header band
  page.rect(0, PAGE_HEIGHT - 118, PAGE_WIDTH, 118, colors.brand);
  page.text("TicketPro", MARGIN, PAGE_HEIGHT - 62, { bold: true, color: colors.white, size: 28 });
  page.text("par Akicorp Solutions", MARGIN, PAGE_HEIGHT - 82, { color: colors.white, size: 10.5 });
  page.text("FACTURE", RIGHT, PAGE_HEIGHT - 58, { align: "right", bold: true, color: colors.white, size: 24 });
  page.text(input.invoiceNumber, RIGHT, PAGE_HEIGHT - 78, { align: "right", color: colors.white, size: 11 });
  const stampWidth = 74;
  page.rect(RIGHT - stampWidth, PAGE_HEIGHT - 106, stampWidth, 20, colors.white);
  page.text("PAYÉE", RIGHT - stampWidth / 2, PAGE_HEIGHT - 100, {
    align: "center",
    bold: true,
    color: colors.success,
    size: 10.5
  });

  // Billed to / invoice details
  const blockTop = PAGE_HEIGHT - 160;
  page.text("FACTURÉ À", MARGIN, blockTop, { bold: true, color: colors.muted, size: 8.5 });
  page.text(input.organizationName || input.customerName, MARGIN, blockTop - 20, {
    bold: true,
    maxWidth: 240,
    size: 13
  });
  let customerY = blockTop - 37;
  if (input.organizationName && input.customerName) {
    page.text(input.customerName, MARGIN, customerY, { color: colors.muted, maxWidth: 240, size: 10 });
    customerY -= 15;
  }
  if (input.customerEmail) {
    page.text(input.customerEmail, MARGIN, customerY, { color: colors.muted, maxWidth: 240, size: 10 });
  }

  const detailsX = 318;
  page.text("DÉTAILS", detailsX, blockTop, { bold: true, color: colors.muted, size: 8.5 });
  const details: Array<[string, string]> = [
    ["Date de facture", input.issuedAtLabel],
    ["Date de paiement", input.paidAtLabel],
    ["Moyen de paiement", input.paymentMethod],
    ["Référence", input.paymentReference]
  ];
  details.forEach(([label, value], index) => {
    const y = blockTop - 20 - index * 17;
    page.text(label, detailsX, y, { color: colors.muted, size: 9.5 });
    page.text(value, RIGHT, y, { align: "right", bold: true, maxWidth: 135, size: 9.5 });
  });

  // Subscription line
  const tableTop = blockTop - 118;
  const periodX = 318;
  page.rect(MARGIN, tableTop - 8, RIGHT - MARGIN, 26, colors.brandSoft);
  page.text("DÉSIGNATION", MARGIN + 12, tableTop + 1, { bold: true, color: colors.muted, size: 8.5 });
  page.text("PÉRIODE", periodX, tableTop + 1, { bold: true, color: colors.muted, size: 8.5 });
  page.text("MONTANT", RIGHT - 12, tableTop + 1, { align: "right", bold: true, color: colors.muted, size: 8.5 });

  const rowY = tableTop - 34;
  page.text(input.description, MARGIN + 12, rowY, { bold: true, maxWidth: periodX - MARGIN - 24, size: 11.5 });
  page.text(input.details, MARGIN + 12, rowY - 16, { color: colors.muted, maxWidth: periodX - MARGIN - 24, size: 9.5 });
  page.text(input.periodLabel, periodX, rowY, { maxWidth: 140, size: 10 });
  page.text(input.amountLabel, RIGHT - 12, rowY, { align: "right", bold: true, size: 11.5 });
  page.line(MARGIN, rowY - 34, RIGHT, rowY - 34, colors.border);

  // Totals
  const totalsX = 318;
  const subtotalY = rowY - 60;
  page.text("Sous-total", totalsX, subtotalY, { color: colors.muted, size: 10 });
  page.text(input.amountLabel, RIGHT - 12, subtotalY, { align: "right", size: 10 });
  page.rect(totalsX - 12, subtotalY - 44, RIGHT - totalsX + 12, 30, colors.brandSoft);
  page.text("Total payé", totalsX, subtotalY - 33, { bold: true, size: 12 });
  page.text(input.amountLabel, RIGHT - 12, subtotalY - 33, {
    align: "right",
    bold: true,
    color: colors.brand,
    size: 14
  });

  // Payment receipt
  const receiptTop = subtotalY - 84;
  page.rect(MARGIN, receiptTop - 46, RIGHT - MARGIN, 56, colors.successSoft);
  page.rect(MARGIN, receiptTop - 46, 4, 56, colors.success);
  page.text(`Paiement reçu le ${input.paidAtLabel} — ${input.paymentMethod}`, MARGIN + 18, receiptTop - 12, {
    bold: true,
    color: colors.success,
    maxWidth: RIGHT - MARGIN - 36,
    size: 10.5
  });
  page.text(`Référence de transaction : ${input.paymentReference}`, MARGIN + 18, receiptTop - 30, {
    color: colors.text,
    maxWidth: RIGHT - MARGIN - 36,
    size: 9.5
  });

  // Footer
  page.line(MARGIN, 104, RIGHT, 104, colors.border);
  page.text("Merci pour votre confiance.", MARGIN, 84, { bold: true, size: 11 });
  page.text(
    "Facture d'abonnement au logiciel TicketPro, générée électroniquement. Elle ne concerne pas la vente de tickets WiFi.",
    MARGIN,
    67,
    { color: colors.muted, maxWidth: RIGHT - MARGIN, size: 8.5 }
  );
  page.text("Akicorp Solutions — TicketPro", MARGIN, 52, { color: colors.muted, size: 8.5 });

  return page.toBytes();
}

type TextOptions = {
  align?: "center" | "left" | "right";
  bold?: boolean;
  color?: Rgb;
  /** Shrinks the text (down to 70 %) then shortens it to fit this width. */
  maxWidth?: number;
  size?: number;
};

class PdfPage {
  private readonly operations: string[] = [];

  rect(x: number, y: number, width: number, height: number, fill: Rgb): void {
    this.operations.push(`${rgb(fill)} rg ${fixed(x)} ${fixed(y)} ${fixed(width)} ${fixed(height)} re f`);
  }

  line(x1: number, y1: number, x2: number, y2: number, stroke: Rgb): void {
    this.operations.push(`${rgb(stroke)} RG 0.8 w ${fixed(x1)} ${fixed(y1)} m ${fixed(x2)} ${fixed(y2)} l S`);
  }

  text(value: string, x: number, y: number, options: TextOptions = {}): void {
    const bold = options.bold ?? false;
    let size = options.size ?? 10;
    let content = normalizePdfText(value);
    if (!content) return;
    if (options.maxWidth) {
      const width = textWidth(content, size, bold);
      if (width > options.maxWidth) size = Math.max(size * 0.7, size * (options.maxWidth / width));
      if (textWidth(content, size, bold) > options.maxWidth) {
        let kept = content;
        while (kept.length > 1 && textWidth(`${kept}...`, size, bold) > options.maxWidth) {
          kept = kept.slice(0, -1);
        }
        content = `${kept.trimEnd()}...`;
      }
    }
    const width = textWidth(content, size, bold);
    const left = options.align === "right" ? x - width : options.align === "center" ? x - width / 2 : x;
    this.operations.push(
      `BT ${rgb(options.color ?? colors.text)} rg /${bold ? "F2" : "F1"} ${fixed(size)} Tf 1 0 0 1 ${fixed(left)} ${fixed(y)} Tm (${escapePdfString(content)}) Tj ET`
    );
  }

  toBytes(): Uint8Array {
    const stream = `${this.operations.join("\n")}\n`;
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [5 0 R] /Count 1 >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents 6 0 R >>`,
      `<< /Length ${byteLength(stream)} >>\nstream\n${stream}endstream`
    ];
    let output = "%PDF-1.4\n";
    const offsets: number[] = [0];
    objects.forEach((object, index) => {
      offsets[index + 1] = byteLength(output);
      output += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xrefOffset = byteLength(output);
    output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let index = 1; index <= objects.length; index += 1) {
      output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
    }
    output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    return new TextEncoder().encode(output);
  }
}

function hex(value: string): Rgb {
  const number = Number.parseInt(value.slice(1), 16);
  return [(number >> 16) / 255, ((number >> 8) & 255) / 255, (number & 255) / 255];
}

function rgb(color: Rgb): string {
  return color.map((channel) => fixed(Number(channel.toFixed(3)))).join(" ");
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

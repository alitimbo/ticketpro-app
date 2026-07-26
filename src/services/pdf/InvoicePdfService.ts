export type InvoicePdfInput = {
  accountEmail: string;
  accountName: string;
  amountLabel: string;
  dueAtLabel: string;
  invoiceNumber: string;
  issuedAtLabel: string;
  notes: string | null;
  packName: string;
  paidAtLabel: string;
  periodLabel: string;
  routerLimit: number;
  statusLabel: string;
};

type TextLine = {
  bold?: boolean;
  size?: number;
  text: string;
  x?: number;
  y: number;
};

export function generateInvoicePdf(input: InvoicePdfInput): Uint8Array {
  const lines: TextLine[] = [
    { bold: true, size: 22, text: "Facture abonnement logiciel", x: 48, y: 780 },
    { size: 10, text: "Ce document concerne l'utilisation de l'application. Il ne concerne pas la vente de tickets WiFi.", x: 48, y: 756 },
    { bold: true, size: 14, text: input.invoiceNumber, x: 48, y: 720 },
    { text: `Compte : ${input.accountName}`, x: 48, y: 684 },
    { text: `Email : ${input.accountEmail}`, x: 48, y: 664 },
    { text: `Pack : ${input.packName}`, x: 48, y: 628 },
    { text: `Routeurs inclus : ${input.routerLimit}`, x: 48, y: 608 },
    { text: `Periode : ${input.periodLabel}`, x: 48, y: 588 },
    { bold: true, size: 13, text: `Montant : ${input.amountLabel}`, x: 48, y: 552 },
    { text: `Statut : ${input.statusLabel}`, x: 48, y: 524 },
    { text: `Emission : ${input.issuedAtLabel}`, x: 48, y: 504 },
    { text: `Echeance : ${input.dueAtLabel}`, x: 48, y: 484 },
    { text: `Paiement : ${input.paidAtLabel}`, x: 48, y: 464 },
    { bold: true, text: "Notes", x: 48, y: 424 },
    { text: input.notes || "Aucune note.", x: 48, y: 404 },
    { size: 9, text: "Paiement en ligne et Mobile Money non integres dans cette version.", x: 48, y: 72 }
  ];

  return new SimpleInvoicePdf(lines).toBytes();
}

class SimpleInvoicePdf {
  constructor(private readonly lines: TextLine[]) {}

  toBytes(): Uint8Array {
    const content = this.lines.map((line) => drawText(line)).join("\n");
    const stream = `${content}\n`;
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [5 0 R] /Count 1 >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents 6 0 R >>`,
      `<< /Length ${byteLength(stream)} >>\nstream\n${stream}endstream`
    ];
    let output = "%PDF-1.4\n";
    const offsets = [0];

    objects.forEach((object, index) => {
      offsets[index + 1] = byteLength(output);
      output += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });

    const xrefOffset = byteLength(output);
    output += "xref\n0 7\n";
    output += "0000000000 65535 f \n";
    for (let index = 1; index <= objects.length; index += 1) {
      output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
    }
    output += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    return new TextEncoder().encode(output);
  }
}

function drawText(line: TextLine): string {
  const font = line.bold ? "F2" : "F1";
  const size = line.size ?? 11;
  return `BT /${font} ${size} Tf 1 0 0 1 ${line.x ?? 48} ${line.y} Tm (${escapePdfString(normalizePdfText(line.text))}) Tj ET`;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function escapePdfString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function normalizePdfText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

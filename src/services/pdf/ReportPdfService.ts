export type ReportPdfRow = {
  code: string;
  createdAt: string;
  operator: string;
  plan: string;
  priceLabel: string;
  router: string;
  status: string;
};

export type ReportPdfInput = {
  generatedAt: string;
  rows: ReportPdfRow[];
  summary: string[];
  title: string;
};

export function generateReportPdf(input: ReportPdfInput): Uint8Array {
  const rowsPerPage = 34;
  const rowChunks = chunk(input.rows, rowsPerPage);
  const pages = rowChunks.length > 0 ? rowChunks : [[]];
  const objects = new Map<number, string>();
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  let nextId = 5;

  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.set(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");

  pages.forEach((rows, pageIndex) => {
    const pageId = nextId++;
    const contentId = nextId++;
    const lines = [
      { bold: true, size: 18, text: input.title, x: 42, y: 790 },
      { size: 9, text: `Généré le ${input.generatedAt} · Page ${pageIndex + 1}/${pages.length}`, x: 42, y: 770 },
      ...input.summary.map((text, index) => ({ size: 9, text, x: 42, y: 744 - index * 15 })),
      { bold: true, size: 8, text: "Code        Plan                  Statut       Routeur              Créé le", x: 42, y: 650 },
      ...rows.map((row, index) => ({
        size: 7,
        text: `${truncate(row.code, 12).padEnd(13)}${truncate(row.plan, 22).padEnd(23)}${truncate(row.status, 12).padEnd(13)}${truncate(row.router, 20).padEnd(21)}${row.createdAt}`,
        x: 42,
        y: 632 - index * 16
      }))
    ];
    const stream = `${lines.map(drawText).join("\n")}\n`;
    objects.set(contentId, `<< /Length ${byteLength(stream)} >>\nstream\n${stream}endstream`);
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
    contentIds.push(contentId);
  });

  objects.set(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);

  let output = "%PDF-1.4\n";
  const offsets = [0];
  const maxId = Math.max(...objects.keys());

  for (let id = 1; id <= maxId; id += 1) {
    offsets[id] = byteLength(output);
    output += `${id} 0 obj\n${objects.get(id) ?? "<<>>"}\nendobj\n`;
  }

  const xrefOffset = byteLength(output);
  output += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= maxId; id += 1) {
    output += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(output);
}

function drawText(line: { bold?: boolean; size: number; text: string; x: number; y: number }): string {
  const font = line.bold ? "F2" : "F1";
  return `BT /${font} ${line.size} Tf 1 0 0 1 ${line.x} ${line.y} Tm (${escapePdfString(normalizePdfText(line.text))}) Tj ET`;
}

function escapePdfString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function normalizePdfText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "").trim();
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

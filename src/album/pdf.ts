/* A PDF of the album: one page per spread, at the album's real size.
 *
 * Why this file and not a library: a proof PDF is a page box and a JPEG, and
 * that is the whole format. Written here, the photographs go in EXACTLY as
 * they came out of the renderer — a PDF can carry a JPEG whole (`DCTDecode`),
 * so nothing is decoded and re-encoded on the way in and the client sees the
 * same pixels the proof was made of. Every library that would save these
 * eighty lines re-encodes, and the second compression is visible in skin.
 *
 * The page box is set from millimetres, not from pixels: a proof printed by a
 * client at home, or measured by a printer, has to come out at the album's
 * true size whatever resolution it was rendered at. 72 points = 1 inch.
 */

const POINTS_PER_MM = 72 / 25.4;

export interface PdfPage {
  /** The rendered sheet, already a JPEG. Embedded byte for byte. */
  jpeg: Blob;
  widthPx: number;
  heightPx: number;
  /** The finished size of this sheet, which is what the page box becomes. */
  widthMm: number;
  heightMm: number;
}

export interface PdfMeta {
  title: string;
  subject?: string;
}

const encoder = new TextEncoder();

function ascii(value: string): Uint8Array {
  return encoder.encode(value);
}

/** A PDF text string in Hebrew: UTF-16BE with a byte-order mark, written as
 *  hex so no byte in it can be read as PDF syntax. */
function pdfText(value: string): string {
  let hex = 'FEFF';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 32;
    if (code > 0xffff) {
      const offset = code - 0x10000;
      hex += (0xd800 + (offset >> 10)).toString(16).padStart(4, '0');
      hex += (0xdc00 + (offset & 0x3ff)).toString(16).padStart(4, '0');
    } else {
      hex += code.toString(16).padStart(4, '0');
    }
  }
  return `<${hex.toUpperCase()}>`;
}

function pdfDate(when: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  const offset = -when.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  return `D:${when.getFullYear()}${two(when.getMonth() + 1)}${two(when.getDate())}`
    + `${two(when.getHours())}${two(when.getMinutes())}${two(when.getSeconds())}`
    + `${sign}${two(Math.floor(absolute / 60))}'${two(absolute % 60)}'`;
}

/** Every page as a JPEG, bound into one file.
 *
 * Object numbering: 1 catalogue, 2 page tree, 3 document information, then
 * three objects per page — the page, its content stream, its image. */
export async function jpegPagesToPdf(pages: PdfPage[], meta: PdfMeta): Promise<Blob> {
  if (!pages.length) throw new Error('אין עמודים לייצוא');

  const bytes = await Promise.all(pages.map(async (page) => new Uint8Array(
    await page.jpeg.arrayBuffer(),
  )));

  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;

  const push = (chunk: Uint8Array | string) => {
    const data = typeof chunk === 'string' ? ascii(chunk) : chunk;
    parts.push(data);
    length += data.byteLength;
  };
  /** Objects must be findable by byte offset, so each one records where it
   *  began. An offset that is off by one byte is a file no reader will open. */
  const openObject = (id: number) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
  };

  push('%PDF-1.4\n');
  // A comment of high bytes is how a PDF declares itself binary, so a transfer
  // that "helpfully" converts line endings is caught instead of silently
  // corrupting every photograph in the file.
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const pageId = (index: number) => 4 + index * 3;

  openObject(1);
  push(`<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);

  openObject(2);
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${
    pages.map((_, index) => `${pageId(index)} 0 R`).join(' ')
  }] >>\nendobj\n`);

  openObject(3);
  push(`<< /Title ${pdfText(meta.title)}${
    meta.subject ? ` /Subject ${pdfText(meta.subject)}` : ''
  } /Producer ${pdfText('TEZA')} /CreationDate (${pdfDate(new Date())}) >>\nendobj\n`);

  pages.forEach((page, index) => {
    const id = pageId(index);
    const contentId = id + 1;
    const imageId = id + 2;
    const width = (page.widthMm * POINTS_PER_MM).toFixed(3);
    const height = (page.heightMm * POINTS_PER_MM).toFixed(3);

    openObject(id);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}]`
      + ` /Resources << /XObject << /Im0 ${imageId} 0 R >> >>`
      + ` /Contents ${contentId} 0 R >>\nendobj\n`);

    // The image fills the page: scale the unit square to the page box.
    const stream = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q\n`;
    openObject(contentId);
    push(`<< /Length ${ascii(stream).byteLength} >>\nstream\n`);
    push(stream);
    push('endstream\nendobj\n');

    openObject(imageId);
    push(`<< /Type /XObject /Subtype /Image /Width ${page.widthPx}`
      + ` /Height ${page.heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8`
      + ` /Filter /DCTDecode /Length ${bytes[index].byteLength} >>\nstream\n`);
    push(bytes[index]);
    push('\nendstream\nendobj\n');
  });

  const count = pages.length * 3 + 4;
  const startxref = length;
  push(`xref\n0 ${count}\n`);
  push('0000000000 65535 f \n');
  for (let id = 1; id < count; id += 1) {
    push(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`);
  }
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\n`);
  push(`startxref\n${startxref}\n%%EOF\n`);

  return new Blob(parts as BlobPart[], { type: 'application/pdf' });
}

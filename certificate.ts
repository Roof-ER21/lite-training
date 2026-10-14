/**
 * Roof-ER Certificate of Completion.
 *
 * One polished, print-ready certificate for every certified representative.
 * Rendered at 3300 x 2550 (US Letter landscape at 300 dpi) and downloadable
 * as a high-resolution PNG or a real PDF. Eligibility is intentionally
 * simple: anyone whose exam state says "certified" — whether that came from
 * passing on this device or from the server sync — can download, any time,
 * from the Final Exam screen or from My Page.
 */

export interface CertificateDetails {
  certificateId?: string;
  recipientName: string;
  score: number;
  /** ISO date string (or anything `new Date()` can parse) of certification. */
  certificationDate: string;
}

export const CERTIFICATE_WIDTH = 3300;
export const CERTIFICATE_HEIGHT = 2550;

/** Brand palette (canvas cannot read CSS custom properties). Keep in sync with theme.css. */
const INK = '#141518';
const PAPER = '#FFFFFF';
const RED = '#B60807';
const RED_DEEP = '#8C0605';
const CHARCOAL = '#101112';
const GRAY = '#5A6066';
const HAIRLINE = '#C9C4B8';

const SIGNATORIES = [
  { name: 'Oliver Brown', title: 'Oliver Brown, CEO & Founder' },
  { name: 'Reese Samala', title: 'Reese Samala, Director of Sales' },
  { name: 'Ford Barsi', title: 'Ford Barsi, General Manager' },
] as const;

/** Anyone recorded as certified may download — no other gate. */
export function isCertificateEligible(state: { isCertified?: boolean | null }): boolean {
  return state?.isCertified === true;
}

/** Stable, verifiable-looking ID derived from the certificate contents. */
export function certificateIdFor(details: CertificateDetails): string {
  if (details.certificateId) return details.certificateId;
  const seed = `${details.recipientName.trim().toLowerCase()}|${details.certificationDate}|${Math.round(details.score)}`;
  let hash = 0x811c9dc5; // FNV-1a
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const year = new Date(details.certificationDate).getFullYear() || new Date().getFullYear();
  return `RER-${year}-${(hash >>> 0).toString(36).toUpperCase().padStart(7, '0')}`;
}

export function certificateFileBase(recipientName: string): string {
  const cleaned = recipientName.trim().replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '');
  return `RoofER_Certificate_${cleaned || 'Representative'}`;
}

export function formatCertificateDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** Wrap raw JPEG bytes in a single-page US Letter landscape PDF (11in x 8.5in). */
export function buildCertificatePdf(jpeg: Uint8Array): Blob {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };

  push('%PDF-1.4\n');
  const objects: (string | Uint8Array)[][] = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    ['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /XObject << /Cert 4 0 R >> >> /Contents 5 0 R >>'],
    [`<< /Type /XObject /Subtype /Image /Width ${CERTIFICATE_WIDTH} /Height ${CERTIFICATE_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`, jpeg, '\nendstream'],
    [],
  ];
  const content = 'q\n792 0 0 612 0 0 cm\n/Cert Do\nQ\n';
  objects[4] = [`<< /Length ${content.length} >>\nstream\n${content}endstream`];

  objects.forEach((objectParts, index) => {
    offsets[index + 1] = length;
    push(`${index + 1} 0 obj\n`);
    objectParts.forEach(push);
    push('\nendobj\n');
  });

  const xrefStart = length;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objects.length; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return new Blob([bytes], { type: 'application/pdf' });
}

function loadLogo(): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const logo = new Image();
    logo.onload = () => resolve(logo);
    logo.onerror = () => resolve(null);
    logo.src = '/assets/logo-roofdocs.png';
  });
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: string, size: number, family: string, maxWidth: number): number {
  let current = size;
  while (current > 40) {
    ctx.font = `${weight} ${current}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    current -= 8;
  }
  return current;
}

function centered(ctx: CanvasRenderingContext2D, text: string, y: number): void {
  ctx.fillText(text, CERTIFICATE_WIDTH / 2, y);
}

function drawSeal(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, 168, 0, Math.PI * 2); ctx.fillStyle = RED; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, 142, 0, Math.PI * 2); ctx.strokeStyle = PAPER; ctx.lineWidth = 4; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 108, 0, Math.PI * 2); ctx.fillStyle = RED_DEEP; ctx.fill();
  // Check mark
  ctx.strokeStyle = PAPER; ctx.lineWidth = 26; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(cx - 52, cy - 2); ctx.lineTo(cx - 14, cy + 38); ctx.lineTo(cx + 58, cy - 42); ctx.stroke();
  ctx.fillStyle = PAPER; ctx.textAlign = 'center';
  ctx.font = '600 24px Geist, Arial, sans-serif';
  ctx.fillText('CERTIFIED', cx, cy + 88);
  ctx.restore();
}

/** Draw the certificate onto a fresh 300-dpi canvas. */
export async function renderCertificateCanvas(details: CertificateDetails): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = CERTIFICATE_WIDTH;
  canvas.height = CERTIFICATE_HEIGHT;
  const ctx = canvas.getContext('2d')!;
  const cx = CERTIFICATE_WIDTH / 2;
  const certificateId = certificateIdFor(details);

  // Paper and double frame: charcoal outer rule, red keyline, hairline inner rule.
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, CERTIFICATE_WIDTH, CERTIFICATE_HEIGHT);
  ctx.strokeStyle = CHARCOAL; ctx.lineWidth = 10; ctx.strokeRect(56, 56, CERTIFICATE_WIDTH - 112, CERTIFICATE_HEIGHT - 112);
  ctx.strokeStyle = RED; ctx.lineWidth = 3; ctx.strokeRect(84, 84, CERTIFICATE_WIDTH - 168, CERTIFICATE_HEIGHT - 168);
  ctx.strokeStyle = HAIRLINE; ctx.lineWidth = 2; ctx.strokeRect(104, 104, CERTIFICATE_WIDTH - 208, CERTIFICATE_HEIGHT - 208);

  // Corner ornaments
  ctx.strokeStyle = INK; ctx.lineWidth = 8;
  for (const [x, y, dx, dy] of [[140, 140, 1, 1], [CERTIFICATE_WIDTH - 140, 140, -1, 1], [140, CERTIFICATE_HEIGHT - 140, 1, -1], [CERTIFICATE_WIDTH - 140, CERTIFICATE_HEIGHT - 140, -1, -1]] as const) {
    ctx.beginPath(); ctx.moveTo(x + 150 * dx, y); ctx.lineTo(x, y); ctx.lineTo(x, y + 150 * dy); ctx.stroke();
  }

  ctx.textAlign = 'center';

  const logo = await loadLogo();
  if (logo) {
    const logoWidth = 820;
    const logoHeight = (logo.height / logo.width) * logoWidth;
    ctx.drawImage(logo, cx - logoWidth / 2, 138, logoWidth, logoHeight);
  } else {
    ctx.fillStyle = INK; ctx.font = '800 150px Geist, Arial, sans-serif';
    centered(ctx, 'ROOF-ER', 420);
  }

  ctx.fillStyle = INK;
  ctx.font = '400 96px Georgia, "Times New Roman", serif';
  centered(ctx, 'Certificate of Completion', 716);

  // Red rule with centre diamond
  ctx.strokeStyle = RED; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(cx - 560, 770); ctx.lineTo(cx - 42, 770); ctx.moveTo(cx + 42, 770); ctx.lineTo(cx + 560, 770); ctx.stroke();
  ctx.save(); ctx.translate(cx, 770); ctx.rotate(Math.PI / 4); ctx.fillStyle = RED; ctx.fillRect(-17, -17, 34, 34); ctx.restore();

  ctx.fillStyle = GRAY; ctx.font = 'italic 44px Georgia, "Times New Roman", serif';
  centered(ctx, 'This certifies that', 884);

  const name = details.recipientName.trim() || 'Certified Representative';
  ctx.fillStyle = INK;
  fitFont(ctx, name, '700', 132, 'Georgia, "Times New Roman", serif', CERTIFICATE_WIDTH - 700);
  centered(ctx, name, 1022);
  ctx.strokeStyle = RED; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx - 640, 1074); ctx.lineTo(cx + 640, 1074); ctx.stroke();

  ctx.fillStyle = GRAY; ctx.font = '44px Georgia, "Times New Roman", serif';
  centered(ctx, 'has successfully completed the Roof-ER Sales Representative Training Program', 1188);
  centered(ctx, 'and is hereby certified as a', 1262);

  ctx.fillStyle = RED; ctx.font = '700 76px Georgia, "Times New Roman", serif';
  centered(ctx, 'Certified Sales Representative', 1376);

  // Credential facts: score / date / certificate ID, separated by hairlines.
  const facts: Array<[string, string]> = [
    ['FINAL EXAM SCORE', `${Math.round(details.score)}%`],
    ['DATE CERTIFIED', formatCertificateDate(details.certificationDate)],
    ['CERTIFICATE ID', certificateId],
  ];
  ctx.font = '600 27px Geist, Arial, sans-serif';
  facts.forEach(([label, value], i) => {
    const x = cx + (i - 1) * 760;
    ctx.fillStyle = GRAY; ctx.fillText(label, x, 1536);
    ctx.fillStyle = INK; ctx.font = '600 42px Geist, Arial, sans-serif';
    ctx.fillText(value, x, 1600);
    ctx.font = '600 27px Geist, Arial, sans-serif';
    if (i > 0) { ctx.strokeStyle = HAIRLINE; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 380, 1500); ctx.lineTo(x - 380, 1612); ctx.stroke(); }
  });

  drawSeal(ctx, 420, 1980);

  // Signatures
  SIGNATORIES.forEach((signatory, i) => {
    const x = cx + (i - 1) * 760 + 260;
    ctx.fillStyle = INK; ctx.font = 'italic 58px Georgia, "Times New Roman", serif';
    ctx.fillText(signatory.name, x, 2036);
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 300, 2086); ctx.lineTo(x + 300, 2086); ctx.stroke();
    ctx.fillStyle = GRAY; ctx.font = '30px Geist, Arial, sans-serif';
    ctx.fillText(signatory.title, x, 2142);
  });

  ctx.fillStyle = GRAY; ctx.font = '26px Geist, Arial, sans-serif';
  centered(ctx, `Roof-ER Sales Training · Certificate ID ${certificateId}`, 2330);

  return canvas;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Download the certificate as PNG or PDF. Safe to call for any certified user. */
export async function downloadCertificate(details: CertificateDetails, format: 'png' | 'pdf'): Promise<void> {
  const canvas = await renderCertificateCanvas(details);
  const base = certificateFileBase(details.recipientName);
  if (format === 'png') {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('Could not prepare the certificate image. Please try again.');
    saveBlob(blob, `${base}.png`);
    return;
  }
  const jpegBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!jpegBlob) throw new Error('Could not prepare the certificate PDF. Please try again.');
  const jpeg = new Uint8Array(await jpegBlob.arrayBuffer());
  saveBlob(buildCertificatePdf(jpeg), `${base}.pdf`);
}

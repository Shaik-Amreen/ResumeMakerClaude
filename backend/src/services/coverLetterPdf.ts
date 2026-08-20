/**
 * Build a clean one-page Helvetica cover-letter PDF.
 * Body starts at "Dear Hiring Team" — no contact header / recipient block
 * (those already live on the resume; ATS uploads want letter-only).
 */
import fs from 'fs';
import path from 'path';
import { config } from '../config';

const SIGN_OFF_NAME = 'Karthik Kovi';

function escapePdf(s: string): string {
  return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapLines(text: string, maxLen = 86, maxLines = 52): string[] {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .flatMap((line) => {
      const words = line.split(/\s+/).filter(Boolean);
      if (!words.length) return [''];
      const out: string[] = [];
      let cur = '';
      for (const w of words) {
        const next = cur ? `${cur} ${w}` : w;
        if (next.length > maxLen) {
          if (cur) out.push(cur);
          cur = w;
        } else cur = next;
      }
      if (cur) out.push(cur);
      return out;
    })
    .slice(0, maxLines);
}

/**
 * Popular ATS-friendly cover letter shape (Harvard / Indeed style):
 * Dear Hiring Team → 3 short paragraphs → Sincerely → name.
 * Strips duplicate contact headers, job-title lines, and recipient address blocks.
 */
export function normalizeCoverLetterBody(
  raw: string,
  opts?: { title?: string; company?: string }
): string {
  let text = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u2014|\u2013/g, '-')
    .trim();

  if (!text) return '';

  // Drop everything before the salutation if a header/address block was prepended.
  const dearIdx = text.search(/\bDear\s+Hiring\s+(Team|Manager)\b/i);
  if (dearIdx > 0) text = text.slice(dearIdx);

  // If still starting with contact/name lines, drop leading non-body lines.
  const lines = text.split('\n').map((l) => l.trimEnd());
  let start = 0;
  for (let i = 0; i < Math.min(lines.length, 14); i++) {
    const l = lines[i].trim();
    if (!l) {
      start = i + 1;
      continue;
    }
    if (/^Dear\s+Hiring\s+(Team|Manager)\b/i.test(l)) {
      start = i;
      break;
    }
    if (
      /karthik\s*kovi/i.test(l) ||
      /@/.test(l) ||
      /\+?1?\s*\(?\d{3}\)?/.test(l) ||
      /linkedin\.com/i.test(l) ||
      /hiring manager/i.test(l) ||
      /cupertino|menlo park|california|united states/i.test(l) ||
      (opts?.title && l.toLowerCase().includes(opts.title.toLowerCase().slice(0, 24))) ||
      (opts?.company && /^apple$|^snowflake$|^google$/i.test(l.trim()))
    ) {
      start = i + 1;
      continue;
    }
    // Unknown preamble — stop scanning
    break;
  }
  text = lines.slice(start).join('\n').trim();

  // Force popular salutation
  text = text.replace(/^Dear\s+Hiring\s+Manager\b[,:]?\s*/i, 'Dear Hiring Team,\n\n');
  text = text.replace(/^Dear\s+Hiring\s+Team\b[,:]?\s*/i, 'Dear Hiring Team,\n\n');
  if (!/^Dear\s+Hiring\s+Team/i.test(text)) {
    text = `Dear Hiring Team,\n\n${text}`;
  }

  // Normalize sign-off
  text = text
    .replace(/\b(Best regards|Kind regards|Respectfully|Yours truly)\b[,!]?\s*$/im, 'Sincerely,')
    .replace(/\bSincerely\b[,!]?\s*$/im, 'Sincerely,');

  if (!/\bSincerely,/i.test(text)) {
    text = `${text.trim()}\n\nSincerely,\n${SIGN_OFF_NAME}`;
  } else if (!new RegExp(`${SIGN_OFF_NAME}\\s*$`, 'i').test(text)) {
    text = text.replace(/\bSincerely,\s*$/i, `Sincerely,\n${SIGN_OFF_NAME}`);
    if (!new RegExp(SIGN_OFF_NAME, 'i').test(text.split(/\bSincerely,/i)[1] || '')) {
      text = `${text.trim()}\n${SIGN_OFF_NAME}`;
    }
  }

  // Collapse 3+ blank lines → paragraph spacing
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

export function buildCoverLetterPdfBuffer(text: string): Buffer {
  const body = wrapLines(normalizeCoverLetterBody(text));
  // Helvetica 11pt, left-aligned, comfortable margins (letter 612x792)
  const ops = ['BT', '/F1 11 Tf', '54 720 Td', '15 TL'];
  body.forEach((line, i) => {
    if (i === 0) ops.push(`(${escapePdf(line)}) Tj`);
    else ops.push('T*', `(${escapePdf(line)}) Tj`);
  });
  ops.push('ET');
  const stream = ops.join('\n');

  const objects = [
    '1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n',
    '2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n',
    '3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n',
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  }
  const xref = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

export function coverLetterDownloadFilename(company?: string, now = new Date()): string {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mon = MONTHS[now.getMonth()] || 'Jan';
  const yy = String(now.getFullYear()).slice(-2);
  const clean = (s: string) =>
    (s || '')
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/\s+/g, '_')
      .trim()
      .slice(0, 40);
  const c = clean(company || '');
  return c
    ? `Karthik_Kovi_Cover_Letter_${c}_${mon}${yy}.pdf`
    : `Karthik_Kovi_Cover_Letter_${mon}${yy}.pdf`;
}

/** Persist cover letter PDF under uploads and return absolute path. */
export function writeCoverLetterPdf(opts: {
  jobId: string;
  text: string;
  company?: string;
  title?: string;
}): { pdfPath: string; filename: string; buffer: Buffer } {
  const filename = coverLetterDownloadFilename(opts.company);
  const normalized = normalizeCoverLetterBody(opts.text, {
    title: opts.title,
    company: opts.company,
  });
  const buffer = buildCoverLetterPdfBuffer(normalized);
  const dir = path.join(config.uploadsDir, 'cover-letters');
  fs.mkdirSync(dir, { recursive: true });
  const pdfPath = path.join(dir, `${opts.jobId}-${filename}`);
  fs.writeFileSync(pdfPath, buffer);
  return { pdfPath, filename, buffer };
}

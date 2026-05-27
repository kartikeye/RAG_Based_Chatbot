import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

export const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
]);

export interface ExtractTextParams {
  buffer: Buffer;
  mimeType: string;
}

export async function extractText({ buffer, mimeType }: ExtractTextParams): Promise<string> {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('extractText: buffer must be a non-empty Buffer');
  }

  let raw: string;
  switch (mimeType) {
    case 'application/pdf':
      raw = await extractFromPdf(buffer);
      break;
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      raw = await extractFromDocx(buffer);
      break;
    case 'text/plain':
    case 'text/markdown':
      raw = buffer.toString('utf8');
      break;
    default:
      throw new Error(`extractText: unsupported mime type "${mimeType}"`);
  }

  return cleanText(raw);
}

async function extractFromPdf(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  return result.text ?? '';
}

async function extractFromDocx(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? '';
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\x00-\x08\x0B-\x1F\x7F]/g, '')
    .replace(/[  -​  　]/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

const DEFAULT_CHUNK_SIZE = 2000;
const DEFAULT_OVERLAP = 200;

const SEPARATORS = ['\n\n', '\n', '. ', '! ', '? ', '; ', ', ', ' ', ''];

export interface Chunk {
  content: string;
  index: number;
}

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_OVERLAP;

  if (chunkOverlap >= chunkSize) {
    throw new Error('chunkOverlap must be smaller than chunkSize');
  }
  if (!text || typeof text !== 'string') return [];

  const pieces = recursiveSplit(text, chunkSize, SEPARATORS);
  const chunks = mergeWithOverlap(pieces, chunkSize, chunkOverlap);
  return chunks.map((content, i) => ({ content, index: i }));
}

function recursiveSplit(text: string, chunkSize: number, separators: string[]): string[] {
  if (text.length <= chunkSize) return [text];

  for (const sep of separators) {
    if (sep === '') {
      const out: string[] = [];
      for (let i = 0; i < text.length; i += chunkSize) {
        out.push(text.slice(i, i + chunkSize));
      }
      return out;
    }

    const parts = text.split(sep);
    if (parts.length === 1) continue;

    const reattached = parts.map((p, i) => (i < parts.length - 1 ? p + sep : p));

    const out: string[] = [];
    for (const part of reattached) {
      if (part.length <= chunkSize) {
        if (part.length > 0) out.push(part);
      } else {
        const sub = recursiveSplit(part, chunkSize, separators.slice(separators.indexOf(sep) + 1));
        out.push(...sub);
      }
    }
    return out;
  }

  return [text];
}

function mergeWithOverlap(pieces: string[], chunkSize: number, chunkOverlap: number): string[] {
  if (pieces.length === 0) return [];

  const chunks: string[] = [];
  let current = '';

  for (const piece of pieces) {
    if (current.length + piece.length > chunkSize && current.length > 0) {
      chunks.push(current);
      current = current.slice(-chunkOverlap);
    }
    current += piece;
  }

  if (current.length > 0) chunks.push(current);
  return chunks.map((c) => c.trim()).filter((c) => c.length > 0);
}

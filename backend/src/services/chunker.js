// src/services/chunker.js
//
// Recursive character-based text splitter with overlap.
//
// Strategy:
//   Try to split text into chunks of `chunkSize` characters, preferring
//   semantic boundaries in order of "naturalness":
//     1. Double newline (paragraph break)
//     2. Single newline (line break)
//     3. Sentence terminator (. ! ? followed by space)
//     4. Space (word boundary)
//     5. Hard character cut (last resort)
//
//   Consecutive chunks overlap by `chunkOverlap` characters so that
//   semantic units straddling a boundary appear whole in at least one chunk.
//
// Why character-based instead of token-based?
//   Token counts depend on the tokenizer (Titan, Claude, GPT use different
//   ones). Characters are a stable approximation: ~4 chars per token for
//   English. 2000 chars ≈ 500 tokens, our target chunk size.

const DEFAULT_CHUNK_SIZE = 2000;     // ~500 tokens for English
const DEFAULT_OVERLAP = 200;          // ~50 tokens overlap

// Separators ordered from most preferred (largest semantic unit) to least.
// The chunker walks this list; the first separator that produces splits
// smaller than chunkSize wins. The empty string at the end is the hard
// fall-through — split by single characters if nothing else works.
const SEPARATORS = [
  '\n\n',         // paragraph
  '\n',           // line
  '. ',           // sentence (period + space)
  '! ',           // sentence (exclamation)
  '? ',           // sentence (question)
  '; ',           // semicolon
  ', ',           // comma
  ' ',            // word
  '',             // character (last resort)
];

/**
 * chunkText(text, { chunkSize, chunkOverlap })
 * Returns an array of { content, index } objects.
 *
 * Note: indexes are sequential starting at 0; they correspond to the
 * `chunk_index` column in the `chunks` table.
 */
export function chunkText(text, options = {}) {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_OVERLAP;

  if (chunkOverlap >= chunkSize) {
    throw new Error('chunkOverlap must be smaller than chunkSize');
  }
  if (!text || typeof text !== 'string') return [];

  // 1. Recursive split — break the document into pieces no larger than chunkSize.
  const pieces = recursiveSplit(text, chunkSize, SEPARATORS);

  // 2. Merge adjacent small pieces back together (so we don't end up with
  //    20-char chunks just because there were lots of paragraph breaks),
  //    and insert overlap between consecutive chunks.
  const chunks = mergeWithOverlap(pieces, chunkSize, chunkOverlap);

  return chunks.map((content, i) => ({ content, index: i }));
}

// ---------------------------------------------------------------------------
// recursiveSplit — pure splitter, no overlap, no merging.
// Returns an array of text pieces each <= chunkSize.
// ---------------------------------------------------------------------------
function recursiveSplit(text, chunkSize, separators) {
  if (text.length <= chunkSize) return [text];

  // Find the FIRST separator from the list that produces pieces all
  // smaller than chunkSize. If no separator works (e.g., a 100k-char string
  // with no whitespace), fall through to character-level split.
  for (const sep of separators) {
    if (sep === '') {
      // Hard character cut — slice into chunkSize-sized pieces.
      const out = [];
      for (let i = 0; i < text.length; i += chunkSize) {
        out.push(text.slice(i, i + chunkSize));
      }
      return out;
    }

    const parts = text.split(sep);
    // If splitting on this separator didn't actually break anything, try the next one.
    if (parts.length === 1) continue;

    // Re-attach the separator to each part except the last, so we don't lose it.
    // (Important — without this, "Hello. World." would become "Hello" and "World."
    // and a chunk boundary mid-period would look wrong.)
    const reattached = parts.map((p, i) =>
      i < parts.length - 1 ? p + sep : p
    );

    // Recurse: any part still too big gets split by the NEXT separator.
    const out = [];
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

// ---------------------------------------------------------------------------
// mergeWithOverlap — combine adjacent small pieces into ~chunkSize chunks
// and add overlap between consecutive chunks.
// ---------------------------------------------------------------------------
function mergeWithOverlap(pieces, chunkSize, chunkOverlap) {
  if (pieces.length === 0) return [];

  const chunks = [];
  let current = '';

  for (const piece of pieces) {
    // If adding this piece would overflow chunkSize, emit current chunk.
    if (current.length + piece.length > chunkSize && current.length > 0) {
      chunks.push(current);
      // Start the next chunk with the trailing `chunkOverlap` chars of
      // the chunk we just emitted. That's the overlap.
      current = current.slice(-chunkOverlap);
    }
    current += piece;
  }

  // Don't forget the tail.
  if (current.length > 0) chunks.push(current);

  // Trim each chunk so we don't have leading/trailing whitespace that
  // wastes embedding tokens.
  return chunks.map((c) => c.trim()).filter((c) => c.length > 0);
}

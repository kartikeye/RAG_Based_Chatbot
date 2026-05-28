// src/types/pdf-parse.d.ts
//
// Ambient module declaration for `pdf-parse`, which ships no TypeScript types
// and isn't on DefinitelyTyped. We declare just enough of the public surface
// for our use (the default export taking a Buffer and returning text + meta).
//
// Interview talking point:
//   For untyped third-party libraries, you have three options —
//     1. install @types/<name> if it exists on DefinitelyTyped,
//     2. write a local ambient .d.ts like this one,
//     3. use `// @ts-expect-error` per call site (worst — kills type safety).
//   Option 2 is the right balance for libraries you call in 1-2 places.

declare module 'pdf-parse' {
  export interface PdfParseResult {
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
    text: string;
  }

  /**
   * Parses a PDF buffer and returns its extracted text and metadata.
   */
  function pdfParse(
    dataBuffer: Buffer,
    options?: Record<string, unknown>
  ): Promise<PdfParseResult>;

  export default pdfParse;
}

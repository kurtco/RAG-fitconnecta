// Deep import avoids pdf-parse index.js debug-mode side effect (reads a local
// test fixture when module.parent is undefined, which breaks under ESM).
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export interface ParseOptions {
  maxBytes: number;
}

export interface ParsedDocument {
  text: string;
  charCount: number;
}

export class UnsupportedDocumentError extends Error {
  override name = "UnsupportedDocumentError";
}

export class DocumentParseError extends Error {
  override name = "DocumentParseError";
}

const SUPPORTED_MIME_TYPES = new Set(["text/plain", "application/pdf"]);
const SUPPORTED_EXTENSIONS = new Set([".txt", ".pdf"]);

/** Validates type and size before any processing (multer enforces size too). */
export function assertSupportedFile(
  mimeType: string,
  filename: string,
  sizeBytes: number,
  options: ParseOptions,
): void {
  const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (!SUPPORTED_MIME_TYPES.has(mimeType) || !SUPPORTED_EXTENSIONS.has(extension)) {
    throw new UnsupportedDocumentError(
      `Unsupported file type "${mimeType}" (${extension || "no extension"}). Allowed: .txt, .pdf`,
    );
  }
  if (sizeBytes <= 0) {
    throw new DocumentParseError("File is empty");
  }
  if (sizeBytes > options.maxBytes) {
    throw new DocumentParseError(
      `File exceeds the ${Math.floor(options.maxBytes / (1024 * 1024))}MB limit`,
    );
  }
}

export async function parseDocument(buffer: Buffer, mimeType: string): Promise<ParsedDocument> {
  let text: string;
  try {
    if (mimeType === "application/pdf") {
      const parsed = await pdfParse(buffer);
      text = parsed.text;
    } else {
      text = buffer.toString("utf8");
    }
  } catch (error) {
    throw new DocumentParseError(
      `Could not extract text: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  // Normalize whitespace; drop control chars except newlines/tabs.
  text = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length === 0) {
    throw new DocumentParseError("Document contains no extractable text");
  }
  return { text, charCount: text.length };
}

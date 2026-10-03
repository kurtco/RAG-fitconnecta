import { createHash } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import type { AppConfig } from "../../config.js";
import type {
  ChunkRepository,
  DocumentRepository,
  EmbeddingProvider,
} from "../../domain/ports.js";
import { ApiError, type AuthenticatedRequest } from "../../middleware/auth.js";
import { assertSupportedFile, parseDocument } from "../../rag/parse.js";
import { chunkText } from "../../rag/chunk.js";

export interface DocumentsRouterDeps {
  documents: DocumentRepository;
  chunks: ChunkRepository;
  embeddings: EmbeddingProvider;
  config: AppConfig;
}

export function createDocumentsRouter(deps: DocumentsRouterDeps): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: deps.config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  });

  /** POST /api/v1/documents — multipart upload, synchronous ingestion (SPEC/README trade-off). */
  router.post("/", upload.single("file"), async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = requireUser(req);
      const file = req.file;
      if (!file) {
        throw new ApiError(400, "file_required", "Multipart field 'file' is required");
      }

      assertSupportedFile(file.mimetype, file.originalname, file.size, {
        maxBytes: deps.config.MAX_UPLOAD_MB * 1024 * 1024,
      });

      const sha256 = createHash("sha256").update(file.buffer).digest("hex");
      const document = await deps.documents.create({
        ownerId: userId,
        filename: file.originalname.slice(0, 255),
        mimeType: file.mimetype,
        sizeBytes: file.size,
        sha256,
      });

      try {
        await deps.documents.markProcessing(document.id);
        const parsed = await parseDocument(file.buffer, file.mimetype);
        const chunks = chunkText(parsed.text, {
          chunkTokens: deps.config.RAG_CHUNK_TOKENS,
          overlapTokens: deps.config.RAG_CHUNK_OVERLAP,
        });
        if (chunks.length === 0) {
          throw new Error("Document produced no chunks");
        }
        const vectors = await deps.embeddings.embed(chunks.map((c) => c.content));
        await deps.chunks.insertMany(
          chunks.map((chunk, i) => ({
            documentId: document.id,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            tokenEst: chunk.tokenEst,
            embedding: vectors[i] ?? [],
          })),
        );
        await deps.documents.markReady(document.id, {
          charCount: parsed.charCount,
          chunkCount: chunks.length,
        });
        res.status(201).json({
          document: publicView({ ...document, status: "ready", chunkCount: chunks.length, charCount: parsed.charCount }),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Processing failed";
        await deps.documents.markFailed(document.id, message);
        res.status(422).json({
          error: { code: "processing_failed", message },
          document: publicView({ ...document, status: "failed", errorDetail: message }),
        });
      }
    } catch (error) {
      next(error);
    }
  });

  /** GET /api/v1/documents — owner-scoped list with ingestion status. */
  router.get("/", async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = requireUser(req);
      const documents = await deps.documents.listForOwner(userId);
      res.json({ documents: documents.map(publicView) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function requireUser(req: AuthenticatedRequest): string {
  if (!req.user) {
    throw new ApiError(401, "unauthenticated", "Authentication required");
  }
  return req.user.id;
}

/** Never expose owner ids, hashes or internal error details wholesale. */
function publicView(document: {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  chunkCount: number;
  charCount: number | null;
  status: string;
  errorDetail: string | null;
  createdAt: Date;
  processedAt: Date | null;
}) {
  return {
    id: document.id,
    filename: document.filename,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    chunkCount: document.chunkCount,
    charCount: document.charCount,
    status: document.status,
    errorDetail: document.status === "failed" ? document.errorDetail : null,
    createdAt: document.createdAt,
    processedAt: document.processedAt,
  };
}

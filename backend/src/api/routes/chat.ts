import { Router } from "express";
import { z } from "zod";
import type { ChatPipelineDeps, ChatStreamEvent } from "../../ai/pipeline/chat.js";
import { runChat, runChatStream } from "../../ai/pipeline/chat.js";
import type { ConversationRepository, MessageRepository } from "../../domain/ports.js";
import { ApiError, type AuthenticatedRequest } from "../../middleware/auth.js";

const chatBodySchema = z.object({
  question: z.string().min(1).max(4_000),
  conversationId: z.string().uuid().optional(),
});

export interface ChatRouterDeps {
  conversations: ConversationRepository;
  messages: MessageRepository;
  pipeline: ChatPipelineDeps;
}

const HISTORY_LIMIT = 6;

export function createChatRouter(deps: ChatRouterDeps): Router {
  const router = Router();

  /** POST /api/v1/chat — JSON answer (SPEC B2). */
  router.post("/", async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = requireUser(req);
      const { question, conversationId } = chatBodySchema.parse(req.body);
      const conversation = await resolveConversation(deps, conversationId, userId, question);
      const history = await loadHistory(deps, conversation.id);

      const output = await runChat({ question, history, ownerId: userId }, deps.pipeline);

      await deps.messages.create({ conversationId: conversation.id, role: "user", content: question });
      await deps.messages.create({
        conversationId: conversation.id,
        role: "assistant",
        content: output.answer,
        ai: output.ai,
      });

      res.json({
        conversationId: conversation.id,
        answer: output.answer,
        confidence: output.confidence,
        citations: output.citations,
        ai: output.ai,
      });
    } catch (error) {
      next(error);
    }
  });

  /** POST /api/v1/chat/stream — SSE token-by-token answer (bonus X1). */
  router.post("/stream", async (req: AuthenticatedRequest, res, next) => {
    try {
      const userId = requireUser(req);
      const { question, conversationId } = chatBodySchema.parse(req.body);
      const conversation = await resolveConversation(deps, conversationId, userId, question);
      const history = await loadHistory(deps, conversation.id);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });

      const send = (event: ChatStreamEvent) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      let aborted = false;
      req.on("close", () => {
        aborted = true;
      });

      let finalEvent: Extract<ChatStreamEvent, { type: "done" }> | undefined;
      for await (const event of runChatStream({ question, history, ownerId: userId }, deps.pipeline)) {
        if (aborted) break;
        if (event.type === "done") {
          finalEvent = event;
        }
        send({ ...event, ...(event.type === "done" ? { conversationId: conversation.id } : {}) } as ChatStreamEvent);
      }

      if (!aborted) {
        await deps.messages.create({ conversationId: conversation.id, role: "user", content: question });
        if (finalEvent) {
          await deps.messages.create({
            conversationId: conversation.id,
            role: "assistant",
            content: finalEvent.output.answer,
            ai: finalEvent.output.ai,
          });
        }
      }
      res.end();
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

async function resolveConversation(
  deps: ChatRouterDeps,
  conversationId: string | undefined,
  userId: string,
  question: string,
) {
  if (conversationId) {
    const existing = await deps.conversations.findByIdForOwner(conversationId, userId);
    if (!existing) {
      throw new ApiError(404, "conversation_not_found", "Conversation not found");
    }
    return existing;
  }
  return deps.conversations.create(userId, question.slice(0, 80));
}

async function loadHistory(deps: ChatRouterDeps, conversationId: string) {
  const messages = await deps.messages.listByConversation(conversationId, HISTORY_LIMIT);
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

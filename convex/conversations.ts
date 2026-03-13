import { query, mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

async function upsertSessionTurnCount(
  ctx: MutationCtx,
  sessionId: string,
  turnDelta: number,
  timestamp: number
) {
  const existing = await ctx.db
    .query("sessions")
    .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      turnCount: Math.max(0, Number(existing.turnCount || 0) + turnDelta),
    });
    return;
  }

  await ctx.db.insert("sessions", {
    sessionId,
    startedAt: timestamp,
    turnCount: Math.max(0, turnDelta),
  });
}

export const saveTurn = mutation({
  args: {
    role: v.string(),
    text: v.string(),
    cleanText: v.string(),
    embedding: v.array(v.number()),
    embeddingStatus: v.string(),
    embeddingUpdatedAt: v.optional(v.number()),
    sessionId: v.string(),
    timestamp: v.number(),
    source: v.string(),
    hasToolCalls: v.boolean(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("conversations", args);
    await upsertSessionTurnCount(ctx, args.sessionId, 1, args.timestamp);
    return id;
  },
});

export const saveTurnBatch = mutation({
  args: {
    turns: v.array(
      v.object({
        role: v.string(),
        text: v.string(),
        cleanText: v.string(),
        embedding: v.array(v.number()),
        embeddingStatus: v.string(),
        embeddingUpdatedAt: v.optional(v.number()),
        sessionId: v.string(),
        timestamp: v.number(),
        source: v.string(),
        hasToolCalls: v.boolean(),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const turn of args.turns) {
      await ctx.db.insert("conversations", turn);
      await upsertSessionTurnCount(ctx, turn.sessionId, 1, turn.timestamp);
    }
    return { inserted: args.turns.length };
  },
});

export const saveToolExecution = mutation({
  args: {
    sessionId: v.string(),
    toolName: v.string(),
    args: v.string(),
    result: v.string(),
    success: v.boolean(),
    timestamp: v.number(),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("tool_executions", args);
  },
});

export const upsertSession = mutation({
  args: {
    sessionId: v.string(),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    turnCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    const patch = Object.fromEntries(
      Object.entries({
        startedAt: args.startedAt,
        endedAt: args.endedAt,
        turnCount: args.turnCount,
      }).filter(([, value]) => value !== undefined)
    );

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("sessions", {
        sessionId: args.sessionId,
        startedAt: args.startedAt ?? args.endedAt ?? Date.now(),
        endedAt: args.endedAt,
        turnCount: args.turnCount ?? 0,
      });
    }
    return existing?._id ?? "inserted";
  },
});

export const patchEmbedding = mutation({
  args: {
    id: v.id("conversations"),
    embedding: v.array(v.number()),
    embeddingStatus: v.string(),
    embeddingUpdatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      embedding: args.embedding,
      embeddingStatus: args.embeddingStatus,
      embeddingUpdatedAt: args.embeddingUpdatedAt,
    });
  },
});

export const getRecent = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    return await ctx.db
      .query("conversations")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit);
  },
});

export const getSessionTurns = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("conversations")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();
  },
});

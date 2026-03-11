import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const saveTurn = mutation({
  args: {
    role: v.string(),
    text: v.string(),
    cleanText: v.string(),
    embedding: v.array(v.number()),
    sessionId: v.string(),
    timestamp: v.number(),
    source: v.string(),
    hasToolCalls: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("conversations", args);
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
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    turnCount: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("sessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("sessions", args);
    }
    return existing?._id ?? "inserted";
  },
});

export const patchEmbedding = mutation({
  args: {
    id: v.id("conversations"),
    embedding: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { embedding: args.embedding });
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

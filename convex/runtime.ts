import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const saveRuntimeEvent = mutation({
  args: {
    event: v.object({
      type: v.string(),
      timestamp: v.number(),
      payload: v.string(),
      source: v.optional(v.string()),
    }),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("runtime_events")
        .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", args.idempotencyKey))
        .first();
      if (existing) return existing._id;
    }
    return await ctx.db.insert("runtime_events", {
      ...args.event,
      idempotencyKey: args.idempotencyKey,
    });
  },
});

export const saveTaskMilestone = mutation({
  args: {
    taskMilestone: v.object({
      taskId: v.string(),
      message: v.string(),
      importance: v.string(),
      status: v.optional(v.string()),
      timestamp: v.optional(v.number()),
    }),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("task_milestones")
        .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", args.idempotencyKey))
        .first();
      if (existing) return existing._id;
    }
    return await ctx.db.insert("task_milestones", {
      ...args.taskMilestone,
      timestamp: args.taskMilestone.timestamp ?? Date.now(),
      idempotencyKey: args.idempotencyKey,
    });
  },
});

export const saveProactiveSuggestion = mutation({
  args: {
    suggestion: v.object({
      text: v.string(),
      confidence: v.number(),
      context: v.optional(v.string()),
      accepted: v.optional(v.boolean()),
      timestamp: v.optional(v.number()),
    }),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("proactive_suggestions")
        .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", args.idempotencyKey))
        .first();
      if (existing) return existing._id;
    }
    return await ctx.db.insert("proactive_suggestions", {
      ...args.suggestion,
      timestamp: args.suggestion.timestamp ?? Date.now(),
      idempotencyKey: args.idempotencyKey,
    });
  },
});

export const saveDailyDraft = mutation({
  args: {
    draft: v.object({
      title: v.string(),
      date: v.string(),
      ghostId: v.optional(v.string()),
      status: v.string(),
      summary: v.optional(v.string()),
      timestamp: v.optional(v.number()),
    }),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("daily_drafts")
        .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", args.idempotencyKey))
        .first();
      if (existing) return existing._id;
    }
    return await ctx.db.insert("daily_drafts", {
      ...args.draft,
      timestamp: args.draft.timestamp ?? Date.now(),
      idempotencyKey: args.idempotencyKey,
    });
  },
});

export const verifyHistoryImport = query({
  args: {},
  handler: async (ctx) => {
    const latest = await ctx.db
      .query("conversations")
      .withIndex("by_timestamp")
      .order("desc")
      .take(5000);

    const imported = latest.filter((row) => row.source === "historical" || row.source === "curated");
    return {
      recentCount: latest.length,
      importedCount: imported.length,
      hasImportedHistory: imported.length > 0,
      latestTimestamp: latest[0]?.timestamp ?? null,
    };
  },
});

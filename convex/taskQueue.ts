import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const createTask = mutation({
  args: {
    task: v.object({
      projectPath: v.string(),
      rawPrompt: v.string(),
      enrichedPrompt: v.optional(v.string()),
      impactedFiles: v.optional(v.array(v.string())),
      complexity: v.optional(v.string()),
      status: v.string(),
      result: v.optional(v.string()),
      errorMessage: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("task_queue")
        .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", args.idempotencyKey))
        .first();
      if (existing) return existing._id;
    }
    return await ctx.db.insert("task_queue", {
      ...args.task,
      idempotencyKey: args.idempotencyKey,
    });
  },
});

export const updateTask = mutation({
  args: {
    id: v.id("task_queue"),
    updates: v.object({
      enrichedPrompt: v.optional(v.string()),
      impactedFiles: v.optional(v.array(v.string())),
      complexity: v.optional(v.string()),
      status: v.optional(v.string()),
      result: v.optional(v.string()),
      errorMessage: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, args.updates);
  },
});

export const getByStatus = query({
  args: {
    status: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("task_queue")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .order("asc")
      .collect();
  },
});

export const getByProject = query({
  args: {
    projectPath: v.string(),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.status) {
      return await ctx.db
        .query("task_queue")
        .withIndex("by_project", (q) =>
          q.eq("projectPath", args.projectPath).eq("status", args.status)
        )
        .order("asc")
        .collect();
    }
    return await ctx.db
      .query("task_queue")
      .withIndex("by_project", (q) => q.eq("projectPath", args.projectPath))
      .order("asc")
      .collect();
  },
});

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("task_queue")
      .order("desc")
      .take(100);
  },
});

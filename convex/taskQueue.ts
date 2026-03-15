import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const intakeValidator = v.object({
  source: v.optional(v.string()),
  mode: v.optional(v.string()),
  appHint: v.optional(v.string()),
  summary: v.optional(v.string()),
  dedupeKey: v.optional(v.string()),
  utterance: v.optional(v.string()),
  capturedAt: v.optional(v.number()),
  frustration: v.optional(v.boolean()),
  frustrationSignals: v.optional(v.array(v.string())),
  confidence: v.optional(v.number()),
});

const executionValidator = v.object({
  strategy: v.optional(v.string()),
  executionLane: v.optional(v.string()),
  hireableProfile: v.optional(v.string()),
  queueBucket: v.optional(v.string()),
  lastEvent: v.optional(v.string()),
  lastErrorCode: v.optional(v.string()),
  lastAttemptAt: v.optional(v.number()),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  fallbackCount: v.optional(v.number()),
  interruptionCount: v.optional(v.number()),
});

export const createTask = mutation({
  args: {
    task: v.object({
      projectPath: v.string(),
      rawPrompt: v.string(),
      enrichedPrompt: v.optional(v.string()),
      impactedFiles: v.optional(v.array(v.string())),
      complexity: v.optional(v.string()),
      taskKind: v.optional(v.string()),
      intake: v.optional(intakeValidator),
      execution: v.optional(executionValidator),
      status: v.string(),
      origin: v.optional(v.string()),
      launchMode: v.optional(v.string()),
      resumable: v.optional(v.boolean()),
      resumeCount: v.optional(v.number()),
      dependencyState: v.optional(v.string()),
      dependencies: v.optional(v.array(v.string())),
      inferredDependencies: v.optional(v.array(v.string())),
      blockedBy: v.optional(v.array(v.string())),
      startedAt: v.optional(v.number()),
      resumedAt: v.optional(v.number()),
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
      taskKind: v.optional(v.string()),
      intake: v.optional(intakeValidator),
      execution: v.optional(executionValidator),
      status: v.optional(v.string()),
      origin: v.optional(v.string()),
      launchMode: v.optional(v.string()),
      resumable: v.optional(v.boolean()),
      resumeCount: v.optional(v.number()),
      dependencyState: v.optional(v.string()),
      dependencies: v.optional(v.array(v.string())),
      inferredDependencies: v.optional(v.array(v.string())),
      blockedBy: v.optional(v.array(v.string())),
      startedAt: v.optional(v.number()),
      resumedAt: v.optional(v.number()),
      result: v.optional(v.string()),
      errorMessage: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, args.updates);
  },
});

export const claimTask = mutation({
  args: {
    id: v.id("task_queue"),
    expectedStatuses: v.array(v.string()),
    updates: v.object({
      status: v.string(),
      startedAt: v.optional(v.number()),
      resumedAt: v.optional(v.number()),
      execution: v.optional(executionValidator),
      updatedAt: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const current = await ctx.db.get(args.id);
    if (!current) return { ok: false, reason: "not_found" };
    if (!args.expectedStatuses.includes(current.status)) {
      return { ok: false, reason: `status_mismatch:${current.status}` };
    }
    await ctx.db.patch(args.id, args.updates);
    return { ok: true };
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
      const { projectPath, status } = args;
      return await ctx.db
        .query("task_queue")
        .withIndex("by_project", (q) => q.eq("projectPath", projectPath).eq("status", status))
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

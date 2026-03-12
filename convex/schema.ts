import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  conversations: defineTable({
    role: v.string(),
    text: v.string(),
    cleanText: v.string(),
    embedding: v.array(v.number()),
    sessionId: v.string(),
    timestamp: v.number(),
    source: v.string(),
    hasToolCalls: v.boolean(),
  })
    .index("by_session", ["sessionId", "timestamp"])
    .index("by_timestamp", ["timestamp"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["role"],
    }),

  tool_executions: defineTable({
    sessionId: v.string(),
    toolName: v.string(),
    args: v.string(),
    result: v.string(),
    success: v.boolean(),
    timestamp: v.number(),
    durationMs: v.number(),
  })
    .index("by_session", ["sessionId", "timestamp"])
    .index("by_tool", ["toolName", "timestamp"]),

  sessions: defineTable({
    sessionId: v.string(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    turnCount: v.number(),
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_startedAt", ["startedAt"]),

  runtime_events: defineTable({
    type: v.string(),
    timestamp: v.number(),
    payload: v.string(),
    source: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
  })
    .index("by_timestamp", ["timestamp"])
    .index("by_idempotency", ["idempotencyKey"]),

  task_milestones: defineTable({
    taskId: v.string(),
    message: v.string(),
    importance: v.string(),
    status: v.optional(v.string()),
    timestamp: v.number(),
    idempotencyKey: v.optional(v.string()),
  })
    .index("by_task", ["taskId", "timestamp"])
    .index("by_idempotency", ["idempotencyKey"]),

  proactive_suggestions: defineTable({
    text: v.string(),
    confidence: v.number(),
    context: v.optional(v.string()),
    accepted: v.optional(v.boolean()),
    timestamp: v.number(),
    idempotencyKey: v.optional(v.string()),
  })
    .index("by_timestamp", ["timestamp"])
    .index("by_idempotency", ["idempotencyKey"]),

  daily_drafts: defineTable({
    title: v.string(),
    date: v.string(),
    ghostId: v.optional(v.string()),
    status: v.string(),
    summary: v.optional(v.string()),
    timestamp: v.number(),
    idempotencyKey: v.optional(v.string()),
  })
    .index("by_date", ["date", "timestamp"])
    .index("by_idempotency", ["idempotencyKey"]),

  task_queue: defineTable({
    projectPath: v.string(),
    rawPrompt: v.string(),
    enrichedPrompt: v.optional(v.string()),
    impactedFiles: v.optional(v.array(v.string())),
    complexity: v.optional(v.string()),
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
    idempotencyKey: v.optional(v.string()),
  })
    .index("by_status", ["status", "createdAt"])
    .index("by_project", ["projectPath", "status", "createdAt"])
    .index("by_idempotency", ["idempotencyKey"]),
});

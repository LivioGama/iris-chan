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
});

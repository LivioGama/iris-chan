import { defineSchema, defineTable } from "convex/server";
import { vector } from "convex/values";

export default defineSchema({
  conversations: defineTable({
    role: "string",
    text: "string",
    cleanText: "string",
    embedding: vector(1024),
    sessionId: "string",
    timestamp: "number",
    source: "string",
    hasToolCalls: "boolean",
  })
    .index("by_session", ["sessionId", "timestamp"])
    .index("by_timestamp", ["timestamp"])
    .index("by_embedding", ["embedding"], { vectorDimension: 1024 }),

  tool_executions: defineTable({
    sessionId: "string",
    toolName: "string",
    args: "string",
    result: "string",
    success: "boolean",
    timestamp: "number",
    durationMs: "number",
  })
    .index("by_session", ["sessionId", "timestamp"])
    .index("by_tool", ["toolName", "timestamp"]),

  sessions: defineTable({
    sessionId: "string",
    startedAt: "number",
    endedAt: "number",
    turnCount: "number",
  })
    .index("by_sessionId", ["sessionId"])
    .index("by_startedAt", ["startedAt"]),
});

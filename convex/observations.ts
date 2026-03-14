import { mutation, action, query } from "./_generated/server";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";

export const saveObservation = mutation({
  args: {
    observation: v.object({
      description: v.string(),
      appName: v.string(),
      tags: v.array(v.string()),
      captureId: v.string(),
      sessionId: v.string(),
      timestamp: v.number(),
      embedding: v.array(v.number()),
      embeddingStatus: v.string(),
      trigger: v.string(),
      note: v.optional(v.string()),
    }),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("visual_observations")
        .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", args.idempotencyKey))
        .first();
      if (existing) return existing._id;
    }
    return await ctx.db.insert("visual_observations", {
      ...args.observation,
      idempotencyKey: args.idempotencyKey,
    });
  },
});

export const patchObservationEmbedding = mutation({
  args: {
    id: v.id("visual_observations"),
    embedding: v.array(v.number()),
    embeddingStatus: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      embedding: args.embedding,
      embeddingStatus: args.embeddingStatus,
    });
  },
});

export const getRecentObservations = query({
  args: {
    limit: v.optional(v.number()),
    sessionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    if (args.sessionId) {
      return await ctx.db
        .query("visual_observations")
        .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
        .order("desc")
        .take(limit);
    }
    return await ctx.db
      .query("visual_observations")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit);
  },
});

export const fetchObservationsByIds = query({
  args: {
    ids: v.array(v.id("visual_observations")),
  },
  handler: async (ctx, args) => {
    const docs: Doc<"visual_observations">[] = [];
    for (const id of args.ids) {
      const doc = await ctx.db.get(id);
      if (doc) docs.push(doc);
    }
    return docs;
  },
});

export const searchObservations = action({
  args: {
    embedding: v.array(v.number()),
    limit: v.optional(v.number()),
    appFilter: v.optional(v.string()),
    triggerFilter: v.optional(v.string()),
    minScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 5;
    const minScore = args.minScore ?? 0.35;

    const hits = await ctx.vectorSearch("visual_observations", "by_embedding", {
      vector: args.embedding,
      limit: Math.max(limit * 3, limit),
      filter: (q) => q.eq("embeddingStatus", "ready"),
    });

    const rankedHits = hits
      .filter((hit) => Number(hit._score ?? 0) >= minScore)
      .slice(0, limit);

    const docs = (await ctx.runQuery(api.observations.fetchObservationsByIds, {
      ids: rankedHits.map((hit) => hit._id),
    })) as Doc<"visual_observations">[];

    const docsById = new Map<string, Doc<"visual_observations">>(
      docs.map((doc) => [doc._id, doc])
    );

    return rankedHits
      .map((hit) => {
        const doc = docsById.get(hit._id);
        if (!doc) return null;
        if (args.appFilter && doc.appName !== args.appFilter) return null;
        if (args.triggerFilter && doc.trigger !== args.triggerFilter) return null;
        return {
          _id: hit._id,
          _score: hit._score,
          description: doc.description,
          appName: doc.appName,
          tags: doc.tags,
          trigger: doc.trigger,
          timestamp: doc.timestamp,
          sessionId: doc.sessionId,
          note: doc.note,
        };
      })
      .filter((result): result is NonNullable<typeof result> => result !== null);
  },
});

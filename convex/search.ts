import { action, query } from "./_generated/server";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";

export const semanticSearch = action({
  args: {
    embedding: v.array(v.number()),
    limit: v.optional(v.number()),
    roleFilter: v.optional(v.string()),
    minScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 5;
    const { roleFilter } = args;
    const minScore = args.minScore ?? 0.35;

    const hits = await ctx.vectorSearch("conversations", "by_embedding", {
      vector: args.embedding,
      limit: Math.max(limit * 3, limit),
      filter: (q) => q.eq("embeddingStatus", "ready"),
    });

    const rankedHits = hits
      .filter((hit) => Number(hit._score ?? 0) >= minScore)
      .slice(0, limit);

    const docs = (await ctx.runQuery(api.search.fetchByIds, {
      ids: rankedHits.map((hit) => hit._id),
    })) as Doc<"conversations">[];

    const docsById = new Map<string, Doc<"conversations">>(
      docs.map((doc) => [doc._id, doc])
    );

    return rankedHits
      .map((hit) => {
        const doc = docsById.get(hit._id);
        if (!doc) return null;
        if (roleFilter && doc.role !== roleFilter) return null;
        return {
          _id: hit._id,
          _score: hit._score,
          role: doc.role,
          text: doc.text,
          cleanText: doc.cleanText,
          sessionId: doc.sessionId,
          timestamp: doc.timestamp,
          source: doc.source,
          hasToolCalls: doc.hasToolCalls,
          embeddingStatus: doc.embeddingStatus,
          provenance: {
            sessionId: doc.sessionId,
            timestamp: doc.timestamp,
            source: doc.source,
          },
        };
      })
      .filter((result): result is NonNullable<typeof result> => result !== null);
  },
});

export const fetchByIds = query({
  args: {
    ids: v.array(v.id("conversations")),
  },
  handler: async (ctx, args) => {
    const docs: Doc<"conversations">[] = [];
    for (const id of args.ids) {
      const doc = await ctx.db.get(id);
      if (doc) docs.push(doc);
    }
    return docs;
  },
});

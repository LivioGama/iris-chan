import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";

export const upsertLink = mutation({
  args: {
    url: v.string(),
    title: v.string(),
    snippet: v.string(),
    domain: v.string(),
    embedding: v.array(v.number()),
    embeddingStatus: v.string(),
    embeddingUpdatedAt: v.optional(v.number()),
    source: v.string(),
    sessionId: v.optional(v.string()),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
    seenCount: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("links")
      .withIndex("by_url", (q) => q.eq("url", args.url))
      .first();

    if (existing) {
      const patch: Record<string, unknown> = {
        lastSeenAt: args.lastSeenAt,
        seenCount: (existing.seenCount || 1) + 1,
      };
      if (args.title.length > (existing.title || "").length) {
        patch.title = args.title;
      }
      if (args.snippet.length > (existing.snippet || "").length) {
        patch.snippet = args.snippet;
      }
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("links", args);
  },
});

export const patchLinkEmbedding = mutation({
  args: {
    id: v.id("links"),
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

export const semanticLinkSearch = action({
  args: {
    embedding: v.array(v.number()),
    limit: v.optional(v.number()),
    minScore: v.optional(v.number()),
    domainFilter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 5;
    const minScore = args.minScore ?? 0.3;

    const hits = await ctx.vectorSearch("links", "by_embedding", {
      vector: args.embedding,
      limit: Math.max(limit * 3, limit),
      filter: (q) => q.eq("embeddingStatus", "ready"),
    });

    const ranked = hits
      .filter((h) => Number(h._score ?? 0) >= minScore)
      .slice(0, limit);

    const docs = (await ctx.runQuery(api.links.fetchLinksByIds, {
      ids: ranked.map((h) => h._id),
    })) as Doc<"links">[];

    const byId = new Map<string, Doc<"links">>(
      docs.map((d) => [d._id, d])
    );

    return ranked
      .map((h) => {
        const doc = byId.get(h._id);
        if (!doc) return null;
        if (args.domainFilter && doc.domain !== args.domainFilter) return null;
        return {
          _id: h._id,
          _score: h._score,
          url: doc.url,
          title: doc.title,
          snippet: doc.snippet,
          domain: doc.domain,
          source: doc.source,
          firstSeenAt: doc.firstSeenAt,
          lastSeenAt: doc.lastSeenAt,
          seenCount: doc.seenCount,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  },
});

export const fetchLinksByIds = query({
  args: {
    ids: v.array(v.id("links")),
  },
  handler: async (ctx, args) => {
    const docs: Doc<"links">[] = [];
    for (const id of args.ids) {
      const doc = await ctx.db.get(id);
      if (doc) docs.push(doc);
    }
    return docs;
  },
});

export const getRecentLinks = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    return await ctx.db
      .query("links")
      .withIndex("by_lastSeen")
      .order("desc")
      .take(limit);
  },
});

export const searchLinksByText = query({
  args: {
    limit: v.optional(v.number()),
    domainFilter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    const results = await ctx.db
      .query("links")
      .withIndex("by_lastSeen")
      .order("desc")
      .take(limit);
    if (args.domainFilter) {
      return results.filter((r) => r.domain === args.domainFilter);
    }
    return results;
  },
});

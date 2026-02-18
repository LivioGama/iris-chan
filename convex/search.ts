import { action, query } from "./_generated/server";
import { v } from "convex/values";

export const semanticSearch = action({
  args: {
    embedding: v.array(v.number()),
    limit: v.optional(v.number()),
    roleFilter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 5;
    const filter = args.roleFilter ? { role: args.roleFilter } : {};

    const results = await ctx.vectorSearch("conversations", "by_embedding", {
      vector: args.embedding,
      limit,
      filter,
    });

    return results;
  },
});

export const fetchByIds = query({
  args: {
    ids: v.array(v.id("conversations")),
  },
  handler: async (ctx, args) => {
    const docs = [];
    for (const id of args.ids) {
      const doc = await ctx.db.get(id);
      if (doc) docs.push(doc);
    }
    return docs;
  },
});

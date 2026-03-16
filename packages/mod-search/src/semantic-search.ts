import type { BusClient } from '@iris/bus';
import { CH } from '@iris/bus';

export interface SemanticSearchRequest {
  query: string;
  table?: 'observations' | 'links';
  limit?: number;
}

export interface SemanticSearchResult {
  id: string;
  text: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export const semanticSearch = async (
  bus: BusClient,
  req: SemanticSearchRequest,
): Promise<SemanticSearchResult[]> => {
  const table = req.table ?? 'observations';
  const fnName =
    table === 'links' ? 'links:searchLinks' : 'observations:searchObservations';

  try {
    const results = await bus.request<
      { function: string; args: Record<string, unknown> },
      SemanticSearchResult[]
    >(CH.CONVEX_QUERY, { function: fnName, args: { query: req.query, limit: req.limit ?? 10 } });

    return results;
  } catch (err) {
    console.error(
      '[mod-search] Semantic search failed:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
};

/**
 * Ghost publisher: POST drafts to Ghost Admin API.
 * Requires GHOST_ADMIN_URL and GHOST_ADMIN_KEY environment variables.
 */

import { createHmac } from 'node:crypto';

export interface GhostPublishResult {
  ok: boolean;
  postId?: string;
  url?: string;
  error?: string;
}

/**
 * Create a Ghost Admin API JWT from the admin key.
 * Ghost admin key format: <id>:<secret> (hex-encoded)
 */
const createGhostToken = (adminKey: string): string => {
  const [id, secret] = adminKey.split(':');
  if (!id || !secret) throw new Error('Invalid Ghost admin key format (expected id:secret)');

  const now = Math.floor(Date.now() / 1000);

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: id })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iat: now, exp: now + 300, aud: '/admin/' }),
  ).toString('base64url');

  const secretBytes = Buffer.from(secret, 'hex');
  const signature = createHmac('sha256', secretBytes)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
};

export const createGhostPublisher = (
  adminUrl: string,
  adminKey: string,
  logger: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void },
) => {
  const configured = !!adminUrl && !!adminKey;

  const publish = async (
    title: string,
    markdown: string,
    status: 'draft' | 'published' = 'draft',
  ): Promise<GhostPublishResult> => {
    if (!configured) {
      return { ok: false, error: 'Ghost not configured (GHOST_ADMIN_URL / GHOST_ADMIN_KEY missing)' };
    }

    try {
      const token = createGhostToken(adminKey);
      const url = `${adminUrl.replace(/\/+$/, '')}/ghost/api/admin/posts/`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Ghost ${token}`,
        },
        body: JSON.stringify({
          posts: [
            {
              title,
              mobiledoc: JSON.stringify({
                version: '0.3.1',
                markups: [],
                atoms: [],
                cards: [['markdown', { markdown }]],
                sections: [[10, 0]],
              }),
              status,
            },
          ],
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => 'unknown');
        return { ok: false, error: `Ghost API ${res.status}: ${body}` };
      }

      const data = (await res.json()) as { posts?: { id: string; url: string }[] };
      const post = data.posts?.[0];

      logger.info(`Ghost draft published: ${post?.url ?? 'unknown'}`);
      return { ok: true, postId: post?.id, url: post?.url };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Ghost publish failed:', message);
      return { ok: false, error: message };
    }
  };

  return { publish, configured };
};

export type GhostPublisher = ReturnType<typeof createGhostPublisher>;

/**
 * In-memory cache for 2FA codes with 5-minute TTL.
 */

export interface CachedCode {
  code: string;
  source: string; // 'imessage' | 'notification' | 'clipboard'
  service?: string;
  cachedAt: number;
  expiresAt: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

export class CodeCache {
  private entries = new Map<string, CachedCode>();
  private ttlMs: number;

  constructor(ttlMs = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * Add a code to the cache. Deduplicates by code value.
   */
  add(code: string, source: string, service?: string): CachedCode {
    this.evictExpired();

    const entry: CachedCode = {
      code,
      source,
      service,
      cachedAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs,
    };

    this.entries.set(code, entry);
    return entry;
  }

  /**
   * Get the most recent valid code, optionally filtered by service.
   */
  getLatest(service?: string): CachedCode | null {
    this.evictExpired();

    let latest: CachedCode | null = null;
    for (const entry of this.entries.values()) {
      if (service && entry.service !== service) continue;
      if (!latest || entry.cachedAt > latest.cachedAt) {
        latest = entry;
      }
    }

    return latest;
  }

  /**
   * Get all valid codes.
   */
  getAll(): CachedCode[] {
    this.evictExpired();
    return Array.from(this.entries.values());
  }

  /**
   * Check if a specific code exists and is valid.
   */
  has(code: string): boolean {
    const entry = this.entries.get(code);
    if (!entry) return false;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(code);
      return false;
    }
    return true;
  }

  /**
   * Remove a specific code (e.g., after successful fill).
   */
  remove(code: string): void {
    this.entries.delete(code);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    this.evictExpired();
    return this.entries.size;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}

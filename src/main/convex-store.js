const path = require('path');
const fs = require('fs');

let currentSessionId = null;
let queue = [];
let flushInterval = null;
let convexConfig = null;
const MAX_QUEUE = 100;
const FLUSH_INTERVAL = 5000;
const QUEUE_TTL = 5 * 60 * 1000;

function loadEnvVars() {
  const envPath = path.join(__dirname, '..', '..', '.env');
  const vars = {};
  try {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^(CONVEX_URL|OPENROUTER_API_KEY|CONVEX_SELF_HOSTED_URL|CONVEX_SELF_HOSTED_ADMIN_KEY)=(.+)$/);
      if (match) vars[match[1]] = match[2].trim();
    }
  } catch {}
  return vars;
}

function initConfig() {
  if (convexConfig) return convexConfig;
  const env = loadEnvVars();
  convexConfig = {
    url: env.CONVEX_URL || env.CONVEX_SELF_HOSTED_URL || '',
    adminKey: env.CONVEX_SELF_HOSTED_ADMIN_KEY || '',
    openrouterKey: env.OPENROUTER_API_KEY || '',
  };
  if (convexConfig.url) {
    console.log(`[ConvexStore] Config loaded — URL: ${convexConfig.url}, Admin key: ${convexConfig.adminKey ? 'present' : 'none'}`);
  } else {
    console.log('[ConvexStore] No CONVEX_URL configured, skipping');
  }
  return convexConfig;
}

// Convex self-hosted HTTP API: POST /api/run/{module}/{function}
// Auth via adminKey in body, args in body.args
async function httpRun(functionName, args) {
  const config = initConfig();
  if (!config.url) return { error: 'No URL configured' };

  // Convert "conversations:saveTurn" → "conversations/saveTurn"
  const apiPath = functionName.replace(':', '/');
  const body = { args };
  if (config.adminKey) body.adminKey = config.adminKey;

  try {
    const response = await fetch(`${config.url}/api/run/${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (data.status === 'error') {
      return { error: data.errorMessage || 'Unknown Convex error' };
    }
    return { value: data.value, status: data.status };
  } catch (err) {
    return { error: err.message };
  }
}

function extractExtraFieldName(errorMessage) {
  if (typeof errorMessage !== 'string') return null;
  const match = errorMessage.match(/extra field `([^`]+)`/i);
  return match ? match[1] : null;
}

async function httpRunWithExtraFieldFallback(functionName, args) {
  const nextArgs = { ...args };

  while (true) {
    const result = await httpRun(functionName, nextArgs);
    if (!result?.error) return result;

    const extraField = extractExtraFieldName(result.error);
    if (!extraField || !(extraField in nextArgs)) {
      return result;
    }

    delete nextArgs[extraField];
  }
}

function startFlushLoop() {
  if (flushInterval) return;
  flushInterval = setInterval(flushQueue, FLUSH_INTERVAL);
}

async function flushQueue() {
  if (queue.length === 0) return;
  const now = Date.now();
  const toFlush = queue.filter(item => now - item.queuedAt < QUEUE_TTL);
  queue = queue.filter(item => now - item.queuedAt >= QUEUE_TTL);
  
  for (const item of toFlush) {
    try {
      await item.fn();
      item.resolve();
    } catch (err) {
      console.error('[ConvexStore] Queue flush error:', err.message);
      item.reject(err);
    }
  }
}

function queueMutation(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject, queuedAt: Date.now() });
    if (queue.length > MAX_QUEUE) {
      queue.shift();
    }
  });
}

function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeLink(url) {
  try {
    return new URL(String(url || '')).toString();
  } catch {
    return '';
  }
}

function cleanText(text) {
  if (!text) return '';
  let cleaned = text.replace(/\*\*[^*]+\*\*/g, '');
  cleaned = cleaned.replace(/^I'm currently.+$/gm, '');
  cleaned = cleaned.replace(/^I've determined.+$/gm, '');
  cleaned = cleaned.replace(/^I am now.+$/gm, '');
  cleaned = cleaned.replace(/<noise>/gi, '');
  cleaned = cleaned.trim();
  return cleaned;
}

function normalizeSearchResult(result) {
  if (!result || typeof result !== 'object') return null;
  const score = Number(result._score ?? result.score ?? 0);
  const clean = typeof result.cleanText === 'string' ? result.cleanText.trim() : '';
  const text = typeof result.text === 'string' ? result.text.trim() : '';
  const provenance = result.provenance && typeof result.provenance === 'object'
    ? {
        sessionId: String(result.provenance.sessionId || result.sessionId || ''),
        timestamp: Number(result.provenance.timestamp ?? result.timestamp ?? 0),
        source: String(result.provenance.source || result.source || ''),
      }
    : {
        sessionId: String(result.sessionId || ''),
        timestamp: Number(result.timestamp ?? 0),
        source: String(result.source || ''),
      };

  if (!clean && !text) return null;

  return {
    ...result,
    _score: score,
    cleanText: clean,
    text,
    provenance,
  };
}

function dedupeSearchResults(results, limit) {
  const seen = new Set();
  const deduped = [];

  for (const raw of results) {
    const result = normalizeSearchResult(raw);
    if (!result) continue;
    const dedupeKey = [
      result.role || '',
      result.cleanText || result.text,
      result.provenance.sessionId || '',
      result.provenance.timestamp || 0,
    ].join('::');
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    deduped.push(result);
    if (deduped.length >= limit) break;
  }

  return deduped;
}

async function generateEmbedding(text) {
  const config = initConfig();
  if (!config.openrouterKey) {
    console.warn('[ConvexStore] No OPENROUTER_API_KEY, embedding unavailable');
    return {
      embedding: new Array(1024).fill(0),
      status: 'unavailable',
    };
  }
  
  const truncated = text.slice(0, 8000);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.openrouterKey}`,
      },
      body: JSON.stringify({
        model: 'qwen/qwen3-embedding-8b',
        input: truncated,
        dimensions: 1024,
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Embedding API error: ${response.status} ${err}`);
    }
    const data = await response.json();
    return {
      embedding: data.data[0].embedding,
      status: 'ready',
    };
  } catch (err) {
    console.error('[ConvexStore] Embedding generation failed:', err.message);
    return {
      embedding: new Array(1024).fill(0),
      status: 'failed',
    };
  }
}

const convexStore = {
  async init() {
    initConfig();
    if (convexConfig.url) {
      console.log(`[ConvexStore] Initialized — connected to ${convexConfig.url}`);
      startFlushLoop();
    }
  },

  async saveTurn(role, text) {
    const config = initConfig();
    if (!config.url) return;
    
    const sessionId = currentSessionId || generateSessionId();
    const timestamp = Date.now();
    const clean = cleanText(text);
    const embedding = new Array(1024).fill(0);
    
    const result = await httpRunWithExtraFieldFallback('conversations:saveTurn', {
      role,
      text,
      cleanText: clean,
      embedding,
      embeddingStatus: clean ? 'pending' : 'unavailable',
      embeddingUpdatedAt: clean ? undefined : timestamp,
      sessionId,
      timestamp,
      source: 'realtime',
      hasToolCalls: false,
    });
    
    if (result.error) {
      console.warn('[ConvexStore] saveTurn error:', result.error);
      return;
    }
    
    // Convex /api/run returns { value: docId, status: "success" }
    const docId = result?.value;
    if (docId && typeof docId === 'string' && clean) {
      generateEmbedding(clean).then(({ embedding: nextEmbedding, status }) => {
        httpRunWithExtraFieldFallback('conversations:patchEmbedding', {
          id: docId,
          embedding: nextEmbedding,
          embeddingStatus: status,
          embeddingUpdatedAt: Date.now(),
        }).catch(err => {
          console.error('[ConvexStore] Failed to patch embedding:', err.message);
        });
      });
    }

    // Extract and save any URLs found in conversation text
    const urlMatches = (text || '').match(/https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi);
    if (urlMatches) {
      for (const url of urlMatches.slice(0, 5)) {
        convexStore.saveLink({ url, title: '', snippet: '', source: 'conversation', sessionId }).catch(() => {});
      }
    }
  },

  async saveObservation(observation) {
    const config = initConfig();
    if (!config.url) return;

    const timestamp = observation.timestamp || Date.now();
    const embedding = new Array(1024).fill(0);
    const idempotencyKey = observation.captureId || `obs_${timestamp}`;

    const result = await httpRunWithExtraFieldFallback('observations:saveObservation', {
      observation: {
        ...observation,
        timestamp,
        embedding,
        embeddingStatus: 'pending',
      },
      idempotencyKey,
    });

    if (result.error) {
      console.warn('[ConvexStore] saveObservation error:', result.error);
      return;
    }

    const docId = result?.value;
    if (docId && typeof docId === 'string' && observation.description) {
      generateEmbedding(observation.description).then(({ embedding: nextEmbedding, status }) => {
        httpRunWithExtraFieldFallback('observations:patchObservationEmbedding', {
          id: docId,
          embedding: nextEmbedding,
          embeddingStatus: status,
        }).catch(err => {
          console.error('[ConvexStore] Failed to patch observation embedding:', err.message);
        });
      });
    }
  },

  async searchObservations(queryText, limit = 5, appFilter = null) {
    const config = initConfig();
    if (!config.url) return [];

    const cleanQuery = cleanText(queryText);
    if (!cleanQuery) return [];

    const { embedding, status } = await generateEmbedding(cleanQuery);
    if (status !== 'ready') return [];

    try {
      const result = await httpRun('observations:searchObservations', {
        embedding,
        limit,
        appFilter,
        minScore: 0.35,
      });
      return Array.isArray(result?.value) ? result.value : [];
    } catch (err) {
      console.error('[ConvexStore] searchObservations error:', err.message);
      return [];
    }
  },

  async getRecentObservations(limit = 10, sessionId = null) {
    const config = initConfig();
    if (!config.url) return [];

    try {
      const args = { limit };
      if (sessionId) args.sessionId = sessionId;
      const result = await httpRun('observations:getRecentObservations', args);
      return Array.isArray(result?.value) ? result.value : [];
    } catch (err) {
      console.error('[ConvexStore] getRecentObservations error:', err.message);
      return [];
    }
  },

  async saveToolExecution(name, args, result, success, durationMs) {
    const config = initConfig();
    if (!config.url || !currentSessionId) return;
    
    const timestamp = Date.now();
    await httpRun('conversations:saveToolExecution', {
      sessionId: currentSessionId,
      toolName: name,
      args: JSON.stringify(args),
      result: String(result),
      success,
      timestamp,
      durationMs,
    });
  },

  async saveLink({ url, title, snippet, source, sessionId } = {}) {
    const config = initConfig();
    if (!config.url) return;
    const normalized = normalizeLink(url);
    if (!normalized) return;
    let domain = '';
    try { domain = new URL(normalized).hostname.replace(/^www\./, ''); } catch {}
    const now = Date.now();
    const embeddingText = `${title || ''} ${snippet || ''}`.trim();
    const result = await httpRunWithExtraFieldFallback('links:upsertLink', {
      url: normalized,
      title: (title || '').slice(0, 500),
      snippet: (snippet || '').slice(0, 500),
      domain,
      embedding: new Array(1024).fill(0),
      embeddingStatus: embeddingText ? 'pending' : 'unavailable',
      source: source || 'unknown',
      sessionId: sessionId || currentSessionId || undefined,
      firstSeenAt: now,
      lastSeenAt: now,
      seenCount: 1,
    });
    if (result.error) {
      console.warn('[ConvexStore] saveLink error:', result.error);
      return;
    }
    const docId = result?.value;
    if (docId && typeof docId === 'string' && embeddingText) {
      generateEmbedding(embeddingText).then(({ embedding, status }) => {
        httpRunWithExtraFieldFallback('links:patchLinkEmbedding', {
          id: docId,
          embedding,
          embeddingStatus: status,
          embeddingUpdatedAt: Date.now(),
        }).catch(err => {
          console.error('[ConvexStore] patchLinkEmbedding error:', err.message);
        });
      });
    }
  },

  async searchLinks(queryText, limit = 5, domainFilter = null) {
    const config = initConfig();
    if (!config.url) return [];
    const clean = cleanText(queryText);
    if (!clean) return [];
    const { embedding, status } = await generateEmbedding(clean);
    if (status !== 'ready') return [];
    try {
      const result = await httpRun('links:semanticLinkSearch', {
        embedding,
        limit,
        minScore: 0.3,
        domainFilter: domainFilter || undefined,
      });
      return Array.isArray(result?.value) ? result.value : [];
    } catch (err) {
      console.error('[ConvexStore] searchLinks error:', err.message);
      return [];
    }
  },

  async semanticSearch(queryText, limit = 5, roleFilter = null) {
    const config = initConfig();
    if (!config.url) return [];

    const cleanQuery = cleanText(queryText);
    if (!cleanQuery) return [];

    const { embedding, status } = await generateEmbedding(cleanQuery);
    if (status !== 'ready') return [];

    try {
      const result = await httpRun('search:semanticSearch', {
        embedding,
        limit,
        roleFilter,
        minScore: 0.35,
      });
      const values = Array.isArray(result?.value) ? result.value : [];
      return dedupeSearchResults(values, limit);
    } catch (err) {
      console.error('[ConvexStore] semanticSearch error:', err.message);
      return [];
    }
  },

  newSession() {
    currentSessionId = generateSessionId();
    const config = initConfig();
    if (config.url) {
      httpRun('conversations:upsertSession', {
        sessionId: currentSessionId,
        startedAt: Date.now(),
        turnCount: 0,
      }).catch(err => {
        console.warn('[ConvexStore] newSession error:', err.message);
      });
    }
    console.log(`[ConvexStore] New session: ${currentSessionId}`);
  },

  async endSession() {
    if (!currentSessionId) return;
    const config = initConfig();
    if (config.url) {
      try {
        await httpRun('conversations:upsertSession', {
          sessionId: currentSessionId,
          endedAt: Date.now(),
        });
      } catch (err) {
        console.error('[ConvexStore] endSession error:', err.message);
      }
    }
    currentSessionId = null;
  },

  shutdown() {
    if (flushInterval) {
      clearInterval(flushInterval);
      flushInterval = null;
    }
    flushQueue();
    convexConfig = null;
    console.log('[ConvexStore] Shutdown complete');
  },
};

module.exports = {
  ...convexStore,
  _private: {
    cleanText,
    normalizeSearchResult,
    dedupeSearchResults,
  },
};

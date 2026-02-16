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

async function httpMutation(functionName, args) {
  const config = initConfig();
  if (!config.url) return { error: 'No URL configured' };
  
  try {
    const response = await fetch(`${config.url}/api/mutations/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.adminKey ? { 'Authorization': `Bearer ${config.adminKey}` } : {}),
      },
      body: JSON.stringify({ json: args }),
    });
    
    if (!response.ok) {
      const text = await response.text();
      return { error: `HTTP ${response.status}: ${text}` };
    }
    
    const data = await response.json();
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

async function httpAction(functionName, args) {
  const config = initConfig();
  if (!config.url) return { error: 'No URL configured' };
  
  try {
    const response = await fetch(`${config.url}/api/actions/${functionName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.adminKey ? { 'Authorization': `Bearer ${config.adminKey}` } : {}),
      },
      body: JSON.stringify({ json: args }),
    });
    
    if (!response.ok) {
      const text = await response.text();
      return { error: `HTTP ${response.status}: ${text}` };
    }
    
    const data = await response.json();
    return data;
  } catch (err) {
    return { error: err.message };
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

async function generateEmbedding(text) {
  const config = initConfig();
  if (!config.openrouterKey) {
    console.warn('[ConvexStore] No OPENROUTER_API_KEY, returning zero embedding');
    return new Array(1024).fill(0);
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
    return data.data[0].embedding;
  } catch (err) {
    console.error('[ConvexStore] Embedding generation failed:', err.message);
    return new Array(1024).fill(0);
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
    
    const result = await httpMutation('conversations:saveTurn', {
      role,
      text,
      cleanText: clean,
      embedding,
      sessionId,
      timestamp,
      source: 'realtime',
      hasToolCalls: false,
    });
    
    if (result.error) {
      console.warn('[ConvexStore] saveTurn error:', result.error);
      return;
    }
    
    const docId = result?.txRecoveryKey || result?._id;
    if (docId) {
      generateEmbedding(clean).then(emb => {
        httpMutation('conversations:patchEmbedding', {
          id: docId,
          embedding: emb,
        }).catch(err => {
          console.error('[ConvexStore] Failed to patch embedding:', err.message);
        });
      });
    }
  },

  async saveToolExecution(name, args, result, success, durationMs) {
    const config = initConfig();
    if (!config.url || !currentSessionId) return;
    
    const timestamp = Date.now();
    await httpMutation('conversations:saveToolExecution', {
      sessionId: currentSessionId,
      toolName: name,
      args: JSON.stringify(args),
      result: String(result),
      success,
      timestamp,
      durationMs,
    });
  },

  async semanticSearch(queryText, limit = 5, roleFilter = null) {
    const config = initConfig();
    if (!config.url) return [];
    
    const embedding = await generateEmbedding(queryText);
    try {
      const results = await httpAction('search:semanticSearch', {
        embedding,
        limit,
        roleFilter,
      });
      return results || [];
    } catch (err) {
      console.error('[ConvexStore] semanticSearch error:', err.message);
      return [];
    }
  },

  newSession() {
    currentSessionId = generateSessionId();
    const config = initConfig();
    if (config.url) {
      httpMutation('conversations:upsertSession', {
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
        await httpMutation('conversations:upsertSession', {
          sessionId: currentSessionId,
          startedAt: 0,
          endedAt: Date.now(),
          turnCount: 0,
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

module.exports = convexStore;

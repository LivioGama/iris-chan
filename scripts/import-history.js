const fs = require('fs');
const path = require('path');

let CONVEX_URL = process.env.CONVEX_URL || 'https://backend-iris.devliv.io';
let OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
let ADMIN_KEY = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY || '';

const DESKTOP = process.env.HOME + '/Desktop';

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  try {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const match = line.match(/^(CONVEX_URL|OPENROUTER_API_KEY|CONVEX_SELF_HOSTED_URL|CONVEX_SELF_HOSTED_ADMIN_KEY)=(.+)$/);
      if (match) process.env[match[1]] = match[2].trim();
    }
  } catch {}
  CONVEX_URL = process.env.CONVEX_URL || process.env.CONVEX_SELF_HOSTED_URL || CONVEX_URL;
  OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || OPENROUTER_API_KEY;
  ADMIN_KEY = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY || ADMIN_KEY;
}

loadEnv();

function parseTimestamp(line) {
  const m = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]$/);
  if (!m) return null;
  return new Date(m[1]).getTime();
}

function cleanText(text) {
  if (!text) return '';
  let cleaned = text.replace(/\*\*[^*]+\*\*/g, '');
  cleaned = cleaned.replace(/^I'm currently.+$/gm, '');
  cleaned = cleaned.replace(/^I've determined.+$/gm, '');
  cleaned = cleaned.replace(/^I am now.+$/gm, '');
  cleaned = cleaned.replace(/^My gaze is.+$/gm, '');
  cleaned = cleaned.replace(/^It seems that.+$/gm, '');
  cleaned = cleaned.replace(/^The.+$/gm, '');
  cleaned = cleaned.replace(/^Therefore,.+$/gm, '');
  cleaned = cleaned.replace(/^Thus,.+$/gm, '');
  cleaned = cleaned.replace(/^I've examined.+$/gm, '');
  cleaned = cleaned.replace(/^I've registered.+$/gm, '');
  cleaned = cleaned.replace(/^I will.+$/gm, '');
  cleaned = cleaned.replace(/^I can.+$/gm, '');
  cleaned = cleaned.replace(/^I must.+$/gm, '');
  cleaned = cleaned.replace(/^I have determined.+$/gm, '');
  cleaned = cleaned.replace(/^I have formulated.+$/gm, '');
  cleaned = cleaned.replace(/^I must propose.+$/gm, '');
  cleaned = cleaned.replace(/^I am.+$/gm, '');
  cleaned = cleaned.replace(/^This should.+$/gm, '');
  cleaned = cleaned.replace(/^This appears.+$/gm, '');
  cleaned = cleaned.replace(/^Based on.+$/gm, '');
  cleaned = cleaned.replace(/<noise>/gi, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.trim();
  return cleaned;
}

function parseFile(filepath, source) {
  const content = fs.readFileSync(filepath, 'utf-8');
  const turns = [];
  const blocks = content.split(/^---$/m);
  
  let currentTimestamp = null;
  let currentRole = null;
  let currentText = [];

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    
    for (const line of lines) {
      const ts = parseTimestamp(line);
      if (ts) {
        if (currentRole && currentText.length > 0) {
          const fullText = currentText.join('\n').trim();
          const cleaned = cleanText(fullText);
          if (cleaned && cleaned.length > 5) {
            turns.push({
              role: currentRole,
              text: fullText,
              cleanText: cleaned,
              timestamp: currentTimestamp,
              source,
            });
          }
        }
        currentTimestamp = ts;
        currentRole = null;
        currentText = [];
        continue;
      }

      if (line.startsWith('USER:')) {
        if (currentRole && currentText.length > 0) {
          const fullText = currentText.join('\n').trim();
          const cleaned = cleanText(fullText);
          if (cleaned && cleaned.length > 5) {
            turns.push({
              role: currentRole,
              text: fullText,
              cleanText: cleaned,
              timestamp: currentTimestamp,
              source,
            });
          }
        }
        currentRole = 'user';
        currentText = [line.slice(5).trim()];
      } else if (line.startsWith('IRIS:')) {
        if (currentRole && currentText.length > 0) {
          const fullText = currentText.join('\n').trim();
          const cleaned = cleanText(fullText);
          if (cleaned && cleaned.length > 5) {
            turns.push({
              role: currentRole,
              text: fullText,
              cleanText: cleaned,
              timestamp: currentTimestamp,
              source,
            });
          }
        }
        currentRole = 'iris';
        currentText = [line.slice(5).trim()];
      } else if (currentRole && line.trim()) {
        currentText.push(line);
      }
    }
  }

  if (currentRole && currentText.length > 0) {
    const fullText = currentText.join('\n').trim();
    const cleaned = cleanText(fullText);
    if (cleaned && cleaned.length > 5) {
      turns.push({
        role: currentRole,
        text: fullText,
        cleanText: cleaned,
        timestamp: currentTimestamp,
        source,
      });
    }
  }

  return turns;
}

async function generateEmbedding(text) {
  if (!OPENROUTER_API_KEY) {
    console.warn('No OPENROUTER_API_KEY, using zero embedding');
    return new Array(1024).fill(0);
  }

  const truncated = text.slice(0, 8000);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
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
    console.error('Embedding generation failed:', err.message);
    return new Array(1024).fill(0);
  }
}

async function callConvexMutation(turns) {
  const url = `${CONVEX_URL}/api/run/conversations/saveTurnBatch`;
  const body = { args: { turns } };
  if (ADMIN_KEY) body.adminKey = ADMIN_KEY;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Convex mutation failed: ${response.status} ${err}`);
    }
    return await response.json();
  } catch (err) {
    console.error('Convex mutation error:', err.message);
    throw err;
  }
}

async function main() {
  console.log('Parsing log files...');

  const curatedPath = path.join(DESKTOP, 'Iris_Message_Log.txt');
  const verbosePath = path.join(DESKTOP, 'iris_conversation.log');
  // consolidated_messages.log is debug output (playback/echo), not conversation data — skip it

  const curatedTurns = fs.existsSync(curatedPath) ? parseFile(curatedPath, 'curated') : [];
  const verboseTurns = fs.existsSync(verbosePath) ? parseFile(verbosePath, 'historical') : [];

  console.log(`Curated: ${curatedTurns.length} turns`);
  console.log(`Verbose: ${verboseTurns.length} turns`);

  // Deduplicate by timestamp + role + first 50 chars of text
  const seen = new Map();
  const allTurns = [...curatedTurns, ...verboseTurns];

  for (const turn of allTurns) {
    const key = `${turn.timestamp}-${turn.role}-${turn.cleanText.slice(0, 50)}`;
    if (!seen.has(key)) {
      seen.set(key, turn);
    }
  }

  const uniqueTurns = Array.from(seen.values()).sort((a, b) => a.timestamp - b.timestamp);
  console.log(`Deduplicated: ${uniqueTurns.length} unique turns`);

  const finalTurns = uniqueTurns.filter(t => t.cleanText.length > 10);
  console.log(`After filtering short: ${finalTurns.length} turns`);

  if (finalTurns.length === 0) {
    console.log('No turns to import.');
    return;
  }

  console.log('\nGenerating embeddings (batches of 20)...');
  const batchSize = 20;
  for (let i = 0; i < finalTurns.length; i += batchSize) {
    const batch = finalTurns.slice(i, i + batchSize);
    console.log(`Embedding ${i + 1}-${Math.min(i + batchSize, finalTurns.length)}...`);

    for (const turn of batch) {
      turn.embedding = await generateEmbedding(turn.cleanText);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\nInserting into Convex (batches of 10)...');
  const insertBatchSize = 10;
  let inserted = 0;

  for (let i = 0; i < finalTurns.length; i += insertBatchSize) {
    const batch = finalTurns.slice(i, i + insertBatchSize);
    const docs = batch.map(turn => ({
      role: turn.role,
      text: turn.text,
      cleanText: turn.cleanText,
      embedding: turn.embedding,
      sessionId: 'import_' + turn.timestamp,
      timestamp: turn.timestamp,
      source: turn.source,
      hasToolCalls: false,
    }));

    try {
      await callConvexMutation(docs);
      inserted += docs.length;
      console.log(`Inserted ${inserted}/${finalTurns.length}`);
    } catch (err) {
      console.error('Failed to insert batch:', err.message);
    }

    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nDone! Inserted ${inserted} conversation turns.`);

  // Verify data actually landed in Convex before deleting source files
  if (inserted > 0) {
    console.log('\nVerifying import in Convex...');
    try {
      const verifyUrl = `${CONVEX_URL}/api/run/conversations/getRecent`;
      const verifyBody = { args: { limit: 1 } };
      if (ADMIN_KEY) verifyBody.adminKey = ADMIN_KEY;
      const verifyRes = await fetch(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verifyBody),
      });
      const verifyData = await verifyRes.json();
      if (!Array.isArray(verifyData) || verifyData.length === 0) {
        console.error('VERIFICATION FAILED: Convex returned no data. Keeping source files.');
        return;
      }
      console.log(`Verified: ${verifyData.length} record(s) found in Convex.`);
    } catch (err) {
      console.error(`VERIFICATION FAILED: ${err.message}. Keeping source files.`);
      return;
    }

    const filesToDelete = [curatedPath, verbosePath, path.join(DESKTOP, 'consolidated_messages.log')];
    for (const file of filesToDelete) {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`Deleted: ${file}`);
      }
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

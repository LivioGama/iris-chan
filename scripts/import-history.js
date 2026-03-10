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

function parseArgs(argv = []) {
	return {
		force: argv.includes('--force'),
		cleanupSources: argv.includes('--cleanup-sources'),
	};
}

function parseTimestamp(line) {
  const m = line.match(/^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]$/);
  if (!m) return null;
  return new Date(m[1]).getTime();
}

function cleanText(text) {
  if (!text) return '';
  // Remove **Bold Section Headers** (Gemini thinking headers)
  let cleaned = text.replace(/\*\*[^*]+\*\*/g, '');
  // Remove Gemini internal monologue patterns (thinking/reasoning, not actual responses)
  const thinkingPatterns = [
    // "I'm/I've/I am/I have/I will/I believe" + thinking verbs
    /^I'm (currently|now |focusing|assessing|zeroing|hearing|emphasizing|confirming|evaluating|shifting|reiterating|ensuring|actively|going to|selecting|suggesting|acknowledging).+$/gm,
    /^I've (determined|examined|registered|revised|analyzed|refined|detailed|noted|assessed|evaluated|shifted|carefully|suggested|formulated|registered|considered).+$/gm,
    /^I am (now|currently|prepared|assessing|actively|ready to|confident).+$/gm,
    /^I have (determined|formulated|noted|considered|added).+$/gm,
    /^I will (now|next|focus|not call).+$/gm,
    /^I believe the user.+$/gm,
    // Internal state descriptions
    /^My (gaze|attention|focus|analysis|initial assessment|next step|goal) .+$/gm,
    /^It seems (that )?.+$/gm,
    /^It's a Slack-like.+$/gm,
    /^Therefore,.+$/gm,
    /^Thus,.+$/gm,
    /^This (should|appears|setup|fixation|anticipates|is key|setup is) .+$/gm,
    /^Based on .+$/gm,
    /^After (examining|analyzing|considering).+$/gm,
    /^No (further action|progress has been made).+$/gm,
    /^Contextual cues .+$/gm,
    /^Sadly, there are no .+$/gm,
    /^There's no (clear|indication) .+$/gm,
    /^While .+ isn't explicitly .+$/gm,
    /^Given this, .+$/gm,
    /^Considering .+$/gm,
    /^I'm ready to state .+$/gm,
    /^I am ready to .+$/gm,
    /^The (user's|screen|current|recent|directory|left|focus|name|incoming|tab|window|Slack|data|visual) .+$/gm,
    /^Furthermore,.+$/gm,
    /^I must (inform|propose).+$/gm,
    /^I can (also )?see .+$/gm,
    /^(Confirming|Assessing|Analyzing|Identifying|Evaluating|Clarifying|Awaiting|Re-evaluating|Now I'm) .+$/gm,
    // More residual thinking
    /^I proactively .+$/gm,
    /^I've? (also |carefully |shifted |revised ).+$/gm,
    /^(His|Her|Their) message .+$/gm,
    /^I'm? prepared to .+$/gm,
    /^I'm? now (proposing|formulating|analyzing|selecting|shifting|emphasizing).+$/gm,
    /^(Looking forward|Standing by|Ready for).+$/gm,
    /^On pourrait .+ if .+$/gm,
  ];
  for (const pattern of thinkingPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }
  cleaned = cleaned.replace(/<noise>/gi, '');
  cleaned = cleaned.replace(/<ctrl\d+>/gi, '');
  // Remove standalone punctuation or single-char lines
  cleaned = cleaned.replace(/^\s*[.!?]\s*$/gm, '');
  // Remove "didn't catch that" / "could you repeat" filler
  cleaned = cleaned.replace(/^.*(?:didn't (?:quite )?catch|couldn't (?:quite )?(?:make out|hear|understand)|could you (?:please )?repeat|can you (?:please )?repeat|say that again|could you clarify what you meant).*$/gim, '');
  // Remove "I'm still listening/not catching" filler
  cleaned = cleaned.replace(/^.*(?:I'm still (?:listening|not catching)).*$/gim, '');
  // Remove "sorry.*(?:audio|garbled|choppy)" filler
  cleaned = cleaned.replace(/^.*(?:sorry.*(?:audio was|garbled|choppy)).*$/gim, '');
  // Remove empty greetings and casual filler
  cleaned = cleaned.replace(/^Hey[.,!? ]*$/gim, '');
  cleaned = cleaned.replace(/^Hey, how are you\??$/gim, '');
  cleaned = cleaned.replace(/^(Done|Ok|Okay|Alright|Got it|Sure|Understood|Correct|Indeed|Yep|Yeah|Yes|Nope|Right|Absolutely|Certainly)[.,!? ]*$/gim, '');
  cleaned = cleaned.replace(/^(I'm here|I'm listening|I'm ready|I'm good|I'm fine|I'm doing well)[.,!? ]*$/gim, '');
  cleaned = cleaned.replace(/^(What's up|How can I help|Go ahead|Sure thing|No problem|No worries|You're welcome|Of course)[.,!? ]*$/gim, '');
  cleaned = cleaned.replace(/^(Hi|Hi there|Hello|Bonjour|Salut)[.,!? ]*$/gim, '');
  cleaned = cleaned.replace(/^(Is there anything else|Anything else|Let me know if|Just let me know|What can I do for you).*$/gim, '');
  cleaned = cleaned.replace(/^I'm here\. What('s up| can I).*$/gim, '');
  cleaned = cleaned.replace(/^Go ahead, I'm ready.*$/gim, '');
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
          if (cleaned && cleaned.length > 10) {
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
          if (cleaned && cleaned.length > 10) {
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
          if (cleaned && cleaned.length > 10) {
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
    if (cleaned && cleaned.length > 10) {
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
  const options = parseArgs(process.argv.slice(2));
  console.log('Parsing log files...');

  const curatedPath = path.join(DESKTOP, 'Iris_Message_Log.txt');
  const verbosePath = path.join(DESKTOP, 'iris_conversation.log');
<<<<<<< Updated upstream
  const consolidatedPath = path.join(DESKTOP, 'consolidated_messages.log');
  // consolidated_messages.log is debug output (playback/echo), not conversation data
=======
  // consolidated_messages.log is debug output (playback/echo), not conversation data — skip it
>>>>>>> Stashed changes

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

<<<<<<< Updated upstream
  if (!options.force) {
    try {
      const verifyUrl = `${CONVEX_URL}/api/run/conversations/getRecent`;
      const verifyBody = { args: { limit: 500 } };
      if (ADMIN_KEY) verifyBody.adminKey = ADMIN_KEY;
      const verifyRes = await fetch(verifyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verifyBody),
      });
      const verifyJson = await verifyRes.json();
      const recent = Array.isArray(verifyJson.value) ? verifyJson.value : [];
      const existingImported = recent.filter(
        row => row?.source === 'historical' || row?.source === 'curated'
      );
      if (existingImported.length > 0) {
        console.log(`Historical import already present (${existingImported.length} recent imported records). Skipping re-import.`);
        if (options.cleanupSources) {
          const filesToDelete = [curatedPath, verbosePath, consolidatedPath];
          for (const file of filesToDelete) {
            if (fs.existsSync(file)) {
              fs.unlinkSync(file);
              console.log(`Deleted: ${file}`);
            }
          }
        }
        return;
      }
    } catch (err) {
      console.warn(`Pre-import verification skipped due to error: ${err.message}`);
    }
  }

=======
>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
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
      const verifyJson = await verifyRes.json();
      const verifyData = verifyJson.value || verifyJson;
      if (!Array.isArray(verifyData) || verifyData.length === 0) {
        console.error('VERIFICATION FAILED: Convex returned no data. Keeping source files.');
        return;
      }
      console.log(`Verified: ${verifyData.length} record(s) found in Convex.`);
    } catch (err) {
      console.error(`VERIFICATION FAILED: ${err.message}. Keeping source files.`);
      return;
    }

    const filesToDelete = [curatedPath, verbosePath, consolidatedPath];
=======
  // Delete log files after successful import
  if (inserted > 0) {
    const filesToDelete = [curatedPath, verbosePath, path.join(DESKTOP, 'consolidated_messages.log')];
>>>>>>> Stashed changes
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

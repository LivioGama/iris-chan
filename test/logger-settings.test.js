const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-logger-'));
process.env.IRIS_LOG_PATH = path.join(tempDir, 'consolidated.log');
process.env.IRIS_LOG_SETTINGS_PATH = path.join(tempDir, 'logging-settings.json');

const loggerPath = require.resolve('../src/main/logger.js');
delete require.cache[loggerPath];
const logger = require('../src/main/logger.js');

logger.updateSettings({
	console: { enabled: false, level: 'silent' },
	persist: { enabled: true, level: 'warn' },
	categories: { conversation: false, voice: true, system: true },
});

logger.info('Conversation', 'hidden conversation line');
logger.warn('Voice', 'kept voice line');

let content = fs.readFileSync(process.env.IRIS_LOG_PATH, 'utf-8');
assert.ok(!content.includes('hidden conversation line'), 'disabled categories should be filtered from persisted logs');
assert.ok(content.includes('kept voice line'), 'enabled categories above threshold should persist');

logger.installConsoleInterceptor();
console.log('suppressed raw console line');
console.error('captured raw console line');

content = fs.readFileSync(process.env.IRIS_LOG_PATH, 'utf-8');
assert.ok(!content.includes('suppressed raw console line'), 'raw console.log should respect persisted level filtering');
assert.ok(content.includes('captured raw console line'), 'raw console.error should be captured by the logger interceptor');

const savedSettings = JSON.parse(fs.readFileSync(process.env.IRIS_LOG_SETTINGS_PATH, 'utf-8'));
assert.strictEqual(savedSettings.persist.level, 'warn', 'log settings should be written to disk');
assert.strictEqual(savedSettings.categories.conversation, false, 'category filters should be persisted');

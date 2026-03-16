import { writeFileSync, appendFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Logger } from './types';

const MAX_LOG_SIZE = 2 * 1024 * 1024; // 2MB
const LOG_DIR = join(homedir(), '.iris', 'logs');
const LOG_FILE = join(LOG_DIR, 'iris.log');

const ensureLogDir = () => {
  const { mkdirSync } = require('node:fs');
  mkdirSync(LOG_DIR, { recursive: true });
};

const rotateIfNeeded = () => {
  try {
    if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > MAX_LOG_SIZE) {
      const rotated = LOG_FILE + '.1';
      const { renameSync } = require('node:fs');
      renameSync(LOG_FILE, rotated);
    }
  } catch {}
};

const writeToFile = (line: string) => {
  try {
    ensureLogDir();
    rotateIfNeeded();
    appendFileSync(LOG_FILE, line + '\n');
  } catch {}
};

const timestamp = () => new Date().toISOString();

export const createLogger = (prefix: string): Logger => ({
  debug: (msg, ...args) => {
    const line = `${timestamp()} [DEBUG] [${prefix}] ${msg}`;
    console.debug(line, ...args);
    writeToFile(line);
  },
  info: (msg, ...args) => {
    const line = `${timestamp()} [INFO]  [${prefix}] ${msg}`;
    console.info(line, ...args);
    writeToFile(line);
  },
  warn: (msg, ...args) => {
    const line = `${timestamp()} [WARN]  [${prefix}] ${msg}`;
    console.warn(line, ...args);
    writeToFile(line);
  },
  error: (msg, ...args) => {
    const line = `${timestamp()} [ERROR] [${prefix}] ${msg}`;
    console.error(line, ...args);
    writeToFile(line);
  },
});

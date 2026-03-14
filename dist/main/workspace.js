"use strict";
// Workspace: persisted current directory for file/terminal operations
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../shared/config').default;
const log = require('./logger');
const WORKSPACE_FILE = path.join(config.paths.irisDir, 'workspace.json');
const DEFAULT_DIR = os.homedir();
let _current = null;
function _load() {
    if (_current)
        return _current;
    try {
        const data = JSON.parse(fs.readFileSync(WORKSPACE_FILE, 'utf-8'));
        if (data.directory && fs.existsSync(data.directory)) {
            _current = data.directory;
            return _current;
        }
    }
    catch { }
    _current = DEFAULT_DIR;
    return _current;
}
function get() {
    return _load();
}
function set(dir) {
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved)) {
        return { ok: false, result: `Directory does not exist: ${resolved}` };
    }
    try {
        if (!fs.statSync(resolved).isDirectory()) {
            return { ok: false, result: `Not a directory: ${resolved}` };
        }
    }
    catch (err) {
        return { ok: false, result: `Cannot access: ${err.message}` };
    }
    _current = resolved;
    try {
        fs.writeFileSync(WORKSPACE_FILE, JSON.stringify({ directory: resolved }, null, '\t') + '\n', 'utf-8');
    }
    catch { }
    log.info('Workspace', `Set to: ${resolved}`);
    return { ok: true, result: `Workspace set to: ${resolved}` };
}
// Resolve a path relative to workspace (absolute paths pass through)
function resolve(p) {
    if (!p)
        return get();
    if (path.isAbsolute(p))
        return p;
    return path.resolve(get(), p);
}
module.exports = { get, set, resolve };

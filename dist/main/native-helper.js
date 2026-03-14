"use strict";
// Swift helper compilation + execution wrapper
const { execFile, exec } = require('child_process');
const fs = require('fs');
const config = require('../shared/config').default;
const log = require('./logger');
let compilePromise = null;
function shouldRecompileHelper(paths = config.paths) {
    if (!fs.existsSync(paths.helperSrc)) {
        throw new Error(`Swift helper source not found: ${paths.helperSrc}`);
    }
    if (!fs.existsSync(paths.helperBin)) {
        return true;
    }
    return fs.statSync(paths.helperSrc).mtimeMs > fs.statSync(paths.helperBin).mtimeMs;
}
function ensureCompiled() {
    try {
        if (!shouldRecompileHelper(config.paths)) {
            return Promise.resolve();
        }
    }
    catch (err) {
        return Promise.reject(err);
    }
    if (compilePromise)
        return compilePromise;
    log.info('NativeHelper', 'Compiling Swift helper...');
    compilePromise = new Promise((resolve, reject) => {
        exec(`swiftc -O -o "${config.paths.helperBin}" "${config.paths.helperSrc}"`, (err, stdout, stderr) => {
            if (err) {
                log.error('NativeHelper', 'Compile error:', stderr);
                return reject(new Error('Swift compile failed: ' + stderr));
            }
            log.info('NativeHelper', 'Helper compiled successfully');
            resolve();
        });
    }).finally(() => {
        compilePromise = null;
    });
    return compilePromise;
}
function parseHelperExecResult(err, stdout, stderr) {
    const out = String(stdout || '').trim();
    const errOut = String(stderr || '').trim();
    if (out) {
        try {
            return JSON.parse(out);
        }
        catch {
            return { ok: err ? false : true, result: out };
        }
    }
    if (errOut)
        return { ok: false, result: errOut };
    if (err)
        return { ok: false, result: err.message };
    return { ok: true, result: '' };
}
async function runHelper(actionObj) {
    try {
        await ensureCompiled();
    }
    catch (e) {
        return { ok: false, result: e.message };
    }
    const arg = JSON.stringify(actionObj);
    return new Promise((resolve) => {
        execFile(config.paths.helperBin, [arg], { timeout: 10000 }, (err, stdout, stderr) => {
            resolve(parseHelperExecResult(err, stdout, stderr));
        });
    });
}
module.exports = { runHelper, ensureCompiled, shouldRecompileHelper, parseHelperExecResult };

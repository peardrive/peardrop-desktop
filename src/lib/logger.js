/**
 * MODULE: lib/logger.js
 * PURPOSE: Centralized debug logging with runtime toggle
 * EXPORTS:
 * createLogger(namespace) - Create namespaced logger
 * setDebug(enabled) - Enable/disable debug logging
 * isDebugEnabled() - Check current debug state
 * loadConfig() - Load debug state from config file (main process only)
 * USAGE:
 *   const log = require('./logger').createLogger('HyperdriveManager');
 * log('Starting download', { id: 123 }); // [HyperdriveManager] Starting download { id: 123 }
 *   // Toggle at runtime:
 *   require('./logger').setDebug(false);
 * CONFIG FILE: ~/peardrop/config.json
 *   { "debug": true }
 * EXTERNAL CALLS: fs (for config loading in main process)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(os.homedir(), 'peardrop', 'config.json');

// Global debug state - default ON during development
let debugEnabled = true;

/**
 * Load debug setting from config file
 * Call this once at app startup in main process
 */
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            if (typeof config.debug === 'boolean') {
                debugEnabled = config.debug;
            }
        }
    } catch (err) {
        // Config doesn't exist or invalid - use default (true)
        console.log('[Logger] No config found, debug enabled by default');
    }
    return debugEnabled;
}

/**
 * Save debug setting to config file
 */
function saveConfig() {
    try {
        let config = {};
        if (fs.existsSync(CONFIG_PATH)) {
            config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        }
        config.debug = debugEnabled;
        
        // Ensure directory exists
        const dir = path.dirname(CONFIG_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (err) {
        console.warn('[Logger] Could not save config:', err.message);
    }
}

/**
 * Enable or disable debug logging
 * @param {boolean} enabled
 * @param {boolean} persist - Save to config file (default: true)
 */
function setDebug(enabled, persist = true) {
    debugEnabled = enabled;
    console.log(`[PearDrop] Debug logging ${enabled ? 'ENABLED' : 'DISABLED'}`);
    if (persist) {
        saveConfig();
    }
}

// ============================================================================
// FILE LOGGING
// ============================================================================
// Written so a user can hand us a log without handing us their files.
//
// A peardrop:// key is a CAPABILITY, not an identifier — anyone holding it
// can download that share. A log containing raw keys, emailed to support, is
// a credential leak. Peer public keys are identity, and on Windows a home
// path carries the person's real name. All three are redacted as the line is
// written, so the file on disk is already safe; nothing depends on a later
// scrubbing step that someone might skip.
//
// Never logged at all: file CONTENTS. Only names, sizes and counts.

const LOG_DIR = path.join(os.homedir(), 'peardrop', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'peardrop.log');
const MAX_LOG_BYTES = 2 * 1024 * 1024;   // rotate at 2 MB
const MAX_LOG_FILES = 3;                 // peardrop.log + .1 + .2

let fileLoggingEnabled = false;
let writeBuffer = [];
let flushTimer = null;
let consoleMirrored = false;

const HOME = os.homedir();
// The same path as it appears after JSON.stringify, i.e. with each
// backslash doubled.
const HOME_JSON = HOME.split(String.fromCharCode(92)).join(String.fromCharCode(92, 92));

/**
 * Redact anything in a log line that would be unsafe to share.
 * Deliberately conservative: it is better to lose a little debuggability
 * than to publish a key that grants access to someone's files.
 */
// Escape a literal string for use inside a RegExp.
function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redact(text) {
    if (typeof text !== 'string') return text;
    return text
        // peardrop://<64 hex> -> keep 8 chars, enough to correlate lines
        .replace(/peardrop:\/\/([a-f0-9]{8})[a-f0-9]{56}/gi, 'peardrop://$1…')
        // Bare 64-hex keys (drive keys, discovery keys, peer public keys)
        .replace(/\b([a-f0-9]{8})[a-f0-9]{56}\b/gi, '$1…')
        // Home directory -> ~   (a Windows home path contains a real name).
        // Both forms matter: the plain path, and the JSON-escaped one that
        // appears whenever an object is logged (C:\\\\Users\\\\Name). Redacting only
        // the plain form leaves the name on disk inside every logged object.
        .replace(new RegExp(escapeRegExp(HOME_JSON), 'gi'), '~')
        .replace(new RegExp(escapeRegExp(HOME), 'gi'), '~');
}

function formatArg(a) {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
    try { return JSON.stringify(a); } catch (_) { return String(a); }
}

function rotateIfNeeded() {
    try {
        if (!fs.existsSync(LOG_FILE)) return;
        if (fs.statSync(LOG_FILE).size < MAX_LOG_BYTES) return;
        // peardrop.log.1 -> .2, peardrop.log -> .1, oldest discarded
        for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
            const from = i === 1 ? LOG_FILE : `${LOG_FILE}.${i - 1}`;
            const to = `${LOG_FILE}.${i}`;
            if (fs.existsSync(from)) fs.renameSync(from, to);
        }
    } catch (_) { /* logging must never break the app */ }
}

function flushNow() {
    if (!writeBuffer.length) return;
    const chunk = writeBuffer.join('');
    writeBuffer = [];
    try {
        rotateIfNeeded();
        fs.appendFileSync(LOG_FILE, chunk);
    } catch (_) { /* disk full, permissions — stay silent, keep running */ }
}

function scheduleFlush() {
    if (flushTimer) return;
    // Buffered: a sync write per line would stall the main process during a
    // transfer, which is exactly when logging matters most.
    flushTimer = setTimeout(() => { flushTimer = null; flushNow(); }, 1000);
}

function writeToFile(namespace, args) {
    if (!fileLoggingEnabled) return;
    const line = `${new Date().toISOString()} [${namespace}] ` +
                 args.map(formatArg).join(' ');
    writeBuffer.push(redact(line) + '\n');
    scheduleFlush();
}

/**
 * Start writing logs to ~/peardrop/logs/peardrop.log.
 * Safe to call more than once.
 * @param {{ appVersion?: string }} meta - recorded in the session header
 */
function initFileLogging(meta = {}) {
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        fileLoggingEnabled = true;
        // Session header: the context needed to read a report, and nothing
        // that identifies the machine beyond its OS.
        writeBuffer.push(
            `\n=== session ${new Date().toISOString()} | v${meta.appVersion || '?'} | ` +
            `${process.platform} ${process.arch} | electron ${process.versions.electron || '-'} | ` +
            `node ${process.versions.node} ===\n`
        );
        flushNow();
        // Anything already queued must reach disk before the process dies.
        process.on('exit', flushNow);
    } catch (_) {
        fileLoggingEnabled = false;
    }
}

/**
 * Mirror console output into the log file.
 *
 * The engine writes with raw console.log — 71 calls in hyperdrive-manager
 * alone, none through createLogger — and hypercore/hyperswarm write their own
 * output too. Converting all of that to createLogger would be a large, risky
 * edit across sacred files for no behavioural gain. Tapping the console
 * captures every one of them, including the libraries', which is exactly what
 * a bug report needs.
 *
 * The original console functions are still called, so the terminal is
 * unchanged. Redaction applies here as everywhere else.
 */
function attachConsoleMirror() {
    if (consoleMirrored) return;
    consoleMirrored = true;

    for (const level of ['log', 'warn', 'error']) {
        const original = console[level].bind(console);
        console[level] = (...args) => {
            original(...args);
            // writeToFile must never call console, or this recurses.
            try { writeToFile(level === 'log' ? 'app' : level, args); } catch (_) {}
        };
    }

    // A crash is the most valuable thing to have on disk, and the least
    // likely to be reproducible.
    process.on('uncaughtException', (err) => {
        try { writeToFile('FATAL', ['uncaughtException', err]); flushNow(); } catch (_) {}
        throw err;                     // preserve existing behaviour
    });
    process.on('unhandledRejection', (reason) => {
        try { writeToFile('FATAL', ['unhandledRejection', reason]); flushNow(); } catch (_) {}
    });
}

/** Absolute path to the log, for a "show me the log" button. */
function getLogPath() {
    return LOG_FILE;
}

/**
 * Check if debug is enabled
 * @returns {boolean}
 */
function isDebugEnabled() {
    return debugEnabled;
}

/**
 * Create a namespaced logger function
 * @param {string} namespace - e.g., 'HyperdriveManager', 'Downloader'
 * @returns {Function} Logger function
 */
function createLogger(namespace) {
    const prefix = `[${namespace}]`;
    
    return function log(...args) {
        if (debugEnabled) {
            console.log(prefix, ...args);
        }
        // The file records regardless of the console toggle: when a user
        // reports a problem, the log has to already contain what happened,
        // not start recording after they turn something on.
        writeToFile(namespace, args);
    };
}

module.exports = {
    createLogger,
    setDebug,
    isDebugEnabled,
    loadConfig,
    initFileLogging,
    attachConsoleMirror,
    getLogPath,
    redact,          // exported for tests
    flushNow,
    CONFIG_PATH,
    LOG_FILE,
    LOG_DIR
};

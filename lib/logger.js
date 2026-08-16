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
    };
}

module.exports = {
    createLogger,
    setDebug,
    isDebugEnabled,
    loadConfig,
    CONFIG_PATH
};

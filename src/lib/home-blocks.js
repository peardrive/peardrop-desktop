/**
 * MODULE: home-blocks.js
 * PURPOSE: Modular block system for Home tab layout
 * 
 * DESIGN:
 *   Home tab consists of "blocks" - containers that can hold different content.
 *   Each block can be shown/hidden with fade transitions.
 *   This provides a single system for managing home tab layout.
 * 
 * BLOCKS:
 *   - dropzone: File drop area (always present, may shrink when notification shows)
 *   - notification: Single slot for transfer notifications (only ONE at a time)
 *   - actions: Share/Download buttons
 * 
 * NOTIFICATION SYSTEM:
 *   Only ONE notification can show at a time. New notifications replace old ones.
 *   Types: 'upload-waiting', 'upload-progress', 'download-progress', 'moved', 'error'
 * 
 * EXPORTS:
 *   - NotificationManager - Singleton for managing the notification slot
 *   - showNotification(config) - Show a notification (replaces any existing)
 *   - hideNotification(options) - Hide current notification with transition
 *   - getCurrentNotification() - Get current notification state
 */

// Notification state - SINGLE SOURCE OF TRUTH
let currentNotification = null;
let notificationTimer = null;
let fadeTimer = null;

/**
 * Notification configuration
 * @typedef {Object} NotificationConfig
 * @property {string} id - Unique identifier
 * @property {string} type - 'upload-waiting' | 'upload-progress' | 'download-progress' | 'complete' | 'moved' | 'error'
 * @property {string} name - Display name
 * @property {number} percent - Progress 0-100
 * @property {number} bytesTransferred - Bytes transferred
 * @property {number} totalBytes - Total bytes
 * @property {string} speed - Speed string
 * @property {string} shareLink - Share link for copy
 * @property {string} error - Error message
 * @property {number} autoDismissMs - Auto-dismiss after N ms (0 = no auto-dismiss)
 * @property {function} onDismiss - Callback when dismissed
 */

/**
 * Show a notification in the home tab notification slot
 * Replaces any existing notification (only ONE at a time)
 * @param {NotificationConfig} config 
 */
function showNotification(config) {
    // Clear any existing timers
    if (notificationTimer) {
        clearTimeout(notificationTimer);
        notificationTimer = null;
    }
    if (fadeTimer) {
        clearTimeout(fadeTimer);
        fadeTimer = null;
    }
    
    // Store notification state
    currentNotification = {
        id: config.id || `notif_${Date.now()}`,
        type: config.type || 'upload-waiting',
        name: config.name || 'Transfer',
        percent: config.percent || 0,
        bytesTransferred: config.bytesTransferred || 0,
        totalBytes: config.totalBytes || 0,
        speed: config.speed || '',
        shareLink: config.shareLink || '',
        error: config.error || '',
        autoDismissMs: config.autoDismissMs || 0,
        onDismiss: config.onDismiss || null,
        createdAt: Date.now()
    };
    
    // Render the notification
    renderNotificationSlot();
    
    // Set up auto-dismiss if configured
    if (config.autoDismissMs > 0) {
        notificationTimer = setTimeout(() => {
            // Check if this notification is still current
            if (currentNotification && currentNotification.id === config.id) {
                hideNotification({ showMoved: true });
            }
        }, config.autoDismissMs);
    }
    
    return currentNotification.id;
}

/**
 * Update the current notification without replacing it
 * @param {Partial<NotificationConfig>} updates 
 */
function updateNotification(updates) {
    if (!currentNotification) return;
    
    Object.assign(currentNotification, updates);
    renderNotificationSlot();
}

/**
 * Hide the current notification with fade transition
 * @param {Object} options
 * @param {boolean} options.showMoved - Show "Moved to Shares" message first
 * @param {number} options.movedDuration - How long to show "moved" message (default 3000ms)
 */
function hideNotification(options = {}) {
    const { showMoved = false, movedDuration = 3000 } = options;
    
    if (!currentNotification) return;
    
    // Clear auto-dismiss timer
    if (notificationTimer) {
        clearTimeout(notificationTimer);
        notificationTimer = null;
    }
    
    const dismissCallback = currentNotification.onDismiss;
    
    if (showMoved && currentNotification.type !== 'moved') {
        // Show "Moved to Shares" message first
        const originalName = currentNotification.name;
        currentNotification = {
            id: `moved_${Date.now()}`,
            type: 'moved',
            name: originalName,
            percent: 100,
            bytesTransferred: 0,
            totalBytes: 0,
            speed: '',
            shareLink: '',
            error: '',
            autoDismissMs: 0,
            onDismiss: null,
            createdAt: Date.now()
        };
        
        renderNotificationSlot();
        
        // After movedDuration, fade out completely
        fadeTimer = setTimeout(() => {
            fadeOutNotification(dismissCallback);
        }, movedDuration);
    } else {
        // Just fade out
        fadeOutNotification(dismissCallback);
    }
}

/**
 * Fade out and remove the notification
 */
function fadeOutNotification(callback) {
    const slot = document.getElementById('notificationSlot');
    if (slot) {
        slot.classList.add('fading-out');
        
        // After fade animation, clear and restore layout
        setTimeout(() => {
            currentNotification = null;
            renderNotificationSlot();
            
            // Callback if provided
            if (callback) callback();
        }, 300); // Match CSS transition duration
    } else {
        currentNotification = null;
        if (callback) callback();
    }
}

/**
 * Get the current notification state
 * @returns {NotificationConfig|null}
 */
function getCurrentNotification() {
    return currentNotification;
}

/**
 * Check if there's an active notification
 * @returns {boolean}
 */
function hasNotification() {
    return currentNotification !== null;
}

/**
 * Render the notification slot
 * This should be called by the main renderer
 */
function renderNotificationSlot() {
    const slot = document.getElementById('notificationSlot');
    if (!slot) return;
    
    if (!currentNotification) {
        slot.classList.add('hidden');
        slot.classList.remove('fading-out');
        slot.innerHTML = '';
        return;
    }
    
    slot.classList.remove('hidden', 'fading-out');
    
    // Use TransferBlob to render the notification content
    if (window.TransferBlob) {
        // Map notification type to blob state
        const stateMap = {
            'upload-waiting': 'waiting',
            'upload-progress': 'transferring',
            'download-progress': 'transferring',
            'complete': 'complete',
            'moved': 'moved',
            'error': 'error'
        };
        
        const blobConfig = {
            id: currentNotification.id,
            name: currentNotification.name,
            type: currentNotification.type.includes('download') ? 'download' : 'upload',
            state: stateMap[currentNotification.type] || 'waiting',
            percent: currentNotification.percent,
            bytesTransferred: currentNotification.bytesTransferred,
            totalBytes: currentNotification.totalBytes,
            speed: currentNotification.speed,
            shareLink: currentNotification.shareLink,
            context: 'home',
            error: currentNotification.error
        };
        
        slot.innerHTML = window.TransferBlob.createTransferBlob(blobConfig);
        
        // Attach event listeners
        attachNotificationListeners(slot);
    }
}

/**
 * Attach event listeners to notification buttons
 */
function attachNotificationListeners(container) {
    // Copy link button
    container.querySelectorAll('.copy-link-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (currentNotification && currentNotification.shareLink) {
                navigator.clipboard.writeText(currentNotification.shareLink);
                btn.textContent = '✓';
                setTimeout(() => { btn.textContent = '📋'; }, 1500);
            }
        });
    });
    
    // Stop/dismiss button
    container.querySelectorAll('.stop-pending-btn, .dismiss-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Emit event for main renderer to handle
            window.dispatchEvent(new CustomEvent('notification-dismiss', {
                detail: { id: currentNotification?.id, type: currentNotification?.type }
            }));
        });
    });
    
    // Cancel download button
    container.querySelectorAll('.cancel-download-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            window.dispatchEvent(new CustomEvent('notification-cancel', {
                detail: { id: currentNotification?.id }
            }));
        });
    });
    
    // Minimize button
    container.querySelectorAll('.minimize-download-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            hideNotification({ showMoved: false });
        });
    });
}

// Export for browser context
if (typeof window !== 'undefined') {
    window.HomeBlocks = {
        showNotification,
        updateNotification,
        hideNotification,
        getCurrentNotification,
        hasNotification,
        renderNotificationSlot
    };
}

// Export for Node.js context
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        showNotification,
        updateNotification,
        hideNotification,
        getCurrentNotification,
        hasNotification,
        renderNotificationSlot
    };
}

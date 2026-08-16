/**
 * MODULE: lib/qr-scanner/qr-scanner.js
 * PURPOSE: Camera + file QR scanner modal for reading peardrop:// links
 * VERSION: 0.1.0
 * EXPORTS (global):
 * window.openQrScanner({ onResult })
 * DEPENDENCIES:
 * window.jsQR (loaded via node_modules/jsqr/dist/jsQR.js)
 * window.showToast (renderer.js, optional)
 * DOM ELEMENTS USED:
 * #qrScannerModal, #qrScannerVideo, #qrScannerStatus, #qrScannerCloseBtn
 * #qrCameraSelect, #qrPickFileBtn, #qrFileInput
 * BEHAVIOR:
 * Opens modal, starts default camera via getUserMedia()
 * Scans frames with jsQR on requestAnimationFrame
 * Camera dropdown auto-hides when 0 or 1 video device available
 * "Select file with QR" path uses #qrFileInput (image/*)
 * Cleanup (stop tracks, cancel rAF) on close, decode success, X click,
 *     backdrop click, ESC key
 */
(function () {
    // TEMP DEBUG — Test Cameras
    const TEST_MOCK_CAMERAS = false;
    const TEST_MOCK_CAMERA_LIST = [
        { deviceId: 'mock-cam-1', kind: 'videoinput', label: 'FaceTime HD Camera' },
        { deviceId: 'mock-cam-2', kind: 'videoinput', label: 'Logitech C920' }
    ];

    let modal, video, statusEl, closeBtn, pickFileBtn, fileInput;
    let cameraDropdown, cameraTrigger, cameraTriggerLabel, cameraPanel;
    let canvas, ctx;
    let stream = null;
    let rafId = null;
    let active = false;
    let onResultCallback = null;
    let initialized = false;
    let currentCams = [];
    let currentDeviceId = null;

    function init() {
        if (initialized) return;
        initialized = true;

        modal = document.getElementById('qrScannerModal');
        video = document.getElementById('qrScannerVideo');
        statusEl = document.getElementById('qrScannerStatus');
        closeBtn = document.getElementById('qrScannerCloseBtn');
        cameraDropdown = document.getElementById('qrCameraDropdown');
        cameraTrigger = document.getElementById('qrCameraTrigger');
        cameraTriggerLabel = document.getElementById('qrCameraTriggerLabel');
        cameraPanel = document.getElementById('qrCameraPanel');
        pickFileBtn = document.getElementById('qrPickFileBtn');
        fileInput = document.getElementById('qrFileInput');

        canvas = document.createElement('canvas');
        ctx = canvas.getContext('2d', { willReadFrequently: true });

        closeBtn.addEventListener('click', close);

        // Backdrop click closes (clicking the overlay itself, not the panel)
        modal.addEventListener('click', (e) => {
            if (e.target === modal) close();
        });

        document.addEventListener('keydown', (e) => {
            if (!active) return;
            if (e.key === 'Escape') {
                if (isDropdownOpen()) closeDropdown();
                else close();
            }
        });

        cameraTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDropdown();
        });

        // Click outside the dropdown closes it (per CLAUDE.md stacking rules:
        // document handler instead of a backdrop element)
        document.addEventListener('click', (e) => {
            if (!isDropdownOpen()) return;
            if (cameraDropdown.contains(e.target)) return;
            closeDropdown();
        });

        pickFileBtn.addEventListener('click', () => {
            fileInput.click();
        });

        fileInput.addEventListener('change', async () => {
            const file = fileInput.files?.[0];
            fileInput.value = '';
            if (!file) return;
            try {
                const text = await decodeQrFromImageFile(file);
                deliver(text);
            } catch (err) {
                if (typeof window.showToast === 'function') {
                    window.showToast(err.message || 'Could not read QR code', 'error');
                }
            }
        });
    }

    async function open({ onResult } = {}) {
        init();
        if (active) return;
        active = true;
        onResultCallback = typeof onResult === 'function' ? onResult : null;
        modal.classList.add('active');
        showStatus('Starting camera…');

        try {
            await startCamera();
        } catch {
            // startCamera handles its own status messaging
        }
        await populateCameraList();
    }

    function close() {
        if (!active) return;
        active = false;
        stopCamera();
        modal.classList.remove('active');
        onResultCallback = null;
    }

    async function startCamera(deviceId) {
        stopCamera();
        try {
            const constraints = deviceId
                ? { video: { deviceId: { exact: deviceId } } }
                : { video: true };
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = stream;
            await video.play();
            hideStatus();
            scheduleScan();
        } catch (err) {
            stream = null;
            const name = err && err.name;
            const msg =
                name === 'NotAllowedError' ? 'Camera permission denied'
                : name === 'NotFoundError' ? 'No camera detected'
                : name === 'NotReadableError' ? 'Camera is in use by another app'
                : (err && err.message) || 'Camera unavailable';
            showStatus(msg);
            throw err;
        }
    }

    function stopCamera() {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;
        }
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
        }
        if (video) video.srcObject = null;
    }

    function scheduleScan() {
        rafId = requestAnimationFrame(scanFrame);
    }

    function scanFrame() {
        rafId = null;
        if (!active || !stream) return;

        if (video.readyState >= 2 && video.videoWidth > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const result = window.jsQR && window.jsQR(imageData.data, imageData.width, imageData.height);
            if (result && result.data) {
                deliver(result.data);
                return;
            }
        }
        scheduleScan();
    }

    function deliver(text) {
        const cb = onResultCallback;
        close();
        if (cb) cb(text);
    }

    async function populateCameraList() {
        try {
            // ⚠️ TEMP DEBUG branch — see TEST_MOCK_CAMERAS at top of file
            const cams = TEST_MOCK_CAMERAS
                ? TEST_MOCK_CAMERA_LIST
                : (await navigator.mediaDevices.enumerateDevices())
                    .filter(d => d.kind === 'videoinput');

            currentCams = cams;

            // Sync current selection to the active stream's device if possible
            const activeDeviceId =
                stream && stream.getVideoTracks && stream.getVideoTracks()[0]
                    ? stream.getVideoTracks()[0].getSettings().deviceId
                    : null;
            if (activeDeviceId && cams.some(c => c.deviceId === activeDeviceId)) {
                currentDeviceId = activeDeviceId;
            } else if (cams.length > 0 && !currentDeviceId) {
                currentDeviceId = cams[0].deviceId;
            }

            renderCameraDropdown();

            // Per spec: hide dropdown when 0 or 1 camera
            cameraDropdown.hidden = cams.length <= 1;
        } catch {
            cameraDropdown.hidden = true;
        }
    }

    function renderCameraDropdown() {
        const checkSvg = '<svg class="qr-camera-item-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

        cameraPanel.innerHTML = currentCams
            .map((c, i) => {
                const label = c.label || `Camera ${i + 1}`;
                const isActive = c.deviceId === currentDeviceId;
                return `<button type="button" class="qr-camera-item${isActive ? ' is-active' : ''}" role="option" data-device-id="${escapeAttr(c.deviceId)}" aria-selected="${isActive}">
                    <span class="qr-camera-item-label">${escapeHtml(label)}</span>
                    ${checkSvg}
                </button>`;
            })
            .join('');

        // Update the trigger label to whatever's currently selected
        const activeCam = currentCams.find(c => c.deviceId === currentDeviceId);
        cameraTriggerLabel.textContent = activeCam ? (activeCam.label || 'Camera') : 'Camera';

        // Wire item clicks
        cameraPanel.querySelectorAll('.qr-camera-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.deviceId;
                closeDropdown();
                if (id === currentDeviceId) return;
                currentDeviceId = id;
                renderCameraDropdown();
                startCamera(id).catch(() => {});
            });
        });
    }

    function isDropdownOpen() {
        return cameraDropdown.classList.contains('is-open');
    }

    function openDropdown() {
        cameraDropdown.classList.add('is-open');
        cameraTrigger.setAttribute('aria-expanded', 'true');
    }

    function closeDropdown() {
        cameraDropdown.classList.remove('is-open');
        cameraTrigger.setAttribute('aria-expanded', 'false');
    }

    function toggleDropdown() {
        if (isDropdownOpen()) closeDropdown();
        else openDropdown();
    }

    async function decodeQrFromImageFile(file) {
        if (!file.type.startsWith('image/')) {
            throw new Error('Please pick an image file');
        }
        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
        const img = await new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('Failed to load image'));
            image.src = dataUrl;
        });
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = window.jsQR && window.jsQR(imageData.data, imageData.width, imageData.height);
        if (!result || !result.data) throw new Error('No QR code found in image');
        return result.data;
    }

    function showStatus(text) {
        statusEl.textContent = text;
        statusEl.hidden = false;
    }

    function hideStatus() {
        statusEl.hidden = true;
    }

    // Shared escape from lib/ui-utils.js (window.PearUtils, loaded first).
    const escapeHtml = (s) => PearUtils.escapeHtml(s);

    function escapeAttr(s) {
        return String(s).replace(/"/g, '&quot;');
    }

    window.openQrScanner = open;
})();

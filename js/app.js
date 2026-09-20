import { decodeBafangPacket, COMMAND_PAYLOADS, getPasCommand, buildWriteFrame, BAFANG_COMMANDS, validateBafangPacket, getErrorCodeName } from './bafang-protocol.js';

const SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';
const NOTIFY_UUID = '0000fff4-0000-1000-8000-00805f9b34fb';
const WRITE_UUID = '0000fff3-0000-1000-8000-00805f9b34fb';

class SimpleKalman {
    constructor(processNoise = 0.0005) { // 0.0005 is optimized for cycling
        this.q = processNoise;
        this.x = null;
        this.p = null;
    }

    setProcessNoise(newQ) {
        this.q = newQ;
    }

    reset() {
        this.x = null;
        this.p = null;
    }
    filter(measurement, accuracy) {
        if (this.x === null) {
            this.x = measurement;
            this.p = accuracy;
            return this.x;
        }
        this.p = this.p + this.q;
        const k = this.p / (this.p + accuracy);
        this.x = this.x + k * (measurement - this.x);
        this.p = (1 - k) * this.p;
        return this.x;
    }
}

const kalmanLat = new SimpleKalman();
const kalmanLon = new SimpleKalman();

let rideData = [];
let lastLoggedTime = 0;
let lastBackupTime = 0;
const BACKUP_INTERVAL_MS = 30000;
let currentLat = 0, currentLon = 0, currentAltitude = 0;
let lastLoggedLat = null, lastLoggedLon = null;
let lastLoggedAccuracy = 0;
let currentNativeSpeedKmh = 0;
let wakeLock = null;
let bleDevice = null;
let geoWatchId = null;
let isScreenLocked = false;
let currentPas = "--", currentSpeed = "--", currentOdo = "--";
let currentBattery = "--", currentVoltage = "--", currentTemp = "--";
let currentTrip = "--", currentRange = "--";
let currentCurrent = "--", currentBmsRelPct = "--";
let currentBmsRemainMah = "--", currentBmsFullMah = "--";
let currentBmsNowPct = "--", currentBmsCycle = "--";
let currentBmsChgCurMin = "--", currentBmsChgMaxMin = "--";
let currentPasNum = "--";
// Default = hardest clamp (matches the 0-4 send table) so the pre-notify
// window can't overshoot; overwritten by the bike's pasNum notify (~1s).
let pasNumMax = 4;
let currentLight = "--";
let currentErrorCode = "--";
let currentAccuracy = 999;
let writeCharacteristic = null;
let headlightState = false;

function pasLevelToString(level) {
    const n = typeof level === 'number' ? level : parseInt(level, 10);
    if (!isNaN(n) && n > pasNumMax) return "WALK";
    return String(level);
}

// "8 (Motor hall sensor)" - raw code kept for logging, name for the UI.
function formatErrorCode(code) {
    const n = typeof code === 'number' ? code : parseInt(code, 10);
    if (isNaN(n)) return String(code);
    return `${n} (${getErrorCodeName(n)})`;
}

function updatePasUI() {
    const pasValEl = document.getElementById('pasValue');
    if (pasValEl) pasValEl.innerText = pasLevelToString(currentPas);
    const pasDispEl = document.getElementById('pasDisplay');
    if (pasDispEl) pasDispEl.innerText = pasLevelToString(currentPas);
}

// Walk mode reports a PAS value above the normal range (15 on DP E12).
// Clamp it back into range first so +/- always computes AND displays
// exactly the level that gets sent - otherwise the buttons show a level
// the bike never acknowledges and look out of sync until feedback arrives.
function parsePasBase() {
    let n = typeof currentPas === 'number' ? currentPas : parseInt(currentPas, 10);
    if (isNaN(n)) return 0;
    return Math.min(pasNumMax, Math.max(0, n));
}

function updateLightUI() {
    const lightBtn = document.getElementById('lightToggleBtn');
    if (lightBtn) {
        if (headlightState) {
            lightBtn.classList.add('active');
        } else {
            lightBtn.classList.remove('active');
        }
        lightBtn.style.background = '';
        lightBtn.style.borderColor = '';
        lightBtn.style.boxShadow = '';
    }
    const lightDisplayEl = document.getElementById('lightDisplay');
    if (lightDisplayEl) lightDisplayEl.innerText = currentLight;
}

const MAX_ACCURACY_METERS = 25;
const MIN_MOVE_METERS = 5;
const MAX_IDLE_TIME_MS = 60000;
const KALMAN_SMOOTHING = 0.1;

// Check for unsaved ride data recovery on page load
window.onload = () => {
    const backup = localStorage.getItem('ride_data_backup');
    if (!backup) return;
    try {
        const recoveredData = JSON.parse(backup);
        if (Array.isArray(recoveredData) && recoveredData.length > 0
            && confirm(`Found ${recoveredData.length} unsaved points from a previous session. Download them now?`)) {
            rideData = recoveredData;
            downloadLogs();
            return;
        }
    } catch (err) {
        console.warn("Could not parse ride backup:", err);
    }
    localStorage.removeItem('ride_data_backup');
};

function updateDisplayVisibility() {
    const metrics = [
        'speed', 'battery', 'pas', 'voltage', 'range', 'trip', 'odo', 
        'current', 'bmsRelPct', 'bmsRemainMah', 
        'bmsFullMah', 'bmsNowPct', 'bmsCycle', 'bmsChgCurMin',
        'bmsChgMaxMin', 'pasNum', 'temp', 'light', 'errorCode'
    ];
    metrics.forEach(m => {
        const checkbox = document.getElementById(`chk_${m}`);
        const box = document.getElementById(`box_${m}`);
        if (checkbox && box) {
            box.style.display = checkbox.checked ? 'block' : 'none';
        }
    });
}

document.querySelectorAll('.config-grid input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', updateDisplayVisibility);
});
updateDisplayVisibility();

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try { wakeLock = await navigator.wakeLock.request('screen'); } 
        catch (err) { console.error(`Wake Lock Error: ${err.message}`); }
    }
}

function releaseWakeLock() {
    if (wakeLock !== null) {
        try { wakeLock.release(); } catch (err) { /* already released */ }
        wakeLock = null;
    }
}

document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && wakeLock === null
        && bleDevice && bleDevice.gatt.connected && !isScreenLocked) {
        await requestWakeLock();
    }
});

// Helper: Calculate distance in meters between two lat/lon points (Haversineformula)					  
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Radius of the earth in meters
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
        Math.sin(dLon / 2) * Math.sin(dLon / 2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
    return R * c;
}

function deg2rad(deg) {
    return deg * (Math.PI / 180);
}

	 
function handleGpsPosition(position) {
        const accuracy = position.coords.accuracy;
        currentAccuracy = accuracy;
        currentAltitude = position.coords.altitude !== null ? position.coords.altitude : 0;
        currentNativeSpeedKmh = (position.coords.speed || 0) * 3.6;

        if (accuracy > MAX_ACCURACY_METERS) return;

        const accuracyDeg = accuracy / 111320;

        // Speed Gate: Bypass Kalman filter when moving fast to hug curves
        if (currentNativeSpeedKmh > 12) {
            currentLat = position.coords.latitude;
            currentLon = position.coords.longitude;
            kalmanLat.x = currentLat;
            kalmanLon.x = currentLon;
        } else {
            // If walking or stopped, apply dynamic Kalman filter based on current accuracy
            const dynamicQ = accuracyDeg * KALMAN_SMOOTHING;
            kalmanLat.setProcessNoise(dynamicQ);
            kalmanLon.setProcessNoise(dynamicQ);

            currentLat = kalmanLat.filter(position.coords.latitude, accuracyDeg);
            currentLon = kalmanLon.filter(position.coords.longitude, accuracyDeg);
        }
        
        // Skip DOM update if OLED lock screen is active
        if (!isScreenLocked) {
            const gpsEl = document.getElementById('gpsDisplay');
            gpsEl.innerHTML = `GPS: <span class="status-badge status-ok">OK (±${Math.round(currentAccuracy)}m)</span>`;
        }
}

function handleGpsError(err) {
        console.error("GPS Error:", err);
        currentAccuracy = Infinity; // Invalidate accuracy on error
        if (!isScreenLocked) {
            const gpsEl = document.getElementById('gpsDisplay');
            gpsEl.innerHTML = `GPS: <span class="status-badge status-searching">Searching</span>`;
        }
}

// GPS only runs while connected to the bike - no point draining the
// battery tracking position on the sofa.
function startGpsTracking() {
    if (geoWatchId !== null || !('geolocation' in navigator)) return;
    geoWatchId = navigator.geolocation.watchPosition(
        handleGpsPosition,
        handleGpsError,
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
}

function stopGpsTracking() {
    if (geoWatchId !== null && ('geolocation' in navigator)) {
        navigator.geolocation.clearWatch(geoWatchId);
    }
    geoWatchId = null;
}

async function sendHexCommand(hexString) {
    if (!writeCharacteristic) {
        console.warn("Write characteristic not available.");
        return;
    }
    try {
        const cleanHex = hexString.replace(/[\s,:-]/g, '').toLowerCase();
        const bytes = new Uint8Array(cleanHex.length / 2);
        for (let i = 0; i < cleanHex.length; i += 2) {
            bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
        }
        
        if (writeCharacteristic.properties.writeWithoutResponse) {
            await writeCharacteristic.writeValueWithoutResponse(bytes);
        } else {
            await writeCharacteristic.writeValueWithResponse(bytes);
        }
        // console.log("Command sent successfully:", hexString);
    } catch (error) {
        console.error("Failed to send command:", error);
    }
}

document.getElementById('connectBtn').addEventListener('click', async () => {
    let connectStage = 'pick'; // 'pick' (requestDevice) vs 'gatt' (connect/service discovery)
    try {
        document.getElementById('status').innerHTML = `Status: <span class="status-badge status-searching">Connecting...</span>`;
        currentPas = "--";
        currentLight = "--";
        currentPasNum = "--";
        currentBmsNowPct = "--";
        currentBmsCycle = "--";
        currentBmsChgCurMin = "--";
        currentBmsChgMaxMin = "--";
        currentErrorCode = "--";
        pasNumMax = 4;
        headlightState = false;
        updatePasUI();
        updateLightUI();
        const checkboxes = document.querySelectorAll('#configCard input[type="checkbox"]');
        checkboxes.forEach(cb => cb.disabled = true);

        // Filter by the FFF0 service instead of the display name: a bike that
        // lost its BLE name (or never had one) still advertises the service.
        // The checkbox falls back to showing every nearby BLE device.
        const showAllDevices = document.getElementById('showAllDevices');
        bleDevice = await navigator.bluetooth.requestDevice(
            showAllDevices && showAllDevices.checked
                ? { acceptAllDevices: true, optionalServices: [SERVICE_UUID] }
                : { filters: [{ services: [SERVICE_UUID] }], optionalServices: [SERVICE_UUID] }
        );
        
        connectStage = 'gatt';
        bleDevice.addEventListener('gattserverdisconnected', onDisconnected);

        const server = await bleDevice.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);
        const notifyChar = await service.getCharacteristic(NOTIFY_UUID);
		writeCharacteristic = await service.getCharacteristic(WRITE_UUID);

        await notifyChar.startNotifications();
        notifyChar.addEventListener('characteristicvaluechanged', handleBikeData);

        // Bafang Go sends A1=1 right after subscribing; extended BMS
        // details (0x67/0x68/0x69) only arrive after it.
        await sendHexCommand(buildWriteFrame(BAFANG_COMMANDS.SESSION, 0x01));
        
        document.getElementById('status').innerHTML = `Status: <span class="status-badge status-connected">Connected</span>`;
        document.getElementById('exportBtn').disabled = false;
        document.getElementById('connectBtn').style.display = 'none';
        document.getElementById('disconnectBtn').style.display = 'block';
        
        kalmanLat.reset();
        kalmanLon.reset();
        startGpsTracking();
        await requestWakeLock();
    } catch (error) {
        console.error("Bluetooth Error:", error);
        // Distinguish user-cancelled picker from a wrong device picked via
        // "Show all": getPrimaryService rejects with NotFoundError when the
        // device doesn't advertise FFF0.
        let statusText = 'Connection Failed';
        if (error && error.name === 'NotFoundError' && connectStage === 'pick') {
            statusText = 'Cancelled';
        } else if (connectStage === 'gatt' && error && (error.name === 'NotFoundError' || error.name === 'NetworkError')) {
            statusText = 'No FFF0 service — pick the bike (uncheck Show all)';
        }
        document.getElementById('status').innerHTML = `Status: <span class="status-badge status-disconnected">${statusText}</span>`;
        const checkboxes = document.querySelectorAll('#configCard input[type="checkbox"]');
        checkboxes.forEach(cb => { if(cb.id !== 'chk_timestamp' && cb.id !== 'chk_latlon') cb.disabled = false; });
    }
});

document.getElementById('disconnectBtn').addEventListener('click', async () => {
    try { await sendHexCommand(buildWriteFrame(BAFANG_COMMANDS.SESSION, 0x00)); } catch (e) { /* best effort */ }
    if (bleDevice && bleDevice.gatt.connected) { bleDevice.gatt.disconnect(); }
});

function onDisconnected() {
    document.getElementById('status').innerHTML = `Status: <span class="status-badge status-disconnected">Disconnected</span>`;
    document.getElementById('connectBtn').style.display = 'block';
    document.getElementById('disconnectBtn').style.display = 'none';
    writeCharacteristic = null;
    currentPas = "--";
    currentLight = "--";
    currentPasNum = "--";
    currentBmsNowPct = "--";
    currentBmsCycle = "--";
    currentBmsChgCurMin = "--";
    currentBmsChgMaxMin = "--";
    currentErrorCode = "--";
    pasNumMax = 4;
    headlightState = false;
    updatePasUI();
    updateLightUI();
    releaseWakeLock();
    stopGpsTracking();
    
    if (rideData.length > 0) {
        downloadLogs();
    }
    
    const checkboxes = document.querySelectorAll('#configCard input[type="checkbox"]');
    checkboxes.forEach(cb => { if(cb.id !== 'chk_timestamp' && cb.id !== 'chk_latlon') cb.disabled = false; });
}

function scheduleBackup() {
    const now = Date.now();
    if (rideData.length === 0 || now - lastBackupTime < BACKUP_INTERVAL_MS) return;
    lastBackupTime = now;
    try {
        localStorage.setItem('ride_data_backup', JSON.stringify(rideData));
    } catch (err) {
        console.warn("Backup failed (quota?):", err);
    }
}

function downloadLogs() {
    // Persist the final state before exporting
    if (rideData.length > 0) {
        try {
            localStorage.setItem('ride_data_backup', JSON.stringify(rideData));
        } catch (err) {
            console.warn("Backup failed (quota?):", err);
        }
        lastBackupTime = Date.now();
    }

    if (rideData.length === 0) return;

    const timeStampStr = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
    const baseFilename = `bafang_ride_${timeStampStr}`;

    // --- 1. GENERATE CSV (Blob: data-URIs break on long rides) ---
    // Union of every point's keys: a metric enabled mid-ride would otherwise
    // be silently dropped because the header came from the first point only.
    const keys = [...new Set(rideData.flatMap(row => Object.keys(row)))];
    const csvLines = [keys.join(",")];
    rideData.forEach(row => {
        csvLines.push(keys.map(key => {
            const val = row[key] !== undefined ? row[key] : "";
            return typeof val === 'string' && (val.includes(',') || val.includes('"'))
                ? `"${val.replace(/"/g, '""')}"` : val;
        }).join(","));
    });
    triggerDownload(
        URL.createObjectURL(new Blob([csvLines.join("\n")], { type: 'text/csv;charset=utf-8' })),
        `${baseFilename}.csv`
    );

    // --- 2. GENERATE GPX (Blob, all logged e-bike fields as extensions) ---
    // Escape via \u0026 so the entities survive tooling that decodes "&amp;".
    const escXml = (v) => String(v)
        .replace(/&/g, '\u0026amp;')
        .replace(/</g, '\u0026lt;')
        .replace(/>/g, '\u0026gt;');
    let gpxContent = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="OpenBafang">\n<trk>\n<name>${baseFilename}</name>\n<trkseg>\n`;
    
    rideData.forEach(row => {
        if (row.lat && row.lon) {
            gpxContent += `  <trkpt lat="${row.lat}" lon="${row.lon}">\n`;
            if (row.altitude_m) gpxContent += `    <ele>${row.altitude_m}</ele>\n`;
            gpxContent += `    <time>${row.timestamp}</time>\n`;
            
            const extKeys = [
                'speed', 'battery', 'pas', 'pasNum', 'voltage', 'current',
                'odo', 'trip', 'range', 'temp', 'light', 'errorCode',
                'bmsRelPct', 'bmsNowPct', 'bmsRemainMah', 'bmsFullMah', 'bmsCycle'
            ].filter(k => row[k] !== undefined);
            if (extKeys.length > 0) {
                gpxContent += `    <extensions>\n`;
                extKeys.forEach(k => { gpxContent += `      <${k}>${escXml(row[k])}</${k}>\n`; });
                gpxContent += `    </extensions>\n`;
            }
            gpxContent += `  </trkpt>\n`;
        }
    });
    gpxContent += `</trkseg>\n</trk>\n</gpx>`;
    
    triggerDownload(
        URL.createObjectURL(new Blob([gpxContent], { type: 'application/gpx+xml;charset=utf-8' })),
        `${baseFilename}.gpx`
    );

	// Clear backup after successful download										 
    localStorage.removeItem('ride_data_backup');
    lastBackupTime = 0;
}

function triggerDownload(uri, filename) {
    const link = document.createElement("a");
    link.setAttribute("href", uri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    if (uri.startsWith('blob:')) {
        setTimeout(() => URL.revokeObjectURL(uri), 60000);
    }
}
             
document.getElementById('exportBtn').addEventListener('click', downloadLogs);

								   
const lockScreenBtn = document.getElementById('lockScreenBtn');
const touchLockOverlay = document.getElementById('touchLockOverlay');
const unlockSlider = document.getElementById('unlockSlider');

	  
lockScreenBtn.addEventListener('click', () => {
    touchLockOverlay.style.display = 'flex';
    unlockSlider.value = 0; // Reset slider position
    isScreenLocked = true; // Freeze heavy DOM repaints
});

														   
unlockSlider.addEventListener('input', (e) => {
    if (e.target.value >= 95) { // If dragged 95% of the way
        touchLockOverlay.style.display = 'none'; // Hide overlay 
        e.target.value = 0;  // Reset for next time
        isScreenLocked = false; // Resume DOM repaints
        
        // Force an immediate UI refresh upon unlocking
        document.getElementById('battDisplay').innerText = `${currentBattery}%`;
        document.getElementById('speedDisplay').innerText = `${currentSpeed} km/h`;
        updatePasUI();
        updateLightUI();
        const refresh = (id, val, suffix = '') => {
            const el = document.getElementById(id);
            if (el) el.innerText = `${val}${suffix}`;
        };
        refresh('tripDisplay', currentTrip, ' km');
        refresh('rangeDisplay', currentRange, ' km');
        refresh('odoDisplay', currentOdo, ' km');
        refresh('voltDisplay', currentVoltage, ' V');
        refresh('tempDisplay', currentTemp, ' °C');
        refresh('currentDisplay', currentCurrent, ' mA');
        refresh('bmsRelPctDisplay', currentBmsRelPct, ' %');
        refresh('bmsRemainMahDisplay', currentBmsRemainMah, ' mAh');
        refresh('bmsFullMahDisplay', currentBmsFullMah, ' mAh');
        refresh('bmsNowPctDisplay', currentBmsNowPct, ' %');
        refresh('bmsCycleDisplay', currentBmsCycle);
        refresh('bmsChgCurMinDisplay', currentBmsChgCurMin, ' min');
        refresh('bmsChgMaxMinDisplay', currentBmsChgMaxMin, ' min');
        refresh('pasNumDisplay', currentPasNum);
        refresh('errorCodeDisplay', formatErrorCode(currentErrorCode));
    }
});

																		 
unlockSlider.addEventListener('change', (e) => {
    if (e.target.value < 95) {
        e.target.value = 0;
    }
});

	  
function handleBikeData(event) {
    // Respect the DataView window; .buffer alone can include an offset.
    const view = event.target.value;
    const buffer = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    if (!validateBafangPacket(buffer)) return; // Drop corrupt/truncated frames
    const decoded = decodeBafangPacket(buffer);
															
	// Update global state variables
    if (decoded.type === 'pas') {
        currentPas = decoded.value;
        if (!isScreenLocked) updatePasUI();
    }
    if (decoded.type === 'light') {
        currentLight = decoded.value;
        headlightState = (currentLight === "ON");
        if (!isScreenLocked) updateLightUI();
    }
    if (decoded.type === 'battery') currentBattery = decoded.value;
    if (decoded.type === 'speed') currentSpeed = decoded.value;
    if (decoded.type === 'trip') currentTrip = decoded.value;
    if (decoded.type === 'range') currentRange = decoded.value;
																 
    if (decoded.type === 'voltage') currentVoltage = decoded.value;
    if (decoded.type === 'temp') currentTemp = decoded.value;
    if (decoded.type === 'odo') currentOdo = decoded.value;
																   
    if (decoded.type === 'current') currentCurrent = decoded.value;
    if (decoded.type === 'bmsRelPct') currentBmsRelPct = decoded.value;
    if (decoded.type === 'bmsRemainMah') currentBmsRemainMah = decoded.value;
    if (decoded.type === 'bmsFullMah') currentBmsFullMah = decoded.value;
    if (decoded.type === 'bmsNowPct') currentBmsNowPct = decoded.value;
    if (decoded.type === 'bmsCycle') currentBmsCycle = decoded.value;
    if (decoded.type === 'bmsChgCurMin') currentBmsChgCurMin = decoded.value;
    if (decoded.type === 'bmsChgMaxMin') currentBmsChgMaxMin = decoded.value;
    if (decoded.type === 'errorCode') currentErrorCode = decoded.value;
    if (decoded.type === 'pasAck') {
        currentPas = decoded.value;
        if (!isScreenLocked) updatePasUI();
    }
    if (decoded.type === 'lightAck') {
        currentLight = decoded.value === 1 ? "ON" : "OFF";
        headlightState = (currentLight === "ON");
        if (!isScreenLocked) updateLightUI();
    }
    if (decoded.type === 'pasNum') {
        // Sanity-guard: a corrupt max would freeze the +/- buttons
        if (decoded.value >= 1 && decoded.value <= 9) {
            currentPasNum = decoded.value;
            pasNumMax = decoded.value;
        }
    }

    // DOM Repaint Management
    if (isScreenLocked) {
        // Only update the bare minimum OLED screen elements
        if (decoded.type === 'battery') document.getElementById('lockBattDisplay').innerText = `${currentBattery}%`;
        if (decoded.type === 'speed') document.getElementById('lockSpeedDisplay').innerText = `${currentSpeed} km/h`;
    } else {
        // Update full UI
										 
        if (decoded.type === 'battery') document.getElementById('battDisplay').innerText = `${currentBattery}%`;
																						 
		 
									   
        if (decoded.type === 'speed') document.getElementById('speedDisplay').innerText = `${currentSpeed} km/h`;
																							
		 
        if (decoded.type === 'trip') document.getElementById('tripDisplay').innerText = `${currentTrip} km`;
        if (decoded.type === 'range') document.getElementById('rangeDisplay').innerText = `${currentRange} km`;
																										  
        if (decoded.type === 'voltage') document.getElementById('voltDisplay').innerText = `${currentVoltage} V`;
        if (decoded.type === 'temp') document.getElementById('tempDisplay').innerText = `${currentTemp} °C`;
        if (decoded.type === 'odo') document.getElementById('odoDisplay').innerText = `${currentOdo} km`;
																													  
        if (decoded.type === 'current') document.getElementById('currentDisplay').innerText = `${currentCurrent} mA`;
        if (decoded.type === 'bmsRelPct') document.getElementById('bmsRelPctDisplay').innerText = `${currentBmsRelPct} %`;
        if (decoded.type === 'bmsRemainMah') document.getElementById('bmsRemainMahDisplay').innerText = `${currentBmsRemainMah} mAh`;
        if (decoded.type === 'bmsFullMah') document.getElementById('bmsFullMahDisplay').innerText = `${currentBmsFullMah} mAh`;
        if (decoded.type === 'bmsNowPct') document.getElementById('bmsNowPctDisplay').innerText = `${currentBmsNowPct} %`;
        if (decoded.type === 'bmsCycle') document.getElementById('bmsCycleDisplay').innerText = `${currentBmsCycle}`;
        if (decoded.type === 'bmsChgCurMin') document.getElementById('bmsChgCurMinDisplay').innerText = `${currentBmsChgCurMin} min`;
        if (decoded.type === 'bmsChgMaxMin') document.getElementById('bmsChgMaxMinDisplay').innerText = `${currentBmsChgMaxMin} min`;
        if (decoded.type === 'pasNum') document.getElementById('pasNumDisplay').innerText = `${currentPasNum}`;
        if (decoded.type === 'errorCode') document.getElementById('errorCodeDisplay').innerText = formatErrorCode(currentErrorCode);
																												   
																																									 
    }

    // --- Smart Logging Filter ---
    let shouldLog = false;
    let now = Date.now();
    const bikeSpeedKmh = parseFloat(currentSpeed) || 0;
    
    // Completely halt logging if both the GPS and the bike motor report zero movement
    const isStationary = currentNativeSpeedKmh < 0.5 && bikeSpeedKmh < 0.5;

    if (now - lastLoggedTime < 1000 || currentAccuracy > MAX_ACCURACY_METERS) {
        shouldLog = false;
    } else if (lastLoggedLat === null || lastLoggedLon === null) {
        shouldLog = true;
    } else if (isStationary) {
        shouldLog = false; // Ignore GPS jitter while stopped at lights
    } else {
        let distance = getDistanceFromLatLonInMeters(lastLoggedLat, lastLoggedLon, currentLat, currentLon);
        let timeSinceLastLog = now - lastLoggedTime;

        // Dynamic Signal-to-Noise Filter: Minimum distance scales based on current GPS accuracy
        const dynamicMinDist = Math.max(MIN_MOVE_METERS, (lastLoggedAccuracy + currentAccuracy) * 0.5);

        if (distance >= dynamicMinDist || timeSinceLastLog >= MAX_IDLE_TIME_MS) {
            shouldLog = true;
        }
    }

    if (shouldLog) {
        lastLoggedTime = now;
        lastLoggedLat = currentLat;
        lastLoggedLon = currentLon;
        lastLoggedAccuracy = currentAccuracy;

        let dataPoint = {
            timestamp: new Date().toISOString(),
            lat: currentLat,
            lon: currentLon,
            altitude_m: currentAltitude.toFixed(1)
        };

        if (document.getElementById('chk_speed').checked) dataPoint.speed = currentSpeed;
        if (document.getElementById('chk_odo').checked) dataPoint.odo = currentOdo;
        if (document.getElementById('chk_battery').checked) dataPoint.battery = currentBattery;
        if (document.getElementById('chk_temp').checked) dataPoint.temp = currentTemp;
        if (document.getElementById('chk_pas').checked) dataPoint.pas = currentPas;
        if (document.getElementById('chk_voltage').checked) dataPoint.voltage = currentVoltage;
        if (document.getElementById('chk_range').checked) dataPoint.range = currentRange;
        if (document.getElementById('chk_trip').checked) dataPoint.trip = currentTrip;
        if (document.getElementById('chk_light').checked) dataPoint.light = currentLight;
        if (document.getElementById('chk_current').checked) dataPoint.current = currentCurrent;
        if (document.getElementById('chk_bmsRelPct').checked) dataPoint.bmsRelPct = currentBmsRelPct;
        if (document.getElementById('chk_bmsRemainMah').checked) dataPoint.bmsRemainMah = currentBmsRemainMah;
        if (document.getElementById('chk_bmsFullMah').checked) dataPoint.bmsFullMah = currentBmsFullMah;
        if (document.getElementById('chk_bmsNowPct').checked) dataPoint.bmsNowPct = currentBmsNowPct;
        if (document.getElementById('chk_bmsCycle').checked) dataPoint.bmsCycle = currentBmsCycle;
        if (document.getElementById('chk_bmsChgCurMin').checked) dataPoint.bmsChgCurMin = currentBmsChgCurMin;
        if (document.getElementById('chk_bmsChgMaxMin').checked) dataPoint.bmsChgMaxMin = currentBmsChgMaxMin;
        if (document.getElementById('chk_pasNum').checked) dataPoint.pasNum = currentPasNum;
        if (document.getElementById('chk_errorCode').checked) dataPoint.errorCode = currentErrorCode;

        rideData.push(dataPoint);
        scheduleBackup();
    }
}

document.getElementById('pasDownBtn').addEventListener('click', async () => {
    const pasNum = Math.max(0, parsePasBase() - 1);

    currentPas = pasNum;
    updatePasUI();

    await sendHexCommand(getPasCommand(pasNum));
});

document.getElementById('pasUpBtn').addEventListener('click', async () => {
    const pasNum = Math.min(pasNumMax, parsePasBase() + 1);

    currentPas = pasNum;
    updatePasUI();

    await sendHexCommand(getPasCommand(pasNum));
});

const lightBtn = document.getElementById('lightToggleBtn');
if (lightBtn) {
    lightBtn.addEventListener('click', async () => {
        headlightState = !headlightState;
        currentLight = headlightState ? "ON" : "OFF";
        updateLightUI();

        const cmd = headlightState ? COMMAND_PAYLOADS.HEADLIGHT_ON : COMMAND_PAYLOADS.HEADLIGHT_OFF;
        await sendHexCommand(cmd);
    });
}

document.getElementById('goBtn').addEventListener('click', async () => {
    for (let i = 0; i < 5; i++) {
        await sendHexCommand(getPasCommand(pasNumMax));
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    currentPas = pasNumMax;
    updatePasUI();

    await sendHexCommand(COMMAND_PAYLOADS.HEADLIGHT_ON);
    headlightState = true;
    currentLight = "ON";
    updateLightUI();
});

// Long-press menu is only blocked on the bike controls so PAS/light
// buttons don't trigger a callout; page text elsewhere keeps default behavior.
document.querySelectorAll('.bike-controls').forEach(el => {
    el.addEventListener('contextmenu', function (event) {
        event.preventDefault();
    });
});

// Register Service Worker for PWA Caching			
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registered successfully:', reg.scope))
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}

import {
    decodeBafangPacket, getPasCommand, getHeadlightCommand,
    getBmsInfoCommand, getDeviceNameCommand, getBacklightCommand, getLightSensCommand,
    getMaintainMileCommand, getAutoOffCommand, getRideModeCommand, getPowerCommand,
    getSetPinCommand, getAuthPinCommand, getResetPinCommand, getPinStatusCommand,
    getMaxPasCommand, BAFANG_COMMANDS, WRITE_COMMANDS, validateBafangPacket,
    getErrorCodeName, getPinStatusName, parseBasicInfo, feedLongFrame, resetLongFrame,
    longStartCmd, isLongTerminator
} from './bafang-protocol.js';

const SERVICE_UUID = '0000fff0-0000-1000-8000-00805f9b34fb';
const NOTIFY_UUID = '0000fff4-0000-1000-8000-00805f9b34fb';
const WRITE_UUID = '0000fff3-0000-1000-8000-00805f9b34fb';
// Standard Bluetooth Device Information Service — SwiftFlow reads 0x2A28
// (Firmware Revision String) here during connect (PlBleService.java:1923).
const DIS_SERVICE_UUID = '0000180a-0000-1000-8000-00805f9b34fb';
const DIS_CHARS = {
    fwVersion: '00002a28-0000-1000-8000-00805f9b34fb',
    swVersion: '00002a26-0000-1000-8000-00805f9b34fb',
    hwVersion: '00002a27-0000-1000-8000-00805f9b34fb',
    manufacturer: '00002a29-0000-1000-8000-00805f9b34fb',
    model: '00002a24-0000-1000-8000-00805f9b34fb',
    serial: '00002a25-0000-1000-8000-00805f9b34fb'
};
let disValues = {};

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
let gattServer = null;
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
let currentCadence = "--", currentCurrentA = "--", currentVoltageV = "--";
let currentBatteryCap = "--", currentTempC = "--", currentMaxSpeed = "--";
let currentAvgSpeed = "--", currentMotorStatus = "--", currentTorque = "--";
let currentTwist = "--", currentHeartRate = "--", currentCapacityAh = "--";
let currentMaintainMile = "--", currentCalories = "--", currentSpeedLimit = "--";
let currentCurrentLimit = "--", currentWheelDiameter = "--";
let currentSensorModel = "--", currentPinStatus = "--";
let currentFwVersion = "--";
// About data from the 0x0B long-frame ('!'-separated SW/HW/SN per part).
// HMI/Controller/Battery cards render labeled rows from these; the sensor
// fields the bike sends empty are ignored (no Sensor card).
let hmiInfo = { sn: "--", sw: "--", hw: "--" };
let controllerInfo = { sn: "--", sw: "--", hw: "--" };
let batteryAbout = { sn: "--", sw: "--", hw: "--" };
// Last completed long-frame payload per command ID — the bike repeats 0x0B
// non-stop, so repeats are dropped before they can spam the log/DOM.
const lastLongFrame = {};
// While true, the current long-frame sequence is unwanted (its metric is
// unticked) and its chunks/terminator are swallowed silently.
let ignoreLongFrame = false;
let currentWriteAck = "--";
// Default = hardest clamp (matches the 0-4 send table) so the pre-notify
// window can't overshoot; overwritten by the bike's pasNum notify (~1s).
let pasNumMax = 4;
let currentLight = "--";
let currentErrorCode = "--";
let currentAccuracy = 999;
let writeCharacteristic = null;
let headlightState = false;

// Chrome allows only one GATT operation in flight per device. Without this,
// two rapid writes (double-tapped PAS, or a settings click during connect)
// reject with "GATT operation already in progress". Every write/read below
// goes through this FIFO chain. The timeout guarantees a hung op can't
// stall the queue (and the reconnect) forever.
let gattQueue = Promise.resolve();
function enqueueGatt(fn, timeoutMs = 8000) {
    const task = () => Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('GATT timeout')), timeoutMs))
    ]);
    const run = gattQueue.then(task, task);
    gattQueue = run.catch(() => {});
    return run;
}

// Link loss often surfaces as a failed write, not (or before) the
// gattserverdisconnected event. Promote that to a full UI reset so the
// Connect button always comes back.
function handlePossibleLinkLoss() {
    if (bleDevice && !bleDevice.gatt.connected) {
        onDisconnected();
    }
}

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

function updateAckStatus(text) {
    currentWriteAck = text;
    const el = document.getElementById('ackStatus');
    if (el) el.innerText = `Last ack: ${text}`;
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

function isChecked(id) {
    const el = document.getElementById(id);
    return !!(el && el.checked);
}

function isInfoCardSelected() {
    return isChecked('chk_hmiInfo') || isChecked('chk_controllerInfo')
        || isChecked('chk_batteryInfo');
}

// Long-frame acquisition follows the Metrics checkboxes: unselected info is
// never reassembled, logged, or rendered. Unknown command IDs still surface
// once (via the change-cache) so new bike behavior stays visible.
function isLongCmdWanted(cmd) {
    if (cmd === BAFANG_COMMANDS.BASIC_INFO) return isInfoCardSelected();
    if (cmd === BAFANG_COMMANDS.SENSOR_MODEL) return isChecked('chk_sensorModel');
    return true;
}

function updateDisplayVisibility() {
    const metrics = [
        'speed', 'battery', 'pas', 'voltage', 'range', 'trip', 'odo',
        'current', 'bmsRelPct', 'bmsRemainMah',
        'bmsFullMah', 'bmsNowPct', 'bmsCycle', 'bmsChgCurMin',
        'bmsChgMaxMin', 'pasNum', 'temp', 'light', 'errorCode',
        'cadence', 'currentA', 'voltageV', 'batteryCap', 'tempC',
        'maxSpeed', 'avgSpeed', 'motorStatus', 'torque', 'twist',
        'heartRate', 'capacityAh', 'maintainMile', 'calories',
        'speedLimit', 'currentLimit', 'wheelDiameter', 'sensorModel',
        'pinStatus', 'fwVersion', 'hmiInfo', 'controllerInfo',
        'batteryInfo'
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
// The Bike Info boxes live inside a collapsed <details>: ticking one opens
// the card and repaints immediately (unselected info is never pulled, so a
// fresh render is needed on select).
['chk_fwVersion', 'chk_hmiInfo', 'chk_controllerInfo', 'chk_batteryInfo'].forEach(id => {
    const chk = document.getElementById(id);
    if (chk) chk.addEventListener('change', () => {
        if (chk.checked) {
            const card = document.getElementById('infoCard');
            if (card) card.open = true;
            renderInfoCards();
            // FW Version is read once at connect when selected; if it was
            // ticked mid-ride, read it now (0x0B info arrives on its own).
            if (id === 'chk_fwVersion' && bleDevice && bleDevice.gatt.connected
                && gattServer && !disValues.fwVersion && !disValues.swVersion) {
                readDisInfo(gattServer);
            }
        }
    });
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
    const cleanHex = hexString.replace(/[\s,:-]/g, '').toLowerCase();
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < cleanHex.length; i += 2) {
        bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
    }

    try {
        await enqueueGatt(async () => {
            if (!writeCharacteristic) throw new Error('disconnected');
            if (writeCharacteristic.properties.writeWithoutResponse) {
                await writeCharacteristic.writeValueWithoutResponse(bytes);
            } else {
                await writeCharacteristic.writeValueWithResponse(bytes);
            }
        });
        // console.log("Command sent successfully:", hexString);
    } catch (error) {
        // Link loss: reset UI so Connect comes back even if the
        // gattserverdisconnected event is late or never fires.
        handlePossibleLinkLoss();
        if (bleDevice && bleDevice.gatt.connected) {
            console.error("Failed to send command:", error);
        }
    }
}

document.getElementById('connectBtn').addEventListener('click', async () => {
    let connectStage = 'pick'; // 'pick' (requestDevice) vs 'gatt' (connect/service discovery)
    try {
        document.getElementById('status').innerHTML = `Status: <span class="status-badge status-searching">Connecting...</span>`;
        resetExtendedMetrics();
        const checkboxes = document.querySelectorAll('#configCard input[type="checkbox"]');
        checkboxes.forEach(cb => cb.disabled = true);

        // Filter by the FFF0 service instead of the display name: a bike that
        // lost its BLE name (or never had one) still advertises the service.
        // The checkbox falls back to showing every nearby BLE device.
        // 0x180A (Device Info) is optional so the FW-version read can follow.
        const showAllDevices = document.getElementById('showAllDevices');
        bleDevice = await navigator.bluetooth.requestDevice(
            showAllDevices && showAllDevices.checked
                ? { acceptAllDevices: true, optionalServices: [SERVICE_UUID, DIS_SERVICE_UUID] }
                : { filters: [{ services: [SERVICE_UUID] }], optionalServices: [SERVICE_UUID, DIS_SERVICE_UUID] }
        );
        
        connectStage = 'gatt';
        bleDevice.addEventListener('gattserverdisconnected', onDisconnected);

        const server = await bleDevice.gatt.connect();
        gattServer = server;
        const service = await server.getPrimaryService(SERVICE_UUID);
        const notifyChar = await service.getCharacteristic(NOTIFY_UUID);
		writeCharacteristic = await service.getCharacteristic(WRITE_UUID);

        await notifyChar.startNotifications();
        notifyChar.addEventListener('characteristicvaluechanged', handleBikeData);

        // SwiftFlow requests BMS info (0xA1=1) to unlock the extended
        // BMS frames (0x67/0x68/0x69), and requests PIN status (0xD5=1) —
        // both observed byte-identical in its HCI capture on this bike.
        // ?minimal=1 skips everything except A1=1 to replicate the hosted
        // build exactly (isolates whether D5/DIS side effects matter).
        const minimalMode = new URLSearchParams(location.search).has('minimal');
        await sendHexCommand(getBmsInfoCommand(true));
        if (!minimalMode) {
            await sendHexCommand(getPinStatusCommand());

            // Read the Device Information Service like SwiftFlow does on
            // connect — but only when the FW Version metric is selected.
            // The HMI/Controller/Battery About cards come from the 0x0B
            // long-frame, so no CAN-node probing is needed.
            if (isChecked('chk_fwVersion')) await readDisInfo(server);
        } else {
            console.debug('[minimal] skipped PIN/DIS to match hosted build');
        }
        
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
        } else if (error) {
            statusText = `${error.name || 'Error'}: ${error.message || ''}`;
        }
        document.getElementById('status').innerHTML = `Status: <span class="status-badge status-disconnected">${statusText}</span>`;
        const checkboxes = document.querySelectorAll('#configCard input[type="checkbox"]');
        checkboxes.forEach(cb => { if(cb.id !== 'chk_timestamp' && cb.id !== 'chk_latlon') cb.disabled = false; });
    }
});

document.getElementById('disconnectBtn').addEventListener('click', async () => {
    try { await sendHexCommand(getBmsInfoCommand(false)); } catch (e) { /* best effort */ }
    try { if (bleDevice && bleDevice.gatt.connected) { bleDevice.gatt.disconnect(); } } catch (e) { /* already gone */ }
    // The event may not fire if the link is already dead — force the UI
    // reset (idempotent: second call is a no-op for buttons/download).
    setTimeout(() => {
        if (!bleDevice || !bleDevice.gatt.connected) onDisconnected();
    }, 300);
});

function onDisconnected() {
    document.getElementById('status').innerHTML = `Status: <span class="status-badge status-disconnected">Disconnected</span>`;
    document.getElementById('connectBtn').style.display = 'block';
    document.getElementById('disconnectBtn').style.display = 'none';
    writeCharacteristic = null;
    gattServer = null;
    resetExtendedMetrics();
    releaseWakeLock();
    stopGpsTracking();

    if (rideData.length > 0) {
        downloadLogs();
    }

    const checkboxes = document.querySelectorAll('#configCard input[type="checkbox"]');
    checkboxes.forEach(cb => { if(cb.id !== 'chk_timestamp' && cb.id !== 'chk_latlon') cb.disabled = false; });
}

// All live bike state reset (shared by connect/disconnect) so a new
// connection never shows stale speed/battery/voltage from a prior ride.
function resetExtendedMetrics() {
    currentPas = currentSpeed = currentOdo = "--";
    currentBattery = currentVoltage = currentTemp = "--";
    currentTrip = currentRange = "--";
    currentCurrent = currentBmsRelPct = "--";
    currentBmsRemainMah = currentBmsFullMah = "--";
    currentBmsNowPct = currentBmsCycle = "--";
    currentBmsChgCurMin = currentBmsChgMaxMin = "--";
    currentPasNum = "--";
    currentCadence = currentCurrentA = currentVoltageV = "--";
    currentBatteryCap = currentTempC = currentMaxSpeed = "--";
    currentAvgSpeed = currentMotorStatus = currentTorque = "--";
    currentTwist = currentHeartRate = currentCapacityAh = "--";
    currentMaintainMile = currentCalories = currentSpeedLimit = "--";
    currentCurrentLimit = currentWheelDiameter = "--";
    currentSensorModel = currentPinStatus = "--";
    currentLight = currentErrorCode = "--";
    currentWriteAck = "--";
    pasNumMax = 4;
    headlightState = false;
    resetLongFrame();
    updatePasUI();
    updateLightUI();
    disValues = {};
    currentFwVersion = "--";
    hmiInfo = { sn: "--", sw: "--", hw: "--" };
    controllerInfo = { sn: "--", sw: "--", hw: "--" };
    batteryAbout = { sn: "--", sw: "--", hw: "--" };
    for (const k of Object.keys(lastLongFrame)) delete lastLongFrame[k];
    ignoreLongFrame = false;
    renderInfoCards();
    updateAckStatus("--");
    refreshFullUI();
}

// Read the standard Device Information Service (0x180A). Individual
// characteristics may be absent; each read fails independently. All GATT
// ops go through the queue so a settings tap during connect can't collide.
async function readDisInfo(server) {
    try {
        const svc = await enqueueGatt(() => server.getPrimaryService(DIS_SERVICE_UUID));
        for (const [key, uuid] of Object.entries(DIS_CHARS)) {
            try {
                const ch = await enqueueGatt(() => svc.getCharacteristic(uuid));
                const value = await enqueueGatt(() => ch.readValue());
                const text = new TextDecoder().decode(value).replace(/\0/g, '').trim();
                if (text) disValues[key] = text;
            } catch (e) { /* characteristic not present on this display */ }
        }
    } catch (e) { /* display has no 0x180A service */ }
    renderInfoCards();
}

function escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// One labeled row inside an info card: `<div class="info-row">…`.
function infoRows(rows) {
    return rows
        .map(([label, value]) =>
            `<div class="info-row"><span class="info-key">${escHtml(label)}</span>` +
            `<span class="info-val">${escHtml(value)}</span></div>`)
        .join('');
}

// '--' stays bare; anything else gets its unit.
function withUnit(value, unit) {
    return value === '--' ? '--' : `${value} ${unit}`;
}

function renderInfoCards() {
    // Unselected info is not pulled at all: skip the build when none of the
    // Bike Info boxes is ticked (ticking one repaints immediately).
    if (!isChecked('chk_fwVersion') && !isInfoCardSelected()) return;
    currentFwVersion = disValues.fwVersion || disValues.swVersion || '--';

    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    };
    const setHtml = (id, html) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    };
    setText('fwVersionDisplay', currentFwVersion);
    setHtml('hmiInfoDisplay', infoRows([
        ['SN', hmiInfo.sn],
        ['Software Ver', hmiInfo.sw],
        ['Hardware Ver', hmiInfo.hw],
    ]));
    setHtml('controllerInfoDisplay', infoRows([
        ['SN', controllerInfo.sn],
        ['Software Ver', controllerInfo.sw],
        ['Hardware Ver', controllerInfo.hw],
    ]));
    // Battery About rows (0x0B SW/HW/SN) merged with live BMS telemetry so
    // the card stays current as new frames arrive (see handleBikeData).
    setHtml('batteryInfoDisplay', infoRows([
        ['SN', batteryAbout.sn],
        ['Software Ver', batteryAbout.sw],
        ['Hardware Ver', batteryAbout.hw],
        ['Model', '--'],
        ['RSOC', withUnit(currentBmsRelPct, '%')],
        ['Voltage', withUnit(currentVoltage, 'V')],
        ['Capacity Left', withUnit(currentBmsRemainMah, 'mAh')],
        ['Full Capacity', withUnit(currentBmsFullMah, 'mAh')],
        ['Temperature', withUnit(currentTemp, '°C')],
        ['Cycle Count', `${currentBmsCycle}`],
        ['Last Charge', currentBmsChgCurMin === '--' ? '--' : `${currentBmsChgCurMin} min ago`],
        ['Max Charge', currentBmsChgMaxMin === '--' ? '--' : `${currentBmsChgMaxMin} min ago`],
    ]));
}

// 0x0B '!'-separated basic-information frame: panel/controller/battery
// SW + HW + serial. Applied per-field so partial strings still render; the
// sensor fields the bike sends empty are ignored (no Sensor card). A shorter
// repeat never clobbers a fuller value — the bike also emits partial frames
// (panel fields only) and cut-off variants of the same string.
function applyBasicInfo(value) {
    const info = parseBasicInfo(value);
    const fuller = (cur, v) => (v !== null && (cur === '--' || v.length >= cur.length)) ? v : cur;
    hmiInfo.sn = fuller(hmiInfo.sn, info.panelSerial);
    hmiInfo.sw = fuller(hmiInfo.sw, info.panelSw);
    hmiInfo.hw = fuller(hmiInfo.hw, info.panelHw);
    controllerInfo.sn = fuller(controllerInfo.sn, info.controllerSerial);
    controllerInfo.sw = fuller(controllerInfo.sw, info.controllerSw);
    controllerInfo.hw = fuller(controllerInfo.hw, info.controllerHw);
    batteryAbout.sn = fuller(batteryAbout.sn, info.batterySerial);
    batteryAbout.sw = fuller(batteryAbout.sw, info.batterySw);
    batteryAbout.hw = fuller(batteryAbout.hw, info.batteryHw);
    renderInfoCards();
}

// Single place that repaints every telemetry tile from current* state.
// Used after unlock (DOM was frozen) and after connect/disconnect resets.
function refreshFullUI() {
    if (isScreenLocked) return;
    const set = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    };
    set('battDisplay', `${currentBattery}%`);
    set('speedDisplay', `${currentSpeed} km/h`);
    updatePasUI();
    updateLightUI();
    set('tripDisplay', `${currentTrip} km`);
    set('rangeDisplay', `${currentRange} km`);
    set('odoDisplay', `${currentOdo} km`);
    set('voltDisplay', `${currentVoltage} V`);
    set('tempDisplay', `${currentTemp} °C`);
    set('currentDisplay', `${currentCurrent} mA`);
    set('bmsRelPctDisplay', `${currentBmsRelPct} %`);
    set('bmsRemainMahDisplay', `${currentBmsRemainMah} mAh`);
    set('bmsFullMahDisplay', `${currentBmsFullMah} mAh`);
    set('bmsNowPctDisplay', `${currentBmsNowPct} %`);
    set('bmsCycleDisplay', `${currentBmsCycle}`);
    set('bmsChgCurMinDisplay', `${currentBmsChgCurMin} min`);
    set('bmsChgMaxMinDisplay', `${currentBmsChgMaxMin} min`);
    set('pasNumDisplay', `${currentPasNum}`);
    set('errorCodeDisplay', formatErrorCode(currentErrorCode));
    set('cadenceDisplay', `${currentCadence} rpm`);
    set('currentADisplay', `${currentCurrentA} A`);
    set('voltageVDisplay', `${currentVoltageV} V`);
    set('batteryCapDisplay', `${currentBatteryCap} %`);
    set('tempCDisplay', `${currentTempC} °C`);
    set('maxSpeedDisplay', `${currentMaxSpeed} km/h`);
    set('avgSpeedDisplay', `${currentAvgSpeed} km/h`);
    set('motorStatusDisplay', `${currentMotorStatus}`);
    set('torqueDisplay', `${currentTorque}`);
    set('twistDisplay', `${currentTwist}`);
    set('heartRateDisplay', `${currentHeartRate} bpm`);
    set('capacityAhDisplay', `${currentCapacityAh} Ah`);
    set('maintainMileDisplay', `${currentMaintainMile} km`);
    set('caloriesDisplay', `${currentCalories} kcal`);
    set('speedLimitDisplay', `${currentSpeedLimit} km/h`);
    set('currentLimitDisplay', `${currentCurrentLimit} A`);
    set('wheelDiameterDisplay', `${currentWheelDiameter}″`);
    set('sensorModelDisplay', `${currentSensorModel}`);
    set('pinStatusDisplay', `${currentPinStatus}`);
    renderInfoCards();
    updateAckStatus(currentWriteAck);
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
                'bmsRelPct', 'bmsNowPct', 'bmsRemainMah', 'bmsFullMah', 'bmsCycle',
                'cadence', 'currentA', 'voltageV', 'batteryCap', 'tempC',
                'maxSpeed', 'avgSpeed', 'motorStatus', 'torque', 'twist',
                'heartRate', 'capacityAh', 'maintainMile', 'calories',
                'speedLimit', 'currentLimit', 'wheelDiameter', 'sensorModel',
                'pinStatus'
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

	// Clear backup and in-memory log after successful download so a
	// later disconnect/export does not re-download the same ride twice.
    localStorage.removeItem('ride_data_backup');
    lastBackupTime = 0;
    rideData = [];
    lastLoggedTime = 0;
    lastLoggedLat = null;
    lastLoggedLon = null;
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
        refreshFullUI();
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
    let decoded = null;
    if (validateBafangPacket(buffer)) {
        decoded = decodeBafangPacket(buffer);
    } else {
        // Not a short 02..03 frame: maybe the long-frame envelope (AB 01 ..
        // chunks .. CHK AA 55) carrying 0x0B basic-info / 0xD1 replies.
        // Short frames always win (as in SwiftFlow); interleaved telemetry
        // like 0x44 validates above and never reaches the reassembler.
        // Unselected info is not pulled at all: the start frame decides, and
        // the rest of an unwanted sequence is swallowed silently.
        const startCmd = longStartCmd(buffer);
        if (startCmd !== null) {
            ignoreLongFrame = !isLongCmdWanted(startCmd);
            resetLongFrame();
            if (ignoreLongFrame) return;
        } else if (ignoreLongFrame) {
            if (isLongTerminator(buffer)) ignoreLongFrame = false;
            return;
        }
        const longRes = feedLongFrame(buffer);
        if (!longRes.handled) {
            console.debug('[drop]', [...buffer].map((b) => b.toString(16).padStart(2, '0')).join(' '));
            return; // Drop corrupt/truncated frames
        }
        if (!longRes.decoded) return; // start/chunk consumed, frame incomplete
        // The bike spams 0x0B continuously: process (and log) only frames
        // whose content changed since the last one, otherwise the console
        // and the info cards churn on every repeat.
        const longKey = `0x${longRes.decoded.cmd.toString(16).padStart(2, '0')}`;
        const longVal = String(longRes.decoded.value);
        if (lastLongFrame[longKey] === longVal) return;
        lastLongFrame[longKey] = longVal;
        console.debug('[long]', longKey, longVal.slice(0, 120));
        decoded = longRes.decoded;
    }
    // Temporary speed debug: raw frame + decoded value for 0x44.
    if (decoded && decoded.type === 'speed') {
        console.debug('[0x44]', [...buffer].map((b) => b.toString(16).padStart(2, '0')).join(' '), '->', decoded.value);
    }
															
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
    if (decoded.type === 'cadence') currentCadence = decoded.value;
    if (decoded.type === 'currentA') currentCurrentA = decoded.value;
    if (decoded.type === 'voltageV') currentVoltageV = decoded.value;
    if (decoded.type === 'batteryCap') currentBatteryCap = decoded.value;
    if (decoded.type === 'tempC') currentTempC = decoded.value;
    if (decoded.type === 'maxSpeed') currentMaxSpeed = decoded.value;
    if (decoded.type === 'avgSpeed') currentAvgSpeed = decoded.value;
    if (decoded.type === 'motorStatus') currentMotorStatus = `0x${decoded.value.toString(16).padStart(2, '0')}`;
    if (decoded.type === 'torque') currentTorque = decoded.value;
    if (decoded.type === 'twist') currentTwist = decoded.value;
    if (decoded.type === 'heartRate') currentHeartRate = decoded.value;
    if (decoded.type === 'capacityAh') currentCapacityAh = decoded.value;
    if (decoded.type === 'maintainMile') currentMaintainMile = decoded.value;
    if (decoded.type === 'calories') currentCalories = decoded.value;
    if (decoded.type === 'speedLimit') currentSpeedLimit = decoded.value;
    if (decoded.type === 'currentLimit') currentCurrentLimit = decoded.value;
    if (decoded.type === 'wheelDiameter') currentWheelDiameter = decoded.value;
    if (decoded.type === 'sensorModel') currentSensorModel = decoded.value;
    if (decoded.type === 'basicInfo') applyBasicInfo(decoded.value);
    if (decoded.type === 'pinStatus') currentPinStatus = getPinStatusName(decoded.value);
    if (decoded.type === 'pinAck') updateAckStatus(`PIN ack: ${decoded.value}`);
    if (decoded.type === 'nameAck') updateAckStatus(`Name ack: ${decoded.value}`);
    if (decoded.type === 'writeAck') updateAckStatus(`0x${decoded.cmd.toString(16).padStart(2, '0')} ack: ${decoded.value}`);
    // The Battery Info card merges About rows with live BMS telemetry, so
    // repaint it as those frames arrive (basicInfo repaints via applyBasicInfo).
    if (decoded.type === 'temp' || decoded.type === 'voltage' ||
        decoded.type === 'bmsRelPct' || decoded.type === 'bmsRemainMah' ||
        decoded.type === 'bmsFullMah' || decoded.type === 'bmsCycle' ||
        decoded.type === 'bmsChgCurMin' || decoded.type === 'bmsChgMaxMin') {
        renderInfoCards();
    }
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
        if (decoded.type === 'cadence') document.getElementById('cadenceDisplay').innerText = `${currentCadence} rpm`;
        if (decoded.type === 'currentA') document.getElementById('currentADisplay').innerText = `${currentCurrentA} A`;
        if (decoded.type === 'voltageV') document.getElementById('voltageVDisplay').innerText = `${currentVoltageV} V`;
        if (decoded.type === 'batteryCap') document.getElementById('batteryCapDisplay').innerText = `${currentBatteryCap} %`;
        if (decoded.type === 'tempC') document.getElementById('tempCDisplay').innerText = `${currentTempC} °C`;
        if (decoded.type === 'maxSpeed') document.getElementById('maxSpeedDisplay').innerText = `${currentMaxSpeed} km/h`;
        if (decoded.type === 'avgSpeed') document.getElementById('avgSpeedDisplay').innerText = `${currentAvgSpeed} km/h`;
        if (decoded.type === 'motorStatus') document.getElementById('motorStatusDisplay').innerText = `${currentMotorStatus}`;
        if (decoded.type === 'torque') document.getElementById('torqueDisplay').innerText = `${currentTorque}`;
        if (decoded.type === 'twist') document.getElementById('twistDisplay').innerText = `${currentTwist}`;
        if (decoded.type === 'heartRate') document.getElementById('heartRateDisplay').innerText = `${currentHeartRate} bpm`;
        if (decoded.type === 'capacityAh') document.getElementById('capacityAhDisplay').innerText = `${currentCapacityAh} Ah`;
        if (decoded.type === 'maintainMile') document.getElementById('maintainMileDisplay').innerText = `${currentMaintainMile} km`;
        if (decoded.type === 'calories') document.getElementById('caloriesDisplay').innerText = `${currentCalories} kcal`;
        if (decoded.type === 'speedLimit') document.getElementById('speedLimitDisplay').innerText = `${currentSpeedLimit} km/h`;
        if (decoded.type === 'currentLimit') document.getElementById('currentLimitDisplay').innerText = `${currentCurrentLimit} A`;
        if (decoded.type === 'wheelDiameter') document.getElementById('wheelDiameterDisplay').innerText = `${currentWheelDiameter}″`;
        if (decoded.type === 'sensorModel') document.getElementById('sensorModelDisplay').innerText = `${currentSensorModel}`;
        if (decoded.type === 'pinStatus') document.getElementById('pinStatusDisplay').innerText = `${currentPinStatus}`;
    }

    // --- Smart Logging Filter ---
    let shouldLog = false;
    let gpsFallback = false;
    let now = Date.now();
    const bikeSpeedKmh = parseFloat(currentSpeed) || 0;

    // Completely halt logging if both the GPS and the bike motor report zero movement
    const isStationary = currentNativeSpeedKmh < 0.5 && bikeSpeedKmh < 0.5;
    const hasGpsFix = currentAccuracy <= MAX_ACCURACY_METERS;

    if (!hasGpsFix) {
        // Bike-only logging: without a GPS fix the CSV would otherwise stay
        // empty even though BLE telemetry flows. Log at most every 5 s with
        // the last known (or 0,0) coordinates; GPX skips these points.
        const hasBikeData = currentSpeed !== "--" || currentBattery !== "--";
        if (hasBikeData && now - lastLoggedTime >= 5000) {
            shouldLog = true;
            gpsFallback = true;
        }
    } else if (now - lastLoggedTime < 1000) {
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
        if (!gpsFallback) {
            lastLoggedLat = currentLat;
            lastLoggedLon = currentLon;
            lastLoggedAccuracy = currentAccuracy;
        }

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
        if (document.getElementById('chk_cadence').checked) dataPoint.cadence = currentCadence;
        if (document.getElementById('chk_currentA').checked) dataPoint.currentA = currentCurrentA;
        if (document.getElementById('chk_voltageV').checked) dataPoint.voltageV = currentVoltageV;
        if (document.getElementById('chk_batteryCap').checked) dataPoint.batteryCap = currentBatteryCap;
        if (document.getElementById('chk_tempC').checked) dataPoint.tempC = currentTempC;
        if (document.getElementById('chk_maxSpeed').checked) dataPoint.maxSpeed = currentMaxSpeed;
        if (document.getElementById('chk_avgSpeed').checked) dataPoint.avgSpeed = currentAvgSpeed;
        if (document.getElementById('chk_motorStatus').checked) dataPoint.motorStatus = currentMotorStatus;
        if (document.getElementById('chk_torque').checked) dataPoint.torque = currentTorque;
        if (document.getElementById('chk_twist').checked) dataPoint.twist = currentTwist;
        if (document.getElementById('chk_heartRate').checked) dataPoint.heartRate = currentHeartRate;
        if (document.getElementById('chk_capacityAh').checked) dataPoint.capacityAh = currentCapacityAh;
        if (document.getElementById('chk_maintainMile').checked) dataPoint.maintainMile = currentMaintainMile;
        if (document.getElementById('chk_calories').checked) dataPoint.calories = currentCalories;
        if (document.getElementById('chk_speedLimit').checked) dataPoint.speedLimit = currentSpeedLimit;
        if (document.getElementById('chk_currentLimit').checked) dataPoint.currentLimit = currentCurrentLimit;
        if (document.getElementById('chk_wheelDiameter').checked) dataPoint.wheelDiameter = currentWheelDiameter;
        if (document.getElementById('chk_sensorModel').checked) dataPoint.sensorModel = currentSensorModel;
        if (document.getElementById('chk_pinStatus').checked) dataPoint.pinStatus = currentPinStatus;

        rideData.push(dataPoint);
        scheduleBackup();
    }
}

document.getElementById('pasDownBtn').addEventListener('click', async () => {
    if (!writeCharacteristic) {
        updateAckStatus('Not connected — PAS');
        return;
    }
    const pasNum = Math.max(0, parsePasBase() - 1);

    currentPas = pasNum;
    updatePasUI();

    await sendHexCommand(getPasCommand(pasNum));
});

document.getElementById('pasUpBtn').addEventListener('click', async () => {
    if (!writeCharacteristic) {
        updateAckStatus('Not connected — PAS');
        return;
    }
    const pasNum = Math.min(pasNumMax, parsePasBase() + 1);

    currentPas = pasNum;
    updatePasUI();

    await sendHexCommand(getPasCommand(pasNum));
});

const lightBtn = document.getElementById('lightToggleBtn');
if (lightBtn) {
    lightBtn.addEventListener('click', async () => {
        if (!writeCharacteristic) {
            updateAckStatus('Not connected — headlight');
            return;
        }
        headlightState = !headlightState;
        currentLight = headlightState ? "ON" : "OFF";
        updateLightUI();

        await sendHexCommand(getHeadlightCommand(headlightState));
    });
}

document.getElementById('goBtn').addEventListener('click', async () => {
    if (!writeCharacteristic) {
        updateAckStatus('Not connected — Go');
        return;
    }
    // Single max-PAS write plus headlight on; the bike acks each.
    // (Previously burst-sent 5x PAS writes, which could flood BLE.)
    await sendHexCommand(getPasCommand(pasNumMax));
    currentPas = pasNumMax;
    updatePasUI();

    await sendHexCommand(getHeadlightCommand(true));
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

// --- Device Settings controls ---

function numVal(id, fallback) {
    const n = parseInt(document.getElementById(id).value, 10);
    return Number.isFinite(n) ? n : fallback;
}

function guardSend(fn, label) {
    return async () => {
        if (!writeCharacteristic) {
            updateAckStatus(`Not connected — ${label}`);
            return;
        }
        await sendHexCommand(fn());
        updateAckStatus(`${label} sent`);
    };
}

document.getElementById('maxPasBtn').addEventListener('click', guardSend(
    () => getMaxPasCommand(numVal('maxPasSelect', 5)), 'Max PAS'));

document.getElementById('autoOffBtn').addEventListener('click', guardSend(
    () => getAutoOffCommand(numVal('autoOffSelect', 1)), 'Auto-Off'));

document.getElementById('modeBtn').addEventListener('click', guardSend(
    () => getRideModeCommand(document.getElementById('modeSelect').value === 'eco', pasNumMax), 'Ride mode'));

document.getElementById('backlightBtn').addEventListener('click', guardSend(
    () => getBacklightCommand(numVal('backlightInput', 3)), 'Backlight'));

document.getElementById('lightSensBtn').addEventListener('click', guardSend(
    () => getLightSensCommand(numVal('lightSensInput', 3)), 'Light sensitivity'));

document.getElementById('maintainMileBtn').addEventListener('click', guardSend(
    () => getMaintainMileCommand(numVal('maintainMileInput', 0)), 'Maintain mileage'));

document.getElementById('powerOnBtn').addEventListener('click', guardSend(
    () => getPowerCommand(true), 'Power ON'));

document.getElementById('powerOffBtn').addEventListener('click', guardSend(
    () => getPowerCommand(false), 'Power OFF'));

document.getElementById('renameBtn').addEventListener('click', guardSend(
    () => getDeviceNameCommand(document.getElementById('deviceNameInput').value.trim() || 'BAFANG'), 'Rename'));

document.getElementById('pinSetBtn').addEventListener('click', guardSend(
    () => getSetPinCommand(document.getElementById('pinSetInput').value.trim()), 'Set PIN'));

document.getElementById('pinAuthBtn').addEventListener('click', guardSend(
    () => getAuthPinCommand(document.getElementById('pinAuthInput').value.trim()), 'Auth PIN'));

document.getElementById('pinResetBtn').addEventListener('click', guardSend(
    () => getResetPinCommand(document.getElementById('pinSetInput').value.trim()), 'Reset PIN'));

document.getElementById('pinStatusBtn').addEventListener('click', guardSend(
    () => getPinStatusCommand(), 'PIN status request'));

// Register Service Worker for PWA Caching
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registered successfully:', reg.scope))
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}

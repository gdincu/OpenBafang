import { decodeBafangPacket } from './bafang-protocol.js';

let rideData = [];
let lastLoggedTime = 0;
let currentLat = 0, currentLon = 0, currentAltitude = 0;
let lastLoggedLat = null, lastLoggedLon = null;
let recentHexLogs = [];
let wakeLock = null;
let bleDevice = null;

let currentPas = "--", currentSpeed = "--", currentOdo = "--";
let currentBattery = "--", currentVoltage = "--", currentTemp = "--";
let currentTrip = "--", currentRange = "--", currentTorque = "--";
let currentCadence = "--", currentCurrent = "--", currentBmsRelPct = "--";
let currentBmsRemainMah = "--", currentBmsFullMah = "--", currentBmsCycles = "--";
let currentMaxPasLevels = "--", currentLight = "--";
let currentAccuracy = 999;

const MAX_ACCURACY_METERS = 25;
const MIN_MOVE_METERS = 3;
const MAX_IDLE_TIME_MS = 5000; // Force a log every 5 seconds even if stationary

// Check for unsaved ride data recovery on page load
window.onload = () => {
    const backup = localStorage.getItem('ride_data_backup');
    if (backup) {
        const recoveredData = JSON.parse(backup);
        if (recoveredData.length > 0 && confirm(`Found ${recoveredData.length} unsaved points from a previous session. Download them now?`)) {
            rideData = recoveredData;
            downloadCSV();
        } else {
            localStorage.removeItem('ride_data_backup');
        }
    }
};

function updateDisplayVisibility() {
    const metrics = [
        'speed', 'battery', 'pas', 'voltage', 'range', 'trip', 'odo', 
        'torque', 'cadence', 'current', 'bmsRelPct', 'bmsRemainMah', 
        'bmsFullMah', 'bmsCycles', 'maxPasLevels', 'temp', 'light'
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
    if (wakeLock !== null) { wakeLock.release().then(() => wakeLock = null); }
}

// Helper: Calculate distance in meters between two lat/lon points (Haversine formula)
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

		   
navigator.geolocation.watchPosition(
    (position) => {
        currentLat = position.coords.latitude;
        currentLon = position.coords.longitude;
        currentAltitude = position.coords.altitude !== null ? position.coords.altitude : 0;
        currentAccuracy = position.coords.accuracy;
        
        const gpsEl = document.getElementById('gpsDisplay');
        gpsEl.innerHTML = `GPS: <span class="status-badge status-ok">OK (±${Math.round(currentAccuracy)}m)</span>`;
    },
    (err) => {
        console.error("GPS Error:", err);
        currentAccuracy = Infinity; // Invalidate accuracy on error
        const gpsEl = document.getElementById('gpsDisplay');
        gpsEl.innerHTML = `GPS: <span class="status-badge status-searching">Searching</span>`;
    },
   
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
	  
		
  
);

document.getElementById('connectBtn').addEventListener('click', async () => {
    try {
        document.getElementById('status').innerHTML = `Status: <span class="status-badge status-searching">Connecting...</span>`;
        
        const checkboxes = document.querySelectorAll('#configCard input[type="checkbox"]');
        checkboxes.forEach(cb => cb.disabled = true);

        bleDevice = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'DP E12.CAN' }],
            optionalServices: ['0000fff0-0000-1000-8000-00805f9b34fb']
        });
        
        bleDevice.addEventListener('gattserverdisconnected', onDisconnected);

        const server = await bleDevice.gatt.connect();
        const service = await server.getPrimaryService('0000fff0-0000-1000-8000-00805f9b34fb');
        const notifyChar = await service.getCharacteristic('0000fff4-0000-1000-8000-00805f9b34fb');

        await notifyChar.startNotifications();
        notifyChar.addEventListener('characteristicvaluechanged', handleBikeData);
        
        document.getElementById('status').innerHTML = `Status: <span class="status-badge status-connected">Connected</span>`;
        document.getElementById('exportBtn').disabled = false;
        document.getElementById('connectBtn').style.display = 'none';
        document.getElementById('disconnectBtn').style.display = 'block';
        
        await requestWakeLock();
    } catch (error) {
        console.error("Bluetooth Error:", error);
        document.getElementById('status').innerHTML = `Status: <span class="status-badge status-disconnected">Connection Failed</span>`;
        const checkboxes = document.querySelectorAll('#configCard input[type="checkbox"]');
        checkboxes.forEach(cb => { if(cb.id !== 'chk_timestamp' && cb.id !== 'chk_latlon') cb.disabled = false; });
    }
});

document.getElementById('disconnectBtn').addEventListener('click', () => {
    if (bleDevice && bleDevice.gatt.connected) { bleDevice.gatt.disconnect(); }
});

function onDisconnected() {
    document.getElementById('status').innerHTML = `Status: <span class="status-badge status-disconnected">Disconnected</span>`;
    document.getElementById('connectBtn').style.display = 'block';
    document.getElementById('disconnectBtn').style.display = 'none';
    releaseWakeLock();
    
    if (rideData.length > 0) {
        downloadCSV();
    }
    
    const checkboxes = document.querySelectorAll('#configCard input[type="checkbox"]');
    checkboxes.forEach(cb => { if(cb.id !== 'chk_timestamp' && cb.id !== 'chk_latlon') cb.disabled = false; });
}

function downloadCSV() {
    if (rideData.length === 0) return;

    const keys = Object.keys(rideData[0]);
    let csvContent = "data:text/csv;charset=utf-8," + keys.join(",") + "\n";
    
    rideData.forEach(row => {
        let line = keys.map(key => {
            let val = row[key] !== undefined ? row[key] : "";
            return typeof val === 'string' && val.includes(',') ? `"${val}"` : val;
        });
        csvContent += line.join(",") + "\n";
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `bafang_ride_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Clear backup after successful download
    localStorage.removeItem('ride_data_backup');
}

			 
document.getElementById('exportBtn').addEventListener('click', downloadCSV);

// Screen Lock Logic / Unlock Logic
const lockScreenBtn = document.getElementById('lockScreenBtn');
const touchLockOverlay = document.getElementById('touchLockOverlay');
const unlockSlider = document.getElementById('unlockSlider');

			   
lockScreenBtn.addEventListener('click', () => {
    touchLockOverlay.style.display = 'flex';
    unlockSlider.value = 0; // Reset slider position
});

// Continuously check the slider value as the user drags it
unlockSlider.addEventListener('input', (e) => {
    if (e.target.value >= 95) { // If dragged 95% of the way to the right
        touchLockOverlay.style.display = 'none'; // Hide overlay
        e.target.value = 0; // Reset for next time
    }
});

																				  
unlockSlider.addEventListener('change', (e) => {
    if (e.target.value < 95) {
        e.target.value = 0;
    }
});

			   
function handleBikeData(event) {
    const buffer = new Uint8Array(event.target.value.buffer);
    const hexString = Array.from(buffer).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

			 
    const decoded = decodeBafangPacket(buffer);

    if (decoded.type === 'pas') { currentPas = decoded.value; document.getElementById('pasDisplay').innerText = currentPas; }
    if (decoded.type === 'light') { currentLight = decoded.value; document.getElementById('lightDisplay').innerText = currentLight; }
    if (decoded.type === 'battery') { 
        currentBattery = decoded.value; 
        document.getElementById('battDisplay').innerText = `${currentBattery}%`; 
        document.getElementById('lockBattDisplay').innerText = `${currentBattery}%`; // Updates lock screen
    }
    if (decoded.type === 'speed') { 
        currentSpeed = decoded.value; 
        document.getElementById('speedDisplay').innerText = `${currentSpeed} km/h`; 
        document.getElementById('lockSpeedDisplay').innerText = `${currentSpeed} km/h`; // Updates lock screen
    }
    if (decoded.type === 'trip') { currentTrip = decoded.value; document.getElementById('tripDisplay').innerText = `${currentTrip} km`; }
    if (decoded.type === 'range') { currentRange = decoded.value; document.getElementById('rangeDisplay').innerText = `${currentRange} km`; }
    if (decoded.type === 'torque') { currentTorque = decoded.value; document.getElementById('torqueDisplay').innerText = currentTorque; }
    if (decoded.type === 'voltage') { currentVoltage = decoded.value; document.getElementById('voltDisplay').innerText = `${currentVoltage} V`; }
    if (decoded.type === 'temp') { currentTemp = decoded.value; document.getElementById('tempDisplay').innerText = `${currentTemp} °C`; }
    if (decoded.type === 'odo') { currentOdo = decoded.value; document.getElementById('odoDisplay').innerText = `${currentOdo} km`; }
    
    if (decoded.type === 'cadence') { currentCadence = decoded.value; document.getElementById('cadenceDisplay').innerText = `${currentCadence} rpm`; }
    if (decoded.type === 'current') { currentCurrent = decoded.value; document.getElementById('currentDisplay').innerText = `${currentCurrent} mA`; }
    if (decoded.type === 'bmsRelPct') { currentBmsRelPct = decoded.value; document.getElementById('bmsRelPctDisplay').innerText = `${currentBmsRelPct} %`; }
    if (decoded.type === 'bmsRemainMah') { currentBmsRemainMah = decoded.value; document.getElementById('bmsRemainMahDisplay').innerText = `${currentBmsRemainMah} mAh`; }
    if (decoded.type === 'bmsFullMah') { currentBmsFullMah = decoded.value; document.getElementById('bmsFullMahDisplay').innerText = `${currentBmsFullMah} mAh`; }
    if (decoded.type === 'bmsCycles') { currentBmsCycles = decoded.value; document.getElementById('bmsCyclesDisplay').innerText = currentBmsCycles; }
    if (decoded.type === 'maxPasLevels') { currentMaxPasLevels = decoded.value; document.getElementById('maxPasLevelsDisplay').innerText = currentMaxPasLevels; }

    let logHexVal = "";
    const isHexEnabled = document.getElementById('toggleHex').checked;
    if (isHexEnabled) {
        logHexVal = hexString;
        recentHexLogs.unshift(hexString);
        if (recentHexLogs.length > 5) recentHexLogs.pop();
        document.getElementById('consoleOutput').innerText = recentHexLogs.join('\n');
    } else {
        document.getElementById('consoleOutput').innerText = "Logging is disabled.";
    }

    // Smart Logging Filter Check:
																				  
																						   
    let shouldLog = false;
    let now = Date.now();
    // 1. Time throttle (minimum 1 second between points) & Accuracy filter
    if (now - lastLoggedTime < 1000 || currentAccuracy > MAX_ACCURACY_METERS) {
        shouldLog = false;
    } else if (isHexEnabled) {
        shouldLog = true;
    } else if (lastLoggedLat === null || lastLoggedLon === null) {
        shouldLog = true;
    } else {
        let distance = getDistanceFromLatLonInMeters(lastLoggedLat, lastLoggedLon, currentLat, currentLon);
        let timeSinceLastLog = now - lastLoggedTime;

        // 2. Optimized Filter: Log if moved far enough OR stayed idle too long
        if (distance >= MIN_MOVE_METERS || timeSinceLastLog >= MAX_IDLE_TIME_MS) {
            shouldLog = true;
        }
    }

    if (shouldLog) {
        lastLoggedTime = now;
        lastLoggedLat = currentLat;
        lastLoggedLon = currentLon;

        let dataPoint = {
            timestamp: new Date().toISOString(),
            lat: currentLat,
            lon: currentLon,
            altitude_m: currentAltitude.toFixed(1),
            rawHex: logHexVal
        };

        if (document.getElementById('chk_speed').checked) dataPoint.speed = currentSpeed;
        if (document.getElementById('chk_odo').checked) dataPoint.odo = currentOdo;
        if (document.getElementById('chk_battery').checked) dataPoint.battery = currentBattery;
        if (document.getElementById('chk_temp').checked) dataPoint.temp = currentTemp;
        if (document.getElementById('chk_pas').checked) dataPoint.pas = currentPas;
        if (document.getElementById('chk_voltage').checked) dataPoint.voltage = currentVoltage;
        if (document.getElementById('chk_range').checked) dataPoint.range = currentRange;
        if (document.getElementById('chk_trip').checked) dataPoint.trip = currentTrip;
        if (document.getElementById('chk_torque').checked) dataPoint.torque = currentTorque;
        if (document.getElementById('chk_light').checked) dataPoint.light = currentLight;
        if (document.getElementById('chk_cadence').checked) dataPoint.cadence = currentCadence;
        if (document.getElementById('chk_current').checked) dataPoint.current = currentCurrent;
        if (document.getElementById('chk_bmsRelPct').checked) dataPoint.bmsRelPct = currentBmsRelPct;
        if (document.getElementById('chk_bmsRemainMah').checked) dataPoint.bmsRemainMah = currentBmsRemainMah;
        if (document.getElementById('chk_bmsFullMah').checked) dataPoint.bmsFullMah = currentBmsFullMah;
        if (document.getElementById('chk_bmsCycles').checked) dataPoint.bmsCycles = currentBmsCycles;
        if (document.getElementById('chk_maxPasLevels').checked) dataPoint.maxPasLevels = currentMaxPasLevels;
        
        if (isHexEnabled) dataPoint.rawHex = logHexVal;

        rideData.push(dataPoint);

        // Save progress to localStorage periodically to prevent data loss on browser crash
        localStorage.setItem('ride_data_backup', JSON.stringify(rideData));
    }
}

// Register Service Worker for PWA Caching                                      
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registered successfully:', reg.scope))
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}
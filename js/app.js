import { decodeBafangPacket, buildLightCommand, buildPasCommand } from './bafang-protocol.js';

let rideData = [];
let currentLat = 0, currentLon = 0, currentAltitude = 0;
let lastLoggedLat = null, lastLoggedLon = null;
let recentHexLogs = [];
let wakeLock = null;
let bleDevice = null;
let bleWriteChar = null;

let currentPas = "--", currentSpeed = "--", currentOdo = "--";
let currentBattery = "--", currentVoltage = "--", currentTemp = "--";
let currentTrip = "--", currentRange = "--", currentTorque = "--";
let currentLight = "--";

const MIN_MOVE_METERS = 3; // Minimum distance change required to log a new position update

function updateDisplayVisibility() {
    const metrics = ['speed', 'battery', 'pas', 'voltage', 'range', 'trip', 'odo', 'torque', 'temp', 'light'];
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

// GPS Tracking with status indicators
navigator.geolocation.watchPosition(
    (position) => {
        currentLat = position.coords.latitude;
        currentLon = position.coords.longitude;
        currentAltitude = position.coords.altitude !== null ? position.coords.altitude : 0;
        
        const gpsEl = document.getElementById('gpsDisplay');
        gpsEl.innerHTML = `GPS: <span class="status-badge status-ok">OK</span>`;
    },
    (err) => {
        console.error("GPS Error:", err);
        const gpsEl = document.getElementById('gpsDisplay');
        gpsEl.innerHTML = `GPS: <span class="status-badge status-searching">Searching</span>`;
    },
    { 
        enableHighAccuracy: true, 
        timeout: 15000, 
        maximumAge: 10000 
    }
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
        
		// Setup write characteristic (often fff3 or fff4 depending on firmware permissions)
        try {
            bleWriteChar = await service.getCharacteristic('0000fff3-0000-1000-8000-00805f9b34fb');
        } catch(e) {
            bleWriteChar = notifyChar; // Fallback to notify char if writeWithoutResponse is supported on it
        }
		
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
    
    const checkboxes = document.querySelectorAll('#configCard input[type="checkbox"]');
    checkboxes.forEach(cb => { if(cb.id !== 'chk_timestamp' && cb.id !== 'chk_latlon') cb.disabled = false; });
}

document.getElementById('toggleLightBtn').addEventListener('click', async () => {
    if (!bleWriteChar) return;
    try {
        const turnOn = currentLight !== "ON";
        const packet = buildLightCommand(turnOn);
        await bleWriteChar.writeValueWithoutResponse(packet);
        console.log("Light command sent:", turnOn ? "ON" : "OFF");
    } catch (err) {
        console.error("Failed to send headlight command:", err);
    }
});

document.querySelectorAll('.pas-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
        if (!bleWriteChar) return;
        try {
            const level = e.target.getAttribute('data-level');
            const packet = buildPasCommand(level);
            await bleWriteChar.writeValueWithoutResponse(packet);
            console.log("PAS level command sent:", level);
        } catch (err) {
            console.error("Failed to send PAS command:", err);
        }
    });
});

// Decode Telemetry & Evaluate Smart Logging Filter
function handleBikeData(event) {
    const buffer = new Uint8Array(event.target.value.buffer);
    const hexString = Array.from(buffer).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

    // Decode packet via external protocol module
    const decoded = decodeBafangPacket(buffer);

    if (decoded.type === 'pas') { currentPas = decoded.value; document.getElementById('pasDisplay').innerText = currentPas; }
    if (decoded.type === 'light') { currentLight = decoded.value; document.getElementById('lightDisplay').innerText = currentLight; }
    if (decoded.type === 'battery') { currentBattery = decoded.value; document.getElementById('battDisplay').innerText = `${currentBattery}%`; }
    if (decoded.type === 'speed') { currentSpeed = decoded.value; document.getElementById('speedDisplay').innerText = `${currentSpeed} km/h`; }
    if (decoded.type === 'trip') { currentTrip = decoded.value; document.getElementById('tripDisplay').innerText = `${currentTrip} km`; }
    if (decoded.type === 'range') { currentRange = decoded.value; document.getElementById('rangeDisplay').innerText = `${currentRange} km`; }
    if (decoded.type === 'torque') { currentTorque = decoded.value; document.getElementById('torqueDisplay').innerText = currentTorque; }
    if (decoded.type === 'voltage') { currentVoltage = decoded.value; document.getElementById('voltDisplay').innerText = `${currentVoltage} V`; }
    if (decoded.type === 'temp') { currentTemp = decoded.value; document.getElementById('tempDisplay').innerText = `${currentTemp} °C`; }
    if (decoded.type === 'odo') { currentOdo = decoded.value; document.getElementById('odoDisplay').innerText = `${currentOdo} km`; }

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
    // If we have a previous point, check if we've moved at least MIN_MOVE_METERS.
    // If it's our very first point, or we've moved past the threshold, record it.
    let shouldLog = false;
    if (lastLoggedLat === null || lastLoggedLon === null) {
        shouldLog = true;
    } else {
        let distance = getDistanceFromLatLonInMeters(lastLoggedLat, lastLoggedLon, currentLat, currentLon);
        if (distance >= MIN_MOVE_METERS) {
            shouldLog = true;
        }
    }

    if (shouldLog) {
        lastLoggedLat = currentLat;
        lastLoggedLon = currentLon;

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
        if (document.getElementById('chk_torque').checked) dataPoint.torque = currentTorque;
        if (document.getElementById('chk_light').checked) dataPoint.light = currentLight;
        if (isHexEnabled) dataPoint.rawHex = logHexVal;

        rideData.push(dataPoint);
    }
}

document.getElementById('exportBtn').addEventListener('click', () => {
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
});

// Register Service Worker for PWA Caching
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('Service Worker registered successfully:', reg.scope))
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}
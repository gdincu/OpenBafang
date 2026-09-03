import { decodeBafangPacket } from './bafang-protocol.js';

class SimpleKalman {
    constructor(processNoise = 0.0005) { // 0.0005 is optimized for cycling
        this.q = processNoise;
        this.x = null;
        this.p = null;
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
let currentLat = 0, currentLon = 0, currentAltitude = 0;
let lastLoggedLat = null, lastLoggedLon = null;
let lastLoggedAccuracy = 0;
let currentNativeSpeedKmh = 0;
let recentHexLogs = [];
let wakeLock = null;
let bleDevice = null;
let isScreenLocked = false;

let currentPas = "--", currentSpeed = "--", currentOdo = "--";
let currentBattery = "--", currentVoltage = "--", currentTemp = "--";
let currentTrip = "--", currentRange = "--";
let currentCurrent = "--", currentBmsRelPct = "--";
let currentBmsRemainMah = "--", currentBmsFullMah = "--";
let currentLight = "--";
let currentAccuracy = 999;

const MAX_ACCURACY_METERS = 25;
const MIN_MOVE_METERS = 5;
const MAX_IDLE_TIME_MS = 60000;

// Check for unsaved ride data recovery on page load
window.onload = () => {
    const backup = localStorage.getItem('ride_data_backup');
    if (backup) {
        const recoveredData = JSON.parse(backup);
        if (recoveredData.length > 0 && confirm(`Found ${recoveredData.length} unsaved points from a previous session. Download them now?`)) {
            rideData = recoveredData;
            downloadLogs();
        } else {
            localStorage.removeItem('ride_data_backup');
        }
    }
};

function updateDisplayVisibility() {
    const metrics = [
        'speed', 'battery', 'pas', 'voltage', 'range', 'trip', 'odo', 
        'current', 'bmsRelPct', 'bmsRemainMah', 
        'bmsFullMah', 'temp', 'light'
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

	 
navigator.geolocation.watchPosition(
    (position) => {
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
            // Apply Kalman filter at slow speeds/stops to kill drift
            currentLat = kalmanLat.filter(position.coords.latitude, accuracyDeg);
            currentLon = kalmanLon.filter(position.coords.longitude, accuracyDeg);
        }
        
        // Skip DOM update if OLED lock screen is active
        if (!isScreenLocked) {
            const gpsEl = document.getElementById('gpsDisplay');
            gpsEl.innerHTML = `GPS: <span class="status-badge status-ok">OK (±${Math.round(currentAccuracy)}m)</span>`;
        }
    },
    (err) => {
        console.error("GPS Error:", err);
        currentAccuracy = Infinity; // Invalidate accuracy on error
        if (!isScreenLocked) {
            const gpsEl = document.getElementById('gpsDisplay');
            gpsEl.innerHTML = `GPS: <span class="status-badge status-searching">Searching</span>`;
        }
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
        
        kalmanLat.reset();
        kalmanLon.reset();
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
        downloadLogs();
    }
    
    const checkboxes = document.querySelectorAll('#configCard input[type="checkbox"]');
    checkboxes.forEach(cb => { if(cb.id !== 'chk_timestamp' && cb.id !== 'chk_latlon') cb.disabled = false; });
}

function downloadLogs() {
    // Save any remaining points that didn't hit the modulo 10 check
    if (rideData.length > 0) {
        localStorage.setItem('ride_data_backup', JSON.stringify(rideData));
    }

    if (rideData.length === 0) return;

    const timeStampStr = new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
    const baseFilename = `bafang_ride_${timeStampStr}`;

    // --- 1. GENERATE CSV ---
    const keys = Object.keys(rideData[0]);
    let csvContent = "data:text/csv;charset=utf-8," + keys.join(",") + "\n";
    
    rideData.forEach(row => {
        let line = keys.map(key => {
            let val = row[key] !== undefined ? row[key] : "";
            return typeof val === 'string' && val.includes(',') ? `"${val}"` : val;
        });
        csvContent += line.join(",") + "\n";
    });
    triggerDownload(encodeURI(csvContent), `${baseFilename}.csv`);

    // --- 2. GENERATE GPX ---
    let gpxContent = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="OpenBafang">\n<trk>\n<name>${baseFilename}</name>\n<trkseg>\n`;
    
    rideData.forEach(row => {
        if (row.lat && row.lon) {
            gpxContent += `  <trkpt lat="${row.lat}" lon="${row.lon}">\n`;
            if (row.altitude_m) gpxContent += `    <ele>${row.altitude_m}</ele>\n`;
            gpxContent += `    <time>${row.timestamp}</time>\n`;
            
																  
            gpxContent += `    <extensions>\n`;
            if (row.speed !== undefined) gpxContent += `      <speed>${row.speed}</speed>\n`;
            if (row.battery !== undefined) gpxContent += `      <battery>${row.battery}</battery>\n`;
            gpxContent += `    </extensions>\n`;
            gpxContent += `  </trkpt>\n`;
        }
    });
    gpxContent += `</trkseg>\n</trk>\n</gpx>`;
    
    const gpxUri = "data:application/gpx+xml;charset=utf-8," + encodeURIComponent(gpxContent);
    triggerDownload(gpxUri, `${baseFilename}.gpx`);

	// Clear backup after successful download										 
    localStorage.removeItem('ride_data_backup');
}

function triggerDownload(uri, filename) {
    const link = document.createElement("a");
    link.setAttribute("href", uri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
															

    // Update global state variables
    if (decoded.type === 'pas') currentPas = decoded.value;
    if (decoded.type === 'light') currentLight = decoded.value;
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

    // DOM Repaint Management
    if (isScreenLocked) {
        // Only update the bare minimum OLED screen elements
        if (decoded.type === 'battery') document.getElementById('lockBattDisplay').innerText = `${currentBattery}%`;
        if (decoded.type === 'speed') document.getElementById('lockSpeedDisplay').innerText = `${currentSpeed} km/h`;
    } else {
        // Update full UI
        if (decoded.type === 'pas') document.getElementById('pasDisplay').innerText = currentPas;
        if (decoded.type === 'light') document.getElementById('lightDisplay').innerText = currentLight;
										 
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
																												   
																																									 
    }

    let logHexVal = "";
    const isHexEnabled = document.getElementById('toggleHex').checked;
    if (isHexEnabled) {
        logHexVal = hexString;
        recentHexLogs.unshift(hexString);
        if (recentHexLogs.length > 5) recentHexLogs.pop();
        if (!isScreenLocked) document.getElementById('consoleOutput').innerText = recentHexLogs.join('\n');
			
																					
    }

    // --- Smart Logging Filter ---
																		 
																				  
    let shouldLog = false;
    let now = Date.now();
    const bikeSpeedKmh = parseFloat(currentSpeed) || 0;
    
    // Completely halt logging if both the GPS and the bike motor report zero movement
    const isStationary = currentNativeSpeedKmh < 0.5 && bikeSpeedKmh < 0.5;

    if (now - lastLoggedTime < 1000 || currentAccuracy > MAX_ACCURACY_METERS) {
        shouldLog = false;
    } else if (isHexEnabled) {
        shouldLog = true; // Always log if raw hex debugging is on
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
        
        if (isHexEnabled) dataPoint.rawHex = logHexVal;

        rideData.push(dataPoint);

        // BATTERY OPTIMIZATION: Only stringify and save to storage every 10 data points
        if (rideData.length % 10 === 0) {
            localStorage.setItem('ride_data_backup', JSON.stringify(rideData));
        }
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

let rideData = [];
let currentLat = 0, currentLon = 0, currentAltitude = 0;
let recentHexLogs = [];
let wakeLock = null;
let bleDevice = null;

let currentPas = "--", currentSpeed = "--", currentOdo = "--";
let currentBattery = "--", currentVoltage = "--", currentTemp = "--";
let currentTrip = "--", currentRange = "--", currentTorque = "--";
let currentLight = "--";

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

navigator.geolocation.watchPosition(
    (position) => {
        currentLat = position.coords.latitude;
        currentLon = position.coords.longitude;
        currentAltitude = position.coords.altitude !== null ? position.coords.altitude : 0;
        
        const gpsEl = document.getElementById('gpsDisplay');
        gpsEl.innerText = "GPS OK";
        gpsEl.style.color = "green";
        gpsEl.style.fontWeight = "bold";
    },
    (err) => {
        console.error("GPS Error:", err);
        const gpsEl = document.getElementById('gpsDisplay');
        gpsEl.innerText = "GPS Error";
        gpsEl.style.color = "red";
    },
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
);

document.getElementById('connectBtn').addEventListener('click', async () => {
    try {
        document.getElementById('status').innerHTML = "Status: <b>Connecting...</b>";
        
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
        
        document.getElementById('status').innerHTML = "Status: <b style='color:green;'>Connected & Logging</b>";
        document.getElementById('exportBtn').disabled = false;
        document.getElementById('connectBtn').style.display = 'none';
        document.getElementById('disconnectBtn').style.display = 'block';
        
        await requestWakeLock();
    } catch (error) {
        console.error("Bluetooth Error:", error);
        document.getElementById('status').innerHTML = "Status: <b style='color:red;'>Connection Failed</b>";
        const checkboxes = document.querySelectorAll('#configCard input[type="checkbox"]');
        checkboxes.forEach(cb => { if(cb.id !== 'chk_timestamp' && cb.id !== 'chk_latlon') cb.disabled = false; });
    }
});

document.getElementById('disconnectBtn').addEventListener('click', () => {
    if (bleDevice && bleDevice.gatt.connected) { bleDevice.gatt.disconnect(); }
});

function onDisconnected() {
    document.getElementById('status').innerHTML = "Status: <b style='color:red;'>Disconnected</b>";
    document.getElementById('connectBtn').style.display = 'block';
    document.getElementById('disconnectBtn').style.display = 'none';
    releaseWakeLock();
    
    const checkboxes = document.querySelectorAll('#configCard input[type="checkbox"]');
    checkboxes.forEach(cb => { if(cb.id !== 'chk_timestamp' && cb.id !== 'chk_latlon') cb.disabled = false; });
}

function handleBikeData(event) {
    const buffer = new Uint8Array(event.target.value.buffer);
    const hexString = Array.from(buffer).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

    const cmdId = buffer[2];

    if (cmdId === 0x4A) { currentPas = buffer[4]; document.getElementById('pasDisplay').innerText = currentPas; }
    if (cmdId === 0x40) { currentLight = buffer[4] === 0x01 ? "ON" : "OFF"; document.getElementById('lightDisplay').innerText = currentLight; }
    if (cmdId === 0x64) { currentBattery = buffer[4]; document.getElementById('battDisplay').innerText = `${currentBattery}%`; }
    if (cmdId === 0x44) { currentSpeed = (((buffer[4] << 8) | buffer[5]) / 10).toFixed(1); document.getElementById('speedDisplay').innerText = `${currentSpeed} km/h`; }
    if (cmdId === 0x47) { currentTrip = (((buffer[4] << 8) | buffer[5]) / 10).toFixed(1); document.getElementById('tripDisplay').innerText = `${currentTrip} km`; }
    if (cmdId === 0x71) { currentRange = (buffer[4] << 8) | buffer[5]; document.getElementById('rangeDisplay').innerText = `${currentRange} km`; }
    if (cmdId === 0xD3) { currentTorque = (buffer[4] << 8) | buffer[5]; document.getElementById('torqueDisplay').innerText = currentTorque; }
    if (cmdId === 0x61) { currentVoltage = (((buffer[4] << 8) | buffer[5]) / 1000).toFixed(1); document.getElementById('voltDisplay').innerText = `${currentVoltage} V`; }
    if (cmdId === 0x60) { currentTemp = (((buffer[4] << 8) | buffer[5]) / 10).toFixed(1); document.getElementById('tempDisplay').innerText = `${currentTemp} °C`; }
    if (cmdId === 0x46) { currentOdo = (buffer[4] << 16) | (buffer[5] << 8) | buffer[6]; document.getElementById('odoDisplay').innerText = `${currentOdo} km`; }

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

    // Baseline mandatory fields (Timestamp, Lat, Lon, Altitude)
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
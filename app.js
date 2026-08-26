let rideData = [];
let currentLat = 0, currentLon = 0;
let recentHexLogs = [];
let wakeLock = null;
let bleDevice = null;

let currentPas = "--", currentSpeed = "--", currentOdo = "--";
let currentBattery = "--", currentVoltage = "--", currentTemp = "--";
let currentTrip = "--", currentRange = "--", currentTorque = "--";
let currentLight = "--";

// Screen Wake Lock
async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try { wakeLock = await navigator.wakeLock.request('screen'); } 
        catch (err) { console.error(`Wake Lock Error: ${err.message}`); }
    }
}

function releaseWakeLock() {
    if (wakeLock !== null) { wakeLock.release().then(() => wakeLock = null); }
}

// GPS Tracking
navigator.geolocation.watchPosition(
    (position) => {
        currentLat = position.coords.latitude;
        currentLon = position.coords.longitude;
        document.getElementById('gpsDisplay').innerText = `GPS: ${currentLat.toFixed(6)}, ${currentLon.toFixed(6)}`;
    },
    (err) => console.error("GPS Error:", err),
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
);

// Connect Bluetooth
document.getElementById('connectBtn').addEventListener('click', async () => {
    try {
        document.getElementById('status').innerHTML = "Status: <b>Connecting...</b>";
        
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
    }
});

// Disconnect
document.getElementById('disconnectBtn').addEventListener('click', () => {
    if (bleDevice && bleDevice.gatt.connected) { bleDevice.gatt.disconnect(); }
});

function onDisconnected() {
    document.getElementById('status').innerHTML = "Status: <b style='color:red;'>Disconnected</b>";
    document.getElementById('connectBtn').style.display = 'block';
    document.getElementById('disconnectBtn').style.display = 'none';
    releaseWakeLock();
}

// Decode Telemetry
function handleBikeData(event) {
    const buffer = new Uint8Array(event.target.value.buffer);
    const hexString = Array.from(buffer).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

    const cmdId = buffer[2];

    if (cmdId === 0x4A) { currentPas = buffer[4]; document.getElementById('pasDisplay').innerText = currentPas; }
    
    // Inverted headlight logic: 00 = ON, 01 = OFF
    if (cmdId === 0x40) { 
        currentLight = buffer[4] === 0x00 ? "ON" : "OFF"; 
        document.getElementById('lightDisplay').innerText = currentLight; 
    }
    
    if (cmdId === 0x64) { currentBattery = buffer[4]; document.getElementById('battDisplay').innerText = `${currentBattery}%`; }
    if (cmdId === 0x44) { currentSpeed = (((buffer[4] << 8) | buffer[5]) / 10).toFixed(1); document.getElementById('speedDisplay').innerText = `${currentSpeed} km/h`; }
    if (cmdId === 0x47) { currentTrip = (((buffer[4] << 8) | buffer[5]) / 10).toFixed(1); document.getElementById('tripDisplay').innerText = `${currentTrip} km`; }
    if (cmdId === 0x71) { currentRange = (buffer[4] << 8) | buffer[5]; document.getElementById('rangeDisplay').innerText = `${currentRange} km`; }
    if (cmdId === 0xD3) { currentTorque = (buffer[4] << 8) | buffer[5]; document.getElementById('torqueDisplay').innerText = currentTorque; }
    if (cmdId === 0x61) { currentVoltage = (((buffer[4] << 8) | buffer[5]) / 1000).toFixed(1); document.getElementById('voltDisplay').innerText = `${currentVoltage} V`; }
    if (cmdId === 0x60) { currentTemp = (((buffer[4] << 8) | buffer[5]) / 10).toFixed(1); document.getElementById('tempDisplay').innerText = `${currentTemp} °C`; }
    if (cmdId === 0x46) { currentOdo = (buffer[4] << 16) | (buffer[5] << 8) | buffer[6]; document.getElementById('odoDisplay').innerText = `${currentOdo} km`; }

    // Optional Hex Logging Checkbox Handling
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

    rideData.push({
        timestamp: new Date().toISOString(),
        lat: currentLat,
        lon: currentLon,
        pas: currentPas,
        speed: currentSpeed,
        trip: currentTrip,
        odo: currentOdo,
        range: currentRange,
        torque: currentTorque,
        battery: currentBattery,
        voltage: currentVoltage,
        temp: currentTemp,
        light: currentLight,
        rawHex: logHexVal
    });
}

// CSV Export
document.getElementById('exportBtn').addEventListener('click', () => {
    let csvContent = "data:text/csv;charset=utf-8,Timestamp,Latitude,Longitude,PAS,Speed_kmh,Trip_km,Odometer_km,Range_km,Torque,Battery_%,Voltage_V,Temp_C,Light,RawHex\n";
    rideData.forEach(row => {
        csvContent += `${row.timestamp},${row.lat},${row.lon},${row.pas},${row.speed},${row.trip},${row.odo},${row.range},${row.torque},${row.battery},${row.voltage},${row.temp},${row.light},"${row.rawHex}"\n`;
    });
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `bafang_ride_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
});
export const BAFANG_COMMANDS = {
    BASIC_INFO: 0x0B, // 11 dec - basic information string (ASCII '!'-separated version/serial data)
    ERROR_CODE: 0x09, // 9 dec - display/controller fault code (1 byte, 0 = OK)
    MOTOR_STATUS: 0x37, // 55 dec - motor status flags (1 byte, bit meanings unknown)
    HEADLIGHT: 0x40,     // 64 dec - headlight state notify (EBoxInfHeadLight)
    CURRENT_A: 0x41,     // 65 dec - controller current, 1 byte /10 A
    VOLTAGE_V: 0x42,     // 66 dec - controller voltage, BE16 /10 V
    BATTERY_CAP: 0x43,   // 67 dec - battery capacity, 1 byte %
    SPEED: 0x44,     // 68 dec (EBoxInfSpeed, BE/10 km/h)
    TEMP_C: 0x45,        // 69 dec - controller temperature, 1 byte C
    ODO: 0x46,       // 70 dec (EBoxInfODO, 3-byte BE km)
    TRIP: 0x47,      // 71 dec (EBoxInfTrip, BE/10 km)
    MAX_SPEED: 0x48,     // 72 dec (EBoxInfMaxSpeed, BE16, /10 inferred)
    AVG_SPEED: 0x49,     // 73 dec (EBoxInfAverageSpeed, BE16, /10 inferred)
    PAS_LEVEL: 0x4A, // 74 dec - PAS feedback telemetry (EBoxInfPASLevel).
                     // NOTE: DP E12 reports walk mode as level 15 here;
                     // SwiftFlow has no walk-engage write for this generation.
    CADENCE: 0x4B,       // 75 dec - cadence, BE16 rpm
    MAINTAIN_MILE: 0x4C, // 76 dec - maintenance mileage (BE16, /10 inferred)
    CAPACITY_AH: 0x50,   // 80 dec - battery capacity, 1 byte /10 Ah
    TEMP: 0x60,      // 96 dec (EBoxInfBMSTemperature, BE/10 C, signed)
    VOLTAGE: 0x61,   // 97 dec (EBoxInfBMSVoltage, BE mV)
    CURRENT: 0x62,   // 98 dec (EBoxInfBMSCurrent, BE mA)
    BMS_REL_PCT: 0x63, // 99 dec (EBoxInfBMSRelPercent, 1 byte %)
    BATTERY: 0x64,   // 100 dec (General Battery %)
    BMS_REMAIN_MAH: 0x65, // 101 dec (EBoxInfBMSRemainCapacity, BE mAh)
    BMS_FULL_MAH: 0x66,   // 102 dec (EBoxInfBMSFullCapacity, BE mAh)
    BMS_CYCLE: 0x67,      // 103 dec (EBoxInfBMSCycleCount, BE, e.g. 53/54)
    BMS_CHG_CUR_MIN: 0x68, // 104 dec (EBoxInfBMSCurChaInterval, 3-byte BE min)
    BMS_CHG_MAX_MIN: 0x69, // 105 dec (EBoxInfBMSMaxChaInterval, 3-byte BE, 151260)
    BMS_NOW_PCT: 0x6A,     // 106 dec (EBoxInfBMSNowCapacity, 1 byte %)
    CALORIES: 0x70,        // 112 dec (EBoxInfCal, BE16 Kcal)
    RANGE: 0x71,     // 113 dec (EBoxInfremaindistance, BE/10 km)
    PAS_NUM: 0x72,   // 114 dec (EBoxInfPASnum, e.g. 4) - notify AND write
    CURRENT_LIMIT: 0x82,     // 130 dec (EBoxResCurrentLimit, 1 byte A)
    SPEED_LIMIT: 0x87,       // 135 dec (EBoxResSpeedLimit, 1 byte km/h)
    WHEEL_DIAMETER: 0x8B,    // 139 dec (EBoxResWheelDiameter, BE16 /10 inch)
    DEVICE_NAME: 0xA2,       // 162 dec - rename ack (EBoxResDevice_Name)
    LIGHT_ACK: 0xA3, // 163 dec - headlight write ack (EBoxResHeadLight)
    SENSOR_MODEL: 0xD1,      // 209 dec (EBoxInfSensor_Model, hex string)
    TORQUE: 0xD2,            // 210 dec (EBoxInfTorque, BE16 mV)
    TWIST: 0xD3,             // 211 dec (EBoxInfTwist, BE16 throttle)
    HEART_RATE: 0xD4,        // 212 dec (EBoxInfHeartRate, 1 byte bpm)
    PIN_STATUS: 0xD5,        // 213 dec notify: 0=UNSET, 1=UNAUTH, 2=AUTH
    PIN_ACK: 0xD6,           // 214 dec (EBoxRes_SetPIN, 1 byte)
    SESSION: 0xA1,   // 161 dec - APPGetBMS_Info: 01 = request, 00 = stop.
                     // Extended BMS frames (0x65-0x69) only arrive after 01.
};

// SwiftFlow write commands (com.pairlink.lib.BafangCanConst). All sent on
// FFF3 as 02 01 CMD LEN DATA.. CHK 03 frames, no encryption.
export const WRITE_COMMANDS = {
    SET_PAS: 0x89,           // 137 APPSetPASLevel - assist level, 1 byte
    BMS_INFO: 0xA1,          // 161 APPGetBMS_Info - 1 start / 0 stop
    DEVICE_NAME: 0xA2,       // 162 APPSetDevice_Name - UTF-8, max 24 bytes
    HEADLIGHT: 0xA3,         // 163 APPSetHeadLight - 1 on / 0 off
    SET_PIN: 0xA4,           // 164 APPController_SetPIN - 8 bytes
    AUTH_PIN: 0xA5,          // 165 APPController_AuthPIN - 4 bytes
    RESET_PIN: 0xA6,         // 166 APPController_ResetPIN - 8 bytes
    NAVIGATION: 0xA7,        // 167 APPNavigationData - complex, not implemented
    BACKLIGHT: 0xA8,         // 168 APPSetBackLight - 1 byte level
    LIGHT_SENS: 0xAB,        // 171 APPSetLightSens - 1 byte level
    MAINTAIN_MILE: 0xAC,     // 172 APPSetMaintainMile - 1 byte
    AUTO_OFF: 0xAD,          // 173 APPSetAutoOff - 1 byte (1-9, 255 = always)
    SPORT_MODE: 0xAE,        // 174 APPSetSportMode - pasNum (sport) / 0x10|pasNum (eco)
    ECO_MODE: 0xAF,          // 175 APPSetECOMode
    POWER: 0xB0,             // 176 APPController_PowerOnOff - 1 byte
    AUTO_DRIVE: 0xB1,        // 177 APPSetAutoDrive - 1 byte
    PIN_STATUS: 0xD5,        // 213 APPGet_Version/PIN status - 1 request / 0 clear
    MAX_PAS: 0x72,           // 114 EBoxInfPASnum write - set max levels 3/4/5/9
};

// Write-ack command IDs (bike echoes the write's CMD with the sent value).
// NOTE: 0x89 (PAS), 0xA3 (headlight), 0xA2 (rename), 0xD5 (PIN status) and
// 0xD6 (PIN ack) have dedicated decoder cases below; 0x72 (max PAS) is also
// decoded as pasNum since notify and ack share the ID.
export const ACK_COMMANDS = new Set([
    WRITE_COMMANDS.DEVICE_NAME, WRITE_COMMANDS.SET_PIN, WRITE_COMMANDS.AUTH_PIN,
    WRITE_COMMANDS.RESET_PIN, WRITE_COMMANDS.BACKLIGHT, WRITE_COMMANDS.LIGHT_SENS,
    WRITE_COMMANDS.MAINTAIN_MILE, WRITE_COMMANDS.AUTO_OFF, WRITE_COMMANDS.SPORT_MODE,
    WRITE_COMMANDS.ECO_MODE, WRITE_COMMANDS.POWER, WRITE_COMMANDS.AUTO_DRIVE,
    WRITE_COMMANDS.MAX_PAS,
]);

// Display fault codes reported on CMD 0x09 (0 = no fault).
// Source: DP E12.CAN user manual (BF-UM-C-DP E12-EN), section 7.7.
export const ERROR_CODE_NAMES = {
    0: 'OK',
    4: 'Throttle not in position',
    5: 'Throttle fault',
    7: 'Overvoltage protection',
    8: 'Motor hall sensor',
    9: 'Motor phase winding',
    10: 'Motor over-temperature',
    11: 'Motor temp sensor',
    12: 'Controller current sensor',
    13: 'Battery temp sensor',
    14: 'Controller over-temperature',
    15: 'Controller temp sensor',
    21: 'Speed sensor',
    25: 'Torque signal',
    26: 'Torque sensor speed signal',
    27: 'Controller over-current',
    30: 'Communication problem',
    33: 'Brake signal',
    35: '15V detection circuit',
    36: 'Keypad detection circuit',
    37: 'WDT circuit',
    41: 'Battery voltage too high',
    42: 'Battery voltage too low',
    43: 'Battery cell power too high',
    44: 'Cell voltage too high',
    45: 'Battery temperature too high',
    46: 'Battery temperature too low',
    47: 'Battery SOC too high',
    48: 'Battery SOC too low',
    61: 'Switching detection defect',
    62: 'Electronic derailleur jammed',
    71: 'Electronic lock jammed',
    81: 'Bluetooth module error'
};

export function getErrorCodeName(code) {
    return ERROR_CODE_NAMES[code] || `Unknown code ${code}`;
}

// Frame layout (both directions):
//   Phone write: 02 01 CMD LEN DATA.. CHK 03        (SEQ fixed 0x01)
//   Bike notify: 02 SEQ CMD LEN DATA.. CHK 03       (SEQ counts 00-FF)
//   CHK = sum(SEQ..DATA) % 256
// Matches PlBleService.gen_uart_cmd / process_uart_pdu in SwiftFlow.
export function buildWriteFrameBytes(cmd, dataBytes) {
    const data = [...dataBytes].map((b) => b & 0xFF);
    const bytes = [0x02, 0x01, cmd & 0xFF, data.length, ...data];
    let chk = 0;
    for (let i = 1; i < bytes.length; i++) chk = (chk + bytes[i]) % 256;
    bytes.push(chk, 0x03);
    return bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

export function buildWriteFrame(cmd, dataByte) {
    return buildWriteFrameBytes(cmd, [dataByte & 0xFF]);
}

export function validateBafangPacket(buffer) {
    // Frame: 02 SEQ CMD LEN DATA.. CHK 03 — total length must equal 6 + LEN.
    // Minimum is 6 bytes (LEN=0, no payload); 1-byte payload is 7 bytes.
    if (!buffer || buffer.length < 6 || buffer[0] !== 0x02 || buffer[buffer.length - 1] !== 0x03) return false;
    if (buffer[3] !== buffer.length - 6) return false;
    let sum = 0;
    for (let i = 1; i < buffer.length - 2; i++) sum = (sum + buffer[i]) % 256;
    return sum === buffer[buffer.length - 2];
}

// '02 01 89 01 05 90 03'  // PAS 5 - checksum holds for every level.
// NOTE: the array previously capped sending at level 4, which desynced the
// UI on multi-level bikes; buildWriteFrame handles 0-255 directly.
export const COMMAND_PAYLOADS = {
    HEADLIGHT_ON: '02 01 A3 01 01 A6 03',
    HEADLIGHT_OFF: '02 01 A3 01 00 A5 03'
};

function asciiBytes(str, maxLen) {
    const out = [];
    for (const ch of String(str).slice(0, maxLen)) {
        const code = ch.charCodeAt(0) & 0xFF;
        out.push(code);
    }
    return out;
}

function fixedAsciiBytes(str, len) {
    const bytes = asciiBytes(str, len);
    while (bytes.length < len) bytes.push(0x00);
    return bytes;
}

export function getPasCommand(level) {
    const lvl = Number.isFinite(level) ? Math.max(0, Math.min(255, Math.round(level))) : 0;
    return buildWriteFrameBytes(WRITE_COMMANDS.SET_PAS, [lvl]);
}

export function getHeadlightCommand(on) {
    return buildWriteFrameBytes(WRITE_COMMANDS.HEADLIGHT, [on ? 0x01 : 0x00]);
}

export function getBmsInfoCommand(start) {
    return buildWriteFrameBytes(WRITE_COMMANDS.BMS_INFO, [start ? 0x01 : 0x00]);
}

export function getDeviceNameCommand(name) {
    return buildWriteFrameBytes(WRITE_COMMANDS.DEVICE_NAME, asciiBytes(name, 24));
}

export function getBacklightCommand(level) {
    return buildWriteFrameBytes(WRITE_COMMANDS.BACKLIGHT, [Number(level) & 0xFF]);
}

export function getLightSensCommand(level) {
    return buildWriteFrameBytes(WRITE_COMMANDS.LIGHT_SENS, [Number(level) & 0xFF]);
}

export function getMaintainMileCommand(value) {
    return buildWriteFrameBytes(WRITE_COMMANDS.MAINTAIN_MILE, [Number(value) & 0xFF]);
}

// SwiftFlow: l = ++t > 9 ? 255 : t — so UI values 1-9 map directly,
// 255 means "always on".
export function getAutoOffCommand(value) {
    let v = Math.round(Number(value));
    if (v > 9) v = 255;
    if (v < 1) v = 1;
    return buildWriteFrameBytes(WRITE_COMMANDS.AUTO_OFF, [v]);
}

// SwiftFlow setSportEcoMode: sport = pasNum, eco = 0x10 | pasNum, both on
// APPSetSportMode (0xAE); 0xAF exists in the registry but is unused by the app.
export function getRideModeCommand(eco, pasNum) {
    const n = Math.max(0, Math.min(15, Math.round(Number(pasNum) || 0)));
    return buildWriteFrameBytes(WRITE_COMMANDS.SPORT_MODE, [eco ? (0x10 | n) : n]);
}

export function getPowerCommand(on) {
    return buildWriteFrameBytes(WRITE_COMMANDS.POWER, [on ? 0x01 : 0x00]);
}

export function getAutoDriveCommand(on) {
    return buildWriteFrameBytes(WRITE_COMMANDS.AUTO_DRIVE, [on ? 0x01 : 0x00]);
}

export function getSetPinCommand(pin) {
    return buildWriteFrameBytes(WRITE_COMMANDS.SET_PIN, fixedAsciiBytes(pin, 8));
}

export function getAuthPinCommand(pin) {
    return buildWriteFrameBytes(WRITE_COMMANDS.AUTH_PIN, fixedAsciiBytes(pin, 4));
}

export function getResetPinCommand(pin) {
    return buildWriteFrameBytes(WRITE_COMMANDS.RESET_PIN, fixedAsciiBytes(pin, 8));
}

export function getPinStatusCommand() {
    return buildWriteFrameBytes(WRITE_COMMANDS.PIN_STATUS, [0x01]);
}

export function getClearPinStatusCommand() {
    return buildWriteFrameBytes(WRITE_COMMANDS.PIN_STATUS, [0x00]);
}

// SwiftFlow setMaxPas: 0 -> 3, 1 -> 4, 2 -> 5, 3 -> 9 levels.
export function getMaxPasCommand(levels) {
    return buildWriteFrameBytes(WRITE_COMMANDS.MAX_PAS, [Number(levels) & 0xFF]);
}

export function getRawCommand(cmd, dataBytes) {
    return buildWriteFrameBytes(cmd, dataBytes || []);
}

function be16(buffer) {
    return (buffer[4] << 8) | buffer[5];
}

// Signed big-endian 16-bit (e.g. BMS temperature 0x60 can go negative).
function sbe16(buffer) {
    let v = (buffer[4] << 8) | buffer[5];
    if (v & 0x8000) v -= 0x10000;
    return v;
}

function be24(buffer) {
    return (buffer[4] << 16) | (buffer[5] << 8) | buffer[6];
}

function rawHex(buffer) {
    return [...buffer].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

// DATA slice only: bytes [4, 4+LEN). Never include trailing CHK + 0x03.
function dataEnd(buffer) {
    const len = buffer[3];
    return Math.min(4 + len, buffer.length - 2);
}

function asciiStr(buffer, start) {
    let s = '';
    const end = dataEnd(buffer);
    for (let i = start; i < end; i++) {
        if (buffer[i] === 0x00) continue; // skip NUL padding
        s += String.fromCharCode(buffer[i]);
    }
    return s;
}

function hexStr(buffer, start) {
    return [...buffer].slice(start, dataEnd(buffer)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

const PIN_STATUS_NAMES = { 0: 'UNSET', 1: 'UNAUTH', 2: 'AUTH' };

export function getPinStatusName(code) {
    return PIN_STATUS_NAMES[code] || `Unknown (${code})`;
}

// 0x0B '!'-separated field order per SwiftFlow bytesToHexStringBafang:
// panel SW, panel HW, panel S/N, controller SW, controller HW, controller S/N,
// battery SW, battery HW, battery S/N, sensor SW, sensor HW, sensor S/N.
// SwiftFlow's About screens show all-zero data on UART-type bikes like the
// DP E12 (user-confirmed), so fields may be missing or empty.
export function parseBasicInfo(value) {
    const keys = [
        'panelSw', 'panelHw', 'panelSerial',
        'controllerSw', 'controllerHw', 'controllerSerial',
        'batterySw', 'batteryHw', 'batterySerial',
        'sensorSw', 'sensorHw', 'sensorSerial'
    ];
    const parts = String(value).split('!');
    const out = {};
    keys.forEach((k, i) => {
        const part = parts[i];
        out[k] = (part !== undefined && part.trim().length > 0) ? part.trim() : null;
    });
    return out;
}

export function decodeBafangPacket(buffer) {
    // Defensive: never read payload bytes the LEN field doesn't guarantee.
    if (!buffer || buffer.length < 6) {
        return { type: null, value: null, raw: buffer ? rawHex(buffer) : '' };
    }
    // LEN must match actual frame length (mirrors validateBafangPacket).
    if (buffer[3] !== buffer.length - 6) {
        return { type: null, value: null, raw: rawHex(buffer) };
    }
    const cmdId = buffer[2];
    const len = buffer[3];
    // Payload must actually be present (validateBafangPacket also enforces
    // len === buffer.length - 6 on the notify path).
    const hasPayload = (n) => len >= n && buffer.length >= 6 + n;
    let result = { type: null, value: null };

    switch (cmdId) {
        case BAFANG_COMMANDS.ERROR_CODE: // 0x09 fault code (0 = OK)
            if (!hasPayload(1)) break;
            result = { type: 'errorCode', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.BASIC_INFO: // 0x0B '!'-separated versions/serials
            if (!hasPayload(1)) break;
            result = { type: 'basicInfo', value: asciiStr(buffer, 4).trim() };
            break;
        case BAFANG_COMMANDS.MOTOR_STATUS: // 0x37 motor status flags
            if (!hasPayload(1)) break;
            result = { type: 'motorStatus', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.HEADLIGHT: // 0x40 headlight state notify
            if (!hasPayload(1)) break;
            result = { type: 'light', value: buffer[4] === 0x01 ? "ON" : "OFF" };
            break;
        case BAFANG_COMMANDS.CURRENT_A: // 0x41 1 byte, /10 A
            if (!hasPayload(1)) break;
            result = { type: 'currentA', value: (buffer[4] / 10).toFixed(1) };
            break;
        case BAFANG_COMMANDS.VOLTAGE_V: // 0x42 BE16, /10 V
            if (!hasPayload(2)) break;
            result = { type: 'voltageV', value: (be16(buffer) / 10).toFixed(1) };
            break;
        case BAFANG_COMMANDS.BATTERY_CAP: // 0x43 1 byte %
            if (!hasPayload(1)) break;
            result = { type: 'batteryCap', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.SPEED:
            if (!hasPayload(2)) break;
            result = { type: 'speed', value: Math.round(((buffer[4] << 8) | buffer[5]) / 10) };
            break;
        case BAFANG_COMMANDS.TEMP_C: // 0x45 1 byte C
            if (!hasPayload(1)) break;
            result = { type: 'tempC', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.ODO:
            if (!hasPayload(3)) break;
            result = { type: 'odo', value: (buffer[4] << 16) | (buffer[5] << 8) | buffer[6] };
            break;
        case BAFANG_COMMANDS.TRIP:
            if (!hasPayload(2)) break;
            result = { type: 'trip', value: (((buffer[4] << 8) | buffer[5]) / 10).toFixed(1) };
            break;
        case BAFANG_COMMANDS.MAX_SPEED: // 0x48 BE16, /10 inferred
            if (!hasPayload(2)) break;
            result = { type: 'maxSpeed', value: (be16(buffer) / 10).toFixed(1) };
            break;
        case BAFANG_COMMANDS.AVG_SPEED: // 0x49 BE16, /10 inferred
            if (!hasPayload(2)) break;
            result = { type: 'avgSpeed', value: (be16(buffer) / 10).toFixed(1) };
            break;
        case BAFANG_COMMANDS.PAS_LEVEL: // 0x4A PAS feedback telemetry
            if (!hasPayload(1)) break;
            result = { type: 'pas', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.CADENCE: // 0x4B BE16 rpm (unscaled per SwiftFlow)
            if (!hasPayload(2)) break;
            result = { type: 'cadence', value: be16(buffer) };
            break;
        case BAFANG_COMMANDS.MAINTAIN_MILE: // 0x4C BE16, /10 inferred
            if (!hasPayload(2)) break;
            result = { type: 'maintainMile', value: (be16(buffer) / 10).toFixed(1) };
            break;
        case BAFANG_COMMANDS.CAPACITY_AH: // 0x50 1 byte, /10 Ah
            if (!hasPayload(1)) break;
            result = { type: 'capacityAh', value: (buffer[4] / 10).toFixed(1) };
            break;
        case WRITE_COMMANDS.SET_PAS: // 0x89 write ack, echoes requested level
            if (!hasPayload(1)) break;
            result = { type: 'pasAck', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.TEMP: // 0x60 signed BE16 /10 C
            if (!hasPayload(2)) break;
            result = { type: 'temp', value: (sbe16(buffer) / 10).toFixed(1) };
            break;
        case BAFANG_COMMANDS.VOLTAGE:
            if (!hasPayload(2)) break;
            result = { type: 'voltage', value: (((buffer[4] << 8) | buffer[5]) / 1000).toFixed(1) };
            break;
        case BAFANG_COMMANDS.CURRENT:
            // Measured directly in milliamperes (mA)
            if (!hasPayload(2)) break;
            result = { type: 'current', value: (buffer[4] << 8) | buffer[5] };
            break;
        case BAFANG_COMMANDS.BMS_REL_PCT:
            // 1-byte value for secondary highly accurate battery %
            if (!hasPayload(1)) break;
            result = { type: 'bmsRelPct', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.BATTERY:
            if (!hasPayload(1)) break;
            result = { type: 'battery', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.BMS_REMAIN_MAH:
            // 2-byte value for exact remaining capacity (mAh)
            if (!hasPayload(2)) break;
            result = { type: 'bmsRemainMah', value: (buffer[4] << 8) | buffer[5] };
            break;
        case BAFANG_COMMANDS.BMS_FULL_MAH:
            // 2-byte value for total battery health capacity (mAh)
            if (!hasPayload(2)) break;
            result = { type: 'bmsFullMah', value: (buffer[4] << 8) | buffer[5] };
            break;
        case BAFANG_COMMANDS.BMS_CYCLE:
            if (!hasPayload(2)) break;
            result = { type: 'bmsCycle', value: be16(buffer) };
            break;
        case BAFANG_COMMANDS.BMS_CHG_CUR_MIN:
            if (!hasPayload(3)) break;
            result = { type: 'bmsChgCurMin', value: be24(buffer) };
            break;
        case BAFANG_COMMANDS.BMS_CHG_MAX_MIN:
            if (!hasPayload(3)) break;
            result = { type: 'bmsChgMaxMin', value: be24(buffer) };
            break;
        case BAFANG_COMMANDS.BMS_NOW_PCT:
            if (!hasPayload(1)) break;
            result = { type: 'bmsNowPct', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.CALORIES: // 0x70 BE16 Kcal
            if (!hasPayload(2)) break;
            result = { type: 'calories', value: be16(buffer) };
            break;
        case BAFANG_COMMANDS.RANGE:
            if (!hasPayload(2)) break;
            result = { type: 'range', value: Math.round(be16(buffer) / 10) };
            break;
        case BAFANG_COMMANDS.PAS_NUM: // 0x72 max PAS levels
            if (!hasPayload(1)) break;
            result = { type: 'pasNum', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.CURRENT_LIMIT: // 0x82 1 byte A
            if (!hasPayload(1)) break;
            result = { type: 'currentLimit', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.SPEED_LIMIT: // 0x87 1 byte km/h
            if (!hasPayload(1)) break;
            result = { type: 'speedLimit', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.WHEEL_DIAMETER: // 0x8B BE16 /10 inch
            if (!hasPayload(2)) break;
            result = { type: 'wheelDiameter', value: (be16(buffer) / 10).toFixed(1) };
            break;
        case BAFANG_COMMANDS.LIGHT_ACK: // 0xA3 write ack
            if (!hasPayload(1)) break;
            result = { type: 'lightAck', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.DEVICE_NAME: // 0xA2 rename ack (echoes name string)
            if (!hasPayload(1)) break;
            result = { type: 'nameAck', value: asciiStr(buffer, 4) };
            break;
        case BAFANG_COMMANDS.SENSOR_MODEL: // 0xD1 hex string
            if (!hasPayload(1)) break;
            result = { type: 'sensorModel', value: hexStr(buffer, 4) };
            break;
        case BAFANG_COMMANDS.TORQUE: // 0xD2 BE16 torque signal
            if (!hasPayload(2)) break;
            result = { type: 'torque', value: be16(buffer) };
            break;
        case BAFANG_COMMANDS.TWIST: // 0xD3 BE16 twist/throttle
            if (!hasPayload(2)) break;
            result = { type: 'twist', value: be16(buffer) };
            break;
        case BAFANG_COMMANDS.HEART_RATE: // 0xD4 1 byte bpm
            if (!hasPayload(1)) break;
            result = { type: 'heartRate', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.PIN_STATUS: // 0xD5 0=UNSET 1=UNAUTH 2=AUTH
            if (!hasPayload(1)) break;
            result = { type: 'pinStatus', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.PIN_ACK: // 0xD6 PIN op ack
            if (!hasPayload(1)) break;
            result = { type: 'pinAck', value: buffer[4] };
            break;
        default:
            if (ACK_COMMANDS.has(cmdId) && len === 1) {
                result = { type: 'writeAck', value: buffer[4], cmd: cmdId };
            } else {
                result = { type: null, value: null, cmd: cmdId, raw: rawHex(buffer) };
            }
            break;
    }
    return result;
}

// --- Long-frame reassembly (bike -> phone, receive side) ---
// Mirrors SwiftFlow PlBleService.process_uart_pdu long path byte-for-byte:
//   start:     AB 01 CMD LEN_HI LEN_LO
//   chunks:    SN + up to 19 payload bytes (SN starts at 0x02, +1 per chunk)
//   terminator: CHK AA 55  (CHK = sum(payload bytes) % 256)
// Short 02..03 frames take priority (checked first, as in SwiftFlow); only
// frames that fail short validation reach feedLongFrame(). The bike uses this
// envelope for payloads that don't fit the short form - on this hardware the
// 0x0B basic-info string (~150B) and the 0xD1 sensor-model reply. Dropping
// these chunks is why the About cards stayed empty.
const LONG_START_0 = 0xAB;
const LONG_START_1 = 0x01;
const LONG_TERM_1 = 0xAA;
const LONG_TERM_2 = 0x55;
const LONG_MAX_PAYLOAD = 512;

const longFrameState = {
    active: false,
    cmd: 0,
    expectedSn: 0x02,
    totalLen: 0,
    payload: [],
};

export function resetLongFrame() {
    longFrameState.active = false;
    longFrameState.cmd = 0;
    longFrameState.expectedSn = 0x02;
    longFrameState.totalLen = 0;
    longFrameState.payload = [];
}

function longPayloadToText(payload) {
    try {
        return new TextDecoder().decode(new Uint8Array(payload));
    } catch (e) {
        return payload.map((b) => String.fromCharCode(b)).join('');
    }
}

function longPayloadToHex(payload) {
    return payload.map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

// Start-of-long-frame probe: returns the CMD of an `AB 01 CMD HI LO`
// frame, or null when the buffer is not a long-frame start. Lets the app
// decide (e.g. from UI selection) whether the sequence is wanted before
// feeding anything to the reassembler.
export function longStartCmd(buffer) {
    if (!buffer || buffer.length < 5) return null;
    if (buffer[0] !== LONG_START_0 || buffer[1] !== LONG_START_1) return null;
    return buffer[2] & 0xFF;
}

// Long-frame terminator probe (`CHK AA 55`).
export function isLongTerminator(buffer) {
    return !!buffer && buffer.length === 3
        && buffer[1] === LONG_TERM_1 && buffer[2] === LONG_TERM_2;
}

// Feed one BLE notification that failed short-frame validation.
// Returns { handled, decoded }: handled=true means the bytes belong to the
// long-frame envelope (start/chunk/terminator) and should NOT be logged as
// a corrupt drop. decoded is set only on a checksum-valid terminator.
export function feedLongFrame(buffer) {
    if (!buffer || buffer.length === 0) return { handled: false, decoded: null };
    const bytes = [...buffer];

    // Start-of-frame: AB 01 CMD LEN_HI LEN_LO (restarts any in-progress frame,
    // matching SwiftFlow which just overwrites data_cmd/data_sn/data_offset).
    if (bytes.length >= 5 && bytes[0] === LONG_START_0 && bytes[1] === LONG_START_1) {
        longFrameState.active = true;
        longFrameState.cmd = bytes[2] & 0xFF;
        longFrameState.totalLen = ((bytes[3] & 0xFF) << 8) | (bytes[4] & 0xFF);
        longFrameState.expectedSn = 0x02;
        longFrameState.payload = [];
        return { handled: true, decoded: null };
    }

    if (!longFrameState.active) return { handled: false, decoded: null };

    // Terminator: CHK AA 55.
    if (bytes.length === 3 && bytes[1] === LONG_TERM_1 && bytes[2] === LONG_TERM_2) {
        let sum = 0;
        for (const b of longFrameState.payload) sum = (sum + b) % 256;
        const cmd = longFrameState.cmd;
        const payload = longFrameState.payload;
        resetLongFrame();
        if (sum !== (bytes[0] & 0xFF)) return { handled: true, decoded: null };
        if (cmd === BAFANG_COMMANDS.BASIC_INFO) {
            return {
                handled: true,
                decoded: { type: 'basicInfo', value: longPayloadToText(payload).trim(), cmd },
            };
        }
        if (cmd === BAFANG_COMMANDS.SENSOR_MODEL) {
            return {
                handled: true,
                decoded: { type: 'sensorModel', value: longPayloadToHex(payload), cmd },
            };
        }
        return {
            handled: true,
            decoded: { type: null, value: null, cmd, raw: longPayloadToHex(payload) },
        };
    }

    // Data chunk: SN + payload. Out-of-order chunks are ignored (kept waiting),
    // as in SwiftFlow - but report unhandled so they still surface in logs.
    if (bytes.length >= 2 && (bytes[0] & 0xFF) === longFrameState.expectedSn) {
        for (let i = 1; i < bytes.length && longFrameState.payload.length < LONG_MAX_PAYLOAD; i++) {
            longFrameState.payload.push(bytes[i] & 0xFF);
        }
        longFrameState.expectedSn = (longFrameState.expectedSn + 1) & 0xFF;
        return { handled: true, decoded: null };
    }

    return { handled: false, decoded: null };
}

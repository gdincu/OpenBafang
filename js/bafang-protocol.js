export const BAFANG_COMMANDS = {
    PAS: 0x89,      // 137 decimal (Write Control command ID for PAS)
    PAS_LEVEL: 0x4A, // 74 dec - PAS feedback telemetry (EBoxInfPASLevel).
                     // NOTE: DP E12 reports walk mode as level 15 here;
                     // the write code to engage walk is still unknown.
    PAS_NUM: 0x72,   // 114 dec - max PAS levels (EBoxInfPASnum, e.g. 4)
    ERROR_CODE: 0x09, // 9 dec - display/controller fault code (1 byte, 0 = OK)
    LIGHT: 0x40,     // 64 dec - headlight state notify (EBoxInfHeadLight)
    LIGHT_ACK: 0xA3, // 163 dec - headlight write ack (EBoxResHeadLight)
    SESSION: 0xA1,   // 161 dec - write-only session start(01)/stop(00), no notify
    SPEED: 0x44,     // 68 dec (EBoxInfSpeed, BE/10 km/h)
    ODO: 0x46,       // 70 dec (EBoxInfODO, 3-byte BE km)
    TRIP: 0x47,      // 71 dec (EBoxInfTrip, BE/10 km)
    RANGE: 0x71,     // 113 dec (EBoxInfremaindistance, BE/10 km)
    TEMP: 0x60,      // 96 dec (EBoxInfBMSTemperature, BE/10 C)
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
};

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
//   Phone write: 02 01 CMD 01 DATA CHK 03        (SEQ fixed 0x01)
//   Bike notify: 02 SEQ CMD LEN DATA.. CHK 03     (SEQ counts 00-FF)
//   CHK = sum(SEQ..DATA) % 256
export function buildWriteFrame(cmd, dataByte) {
    const chk = (0x01 + cmd + 0x01 + dataByte) % 256;
    const hex = (n) => n.toString(16).padStart(2, '0');
    return `02 01 ${hex(cmd)} 01 ${hex(dataByte)} ${hex(chk)} 03`;
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

export function getPasCommand(level) {
    const lvl = Number.isFinite(level) ? Math.max(0, Math.min(255, Math.round(level))) : 0;
    return buildWriteFrame(BAFANG_COMMANDS.PAS, lvl);
}

function be16(buffer) {
    return (buffer[4] << 8) | buffer[5];
}

function be24(buffer) {
    return (buffer[4] << 16) | (buffer[5] << 8) | buffer[6];
}

function rawHex(buffer) {
    return [...buffer].map((b) => b.toString(16).padStart(2, '0')).join(' ');
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
        case 0x4A: // 74 decimal (Feedback telemetry for PAS level)
            if (!hasPayload(1)) break;
            result = { type: 'pas', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.PAS: // 0x89 write ack, echoes requested level
            if (!hasPayload(1)) break;
            result = { type: 'pasAck', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.LIGHT_ACK: // 0xA3 write ack
            if (!hasPayload(1)) break;
            result = { type: 'lightAck', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.PAS_NUM: // 0x72 max PAS levels
            if (!hasPayload(1)) break;
            result = { type: 'pasNum', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.LIGHT:
            if (!hasPayload(1)) break;
            result = { type: 'light', value: buffer[4] === 0x01 ? "ON" : "OFF" };
            break;
        case BAFANG_COMMANDS.BATTERY:
            if (!hasPayload(1)) break;
            result = { type: 'battery', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.SPEED:
            if (!hasPayload(2)) break;
            result = { type: 'speed', value: Math.round(((buffer[4] << 8) | buffer[5]) / 10) };
            break;
        case BAFANG_COMMANDS.TRIP:
            if (!hasPayload(2)) break;
            result = { type: 'trip', value: (((buffer[4] << 8) | buffer[5]) / 10).toFixed(1) };
            break;
        case BAFANG_COMMANDS.RANGE:
            if (!hasPayload(2)) break;
            result = { type: 'range', value: Math.round(be16(buffer) / 10) };
            break;
        case BAFANG_COMMANDS.VOLTAGE:
            if (!hasPayload(2)) break;
            result = { type: 'voltage', value: (((buffer[4] << 8) | buffer[5]) / 1000).toFixed(1) };
            break;
        case BAFANG_COMMANDS.TEMP:
            if (!hasPayload(2)) break;
            result = { type: 'temp', value: (((buffer[4] << 8) | buffer[5]) / 10).toFixed(1) };
            break;
        case BAFANG_COMMANDS.ODO:
            if (!hasPayload(3)) break;
            result = { type: 'odo', value: (buffer[4] << 16) | (buffer[5] << 8) | buffer[6] };
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
        default:
            result = { type: null, value: null, cmd: cmdId, raw: rawHex(buffer) };
            break;
    }
    return result;
}

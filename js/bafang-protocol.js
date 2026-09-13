export const BAFANG_COMMANDS = {
    PAS: 0x89,      // 137 decimal (Write Control command ID for PAS)
    PAS_LEVEL: 0x4A, // 74 dec - PAS feedback telemetry (EBoxInfPASLevel).
                     // NOTE: DP E12 reports walk mode as level 15 here;
                     // the write code to engage walk is still unknown.
    PAS_NUM: 0x72,   // 114 dec - max PAS levels (EBoxInfPASnum, e.g. 4)
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
    if (buffer.length < 6 || buffer[0] !== 0x02 || buffer[buffer.length - 1] !== 0x03) return false;
    let sum = 0;
    for (let i = 1; i < buffer.length - 2; i++) sum = (sum + buffer[i]) % 256;
    return sum === buffer[buffer.length - 2];
}

// '02 01 89 01 05 90 03'  // 5
const PAS_COMMANDS = [
    '02 01 89 01 00 8B 03', // 0
    '02 01 89 01 01 8C 03', // 1
    '02 01 89 01 02 8D 03', // 2
    '02 01 89 01 03 8E 03', // 3
    '02 01 89 01 04 8F 03' // 4
];

// Single source of truth for PAS frames is PAS_COMMANDS + getPasCommand()
// (a duplicate PAS table here drifted out of sync before - only 0 and 4).
export const COMMAND_PAYLOADS = {
    HEADLIGHT_ON: '02 01 A3 01 01 A6 03',
    HEADLIGHT_OFF: '02 01 A3 01 00 A5 03'
};

export function getPasCommand(level) {
    const lvl = Math.max(0, Math.min(PAS_COMMANDS.length - 1, level));
    return PAS_COMMANDS[lvl];
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
    const cmdId = buffer[2];
    let result = { type: null, value: null };

    switch (cmdId) {
        case 0x4A: // 74 decimal (Feedback telemetry for PAS level)
            result = { type: 'pas', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.PAS: // 0x89 write ack, echoes requested level
            result = { type: 'pasAck', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.LIGHT_ACK: // 0xA3 write ack
            result = { type: 'lightAck', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.PAS_NUM: // 0x72 max PAS levels
            result = { type: 'pasNum', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.LIGHT:
            result = { type: 'light', value: buffer[4] === 0x01 ? "ON" : "OFF" };
            break;
        case BAFANG_COMMANDS.BATTERY:
            result = { type: 'battery', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.SPEED:
            result = { type: 'speed', value: Math.round(((buffer[4] << 8) | buffer[5]) / 10) };
            break;
        case BAFANG_COMMANDS.TRIP:
            result = { type: 'trip', value: (((buffer[4] << 8) | buffer[5]) / 10).toFixed(1) };
            break;
        case BAFANG_COMMANDS.RANGE:
            result = { type: 'range', value: Math.round(be16(buffer)) };
            break;
        case BAFANG_COMMANDS.VOLTAGE:
            result = { type: 'voltage', value: (((buffer[4] << 8) | buffer[5]) / 1000).toFixed(1) };
            break;
        case BAFANG_COMMANDS.TEMP:
            result = { type: 'temp', value: (((buffer[4] << 8) | buffer[5]) / 10).toFixed(1) };
            break;
        case BAFANG_COMMANDS.ODO:
            result = { type: 'odo', value: (buffer[4] << 16) | (buffer[5] << 8) | buffer[6] };
            break;
        case BAFANG_COMMANDS.CURRENT:
            // Measured directly in milliamperes (mA)
            result = { type: 'current', value: (buffer[4] << 8) | buffer[5] };
            break;
        case BAFANG_COMMANDS.BMS_REL_PCT:
            // 1-byte value for secondary highly accurate battery %
            result = { type: 'bmsRelPct', value: buffer[4] };
            break;
        case BAFANG_COMMANDS.BMS_REMAIN_MAH:
            // 2-byte value for exact remaining capacity (mAh)
            result = { type: 'bmsRemainMah', value: (buffer[4] << 8) | buffer[5] };
            break;
        case BAFANG_COMMANDS.BMS_FULL_MAH:
            // 2-byte value for total battery health capacity (mAh)
            result = { type: 'bmsFullMah', value: (buffer[4] << 8) | buffer[5] };
            break;
        case BAFANG_COMMANDS.BMS_CYCLE:
            result = { type: 'bmsCycle', value: be16(buffer) };
            break;
        case BAFANG_COMMANDS.BMS_CHG_CUR_MIN:
            result = { type: 'bmsChgCurMin', value: be24(buffer) };
            break;
        case BAFANG_COMMANDS.BMS_CHG_MAX_MIN:
            result = { type: 'bmsChgMaxMin', value: be24(buffer) };
            break;
        case BAFANG_COMMANDS.BMS_NOW_PCT:
            result = { type: 'bmsNowPct', value: buffer[4] };
            break;
        default:
            result = { type: null, value: null, cmd: cmdId, raw: rawHex(buffer) };
            break;
    }
    return result;
}

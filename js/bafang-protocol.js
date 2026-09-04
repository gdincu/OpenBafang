export const BAFANG_COMMANDS = {
    PAS: 0x89,      // 137 decimal (Write Control command ID for PAS)
    LIGHT: 0x40,
    SPEED: 0x44,
	ODO: 0x46,
    TRIP: 0x47,
    RANGE: 0x71,
    TEMP: 0x60,
	VOLTAGE: 0x61,
	CURRENT: 0x62,     // 98 dec (mA)
	BMS_REL_PCT: 0x63, // 99 dec
	BATTERY: 0x64,     // General Battery %
	BMS_REMAIN_MAH: 0x65, // 101 dec
    BMS_FULL_MAH: 0x66   // 102 dec
};

// '02 01 89 01 05 90 03'  // 5
const PAS_COMMANDS = [
    '02 01 89 01 00 8B 03', // 0
    '02 01 89 01 01 8C 03', // 1
    '02 01 89 01 02 8D 03', // 2
    '02 01 89 01 03 8E 03', // 3
    '02 01 89 01 04 8F 03' // 4
];

export const COMMAND_PAYLOADS = {
    PAS: {
        0: '02 01 89 01 00 8B 03',
        4: '02 01 89 01 04 8F 03'
    },
    HEADLIGHT_ON: '02 01 A3 01 01 A6 03',
    HEADLIGHT_OFF: '02 01 A3 01 00 A5 03'
};

export function getPasCommand(level) {
    const lvl = Math.max(0, Math.min(PAS_COMMANDS.length - 1, level));
    return PAS_COMMANDS[lvl];
}

export function decodeBafangPacket(buffer) {
    const cmdId = buffer[2];
    let result = { type: null, value: null };

    switch (cmdId) {
        case 0x4A: // 74 decimal (Feedback telemetry for PAS level)
            result = { type: 'pas', value: buffer[4] };
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
            result = { type: 'range', value: (buffer[4] << 8) | buffer[5] };
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
    }
    return result;
}
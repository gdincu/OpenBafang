export const BAFANG_COMMANDS = {
    PAS: 0x89,      // 137 decimal (Write Control command ID for PAS)
    LIGHT: 0x40,
    SPEED: 0x44,
	ODO: 0x46,
    TRIP: 0x47,
    RANGE: 0x71,
	CADENCE: 0xD2,
    TORQUE: 0xD3,
    TEMP: 0x60,
	VOLTAGE: 0x61,
	CURRENT: 0x62,     // 98 dec (mA)
	BMS_REL_PCT: 0x63, // 99 dec
	BATTERY: 0x64,     // General Battery %
	BMS_REMAIN_MAH: 0x65, // 101 dec
    BMS_FULL_MAH: 0x66,   // 102 dec
    BMS_CYCLES: 0x67,     // 103 dec
	MAX_PAS_LEVELS: 0x72  // 114 dec
};

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
        case BAFANG_COMMANDS.TORQUE:
            result = { type: 'torque', value: (buffer[4] << 8) | buffer[5] };
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
		case BAFANG_COMMANDS.CADENCE:
            result = { type: 'cadence', value: (buffer[4] << 8) | buffer[5] };
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
        case BAFANG_COMMANDS.BMS_CYCLES:
            // Adapt to different BMS firmware payload lengths (1 or 2 bytes)
            let cycleCount = 0;
            if (buffer[3] === 1) {
                cycleCount = buffer[4];
            } else if (buffer[3] >= 2) {
                cycleCount = (buffer[4] << 8) | buffer[5];
            }
            result = { type: 'bmsCycles', value: cycleCount };
            break;
        case BAFANG_COMMANDS.MAX_PAS_LEVELS:
            // 1-byte value defining the upper limit of the PAS configuration
            result = { type: 'maxPasLevels', value: buffer[4] };
            break;
    }
    return result;
}
export const BAFANG_COMMANDS = {
    PAS: 0x89,      // 137 decimal (Write Control command ID for PAS)
    LIGHT: 0x40,
    BATTERY: 0x64,
    SPEED: 0x44,
    TRIP: 0x47,
    RANGE: 0x71,
    TORQUE: 0xD3,
    VOLTAGE: 0x61,
    TEMP: 0x60,
    ODO: 0x46
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
            result = { type: 'speed', value: (((buffer[4] << 8) | buffer[5]) / 10).toFixed(1) };
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
    }
    return result;
}
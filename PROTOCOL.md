# OpenBafang — SwiftFlow BLE Protocol Notes

Reverse-engineered documentation of the Bluetooth Low Energy protocol used by
Bafang's BLE displays to talk to the **SwiftFlow** smartphone app
(package `cn.bafang.client`, by Bafang Electric (Suzhou), app version 2.3.3).

SwiftFlow is Bafang's *older-generation* app, paired with the UART-era hub
systems. The newer **Bafang Go** app targets the CAN-bus generation
(M500/M600, DP C24x/C25x etc.); the two apps/protocol families are related but
not identical. Bikes that pair with SwiftFlow are **not** supported by
Bafang Go.

Verified against:

| Component | Model |
|---|---|
| Motor | Bafang FM G311.250D (250 W rear hub) |
| Controller | CRS10D.350.FC1 |
| Display (HMI) | DP E12.CAN (label: DPE12CM10101.2) |
| App protocol | SwiftFlow (`cn.bafang.client` v2.3.3) over BLE (GATT service `FFF0`) |

**Primary source:** decompiled SwiftFlow APK —
`com.pairlink.lib.BafangCanConst` (command ID registry),
`com.pairlink.lib.PlBleService` (frame builder/parsers,
`gen_uart_cmd` / `process_uart_pdu` / `UartInfo.update_value`) and the React
Native bundle (`assets/index.android.bundle`, command call sites).
Everything in §2–§4 is read directly from that code; sections marked
*(observed)* were confirmed on the bike's BLE traffic as well.

To our knowledge no other public documentation of this command set exists.

---

## 1. BLE transport

| UUID | Role |
|---|---|
| `0000fff0-0000-1000-8000-00805f9b34fb` | GATT service (`UUID_UART_SERVICE`) |
| `0000fff3-0000-1000-8000-00805f9b34fb` | Write characteristic (`UUID_UART_WRITE`) |
| `0000fff4-0000-1000-8000-00805f9b34fb` | Notify characteristic (`UUID_UART_NOTIFY`) |

Frames written to `FFF3` are sent **plaintext** — SwiftFlow only applies its
`NativeHelper.bafangEncry` encryption on the separate CAN-node channel
(service characteristic `49d55e56-76b1-11e9-8f9e-2a86e4085a59`, used by
CAN-generation systems, not by this bike).

SwiftFlow matches devices by advertisement: UART-type Bafang BLE modules
advertise manufacturer data `F0 FF`, CAN-type systems use a 16-byte
manufacturer blob and MAC prefixes `F0:AC:D7` / `EC:C5:7F` are also treated
as Bafang. This app instead matches the `FFF0` service so bikes with a
missing/changed BLE name are still discoverable.

On connect SwiftFlow: subscribes to `FFF4` notifications, reads the device
name, then issues the version/base-info requests (§4) as needed. This app
additionally sends the BMS-info request (`0xA1`=1) right away — see §4.

---

## 2. Frame format

A single frame format is used in both directions (matches
`PlBleService.gen_uart_cmd` and `process_uart_pdu` byte-for-byte):

```
02 | SEQ | CMD | LEN | DATA[LEN] | CHK | 03
```

| Byte | Meaning |
|---|---|
| 0 | Start of frame, always `0x02` |
| 1 | Sequence number. Phone→bike writes always use `0x01`. Bike→phone notifications increment `0x00`–`0xFF` and wrap |
| 2 | Command ID |
| 3 | Payload length `LEN` (number of DATA bytes) |
| 4.. | Payload (see scaling table — mostly big-endian) |
| -2 | Checksum: `(SEQ + CMD + LEN + ΣDATA) mod 256` |
| -1 | End of frame, always `0x03` |

Total frame length is always `LEN + 6`. SwiftFlow's parser additionally
treats a 1-byte payload of `0x00` on `0xA2` (device name) as "no name set".

Write commands are acknowledged by the bike echoing the command ID with the
requested value (e.g. `0x89` → pas-level echo, `0xA3` → headlight echo).
The UI should optimistically update and then reconcile against the
ack/notify value.

### Long-frame escape (payloads > 7 bytes)

For larger payloads (used for OTA data and multi-byte info strings) SwiftFlow
switches to a chunked envelope (`gen_uart_long_cmd`):

```
AA 01 CMD LEN_HI LEN_LO          (start)
02 | 19 data bytes               (chunk, sequence number = chunk index from 02)
03 | <up to 19 data bytes>       (final chunk, sequence continues)
CHK AA 55                        (terminator; CHK = byte sum of all chunks)
```

> OpenBafang reassembles this envelope on receive (`feedLongFrame` in
> `js/bafang-protocol.js`, wired into `handleBikeData`): short `02 … 03`
> frames are validated first (as in SwiftFlow, so interleaved telemetry such
> as `0x44` never gets consumed as chunks); only failures reach the
> reassembler. Start restarts any in-progress frame, chunks append with the
> expected `SN` (`0x02`…), and `CHK AA 55` completes with
> `CHK = sum(payload) % 256`. `0x0B` completes as `basicInfo` (About cards),
> `0xD1` as `sensorModel`. The send side (`gen_uart_long_cmd`, OTA) is still
> not implemented — all frames this app sends use the short form.

---

## 3. Command registry (from `BafangCanConst`)

Names below are the decompiled identifiers. "Ack" = the bike echoes this ID
after the corresponding write.

### Notifications (bike → phone, on `FFF4`)

| CMD | Hex | Decompiled name | Len | Decoding (from `UartInfo.update_value`) |
|------|-----|-----------------|-----|------------------------------------------|
| 9 | `0x09` | `EBoxErrorCode` | 1 | 0 = OK (table in §6) |
| 11 | `0x0B` | *(basic information)* | n | ASCII `!`-separated: panel SW/HW/SN, controller SW/HW/SN, battery SW/HW/SN, sensor SW/HW/SN |
| 55 | `0x37` | `EBoxInfMotorStatus` | 1 | motor status flags |
| 64 | `0x40` | `EBoxInfHeadLight` | 1 | `0x01` = ON, `0x00` = OFF |
| 65 | `0x41` | `EBoxInfCurrent(A)` | 1 | value / 10 → A |
| 66 | `0x42` | `EBoxInfVoltage(V)` | 2 | BE / 10 → V |
| 67 | `0x43` | `EBoxInfBatteryCapacity` | 1 | % |
| 68 | `0x44` | `EBoxInfSpeed(km/hr)` | 2 | BE / 10 → km/h |
| 69 | `0x45` | `EBoxInfTemperature(C)` | 1 | °C |
| 70 | `0x46` | `EBoxInfOdo(km)` | 3 | BE → km |
| 71 | `0x47` | `EBoxInfTrip(km)` | 2 | BE / 10 → km |
| 72 | `0x48` | `EBoxInfMaxSpeed` | 2 | BE |
| 73 | `0x49` | `EBoxInfAverageSpeed` | 2 | BE |
| 74 | `0x4A` | `EBoxInfPASLevel` | 1 | assist level; **15 = walk on this bike** |
| 75 | `0x4B` | `EBoxInfCadence` | 2 | BE, rpm |
| 76 | `0x4C` | `EBoxInfMaintainMile` | ? | service mileage |
| 80 | `0x50` | `EBoxInfBatteryCapacity_AH` | 1 | value × 0.1 → Ah |
| 96 | `0x60` | `EBoxInfBMSTemperature(C)` | 2 | BE / 10 → °C (signed) |
| 97 | `0x61` | `EBoxInfBMSVoltage(mV)` | 2 | BE → mV |
| 98 | `0x62` | `EBoxInfBMSCurrent(mA)` | 2 | BE → mA |
| 99 | `0x63` | `EBoxInfBMSRelPercent` | 1 | % |
| 100 | `0x64` | `EBoxInfBMSAbsPercent` | 1 | % |
| 101 | `0x65` | `EBoxInfBMSRemainCapacity` | 2 | BE → mAh |
| 102 | `0x66` | `EBoxInfBMSFullCapacity` | 2 | BE → mAh |
| 103 | `0x67` | `EBoxInfBMSCycleCount` | 2 | BE |
| 104 | `0x68` | `EBoxInfBMSCurChaInterval` | 3 | BE → min |
| 105 | `0x69` | `EBoxInfBMSMaxChaInterval` | 3 | BE → min |
| 106 | `0x6A` | `EBoxInfBMSNowCapacity` | 1 | % |
| 112 | `0x70` | `EBoxInfCal(Kcal)` | 2 | BE |
| 113 | `0x71` | `EBoxInfremaindistance(km)` | 2 | BE (used as /10 → km by this app) |
| 114 | `0x72` | `EBoxInfPASnum` | 1 | max assist levels (3/4/5/9) |
| 130 | `0x82` | `EBoxResCurrentLimit(A)` | 1 | A |
| 135 | `0x87` | `EBoxResSpeedLimit(km/hr)` | 1 | km/h |
| 139 | `0x8B` | `EBoxResWheelDiameter(inch)` | 2 | BE / 10 → inch |
| 163 | `0xA3` | `EBoxResHeadLight` | 1 | headlight write ack |
| 209 | `0xD1` | `EBoxInfSensor_Model` | n | hex string |
| 210 | `0xD2` | `EBoxInfTorque` | 2 | BE |
| 211 | `0xD3` | `EBoxInfTwist` | 2 | BE (throttle) |
| 212 | `0xD4` | `EBoxInfHeartRate` | 1 | bpm |
| 214 | `0xD6` | `EBoxRes_SetPIN` | 1 | PIN ack |

*(IDs 162/213 also appear as write commands — see below. The `2`-suffixed
constants such as `EBoxInfBMSVoltage2 = 3937` are the CAN-node generation's
secondary-battery variants and are not used on the FFF3 path.)*

### Writes (phone → bike, on `FFF3`)

| CMD | Hex | Decompiled name | Payload | Notes |
|------|-----|-----------------|---------|-------|
| 137 | `0x89` | `APPSetPASLevel` / `EBoxResPASLevel` | 1 byte | assist level, ack echoes it. **Linear 0–N on this generation** |
| 161 | `0xA1` | `APPGetBMS_Info` | `0x01` / `0x00` | request (1) / stop (0) extended BMS info polling; no notify ack, but triggers `0x65`–`0x69` frames |
| 162 | `0xA2` | `APPSetDevice_Name` / `EBoxResDevice_Name` | string (≤24 bytes) | rename display |
| 163 | `0xA3` | `APPSetHeadLight` / `EBoxResHeadLight` | `0x01` / `0x00` | headlight |
| 164 | `0xA4` | `APPController_SetPIN` | 8 bytes | set PIN |
| 165 | `0xA5` | `APPController_AuthPIN` | 4 bytes | authenticate PIN |
| 166 | `0xA6` | `APPController_ResetPIN` | 8 bytes | reset PIN |
| 167 | `0xA7` | `APPNavigationData` | n | navigation data to HMI |
| 168 | `0xA8` | `APPSetBackLight` | 1 byte | backlight level |
| 171 | `0xAB` | `APPSetLightSens` | 1 byte | light sensitivity |
| 172 | `0xAC` | `APPSetMaintainMile` | 1 byte | maintenance mileage |
| 173 | `0xAD` | `APPSetAutoOff` | 1 byte | auto-off time; app sends `++t > 9 ? 0xFF : t` |
| 174 | `0xAE` | `APPSetSportMode` | 1 byte | sport = `PASNUM`, eco = `0x10 | PASNUM` (both sent on `0xAE`; see below) |
| 175 | `0xAF` | `APPSetECOMode` | 1 byte | registry entry only — SwiftFlow 2.3.3 never sends `0xAF`, both modes go on `0xAE` |
| 176 | `0xB0` | `APPController_PowerOnOff` | 1 byte | controller power on/off |
| 177 | `0xB1` | `APPSetAutoDrive` | 1 byte | auto-drive flag (app-side only in 2.3.3) |
| 213 | `0xD5` | `APPGet_Version` / `EBoxInfPINStatus` | `0x01` / `0x00` | PIN status request (1) / unset (0) |

Example payloads (checksums verified):

```
Assist level 5 : 02 01 89 01 05 90 03
BMS info start : 02 01 A1 01 01 A4 03
BMS info stop  : 02 01 A1 01 00 A3 03
Headlight on   : 02 01 A3 01 01 A6 03
Headlight off  : 02 01 A3 01 00 A5 03
PIN status req : 02 01 D5 01 01 D8 03
```

---

## 4. Connection sequence

As observed on this bike and consistent with SwiftFlow's flow:

1. Connect GATT, subscribe to notifications on `FFF4`.
2. Send **BMS info request** `0xA1` = 1 (SwiftFlow calls this when the app
   needs battery detail — cycle count etc. — and it is what unlocks the
   `0x65`–`0x69` extended BMS frames).
3. Send **PIN status request** `0xD5` = 1 (observed byte-identical in
   SwiftFlow's HCI capture on this bike; response on `0xD5`: 0=UNSET,
   1=UNAUTH, 2=AUTH).
4. Read the standard GATT Device Information Service (`0x180A`, see §7)
   for the BLE-module firmware revision. The CAN-node channel (§5) is not
   probed: UART-type hardware never answers it, and the About data now
   comes from the `0x0B` long-frame instead.
5. On disconnect, send `0xA1` = 0 (stop) — best effort.

Not yet replicated from SwiftFlow's flow:

* PIN authentication (`0xA5`) — required by some systems before writes.

---

## 5. The CAN-node channel (controller/battery/sensor version queries)

> OpenBafang does not probe this channel: UART-type hardware (DP E12)
> never answers, and the About cards are fed by the `0x0B` long-frame
> instead. Documented here for reference since SwiftFlow implements both
> stacks.

SwiftFlow contains two complete protocol stacks:

* **FFF3/FFF4 "EBox/UART-style" tunnel** (this document) — plaintext
  `02 … 03` frames; used by hub systems like this bike.
* **CAN-node channel** — service `49d554a6-76b1-11e9-8f9e-2a86e4085a59`,
  with write `49d5571c-…` (TRANSMIT_TX), notify `49d5571d-…`
  (TRANSMIT_RX), plus control `49d55e56-…` and OTA `49d55ce4-…`
  characteristics. The BLE module (device id `0x13`) acts as the CAN-bus
  hub; frames use BESST-style addressing:
  `[source, (target<<3)|opt, codeHi, codeLo, len, data…]`.

**Encryption depends on the module firmware** (read from GATT `0x2A28`,
PlBleService.java:597-615): firmware ≤ 1.7 → plaintext data channel
(`can_channel_encry = 0`); firmware > 1.7 → dynamic-key encryption
implemented in SwiftFlow's native library (`libnative-lib.so`), which is
*not* required for this bike (module FW 1.2).

### Version queries (plaintext)

SwiftFlow's node-info flow (this is what populates the About screens on
CAN-node bikes): request each of the 14 registry fields below. On
UART-type hardware such as the DP E12 this probe answers nothing:

```
Request  : 13 | (node<<3)|01 | 60 | sub | 00
Response : node | (13<<3)|opt | 60 | sub/pkt | len | data…
ACK      : 13 | (node<<3)|02 | 60 | sub | 00     (after every chunk)
```

* `opt` 4 = start of long frame (byte5 = total string length), 5 = data
  chunk, 6 = final chunk. Chunks carry a packet index in byte 3 and up to
  8 UTF-8 data bytes each (packet 0–6, max 56-byte strings).
* Nodes: 1 = sensor, 2 = controller, 3 = HMI, 4 = battery.
* Registry `0x6000 + sub`: 0 = hardware version, 1 = software version,
  2 = model (battery only), 3 = serial number.
* Response frames echo `[node | (0x13<<3)|opt | 60 | …]`; the app must ACK
  each with opt `0x02` or the node resends.

This channel also carries live telemetry frames (registry codes like
`0x3201` speed, `0x6300` HMI state) matching the
[OpenSourceEBike/Bafang_M500_M600](https://github.com/OpenSourceEBike/Bafang_M500_M600)
documentation; those frames are ignored here since the FFF4 tunnel already
provides telemetry.

On CAN-node systems the assist levels are encoded non-linearly
(`PAS_NUM_3/4/5/9` tables in `PlBleService`, e.g. 4 levels =
`{6, 0, 1, 12, 21, 3}` where index 0 = walk). On the FFF3 path used by this
bike, levels are written linearly and walk is *reported* as 15 on `0x4A`.

---

## 6. Error codes (CMD `0x09`)

Source: DP E12.CAN user manual (BF-UM-C-DP E12-EN), section 7.7; the same
table appears across Bafang display manuals.

| Code | Meaning | Code | Meaning |
|-----|-----------------------------|-----|--------------------------------|
| 0 | OK | 30 | Communication problem |
| 4 | Throttle not in position | 33 | Brake signal |
| 5 | Throttle fault | 35 | 15V detection circuit |
| 7 | Overvoltage protection | 36 | Keypad detection circuit |
| 8 | Motor hall sensor | 37 | WDT circuit |
| 9 | Motor phase winding | 41 | Battery voltage too high |
| 10 | Motor over-temperature | 42 | Battery voltage too low |
| 11 | Motor temp sensor | 43 | Battery cell power too high |
| 12 | Controller current sensor | 44 | Cell voltage too high |
| 13 | Battery temp sensor | 45 | Battery temperature too high |
| 14 | Controller over-temperature | 46 | Battery temperature too low |
| 15 | Controller temp sensor | 47 | Battery SOC too high |
| 21 | Speed sensor | 48 | Battery SOC too low |
| 25 | Torque signal | 61 | Switching detection defect |
| 26 | Torque sensor speed signal | 62 | Electronic derailleur jammed |
| 27 | Controller over-current | 71 | Electronic lock jammed |
| | | 81 | Bluetooth module error |

---

## 7. Open questions

* **Walk assist engage** — SwiftFlow itself has no walk-engage write for this
  generation (its level +/- logic is purely linear via `0x89`); walk is
  engaged from the display keypad (per the DP E12 manual: long-press DOWN) and
  merely *reported* on `0x4A` as 15. It likely cannot be triggered over BLE at
  all on this hardware.
* **Untested write commands** — device rename, PIN, auto-off, sport/ECO,
  backlight etc. are implemented in SwiftFlow and now exposed by this app
  (Device Settings card), but payloads beyond the single-byte settings
  (PIN strings, navigation) are derived from code only and have not been
  exercised on hardware.
* **Exact meaning of `0x37` motor status bits** and the scale of `0x48`/`0x49`
  (max/average speed) and `0x4C` are not decoded by SwiftFlow either; this app
  applies `/10` inferred from the speed frames — verify against live values.
* **Which frames this hardware actually broadcasts** — per a full ride log
  captured with the BafangCANTester (2026-09-20), the DP E12/CRS10D combo
  broadcasts: `0x09, 0x40, 0x44, 0x46, 0x47, 0x4A, 0x60, 0x61, 0x62, 0x63,
  0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x71, 0x72` (+ acks `0x89`,
  `0xA3`). `0x4B/0x70/0xD2/D3` appear in the stream but carry zero on this
  hardware, and the remaining SwiftFlow IDs (`0x0B, 0x37, 0x41, 0x42, 0x43,
  0x45, 0x48, 0x49, 0x50, 0x82, 0x87, 0x8B, 0xD1, 0xD4`) were never observed —
  they belong to other bike generations sharing the app. No additional
  "session/query" unlock was found beyond `0xA1`=1: SwiftFlow's JS layer
  never calls `APPGet_Version` on the FFF3 path, so unsupported tiles simply
  stay empty on this bike.
* **`0x72` max-PAS write is ignored by this hardware** (tested 2026-09-20 on
  DP E12/CRS10D): writing `3`/`5`/`9` produces no ack change and the `0x72`
  notify stays at 4 — the level count on this generation is fixed by the
  display/controller configuration and cannot be changed over BLE, even
  though SwiftFlow exposes the option (it serves other generations). The
  app-side clamp to the bike's reported max is correct behaviour.
* **About-screen data (controller/HMI/battery/sensor versions)** comes from
  the `0x0B` basic-information long-frame and from the CAN-node registry
  reads. The CAN-node queries don't apply to UART-type hardware (no answers,
  fast-fail skips them). `0x0B` arrives as a repeated `AB 01 0B … CHK AA 55`
  long-frame (≈150 B payload, e.g. `DPE12CM10101.2!DP E12.C 1.0!…`) and is now
  reassembled into the HMI/controller/battery cards; the sensor `S/N` fields
  arrive empty on this bike. (SwiftFlow's About screens were user-reported
  all-zero on 2026-09-20 — its HCI capture showed no `0x0B` in that session —
  but OpenBafang sessions observe the bike spamming it continuously.)
  OpenBafang also reads the
  standard GATT Device Information Service (`0x180A`, characteristic
  `0x2A28` Firmware Revision String, plus the optional `0x2A26/27/29/24/25`
  strings) at connect, mirroring SwiftFlow's connect-time read
  (PlBleService.java:1923).
* **HCI snoop capture of a full SwiftFlow session** (2026-09-20, 7,101 ATT
  PDUs) settles the question definitively: SwiftFlow's writes on this bike
  are exactly `0xA1`=1/0 (BMS info start/stop), `0x89` (PAS), `0xA3`
  (headlight) and `0xD5`=1 (PIN status request) — no other commands. Its
  notification stream contains only the known CMD set (plus `0x50`, which
  broadcasts ~13× more often than the rest) and **no** `0x0B` basic-info
  frame. The bike's GATT table also contains a second service `FFE0`
  (write `FFE3` / notify `FFE4`) that SwiftFlow never touches. Conclusion:
  controller/battery/sensor versions are not retrievable over BLE on this
  firmware; the About screens render that empty state as zeros.
* Remaining unknown notification IDs (frames are logged with raw hex by the
  decoder when unmatched).

## 8. Method & sources

* Decompiled sources in `E:\repos\SwiftFlow` (jadx output):
  * `app/src/main/java/com/pairlink/lib/BafangCanConst.java` — full command
    ID registry (the `EBoxInf*` names used throughout this project).
  * `app/src/main/java/com/pairlink/lib/PlBleService.java` — frame
    construction (`gen_uart_cmd`, `process_uart_cmd`), parsing
    (`process_uart_pdu`, `UartInfo.update_value`), scaling, long-frame
    envelope, PAS_NUM tables.
  * `app/src/main/java/cn/bafang/client/api/PlBleApi.java` — the
    `processCanCmd` dispatch between the two stacks.
  * `app/src/main/assets/index.android.bundle` — app-level behaviour
    (when each command is sent, sport/eco encoding, auto-off clamping).
* Runtime verification: unmatched frames are logged with raw hex by this
  app's decoder (`decodeBafangPacket`).
* Community context for the CAN-node generation: Bafang_M500_M600,
  besst-reference, OpenBafangTool (see §5).

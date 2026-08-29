# OpenBafang

A lightweight, mobile-friendly **Progressive Web App (PWA)** built to connect directly to Bafang e-bike CAN-bus controllers (such as the DP E12.CAN display) via Bluetooth Low Energy (BLE). 
<br><br>It logs high-precision telemetry, tracks your ride using device GPS (with smart distance filtering), and allows you to export clean CSV and GPX logs.

<img width="303.75" height="675" alt="input1" src="https://github.com/user-attachments/assets/f09fa5a9-f5ad-47dc-92b4-13fb27df2283" />
<img width="303.75" height="675" alt="input2" src="https://github.com/user-attachments/assets/979da274-7a48-4e61-9b48-26e9b93c827c" />

## Features

* **Real-Time Telemetry:** Live monitoring for Speed, Battery %, PAS Level, Voltage, Est. Range, Trip Distance, Odometer, Torque, Battery Temp, and Headlight state.
* **Smart GPS Logging:** Automatically captures Latitude, Longitude, and Altitude with a built-in distance filter (ignoring stationary GPS drift) and a clean "OK/Searching" status indicator.
* **Configurable Metrics:** Choose which metrics to log and display before connecting to the bike.
* **Optional Raw Hex Stream:** Toggleable logging to capture raw Bluetooth hex packets for debugging.
* **PWA & Offline Support:** Installable directly to your home screen on mobile or desktop, with full offline caching via a Service Worker.
* **Screen Wake Lock:** Keeps your phone screen awake automatically while connected and riding.

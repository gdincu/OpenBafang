# OpenBafang

A lightweight, mobile-friendly **Progressive Web App (PWA)** built to connect directly to Bafang e-bike CAN-bus controllers (such as the DP E12.CAN display) via Bluetooth Low Energy (BLE). 
<br><br>It logs high-precision telemetry, tracks your ride using device GPS (with smart distance filtering), and allows you to export clean CSV logs.

## Features

* **Real-Time Telemetry:** Live monitoring for Speed, Battery %, PAS Level, Voltage, Est. Range, Trip Distance, Odometer, Torque, Battery Temp, and Headlight state.
* **Smart GPS Logging:** Automatically captures Latitude, Longitude, and Altitude with a built-in distance filter (ignoring stationary GPS drift) and a clean "OK/Searching" status indicator.
* **Configurable Metrics:** Choose which metrics to log and display before connecting to the bike.
* **Optional Raw Hex Stream:** Toggleable logging to capture raw Bluetooth hex packets for debugging.
* **PWA & Offline Support:** Installable directly to your home screen on mobile or desktop, with full offline caching via a Service Worker.
* **Screen Wake Lock:** Keeps your phone screen awake automatically while connected and riding.

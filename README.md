# OpenBafang

A lightweight, mobile-friendly **Progressive Web App (PWA)** built to connect directly to Bafang e-bike CAN-bus controllers (such as the DP E12.CAN display) via Web Bluetooth. 
<br><br>It logs high-precision telemetry, tracks your ride using device GPS (with smart distance filtering), and allows you to export clean CSV and GPX logs.

<img width="303.75" height="675" alt="input1" src="https://github.com/user-attachments/assets/f09fa5a9-f5ad-47dc-92b4-13fb27df2283" />
<img width="303.75" height="675" alt="input2" src="https://github.com/user-attachments/assets/979da274-7a48-4e61-9b48-26e9b93c827c" />

## Features

*   **Web Bluetooth Integration:** Connects wirelessly to your bike's display to pull live hardware data.
*   **Rich Telemetry Logging:** Tracks and records Speed, Battery %, Voltage, Current (mA), PAS Level, Temperature, Odometer, and exact BMS capacity metrics.
*   **100% Client-Side & Offline:** No backend, no accounts. Installs directly to your home screen (PWA) and works completely offline once cached.
*   **Dynamic Kalman Filtering:** Applies a 1D Kalman filter to smooth out GPS jitter at slow speeds, but automatically bypasses the filter at speeds >12 km/h to accurately hug road curves while cycling.
*   **Dual Zero-Movement Drift Prevention:** Checks both the GPS Doppler speed and the bike's motor speed to completely freeze coordinate logging when you are standing still (< 1.5 km/h), preventing "spiderwebbing" at traffic lights.
*   **Extreme Battery Optimization:** 
    *   Batches `localStorage` saves to minimize CPU usage.
    *   Pauses visual DOM updates when the screen is locked.
    *   Built-in **OLED Lock Screen** turns off most screen pixels to save power while keeping the browser active, displaying only your live Speed and Battery %.
*   **Dual Data Export:** Automatically generates both a `.csv` file for raw data analysis and a `.gpx` file with custom `<extensions>` for mapping your route alongside battery and speed data.

## How to Use

1. Open the app in your browser / install it to your home screen
2. (Optional) Under **Configure Log & Display Metrics**, check the boxes for the telemetry data you wish to track (e.g., Voltage, Current, Temp)
3. Turn on your e-bike, then tap **Connect to Bike** and select your DP E12.CAN display from the Bluetooth pairing menu
4. (Optional) Tap **Lock Screen** before putting the phone in your pocket to save battery. Slide to unlock when you take it out
5. When your ride is finished, tap **Disconnect**
6. Tap **Export CSV Log** to generate and download your `.csv` and `.gpx` files

## Important Note on Background Tracking

Because this is a web application, mobile operating systems (iOS and Android) will aggressively suspend the tracking script and drop the Bluetooth connection if you manually lock your phone with the physical power button or switch to another app. 

**To ensure continuous, battery-friendly tracking:**
*   **Do not press your phone's physical power button.** 
*   Instead, tap the in-app **Lock Screen** button at the bottom of the page. 
*   This triggers the built-in Wake Lock API to prevent the phone from sleeping, while covering the screen in pure black to turn off OLED pixels and freeze UI repaints. You can then safely place the phone in a mount or in your pocket. 

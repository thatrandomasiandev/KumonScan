# KumonScan SMS Gateway (Android)

Android app that turns a dedicated phone into the SMS gateway for KumonScan. A foreground service polls the backend every 15 seconds, sends each queued message via `SmsManager`, and acknowledges the result. Credentials are stored in EncryptedSharedPreferences (AES256-GCM master key).

## Setup

1. Open the `gateway-app/` folder in Android Studio. The IDE generates the Gradle wrapper on first sync (none is committed). Requires AGP 8.5.2, Kotlin 1.9.24, JDK 17.
2. Build and install on the dedicated gateway phone: `Run > Run 'app'` with the phone connected over USB, or `Build > Generate APK` and sideload.
3. Launch the app and grant the SMS permission (and notification permission on Android 13+) when prompted by the Start button.
4. Enter the server URL (for example `https://kumonscan.vercel.app`) and the gateway API key, then tap Save. The key must match the server's `GATEWAY_API_KEY` environment variable.
5. Tap Start service. The status section shows last poll time, last result, and messages sent since start.
6. Disable battery optimization for the app (Settings > Apps > KumonScan Gateway > Battery > Unrestricted) so Android does not kill the foreground service.

## Behavior

- Poll cycle (every 15 s): `POST /api/gateway/heartbeat`, `GET /api/gateway/pending`, send each message, `POST /api/gateway/{id}/ack` with `{ "success": true }` or `{ "success": false, "error": "reason" }`.
- All requests carry `Authorization: Bearer <GATEWAY_API_KEY>` and use 10 s connect/read timeouts.
- Messages longer than one SMS segment are sent with `sendMultipartTextMessage`.
- Network or SMS errors never stop the loop; the failure category appears in the status section and the cycle retries in 15 s. The queue lives server-side.
- Logcat records counts and error categories only, never message bodies or phone numbers.

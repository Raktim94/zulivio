# Zulivio for Android

Native Kotlin + Jetpack Compose client for a self-hosted Zulivio server. Full guide: [`docs/mobile-android.md`](../../docs/mobile-android.md). API: [`docs/integrations/api.md`](../../docs/integrations/api.md). Privacy: [`docs/privacy-mobile.md`](../../docs/privacy-mobile.md).

```bash
export ANDROID_HOME=$HOME/Android/Sdk          # JDK 17+ required
./gradlew :app:testDebugUnitTest                # JVM unit tests
./gradlew :app:assembleDebug                    # build/outputs/apk/debug/app-debug.apk
./gradlew :app:assembleRelease                  # HTTPS-only, minified; sign it with your own key
```

Layout: `data/` (API client with token refresh, Keystore-encrypted session store, encrypted Room outbox, sync engine, repository) · `contacts/` (import flow) · `sync/` (WorkManager, reminders) · `ui/` (theme from `DESIGN.md`, screens).

Debug builds may connect over plain HTTP to a local server (`http://10.0.2.2:4100` from the emulator) behind an explicit checkbox and a warning banner; release builds forbid cleartext at the OS level.

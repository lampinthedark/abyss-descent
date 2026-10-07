# Abyss Descent

Isometric browser action RPG. Click or tap to move, fight, and talk; go deeper until the portal.

Sound is synthesized in the browser (no audio files). It starts after the first tap, click, or key. Mute with the **Sound** button on the title screen or HUD, or press **M**. The choice is saved on this device. After an update, hard-refresh the page so the browser drops cached scripts.

Play it here: https://lampinthedark.github.io/abyss-descent/

## Android and iOS

Capacitor 7 wraps this same site in a WebView. The GitHub Pages build is still the repository root (`index.html`, `css/`, `js/`). `npm run cap:sync` copies those files into `www/` and into the native projects, then links `mobile/shell.css` and `mobile/shell.js` in the copy only. The Pages `index.html` stays as it is.

The shell keeps the WebView full-bleed: safe-area padding (Android pushes `--safe-*` from the status bar, cutout, and gesture insets; iOS uses `env(safe-area-inset-*)`), no rubber-band scroll, and the existing Web Audio graph resumes on the first tap. App name is **Abyss Descent**. The icon is the favicon triangle.

### What a release is

| Surface | What players get | What to bump |
| --- | --- | --- |
| GitHub Pages | Root HTML/CSS/JS, cache-busted with `?v=` (currently `9`) | Every `?v=` in root `index.html` when shared files change |
| Android / iOS | Whatever `cap sync` last copied, plus the shell | `versionCode` in `android/app/build.gradle` (and iOS `CURRENT_PROJECT_VERSION`) when you ship a new binary |

A gameplay change ships to both by editing the root files, bumping `?v=` so browsers drop the old scripts, then running `npm run cap:sync` and building a new binary.

### Prerequisites

- Node.js 20 or newer
- JDK 21
- Android SDK (Android Studio, or command-line tools). Capacitor 7 compiles against SDK 35.
- A device with USB debugging, or an emulator

iOS: `ios/` is a real Xcode project. Building it needs a Mac with Xcode and CocoaPods. On Linux, `npx cap sync ios` still copies the web assets and skips `pod install`.

### Sync and build

```bash
npm install

# Copy the Pages files into www/ and both native projects.
npx cap sync
# same thing:
npm run cap:sync

# Debug APK, installable with the debug keystore.
cd android && ./gradlew assembleDebug
# android/app/build/outputs/apk/debug/app-debug.apk

# From the repo root, sync and assemble in one step:
npm run android:debug

# Release bundle. Unsigned unless the signing env vars below are set.
cd android && ./gradlew bundleRelease
# android/app/build/outputs/bundle/release/app-release.aab
npm run android:bundle
```

Sign a Play bundle by pointing Gradle at a keystore:

```bash
export ABYSS_KEYSTORE=/path/to/release.keystore
export ABYSS_KEYSTORE_PASSWORD=...
export ABYSS_KEY_ALIAS=...
export ABYSS_KEY_PASSWORD=...
npm run android:bundle
```

`android.webContentsDebuggingEnabled` is on, so a debug WebView shows up in `chrome://inspect`. Turn that flag off in `capacitor.config.json` before a store build, then sync again.

Regenerate the launcher art from `favicon.svg` with `npm run icons` (needs the dev dependency `sharp`), then sync.

### Run on a device or emulator

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Open **Abyss Descent**. The first tap starts sound, same as the browser. Tap to move, attack, and talk.

Create an emulator from Android Studio's Device Manager, or from the SDK:

```bash
sdkmanager "platforms;android-35" "system-images;android-35;google_apis;x86_64"
avdmanager create avd -n abyss -k "system-images;android-35;google_apis;x86_64" -d pixel_6
emulator -avd abyss
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

### iOS on a Mac

```bash
npm run cap:sync:ios
npx cap open ios
```

Run the App target. `ios.scrollEnabled` is false and `ios.contentInset` is `never`, and the WebView turns bouncing off, so the page stays full screen.

### Known follow-up

The exit portal is the center of the last carved room. If that tile is where the last enemy dies, the clear check treats the player as already standing in the portal, and the combat click can descend before the Hermit vow is turned in. Floor logic is unchanged in this wrap.

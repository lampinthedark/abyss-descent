# Abyss Descent

Isometric browser action RPG. Click or tap to move, fight, and talk; go deeper until the portal. On a phone, an Attack button and the class skills you have learned sit above the Bag and Skills buttons. Hold Attack to keep swinging. Keys 1–3 do the same thing. Those buttons stay off a desktop.

Sound is synthesized in the browser (no audio files). It starts after the first tap, click, or key. Mute with the **Sound** button on the title screen or HUD, or press **M**. The choice is saved on this device. After an update, hard-refresh the page so the browser drops cached scripts.

Play it here: https://lampinthedark.github.io/abyss-descent/

Survivor mode is a separate page: https://lampinthedark.github.io/abyss-descent/survivor.html?v=1

## Survivor mode

One open arena, about ten minutes. The hero is the **sorcerer** because that class already fights with a ranged bolt, so the staff fires on its own and a thumb only steers. Warrior and rogue stay melee in the descent.

Drag anywhere (or use WASD / the arrow keys) to move. There is no attack button and no click-to-move. XP gems pull in. A level-up pauses the fight and offers three large choices. At five minutes a Risen Brute joins the crowd. At ten minutes the run ends with **You survived**. Dying shows time, kills, level, and gold, and Restart is one tap. Once a run, the Hermit can offer a vow: enemies gain half again as much life for a minute, then you pick two upgrades.

Revive, reroll, and double gold call the same ad hooks as the descent. They stay off unless `?adtest=1` is set, and a placeholder opens only from the death screen or when Reroll is tapped on the level-up screen. Nothing is requested from a network. `?debug=1` shows a small frames-per-second readout. `?bench=1` fills the arena with 300 demons so that readout can be checked.

Weapons and passives are data in `js/survivor-data.js`, each with a level cap and an `evolvesWith` field (empty for now). Run gold amounts live in one `REWARDS` table. A versioned local save (`abyss-survivor-meta`) keeps banked gold, a slot for future permanent upgrades, and a cosmetics slot for a skin or effect. There is no shop yet.

The descent at `index.html` is unchanged except for a link to this mode.

## Android and iOS

Capacitor 7 wraps this same site in a WebView. The GitHub Pages build is still the repository root (`index.html`, `css/`, `js/`). `npm run cap:sync` copies those files into `www/` and into the native projects, then links `mobile/shell.css` and `mobile/shell.js` in the copy only. The Pages `index.html` stays as it is.

The shell keeps the WebView full-bleed: safe-area padding (Android pushes `--safe-*` from the status bar, cutout, and gesture insets; iOS uses `env(safe-area-inset-*)`), no rubber-band scroll, and the existing Web Audio graph resumes on the first tap. App name is **Abyss Descent**. The icon is the favicon triangle.

On Android, the system Back button opens the pause menu. Pressing it again resumes. Quit asks for confirmation before leaving. Hiding the app, or the browser tab, pauses play and silences audio until you come back. The saved mute choice is left as it was. A browser tab has no system Back button, so that control does nothing there.

### What a release is

| Surface | What players get | What to bump |
| --- | --- | --- |
| GitHub Pages | Root HTML/CSS/JS, cache-busted with `?v=` (currently `11`) | Every `?v=` in root `index.html` when shared files change |
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

Clearing a floor does not walk you through the portal. If you are already standing on the stairs when the last enemy dies, you stay on the floor until you step off and back on, or tap the lit portal.

## Anonymous counts

Counts stay off until you set one constant. In `js/analytics.js`:

```javascript
const GOATCOUNTER_ENDPOINT = '';
```

Set it to your GoatCounter count URL, for example `https://yoursite.goatcounter.com/count`, then bump `?v=` in `index.html`. The game sends GoatCounter's event count (`p` is the event name, `e=true`) and nothing else: no screen size, no referrer, no cookies, and no player id. A failed request is ignored. If the browser sends Do Not Track or Global Privacy Control, nothing is sent even when the endpoint is set.

`?debug=1` prints each event to the console as `[analytics] <name>` and still sends nothing while the endpoint is empty.

The only thing stored for the return check is a local date (`abyss-descent-last-played`, `YYYY-MM-DD`). When that date is an earlier day, one `returned` event is sent. The date itself is not sent.

Events:

| Event | When |
| --- | --- |
| `title-shown` | Title screen is shown |
| `class-selected-warrior`, `class-selected-rogue`, `class-selected-sorcerer` | That class card is chosen |
| `floor-1-entered` … `floor-10-entered` | That floor starts |
| `floor-10-plus-entered` | Floor 11 or deeper starts |
| `returned` | This device's saved date is an earlier day |
| `session-under-1-min`, `session-1-3-min`, `session-3-5-min`, `session-5-10-min`, `session-10-20-min`, `session-20-plus-min` | Once, when the tab hides or the page closes. The bucket is active play time, not time in a background tab |
| `vow-offered-silence`, `vow-offered-embers`, `vow-offered-oath` | The Hermit offers that vow |
| `vow-accepted-silence`, `vow-accepted-embers`, `vow-accepted-oath` | That vow is accepted |
| `vow-completed-silence`, `vow-completed-embers`, `vow-completed-oath` | That vow is turned in |
| `survivor-run-started` | Survivor play begins |
| `survivor-minute-1` … `survivor-minute-10` | That minute of the run is reached |
| `survivor-died-minute-0` … `survivor-died-minute-10` | The run ends in death during that minute (`0` is the opening minute) |
| `survivor-won` | The ten minutes are survived |
| `survivor-restart` | Restart is pressed |
| `survivor-level-1-5`, `survivor-level-6-10`, `survivor-level-11-20`, `survivor-level-21-plus` | Level at the end of the run |
| `survivor-levelups-0`, `survivor-levelups-1-3`, `survivor-levelups-4-7`, `survivor-levelups-8-plus` | How many level-ups the run had |

## Ad test

`offerRevive()`, `offerReroll()`, and `offerDoubleGold()` return `unavailable` and show nothing. They never play an ad.

Add `?adtest=1` to check the no-fight guard. A small panel appears with a button for each hook. Each one opens a placeholder such as `TEST AD: Revive`, with Accept and Dismiss. Nothing is requested from the network. If a hook runs while any enemy is aggro'd or a swing is in progress, the prompt waits, the panel shows `held: in combat`, and the prompt appears once combat ends.

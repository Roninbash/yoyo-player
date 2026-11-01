<p align="center"><img src="assets/logo.png" alt="YoYo Player logo" width="128"></p>

# YoYo Player

A browser extension for Chrome and Safari that pops a website's video out into a floating player. It works with YouTube, Netflix, Prime Video, Disney+, Twitch, embedded players and most other sites. It has two modes:

- **Pop out:** an always-on-top window that floats over your other apps and follows you between desktops, even when the browser is in the background. On Mac, full-screen apps need the small [YoYo Companion](#full-screen-apps-on-mac-yoyo-companion) app as well.
- **Float in page:** a mini player inside the tab that you can drag and resize anywhere on the page.

## Using it

| | Pop out | Float in page |
|---|---|---|
| Start | Toolbar icon → **Pop out**, or `⌥⇧P` / `Alt+Shift+P` | Toolbar icon → **Float in page**, or `⌥⇧F` / `Alt+Shift+F` |
| Automatic | Switch to another tab while a video plays (Chrome only) | Scroll past a playing video |
| Move / resize | Like any window | Drag anywhere; resize from the bottom-right corner |

The floating player has play/pause (or click the video), a seek bar, mute, **Back to page**, and **✕** (puts the video back and pauses it). The in-page player has a pop-out button too. In the pop-out window, `Space`/`K` plays or pauses, `←`/`→` skip 5 seconds and `M` mutes. `Esc` puts the in-page player back.

Both automatic modes can be turned off in the popup.

### Which sites work

| Kind of site | Examples | Pop out | Float in page |
|---|---|---|---|
| Regular video sites | YouTube, Twitch, Vimeo, Reddit, X, Facebook, news and course sites | Yes, with the extension's own controls | Yes |
| Streaming services with copy protection (DRM) | Netflix, Prime Video, Disney+, Max, Hulu, Apple TV+, Peacock, Paramount+, Crunchyroll, Hotstar | Yes, in the browser's own picture-in-picture window | No: moving the video would break their player, and their whole page is already the player |
| Videos embedded from another site | A YouTube or Vimeo video on a blog | Yes, in the browser's own picture-in-picture window | Yes: the whole embed floats with its own controls, plus a bar to drag it by |
| Custom player components | Players that keep their video inside a web component | Yes | Yes |

Copy-protected streaming sites are detected automatically from the video itself. A built-in list of streaming sites in [src/content.js](src/content.js) (`PIP_ONLY_SITES`) covers players that break even before their protection kicks in.

### Chrome vs Safari

| | Chrome, Edge, Brave, Arc | Safari |
|---|---|---|
| Pop-out window | The extension's own window with its controls (Chrome 116+) | Safari's built-in picture-in-picture window and controls |
| Pop out from the toolbar or shortcut | Yes | Safari may require a click on the page. If so the video floats in the page instead, and the player's pop-out button finishes the job |
| Auto pop-out on tab switch | Yes (Chrome may ask the first time) | Not supported by Safari |
| Float in page, auto-float on scroll | Yes | Yes |

### Full-screen apps on Mac (YoYo Companion)

macOS gives each full-screen app its own Space, and Chrome's pop-out window can't appear there. It does follow you between regular desktops. Extensions can't change this, so an optional menu-bar app fills the gap: when you swipe to a full-screen app, it shows a live floating copy of the pop-out, and hides the copy when you swipe back.

1. Build it with `npm run companion`, which creates `dist/YoYo Companion.app`. Needs Xcode. You can drag the app to Applications.
2. Open it and allow **Screen Recording** when asked (System Settings → Privacy & Security → Screen & System Audio Recording), then quit it from its menu-bar icon and open it again. It reads only the browser's pop-out window, and nothing is saved or sent.
3. Pop out a video in the browser, then swipe to a full-screen app.

Drag the copy to move it, drag its edges to resize it, or hover and click ✕ to hide it until the next pop-out. To start it automatically, add it under System Settings → General → Login Items.

Good to know:

- The copy is picture only. Sound keeps coming from the browser, and the playback controls are on the real pop-out, so swipe back to use them.
- It works with Chrome and other Chromium browsers. Safari wasn't tested and isn't watched.
- Copy-protected video (Netflix, Prime Video and similar) wasn't tested and may show black.
- It needs macOS 13 or newer. It relies on one deprecated Apple call to capture the window and one non-public call to spot closed windows, so a future macOS update could stop it working. If that happens the copy stops appearing, and the pop-out itself isn't affected. These calls also rule out the Mac App Store.
- Each rebuild needs Screen Recording allowed again, because macOS treats it as a new app. It's signed to run only on the Mac that built it, so other people should build their own copy.

## Development

Requirements: Node 18+. For Safari, also Xcode 15+.

```
src/            extension source (src/manifest.json is the Chrome manifest)
scripts/        build script and icon generator
tests/          end-to-end tests and fixture pages
safari/         Xcode project that wraps the extension as a Mac app
companion/      YoYo Companion, the optional Mac app for full-screen apps
assets/         full-size logo
dist/           build output (generated)
```

The icons are drawn by `scripts/make-icons.py`. To change the logo, edit it and run `python3 scripts/make-icons.py` (needs `pip install Pillow`). It updates the extension icons, `assets/logo.png` and the Mac app icons.

| Command | What it does |
|---|---|
| `npm run build` | Builds `dist/chrome` and `dist/safari` from `src/` |
| `npm run package` | Also zips `dist/chrome` for the Chrome Web Store |
| `npm test` | Builds, then runs the end-to-end tests in Chromium |
| `npm run safari` | Builds, then builds the Safari app with Xcode |
| `npm run companion` | Builds `dist/YoYo Companion.app` |

Run `npm install` once first. For tests, also run `npx playwright install chromium` once.

### Load in Chrome

1. `npm run build`
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and choose `dist/chrome`.
3. After changing code, rebuild and click the reload icon on the extension's card.

You can also load `src/` directly while developing.

### Load in Safari

1. `npm run build`
2. Open `safari/YoYo Player/YoYo Player.xcodeproj` in Xcode and press **Run** (⌘R). This installs the YoYo Player app and its extension.
3. In Safari, open **Settings → Advanced** and turn on **Show features for web developers**.
4. Open **Settings → Developer** and turn on **Allow unsigned extensions**. Safari turns this off again every time it quits.
5. Open **Settings → Extensions**, turn on **YoYo Player**, and allow it on all websites (or the sites you want).
6. After changing code, run `npm run build` and press **Run** in Xcode again.

The Xcode project reads its files from `dist/safari`. If you add a new file to `src/`, also add it to the extension target in Xcode (drag it from `dist/safari` into the **Resources** group).

## Publishing

### Chrome Web Store

1. Bump `version` in `src/manifest.json`.
2. `npm run package`, then upload `dist/yoyo-player-chrome-<version>.zip` in the [developer dashboard](https://chrome.google.com/webstore/devconsole) (one-time $5 registration).
3. Permission justifications for the review form:
   - **Access to all sites** (content script): finds the video on the page and runs the floating player and the scroll and tab-switch triggers.
   - **scripting / activeTab:** runs the pop-out and float actions in the current tab from the toolbar button or shortcut.
   - **storage:** saves the user's settings and the player's position and size.
4. Privacy: the extension collects no data. See [PRIVACY.md](PRIVACY.md).

### Mac App Store (Safari)

Requires an Apple Developer Program membership ($99/year).

1. Replace the placeholder bundle IDs with your own (for example `com.yourname.YoYoPlayer`):
   - In Xcode, select each target and change **General → Identity → Bundle Identifier**. The app is `com.example.YoYoPlayer` and the extension is `com.example.YoYoPlayer.Extension`; the extension's ID must start with the app's.
   - Update `extensionBundleIdentifier` in `safari/YoYo Player/YoYo Player/ViewController.swift` to match the extension's new ID.
2. In each target's **Signing & Capabilities**, choose your team.
3. Set the version under **General → Identity** to match `src/manifest.json`.
4. **Product → Archive**, then **Distribute App → App Store Connect**.

You can also distribute outside the App Store by choosing **Developer ID** when distributing. Apple then notarizes the app.

## Limitations

- An embed can't float in the page if the site has wrapped it in certain visual effects (CSS transforms or filters), because those stop it being pinned in place. Pop out still works.
- While the video is out of the page, the site's own controls (like YouTube's control bar) aren't shown on it. The site's keyboard shortcuts still work in its tab.
- The tests can't confirm that a toolbar click or shortcut counts as a user click in the page (the test tool fakes that automatically). Test this in a real browser before each release.

## License

[MIT](LICENSE). You're free to use, change and share this code, including in commercial projects, as long as you keep the license notice.

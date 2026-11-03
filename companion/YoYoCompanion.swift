// YoYo Companion: keeps the browser's pop-out video visible over full-screen apps on macOS.
//
// Chrome's pop-out windows join every regular desktop, but macOS won't show them on a
// full-screen app's Space, and nothing outside Chrome can change that. A non-activating
// panel can appear there, though. So when the pop-out goes off screen, this app shows a
// live copy of it in such a panel, and hides the copy again once the pop-out is back.
//
// The copy is only a picture, and sound keeps coming from the browser. Clicking it plays
// or pauses the real video, through the extension.
//
// The same binary is also the extension's native messaging host. The browser starts it
// with the extension's origin as an argument, and it then answers one message (status, or
// start/stop/allow the app, for the popup's switch) and exits, or stays to relay play/pause
// between the extension and the running app while a video is popped out.

import AppKit

private let browsers: Set<String> = [
  "com.google.Chrome", "com.google.Chrome.beta", "com.google.Chrome.dev", "com.google.Chrome.canary",
  "com.google.chrome.for.testing", "org.chromium.Chromium", "com.microsoft.edgemac", "com.brave.Browser",
  "company.thebrowser.Browser", "com.vivaldi.Vivaldi", "com.operasoftware.Opera",
]
private let minPopOutSize = CGSize(width: 150, height: 80)
private let framesPerSecond = 30.0
private let positionKey = "mirrorFrame"
private let allowedKey = "screenRecordingAllowed"

private let hostName = "yoyo.player.companion"
private let allowedOrigins = ["chrome-extension://fjhgppdcojomjenaikcfnplkgljndaif/"]
// Where each Chromium browser looks for native messaging hosts, under Application Support.
private let browserDataDirs = [
  "Google/Chrome", "Google/Chrome Beta", "Google/Chrome Dev", "Google/Chrome Canary", "Google/Chrome for Testing",
  "Chromium", "Microsoft Edge", "BraveSoftware/Brave-Browser", "Arc/User Data", "Vivaldi", "com.operasoftware.Opera",
]
private let stateNotification = Notification.Name("yoyo.player.companion.state")
private let commandNotification = Notification.Name("yoyo.player.companion.command")
private let permissionSettingsURL = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"

// Streaming capture stalls after about two seconds for an off-screen window, while this
// call keeps returning fresh frames. Apple has deprecated it and removed it from the
// SDK, so it's looked up at runtime; if a future macOS drops it, mirroring stops.
private typealias WindowImageFn = @convention(c) (CGRect, UInt32, UInt32, UInt32) -> Unmanaged<CGImage>?
private let windowImage: WindowImageFn? = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImage")
  .map { unsafeBitCast($0, to: WindowImageFn.self) }
private let includingWindow: UInt32 = 1 << 3 // kCGWindowListOptionIncludingWindow
private let ignoreFraming: UInt32 = 1 << 0   // kCGWindowImageBoundsIgnoreFraming

// After a pop-out closes, Chrome keeps its hidden window around. Apple's public window
// info can't tell that apart from a live pop-out on another Space, but a closed window
// belongs to no Space at all. If the call returns nothing the window counts as closed,
// so a future macOS change can only stop the copy appearing, not leave it stuck on screen.
private typealias ConnectionFn = @convention(c) () -> Int32
private typealias SpacesForWindowsFn = @convention(c) (Int32, Int32, CFArray) -> Unmanaged<CFArray>?
private let skyLight = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY)
private let connection = dlsym(skyLight, "SLSMainConnectionID").map { unsafeBitCast($0, to: ConnectionFn.self) }
private let spacesForWindows = dlsym(skyLight, "SLSCopySpacesForWindows").map { unsafeBitCast($0, to: SpacesForWindowsFn.self) }
private let allSpaces: Int32 = 7

private func belongsToASpace(_ id: CGWindowID) -> Bool {
  guard let connection, let spacesForWindows else { return false }
  let spaces = spacesForWindows(connection(), allSpaces, [id] as CFArray)?.takeRetainedValue() as? [Any]
  return !(spaces ?? []).isEmpty
}

private struct PopOut {
  let id: CGWindowID
  let onScreen: Bool
  let frame: CGRect // in Cocoa screen coordinates
}

// The browser's pop-out window, if one is open. Browsers keep these at the floating window level.
private func findPopOut() -> PopOut? {
  guard let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] else { return nil }
  var best: PopOut?
  for w in windows where w[kCGWindowLayer as String] as? Int == Int(CGWindowLevelForKey(.floatingWindow)) {
    guard let bounds = w[kCGWindowBounds as String] as? NSDictionary,
          let rect = CGRect(dictionaryRepresentation: bounds),
          rect.width >= minPopOutSize.width, rect.height >= minPopOutSize.height,
          let pid = w[kCGWindowOwnerPID as String] as? pid_t,
          let bundle = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier, browsers.contains(bundle),
          let id = w[kCGWindowNumber as String] as? CGWindowID, belongsToASpace(id) else { continue }
    if let b = best, b.frame.width * b.frame.height >= rect.width * rect.height { continue }
    let primaryHeight = NSScreen.screens.first?.frame.height ?? rect.maxY
    best = PopOut(
      id: id,
      onScreen: w[kCGWindowIsOnscreen as String] as? Bool ?? false,
      frame: CGRect(x: rect.minX, y: primaryHeight - rect.maxY, width: rect.width, height: rect.height))
  }
  return best
}

// The panel never becomes the key window, so clicks must work without activating it first.
private final class FirstClickButton: NSButton {
  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

// A click plays or pauses, a drag moves the panel, and a hover reveals the buttons.
private final class MirrorView: NSView {
  let closeButton = FirstClickButton()
  let playButton = FirstClickButton()
  var onClick: (() -> Void)?
  private var grabPoint: NSPoint?
  private var didDrag = false
  private var hovering = false
  private var paused: Bool? // nil until the extension reports a video it can control

  override init(frame: NSRect) {
    super.init(frame: frame)
    wantsLayer = true
    layer?.backgroundColor = NSColor.black.cgColor
    layer?.cornerRadius = 10
    layer?.masksToBounds = true
    layer?.contentsGravity = .resizeAspect
    layer?.actions = ["contents": NSNull()]

    closeButton.image = NSImage(systemSymbolName: "xmark.circle.fill", accessibilityDescription: "Hide copy")
    closeButton.isBordered = false
    closeButton.contentTintColor = .white
    closeButton.isHidden = true
    closeButton.toolTip = "Hide until the next pop-out"
    closeButton.frame = NSRect(x: frame.width - 26, y: frame.height - 26, width: 20, height: 20)
    closeButton.autoresizingMask = [.minXMargin, .minYMargin]
    addSubview(closeButton)

    playButton.isBordered = false
    playButton.contentTintColor = .white
    playButton.isHidden = true
    playButton.wantsLayer = true
    playButton.layer?.backgroundColor = NSColor.black.withAlphaComponent(0.55).cgColor
    playButton.layer?.cornerRadius = 18
    playButton.frame = NSRect(x: (frame.width - 36) / 2, y: 12, width: 36, height: 36)
    playButton.autoresizingMask = [.minXMargin, .maxXMargin, .maxYMargin]
    addSubview(playButton)

    addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
  }
  required init?(coder: NSCoder) { fatalError("not used") }

  func setPlayback(paused: Bool?) {
    self.paused = paused
    updateButtons()
  }

  private func updateButtons() {
    closeButton.isHidden = !hovering
    playButton.isHidden = paused == nil || !(hovering || paused == true)
    guard let paused else { return }
    let label = paused ? "Play" : "Pause"
    playButton.image = NSImage(systemSymbolName: paused ? "play.fill" : "pause.fill", accessibilityDescription: label)
    playButton.toolTip = label
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
  override func mouseEntered(with event: NSEvent) { hovering = true; updateButtons() }
  override func mouseExited(with event: NSEvent) { hovering = false; updateButtons() }

  override func mouseDown(with event: NSEvent) {
    grabPoint = event.locationInWindow
    didDrag = false
  }

  override func mouseDragged(with event: NSEvent) {
    guard let window, let grabPoint else { return }
    // The true pointer position, because event locations are relative to the moving window.
    let pointer = NSEvent.mouseLocation
    let origin = NSPoint(x: pointer.x - grabPoint.x, y: pointer.y - grabPoint.y)
    if !didDrag, hypot(origin.x - window.frame.minX, origin.y - window.frame.minY) < 4 { return }
    didDrag = true
    window.setFrameOrigin(origin)
  }

  override func mouseUp(with event: NSEvent) {
    if grabPoint != nil, !didDrag { onClick?() }
    grabPoint = nil
  }
}

private final class MirrorPanel: NSPanel {
  init() {
    super.init(contentRect: NSRect(x: 0, y: 0, width: 400, height: 225),
               styleMask: [.borderless, .nonactivatingPanel, .resizable], backing: .buffered, defer: false)
    level = .floating
    // The non-activating style is what lets it appear on another app's full-screen Space.
    collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    hidesOnDeactivate = false
    isOpaque = false
    backgroundColor = .clear
    hasShadow = true
    minSize = NSSize(width: 160, height: 90)
    isReleasedWhenClosed = false
    title = "YoYo Companion copy"
  }
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

private final class Companion: NSObject, NSApplicationDelegate, NSWindowDelegate {
  private let panel = MirrorPanel()
  private let view = MirrorView(frame: NSRect(x: 0, y: 0, width: 400, height: 225))
  private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
  private let statusLine = NSMenuItem(title: "", action: nil, keyEquivalent: "")
  private let permissionItem = NSMenuItem(title: "Open Screen Recording Settings…", action: #selector(openPermissionSettings), keyEquivalent: "")
  private let grabQueue = DispatchQueue(label: "yoyo.companion.grab")
  private var grabTimer: DispatchSourceTimer?
  private var mirroredID: CGWindowID?
  private var dismissedID: CGWindowID?
  private var frameInFlight = false
  private var hasPermission = false

  func applicationDidFinishLaunching(_ notification: Notification) {
    hasPermission = CGPreflightScreenCaptureAccess()
    publishPermission(hasPermission)
    if !hasPermission { CGRequestScreenCaptureAccess() }

    view.autoresizingMask = [.width, .height]
    view.closeButton.target = self
    view.closeButton.action = #selector(dismissMirror)
    view.playButton.target = self
    view.playButton.action = #selector(togglePlayback)
    view.onClick = { [weak self] in self?.togglePlayback() }
    panel.contentView = view
    panel.delegate = self

    statusItem.button?.image = NSImage(systemSymbolName: "pip", accessibilityDescription: "YoYo Companion")
    let menu = NSMenu()
    statusLine.isEnabled = false
    permissionItem.target = self
    menu.addItem(statusLine)
    menu.addItem(permissionItem)
    menu.addItem(.separator())
    menu.addItem(NSMenuItem(title: "Quit YoYo Companion", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    statusItem.menu = menu

    DistributedNotificationCenter.default().addObserver(
      self, selector: #selector(playbackChanged(_:)), name: stateNotification, object: nil, suspensionBehavior: .deliverImmediately)
    NSWorkspace.shared.notificationCenter.addObserver(
      self, selector: #selector(refresh), name: NSWorkspace.activeSpaceDidChangeNotification, object: nil)
    Timer.scheduledTimer(timeInterval: 1, target: self, selector: #selector(refresh), userInfo: nil, repeats: true)
    refresh()
  }

  @objc private func refresh() {
    // Once granted, it holds for this run. macOS only applies changes after a restart, and
    // this check can briefly report false, which would make the copy flicker.
    hasPermission = hasPermission || CGPreflightScreenCaptureAccess()
    publishPermission(hasPermission)
    let allowed = hasPermission
    permissionItem.isHidden = allowed
    let popOut = findPopOut()
    if dismissedID != popOut?.id { dismissedID = nil } // that pop-out closed; forget the dismissal

    if let popOut, !popOut.onScreen, allowed, windowImage != nil, dismissedID != popOut.id {
      show(popOut)
      statusLine.title = "Showing a copy of the pop-out"
    } else {
      hide()
      statusLine.title = !allowed ? "Needs Screen Recording permission, then reopen"
        : windowImage == nil ? "This version of macOS isn't supported"
        : popOut == nil ? "Waiting for a pop-out window"
        : "Ready: pop-out is on screen"
    }
  }

  // The extension's popup reads this through the native messaging host.
  private func publishPermission(_ allowed: Bool) {
    if UserDefaults.standard.object(forKey: allowedKey) as? Bool != allowed {
      UserDefaults.standard.set(allowed, forKey: allowedKey)
      UserDefaults.standard.synchronize()
    }
  }

  private func show(_ popOut: PopOut) {
    if mirroredID == popOut.id, panel.isVisible { return }
    mirroredID = popOut.id
    let saved = UserDefaults.standard.string(forKey: positionKey).map(NSRectFromString)
    panel.setFrame(saved ?? popOut.frame, display: false)
    panel.contentAspectRatio = popOut.frame.size
    panel.orderFrontRegardless()
    startGrabbing(popOut.id)
    postCommand("requestState")
  }

  private func hide() {
    guard panel.isVisible else { return }
    stopGrabbing()
    panel.orderOut(nil)
    mirroredID = nil
  }

  private func startGrabbing(_ id: CGWindowID) {
    stopGrabbing()
    guard let grab = windowImage else { return }
    let timer = DispatchSource.makeTimerSource(queue: grabQueue)
    timer.schedule(deadline: .now(), repeating: 1 / framesPerSecond, leeway: .milliseconds(5))
    timer.setEventHandler { [weak self] in
      guard let self, !self.frameInFlight else { return } // the main thread is behind; skip a frame
      guard let image = grab(.null, includingWindow, id, ignoreFraming)?.takeRetainedValue() else { return }
      self.frameInFlight = true
      DispatchQueue.main.async {
        if self.mirroredID == id { self.view.layer?.contents = image }
        self.frameInFlight = false
      }
    }
    timer.resume()
    grabTimer = timer
  }

  private func stopGrabbing() {
    grabTimer?.cancel()
    grabTimer = nil
  }

  private func postCommand(_ command: String) {
    DistributedNotificationCenter.default().postNotificationName(commandNotification, object: command, userInfo: nil, deliverImmediately: true)
  }

  @objc private func togglePlayback() { postCommand("togglePlay") }

  @objc private func playbackChanged(_ notification: Notification) {
    view.setPlayback(paused: notification.userInfo?["paused"] as? Bool)
  }

  @objc private func dismissMirror() {
    dismissedID = mirroredID
    hide()
    statusLine.title = "Copy hidden until the next pop-out"
  }

  @objc private func openPermissionSettings() {
    if let url = URL(string: permissionSettingsURL) { NSWorkspace.shared.open(url) }
  }

  private func savePosition() {
    if panel.isVisible { UserDefaults.standard.set(NSStringFromRect(panel.frame), forKey: positionKey) }
  }
  func windowDidMove(_ notification: Notification) { savePosition() }
  func windowDidEndLiveResize(_ notification: Notification) { savePosition() }
}

// ---------- native messaging host ----------

// Tells the browsers where to find this binary. Runs at every launch, so moving the app just works.
private func registerNativeHost() {
  guard let executable = Bundle.main.executablePath,
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first,
        let manifest = try? JSONSerialization.data(withJSONObject: [
          "name": hostName, "description": "YoYo Companion", "path": executable,
          "type": "stdio", "allowed_origins": allowedOrigins,
        ], options: [.prettyPrinted]) else { return }
  for dir in browserDataDirs {
    let browser = support.appendingPathComponent(dir)
    guard FileManager.default.fileExists(atPath: browser.path) else { continue }
    let hosts = browser.appendingPathComponent("NativeMessagingHosts")
    try? FileManager.default.createDirectory(at: hosts, withIntermediateDirectories: true)
    try? manifest.write(to: hosts.appendingPathComponent("\(hostName).json"), options: .atomic)
  }
}

private func runningCompanions() -> [NSRunningApplication] {
  guard let id = Bundle.main.bundleIdentifier else { return [] }
  return NSRunningApplication.runningApplications(withBundleIdentifier: id).filter { $0.processIdentifier != getpid() }
}

private func wait(upTo seconds: TimeInterval, until done: () -> Bool) {
  let deadline = Date().addingTimeInterval(seconds)
  while !done(), Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
}

// Standard output carries the messages to the browser, so helpers must stay off it.
private func runQuietly(_ path: String, _ arguments: [String]) {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: path)
  process.arguments = arguments
  process.standardOutput = FileHandle.nullDevice
  process.standardError = FileHandle.nullDevice
  try? process.run()
  process.waitUntilExit()
}

private func runOpen(_ arguments: [String]) {
  runQuietly("/usr/bin/open", arguments)
}

private func resetPermissions() {
  guard let id = Bundle.main.bundleIdentifier else { return }
  runQuietly("/usr/bin/tccutil", ["reset", "All", id])
}

private func startCompanion() {
  runOpen(["-g", Bundle.main.bundlePath])
  wait(upTo: 3) { !runningCompanions().isEmpty }
  wait(upTo: 0.8) { false } // give it a moment to publish its permission state
}

private func stopCompanion() {
  runningCompanions().forEach { $0.terminate() }
  wait(upTo: 3) { runningCompanions().isEmpty }
}

// Messages to and from the browser are a 32-bit length followed by JSON.
private func readMessage() -> [String: Any]? {
  let header = FileHandle.standardInput.readData(ofLength: 4)
  guard header.count == 4 else { return nil }
  let length = header.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) }
  let body = FileHandle.standardInput.readData(ofLength: Int(length))
  return (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
}

private func writeMessage(_ message: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: message) else { return }
  var size = UInt32(data.count)
  FileHandle.standardOutput.write(Data(bytes: &size, count: 4))
  FileHandle.standardOutput.write(data)
}

// Passes play/pause between the extension and the running app until the browser hangs up.
private func runRelay() -> Never {
  let center = DistributedNotificationCenter.default()
  var paused: Bool?
  func announce() {
    let info: [AnyHashable: Any]? = paused.map { ["paused": $0] }
    center.postNotificationName(stateNotification, object: nil, userInfo: info, deliverImmediately: true)
  }
  let observer = center.addObserver(forName: commandNotification, object: nil, queue: .main) { note in
    switch note.object as? String {
    case "togglePlay": writeMessage(["command": "togglePlay"])
    case "requestState": announce()
    default: break
    }
  }
  DispatchQueue.global().async {
    while let message = readMessage() {
      guard let value = message["paused"] as? Bool else { continue }
      DispatchQueue.main.async {
        paused = value
        announce()
      }
    }
    DispatchQueue.main.async {
      paused = nil
      announce()
      center.removeObserver(observer)
      exit(0)
    }
  }
  RunLoop.main.run()
  exit(0)
}

private func runNativeHost() {
  switch readMessage()?["action"] as? String {
  case "relay": runRelay()
  case "start": startCompanion()
  case "stop": stopCompanion()
  case "allow":
    // macOS only applies a new Screen Recording permission after a restart, so restart
    // first in case it was already granted.
    stopCompanion()
    startCompanion()
    wait(upTo: 1.5) { false } // past the app's next permission check
    UserDefaults.standard.synchronize()
    if !UserDefaults.standard.bool(forKey: allowedKey) {
      // Still not allowed. macOS may be holding an entry from a differently signed build,
      // which can look switched on in Settings but no longer matches this app. Nothing is
      // lost by clearing it, since it isn't working, and macOS then makes a fresh entry.
      stopCompanion()
      resetPermissions()
      startCompanion()
      runOpen([permissionSettingsURL])
    }
  default: break
  }

  UserDefaults.standard.synchronize()
  writeMessage([
    "running": !runningCompanions().isEmpty,
    "allowed": UserDefaults.standard.bool(forKey: allowedKey),
  ])
}

if CommandLine.arguments.contains(where: { $0.hasPrefix("chrome-extension://") }) {
  runNativeHost()
  exit(0)
}
registerNativeHost()
if CommandLine.arguments.contains("--register") { exit(0) }

private let app = NSApplication.shared
private let delegate = Companion()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()

import Foundation
import AppKit
import Carbon.HIToolbox
import ApplicationServices

// MARK: - JSON helpers
struct Command: Decodable {
    let action: String
    let text: String?
    let key: String?
    let direction: String?
    let amount: Int?
    let x: Double?
    let y: Double?
    let name: String?
    let level: Double?
    let path: String?
    let content: String?
    let position: String? // "left", "right", "maximize", "center"
    let x2: Double?
    let y2: Double?
    let button: String? // "left", "right"
    let region: String? // "fullscreen", "window"
    let width: Int?
    let height: Int?
}

struct Response: Encodable {
    let ok: Bool
    let result: String
}

func respond(_ ok: Bool, _ result: String) -> Never {
    let r = Response(ok: ok, result: result)
    let data = try! JSONEncoder().encode(r)
    print(String(data: data, encoding: .utf8)!)
    exit(ok ? 0 : 1)
}

guard CommandLine.arguments.count > 1 else {
    respond(false, "Usage: iris-helper '{\"action\":\"...\",…}'")
}

guard let data = CommandLine.arguments[1].data(using: .utf8),
      let cmd = try? JSONDecoder().decode(Command.self, from: data) else {
    respond(false, "Invalid JSON input")
}

// MARK: - Keycode map
let keycodeMap: [String: CGKeyCode] = [
    "return": 36, "enter": 36, "tab": 48, "space": 49,
    "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
    "up": 126, "down": 125, "left": 123, "right": 124,
    "a": 0, "b": 11, "c": 8, "d": 2, "e": 14, "f": 3,
    "g": 5, "h": 4, "i": 34, "j": 38, "k": 40, "l": 37,
    "m": 46, "n": 45, "o": 31, "p": 35, "q": 12, "r": 15,
    "s": 1, "t": 17, "u": 32, "v": 9, "w": 13, "x": 7,
    "y": 16, "z": 6,
    "0": 29, "1": 18, "2": 19, "3": 20, "4": 21,
    "5": 23, "6": 22, "7": 26, "8": 28, "9": 25,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118,
    "f5": 96, "f6": 97, "f7": 98, "f8": 100,
    "f9": 101, "f10": 109, "f11": 103, "f12": 111,
    "minus": 27, "equal": 24, "leftbracket": 33, "rightbracket": 30,
    "semicolon": 41, "quote": 39, "comma": 43, "period": 47,
    "slash": 44, "backslash": 42, "grave": 50,
]

func accessibilityPromptOptions() -> CFDictionary {
    [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
}

func accessibilityErrorMessage(_ capability: String) -> String {
    "Accessibility permission is required for \(capability). macOS should show a prompt. Enable Accessibility for the app running Iris, then retry."
}

func requireAccessibility(_ capability: String, prompt: Bool = true) {
    let trusted = prompt ? AXIsProcessTrustedWithOptions(accessibilityPromptOptions()) : AXIsProcessTrusted()
    if !trusted {
        respond(false, accessibilityErrorMessage(capability))
    }
}

func currentCursorPositionCG() -> CGPoint? {
    if let point = CGEvent(source: nil)?.location {
        return point
    }

    let point = NSEvent.mouseLocation
    let primaryHeight = NSScreen.screens.first?.frame.height ?? NSScreen.main?.frame.height ?? 0
    guard primaryHeight > 0 else {
        return CGPoint(x: point.x, y: point.y)
    }
    return CGPoint(x: point.x, y: primaryHeight - point.y)
}

func describe(point: CGPoint) -> String {
    "(\(Int(point.x.rounded())),\(Int(point.y.rounded())))"
}

@discardableResult
func requireCursor(at target: CGPoint, tolerance: CGFloat = 5, action: String) -> CGPoint {
    guard let actual = currentCursorPositionCG() else {
        respond(false, "\(action) failed: could not read cursor position.")
    }

    let withinTolerance = abs(actual.x - target.x) <= tolerance && abs(actual.y - target.y) <= tolerance
    if !withinTolerance {
        let hint = AXIsProcessTrusted()
            ? "Synthetic input was blocked or the coordinates were wrong."
            : accessibilityErrorMessage("mouse input")
        respond(false, "\(action) failed: requested \(describe(point: target)) but cursor is at \(describe(point: actual)). \(hint)")
    }

    return actual
}

func eventFlags(from parts: [String]) -> CGEventFlags {
    var flags: CGEventFlags = []
    for part in parts {
        switch part {
        case "cmd", "command":
            flags.insert(.maskCommand)
        case "ctrl", "control":
            flags.insert(.maskControl)
        case "shift":
            flags.insert(.maskShift)
        case "alt", "option":
            flags.insert(.maskAlternate)
        default:
            break
        }
    }
    return flags
}

// MARK: - Actions
switch cmd.action {

case "type_text":
    guard let text = cmd.text, !text.isEmpty else {
        respond(false, "Missing text")
    }
    requireAccessibility("keyboard input")
    let pb = NSPasteboard.general
    let oldContents = pb.pasteboardItems?.compactMap { item -> (String, Data)? in
        guard let type = item.types.first, let data = item.data(forType: type) else { return nil }
        return (type.rawValue, data)
    } ?? []

    pb.clearContents()
    pb.setString(text, forType: .string)

    let src = CGEventSource(stateID: .hidSystemState)
    let vDown = CGEvent(keyboardEventSource: src, virtualKey: 9, keyDown: true)!
    vDown.flags = .maskCommand
    let vUp = CGEvent(keyboardEventSource: src, virtualKey: 9, keyDown: false)!
    vUp.flags = .maskCommand
    vDown.post(tap: .cghidEventTap)
    vUp.post(tap: .cghidEventTap)

    usleep(300_000) // 300ms for web apps to process the paste
    pb.clearContents()
    for (typeStr, data) in oldContents {
        pb.setData(data, forType: NSPasteboard.PasteboardType(typeStr))
    }

    respond(true, "Typed \(text.count) characters")

case "press_key":
    guard let key = cmd.key?.lowercased(), !key.isEmpty else {
        respond(false, "Missing key")
    }
    requireAccessibility("keyboard input")

    // Small delay so prior actions (paste, focus) settle in web apps
    usleep(150_000)

    let parts = key.split(separator: "+").map(String.init)
    var keyStr = parts.last ?? key
    if parts.count == 1 { keyStr = parts[0] }

    guard let keycode = keycodeMap[keyStr] else {
        respond(false, "Unknown key: \(keyStr)")
    }

    let flags = eventFlags(from: Array(parts.dropLast()))
    let src = CGEventSource(stateID: .hidSystemState)
    let down = CGEvent(keyboardEventSource: src, virtualKey: keycode, keyDown: true)!
    down.flags = flags
    let up = CGEvent(keyboardEventSource: src, virtualKey: keycode, keyDown: false)!
    up.flags = flags
    down.post(tap: .cghidEventTap)
    usleep(20_000)
    up.post(tap: .cghidEventTap)

    respond(true, "Pressed \(key)")

case "scroll":
    requireAccessibility("scrolling")
    let dir = cmd.direction?.lowercased() ?? "down"
    let amount = cmd.amount ?? 3
    let delta = dir == "up" ? Int32(amount) : Int32(-amount)

    guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: delta, wheel2: 0, wheel3: 0) else {
        respond(false, "Failed to create scroll event")
    }
    event.post(tap: .cghidEventTap)

    respond(true, "Scrolled \(dir) by \(amount)")

case "click_at":
    guard let x = cmd.x, let y = cmd.y else {
        respond(false, "Missing x or y coordinates")
    }
    requireAccessibility("mouse input")
    let point = CGPoint(x: x, y: y)
    let src = CGEventSource(stateID: .hidSystemState)
    let isRight = cmd.button?.lowercased() == "right"

    // Move cursor to target first so CGEvent click lands correctly
    let preMove = CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)!
    preMove.post(tap: .cghidEventTap)
    usleep(40_000)
    let movedActual = requireCursor(at: point, action: "Mouse move before click")

    if isRight {
        let down = CGEvent(mouseEventSource: src, mouseType: .rightMouseDown, mouseCursorPosition: point, mouseButton: .right)!
        let up = CGEvent(mouseEventSource: src, mouseType: .rightMouseUp, mouseCursorPosition: point, mouseButton: .right)!
        down.post(tap: .cghidEventTap)
        usleep(50_000)
        up.post(tap: .cghidEventTap)
    } else {
        let down = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)!
        let up = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)!
        down.post(tap: .cghidEventTap)
        usleep(50_000)
        up.post(tap: .cghidEventTap)
    }
    usleep(20_000)
    let clickLabel = isRight ? "Right-clicked" : "Clicked"
    respond(true, "\(clickLabel) at \(describe(point: point)) — cursor verified at \(describe(point: movedActual))")

case "double_click":
    guard let x = cmd.x, let y = cmd.y else {
        respond(false, "Missing x or y coordinates")
    }
    requireAccessibility("mouse input")
    let dblPoint = CGPoint(x: x, y: y)
    let dblSrc = CGEventSource(stateID: .hidSystemState)
    let preMove = CGEvent(mouseEventSource: dblSrc, mouseType: .mouseMoved, mouseCursorPosition: dblPoint, mouseButton: .left)!
    preMove.post(tap: .cghidEventTap)
    usleep(40_000)
    _ = requireCursor(at: dblPoint, action: "Mouse move before double click")
    for i in 0..<2 {
        let down = CGEvent(mouseEventSource: dblSrc, mouseType: .leftMouseDown, mouseCursorPosition: dblPoint, mouseButton: .left)!
        let up = CGEvent(mouseEventSource: dblSrc, mouseType: .leftMouseUp, mouseCursorPosition: dblPoint, mouseButton: .left)!
        down.setIntegerValueField(.mouseEventClickState, value: Int64(i + 1))
        up.setIntegerValueField(.mouseEventClickState, value: Int64(i + 1))
        down.post(tap: .cghidEventTap)
        usleep(30_000)
        up.post(tap: .cghidEventTap)
        if i == 0 { usleep(50_000) }
    }
    respond(true, "Double-clicked at (\(Int(x)), \(Int(y)))")

case "mouse_move":
    guard let x = cmd.x, let y = cmd.y else {
        respond(false, "Missing x or y coordinates")
    }
    requireAccessibility("mouse input")
    let movePoint = CGPoint(x: x, y: y)
    let moveSrc = CGEventSource(stateID: .hidSystemState)
    let moveEvent = CGEvent(mouseEventSource: moveSrc, mouseType: .mouseMoved, mouseCursorPosition: movePoint, mouseButton: .left)!
    moveEvent.post(tap: .cghidEventTap)
    usleep(30_000) // 30ms settle before reading back
    let actual = requireCursor(at: movePoint, action: "Mouse move")
    respond(true, "Moved to \(describe(point: movePoint)) — verified at \(describe(point: actual))")

case "drag":
    guard let x = cmd.x, let y = cmd.y, let x2 = cmd.x2, let y2 = cmd.y2 else {
        respond(false, "Missing coordinates (need x, y, x2, y2)")
    }
    requireAccessibility("mouse input")

    let from = CGPoint(x: x, y: y)
    var to = CGPoint(x: x2, y: y2)

    // Convert AppKit frame (bottom-left origin) to CGEvent bounds (top-left origin).
    // primaryH is the height of the primary display in points.
    let primaryH = NSScreen.screens.first?.frame.height ?? 0

    // Find the screen containing the start position using CGEvent coordinates
    guard let startScreen = NSScreen.screens.first(where: { screen in
        let frame = screen.frame
        // Convert AppKit frame Y range to CGEvent Y range
        let cgMinY = primaryH - frame.maxY  // top of this screen in CGEvent coords
        let cgMaxY = primaryH - frame.minY  // bottom of this screen in CGEvent coords
        return from.x >= frame.minX && from.x <= frame.maxX &&
               from.y >= cgMinY && from.y <= cgMaxY
    }) else {
        respond(false, "Start position not on any screen: (\(Int(x)),\(Int(y)))")
    }

    let frame = startScreen.frame
    let cgMinY = primaryH - frame.maxY
    let cgMaxY = primaryH - frame.minY

    // CRITICAL: Clamp end position to stay on the same screen
    // This prevents jumping to other screens during chess moves
    to.x = max(frame.minX, min(frame.maxX - 1, to.x))
    to.y = max(cgMinY, min(cgMaxY - 1, to.y))

    // Validate start position is on screen (already checked above but kept for safety)
    guard from.x >= frame.minX, from.x <= frame.maxX,
          from.y >= cgMinY, from.y <= cgMaxY else {
        respond(false, "Start coordinates not on detected screen")
    }

    let dragSrc = CGEventSource(stateID: .hidSystemState)

    // Move to start position without clicking
    let moveStart = CGEvent(mouseEventSource: dragSrc, mouseType: .mouseMoved, mouseCursorPosition: from, mouseButton: .left)!
    moveStart.post(tap: .cghidEventTap)
    usleep(50_000) // 50ms settle
    _ = requireCursor(at: from, action: "Mouse move before drag")

    // Press down - LOCK focus to current window
    let dragDown = CGEvent(mouseEventSource: dragSrc, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left)!
    dragDown.post(tap: .cghidEventTap)
    usleep(60_000) // 60ms - lock button state

    // Smooth drag in 30 steps, staying within screen bounds (CGEvent coords)
    let steps = 30
    for i in 1...steps {
        let t = Double(i) / Double(steps)
        var progress = CGPoint(
            x: from.x + (to.x - from.x) * t,
            y: from.y + (to.y - from.y) * t
        )
        // Extra safety: clamp each intermediate position to screen bounds (CGEvent coords)
        progress.x = max(frame.minX, min(frame.maxX - 1, progress.x))
        progress.y = max(cgMinY, min(cgMaxY - 1, progress.y))

        let dragMove = CGEvent(mouseEventSource: dragSrc, mouseType: .leftMouseDragged, mouseCursorPosition: progress, mouseButton: .left)!
        dragMove.post(tap: .cghidEventTap)
        usleep(12_000) // 12ms between steps
    }

    // Release at clamped end position
    usleep(40_000)
    let dragUp = CGEvent(mouseEventSource: dragSrc, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left)!
    dragUp.post(tap: .cghidEventTap)
    usleep(30_000) // Final settle
    let finalActual = requireCursor(at: to, tolerance: 8, action: "Drag")
    respond(true, "Dragged from \(describe(point: from)) to \(describe(point: to)) — cursor verified at \(describe(point: finalActual))")

case "get_mouse_position":
    guard let pos = currentCursorPositionCG() else {
        respond(false, "Could not read cursor position")
    }
    respond(true, "x:\(Int(pos.x.rounded())),y:\(Int(pos.y.rounded()))")

case "check_accessibility":
    respond(true, AXIsProcessTrusted() ? "granted" : "not granted")

case "clipboard_read":
    let pb = NSPasteboard.general
    let text = pb.string(forType: .string) ?? ""
    respond(true, text.isEmpty ? "(clipboard empty)" : String(text.prefix(4000)))

case "clipboard_write":
    guard let text = cmd.text, !text.isEmpty else {
        respond(false, "Missing text")
    }
    let pb = NSPasteboard.general
    pb.clearContents()
    pb.setString(text, forType: .string)
    respond(true, "Copied \(text.count) chars to clipboard")

case "notify":
    let msg = cmd.text ?? "Notification from Iris"
    let script = "display notification \"\(msg.replacingOccurrences(of: "\"", with: "\\\""))\" with title \"Iris\""
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    proc.arguments = ["-e", script]
    try? proc.run()
    proc.waitUntilExit()
    respond(true, "Notification sent")

case "open_app":
    guard let name = cmd.name, !name.isEmpty else {
        respond(false, "Missing app name")
    }

    let workspace = NSWorkspace.shared
    let appURL: URL?

    if let url = workspace.urlForApplication(withBundleIdentifier: "com.apple.\(name.lowercased())") {
        appURL = url
    } else {
        let candidates = [
            "/Applications/\(name).app",
            "/Applications/\(name.capitalized).app",
            "/System/Applications/\(name).app",
            "/System/Applications/\(name.capitalized).app",
            "/Applications/Utilities/\(name).app",
        ]
        appURL = candidates.compactMap { path in
            let url = URL(fileURLWithPath: path)
            return FileManager.default.fileExists(atPath: path) ? url : nil
        }.first
    }

    if let url = appURL {
        workspace.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration())
        usleep(500_000)
        respond(true, "Opened \(name)")
    } else {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/open")
        proc.arguments = ["-a", name]
        do {
            try proc.run()
            proc.waitUntilExit()
            if proc.terminationStatus == 0 {
                respond(true, "Opened \(name)")
            } else {
                respond(false, "Could not find app: \(name)")
            }
        } catch {
            respond(false, "Failed to open \(name): \(error.localizedDescription)")
        }
    }

case "set_volume":
    let level = cmd.level ?? 0.5
    let clamped = max(0.0, min(1.0, level))
    let script = "set volume output volume \(Int(clamped * 100))"
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    proc.arguments = ["-e", script]
    try? proc.run()
    proc.waitUntilExit()
    respond(true, "Volume set to \(Int(clamped * 100))%")

case "set_brightness":
    let level = cmd.level ?? 0.5
    let clamped = max(0.0, min(1.0, level))
    let script = "tell application \"System Events\" to tell appearance preferences to set dark mode to \(clamped < 0.5 ? "true" : "false")"
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    proc.arguments = ["-e", "do shell script \"brightness \(clamped)\" 2>/dev/null || osascript -e '\(script)'"]
    try? proc.run()
    proc.waitUntilExit()
    respond(true, "Brightness set to \(Int(clamped * 100))%")

case "get_frontmost_app":
    let script = """
    tell application "System Events"
        set frontApp to first application process whose frontmost is true
        set appName to name of frontApp
        set winNames to name of every window of frontApp
        return appName & "|" & (winNames as text)
    end tell
    """
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    proc.arguments = ["-e", script]
    let pipe = Pipe()
    proc.standardOutput = pipe
    try? proc.run()
    proc.waitUntilExit()
    let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let parts = output.split(separator: "|", maxSplits: 1)
    let appName = parts.first.map(String.init) ?? "unknown"
    let windows = parts.count > 1 ? String(parts[1]) : ""
    respond(true, "App: \(appName), Windows: \(windows)")

case "window_manage":
    requireAccessibility("window management")
    let pos = cmd.position?.lowercased() ?? "maximize"
    let script: String
    switch pos {
    case "left":
        script = """
        tell application "System Events"
            set frontApp to first application process whose frontmost is true
            set frontWin to first window of frontApp
            set {x, y, w, h} to {0, 25, (do shell script "system_profiler SPDisplaysDataType | grep Resolution | head -1 | awk '{print $2}'"  as integer) / 2, (do shell script "system_profiler SPDisplaysDataType | grep Resolution | head -1 | awk '{print $4}'" as integer) - 25}
            set position of frontWin to {0, 25}
            set size of frontWin to {w, h}
        end tell
        """
    case "right":
        script = """
        tell application "System Events"
            set frontApp to first application process whose frontmost is true
            set frontWin to first window of frontApp
            set screenW to (do shell script "system_profiler SPDisplaysDataType | grep Resolution | head -1 | awk '{print $2}'" as integer)
            set screenH to (do shell script "system_profiler SPDisplaysDataType | grep Resolution | head -1 | awk '{print $4}'" as integer)
            set halfW to screenW / 2
            set position of frontWin to {halfW, 25}
            set size of frontWin to {halfW, screenH - 25}
        end tell
        """
    case "center":
        script = """
        tell application "System Events"
            set frontApp to first application process whose frontmost is true
            set frontWin to first window of frontApp
            set screenW to (do shell script "system_profiler SPDisplaysDataType | grep Resolution | head -1 | awk '{print $2}'" as integer)
            set screenH to (do shell script "system_profiler SPDisplaysDataType | grep Resolution | head -1 | awk '{print $4}'" as integer)
            set {winW, winH} to size of frontWin
            set position of frontWin to {(screenW - winW) / 2, (screenH - winH) / 2}
        end tell
        """
    default: // maximize
        script = """
        tell application "System Events"
            set frontApp to first application process whose frontmost is true
            set frontWin to first window of frontApp
            set screenW to (do shell script "system_profiler SPDisplaysDataType | grep Resolution | head -1 | awk '{print $2}'" as integer)
            set screenH to (do shell script "system_profiler SPDisplaysDataType | grep Resolution | head -1 | awk '{print $4}'" as integer)
            set position of frontWin to {0, 25}
            set size of frontWin to {screenW, screenH - 25}
        end tell
        """
    }
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    proc.arguments = ["-e", script]
    try? proc.run()
    proc.waitUntilExit()
    respond(true, "Window moved to \(pos)")

case "slow_move":
    guard let x = cmd.x, let y = cmd.y else {
        respond(false, "Missing x or y coordinates")
    }
    requireAccessibility("mouse input")
    let movePoint = CGPoint(x: x, y: y)
    let moveSrc = CGEventSource(stateID: .hidSystemState)

    // Smooth animation: move in 20 steps over 500ms
    let steps = 20
    let startPos = currentCursorPositionCG() ?? movePoint

    for i in 0...steps {
        let progress = Double(i) / Double(steps)
        let mid = CGPoint(
            x: startPos.x + (movePoint.x - startPos.x) * progress,
            y: startPos.y + (movePoint.y - startPos.y) * progress
        )
        let moveEvent = CGEvent(mouseEventSource: moveSrc, mouseType: .mouseMoved, mouseCursorPosition: mid, mouseButton: .left)!
        moveEvent.post(tap: .cghidEventTap)
        usleep(25_000) // 25ms between steps
    }

    let finalActual = requireCursor(at: movePoint, action: "Slow mouse move")
    respond(true, "Slowly moved to \(describe(point: movePoint)) — verified at \(describe(point: finalActual))")

case "activate_app":
    guard let name = cmd.name, !name.isEmpty else {
        respond(false, "Missing app name")
    }

    let script = """
    tell application "System Events"
        activate application "\(name)"
    end tell
    """
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    proc.arguments = ["-e", script]
    do {
        try proc.run()
        proc.waitUntilExit()
        if proc.terminationStatus == 0 {
            usleep(100_000) // 100ms to ensure focus is established
            respond(true, "Activated \(name)")
        } else {
            respond(false, "Failed to activate \(name)")
        }
    } catch {
        respond(false, "Error activating app: \(error.localizedDescription)")
    }

default:
    respond(false, "Unknown action: \(cmd.action)")
}

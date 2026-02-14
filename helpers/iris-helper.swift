import Foundation
import AppKit
import Carbon.HIToolbox

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

// MARK: - Actions
switch cmd.action {

case "type_text":
    guard let text = cmd.text, !text.isEmpty else {
        respond(false, "Missing text")
    }
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

    // Small delay so prior actions (paste, focus) settle in web apps
    usleep(150_000)

    let parts = key.split(separator: "+").map(String.init)
    var modifiers: [String] = []
    var keyStr = parts.last ?? key

    for part in parts.dropLast() {
        switch part {
        case "cmd", "command": modifiers.append("command down")
        case "ctrl", "control": modifiers.append("control down")
        case "shift": modifiers.append("shift down")
        case "alt", "option": modifiers.append("option down")
        default: break
        }
    }
    if parts.count == 1 { keyStr = parts[0] }

    // Use AppleScript System Events — works reliably across all apps including Electron
    guard let keycode = keycodeMap[keyStr] else {
        respond(false, "Unknown key: \(keyStr)")
    }

    let modStr = modifiers.isEmpty ? "" : " using {\(modifiers.joined(separator: ", "))}"
    let script = "tell application \"System Events\" to key code \(keycode)\(modStr)"
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    proc.arguments = ["-e", script]
    try? proc.run()
    proc.waitUntilExit()

    respond(true, "Pressed \(key)")

case "scroll":
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
    let point = CGPoint(x: x, y: y)
    let src = CGEventSource(stateID: .hidSystemState)
    let isRight = cmd.button?.lowercased() == "right"

    if isRight {
        let down = CGEvent(mouseEventSource: src, mouseType: .rightMouseDown, mouseCursorPosition: point, mouseButton: .right)!
        let up = CGEvent(mouseEventSource: src, mouseType: .rightMouseUp, mouseCursorPosition: point, mouseButton: .right)!
        down.post(tap: .cghidEventTap)
        usleep(50_000)
        up.post(tap: .cghidEventTap)
        respond(true, "Right-clicked at (\(Int(x)), \(Int(y)))")
    } else {
        let down = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)!
        let up = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)!
        down.post(tap: .cghidEventTap)
        usleep(50_000)
        up.post(tap: .cghidEventTap)
        respond(true, "Clicked at (\(Int(x)), \(Int(y)))")
    }

case "double_click":
    guard let x = cmd.x, let y = cmd.y else {
        respond(false, "Missing x or y coordinates")
    }
    let dblPoint = CGPoint(x: x, y: y)
    let dblSrc = CGEventSource(stateID: .hidSystemState)
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
    let movePoint = CGPoint(x: x, y: y)
    let moveSrc = CGEventSource(stateID: .hidSystemState)
    let moveEvent = CGEvent(mouseEventSource: moveSrc, mouseType: .mouseMoved, mouseCursorPosition: movePoint, mouseButton: .left)!
    moveEvent.post(tap: .cghidEventTap)
    respond(true, "Moved mouse to (\(Int(x)), \(Int(y)))")

case "drag":
    guard let x = cmd.x, let y = cmd.y, let x2 = cmd.x2, let y2 = cmd.y2 else {
        respond(false, "Missing coordinates (need x, y, x2, y2)")
    }
    let dragSrc = CGEventSource(stateID: .hidSystemState)
    let from = CGPoint(x: x, y: y)
    let to = CGPoint(x: x2, y: y2)
    let dragDown = CGEvent(mouseEventSource: dragSrc, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left)!
    dragDown.post(tap: .cghidEventTap)
    usleep(100_000)
    // Smooth drag in steps
    let steps = 10
    for i in 1...steps {
        let t = Double(i) / Double(steps)
        let mid = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
        let dragMove = CGEvent(mouseEventSource: dragSrc, mouseType: .leftMouseDragged, mouseCursorPosition: mid, mouseButton: .left)!
        dragMove.post(tap: .cghidEventTap)
        usleep(20_000)
    }
    let dragUp = CGEvent(mouseEventSource: dragSrc, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left)!
    dragUp.post(tap: .cghidEventTap)
    respond(true, "Dragged from (\(Int(x)),\(Int(y))) to (\(Int(x2)),\(Int(y2)))")

case "get_mouse_position":
    let pos = NSEvent.mouseLocation
    let screenH = NSScreen.main?.frame.height ?? 0
    // Convert from AppKit (bottom-left origin) to CGEvent (top-left origin)
    respond(true, "x:\(Int(pos.x)),y:\(Int(screenH - pos.y))")

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

default:
    respond(false, "Unknown action: \(cmd.action)")
}

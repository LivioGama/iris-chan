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

    usleep(100_000)
    pb.clearContents()
    for (typeStr, data) in oldContents {
        pb.setData(data, forType: NSPasteboard.PasteboardType(typeStr))
    }

    respond(true, "Typed \(text.count) characters")

case "press_key":
    guard let key = cmd.key?.lowercased(), !key.isEmpty else {
        respond(false, "Missing key")
    }

    let parts = key.split(separator: "+").map(String.init)
    var flags: CGEventFlags = []
    var keyStr = parts.last ?? key

    for part in parts.dropLast() {
        switch part {
        case "cmd", "command": flags.insert(.maskCommand)
        case "ctrl", "control": flags.insert(.maskControl)
        case "shift": flags.insert(.maskShift)
        case "alt", "option": flags.insert(.maskAlternate)
        default: break
        }
    }
    if parts.count == 1 { keyStr = parts[0] }

    guard let keycode = keycodeMap[keyStr] else {
        respond(false, "Unknown key: \(keyStr)")
    }

    let src = CGEventSource(stateID: .hidSystemState)
    let down = CGEvent(keyboardEventSource: src, virtualKey: keycode, keyDown: true)!
    let up = CGEvent(keyboardEventSource: src, virtualKey: keycode, keyDown: false)!
    if !flags.isEmpty {
        down.flags = flags
        up.flags = flags
    }
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)

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

    let mouseDown = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)!
    let mouseUp = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)!

    mouseDown.post(tap: .cghidEventTap)
    usleep(50_000)
    mouseUp.post(tap: .cghidEventTap)

    respond(true, "Clicked at (\(Int(x)), \(Int(y)))")

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

default:
    respond(false, "Unknown action: \(cmd.action)")
}

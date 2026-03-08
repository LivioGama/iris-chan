import Foundation
import AppKit
import ApplicationServices

let fileManager = FileManager.default

func printResult(app: String, path: String? = nil, error: String? = nil) {
    print("App: \(app)")
    if let path, !path.isEmpty {
        print("Path: \(path)")
    }
    if let error, !error.isEmpty {
        print("Error: \(error)")
    }
}

func runAppleScript(_ script: String) -> String? {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    process.arguments = ["-e", script]
    process.standardOutput = pipe
    process.standardError = Pipe()

    do {
        try process.run()
    } catch {
        return nil
    }

    process.waitUntilExit()
    guard process.terminationStatus == 0 else {
        return nil
    }

    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    return String(data: data, encoding: .utf8)?
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

func normalizePath(_ raw: String) -> String? {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        .trimmingCharacters(in: CharacterSet(charactersIn: "\"'“”"))
    guard !trimmed.isEmpty else { return nil }

    if trimmed.hasPrefix("file://"), let url = URL(string: trimmed), url.isFileURL {
        return url.path
    }

    if trimmed.hasPrefix("~/") {
        return (trimmed as NSString).expandingTildeInPath
    }

    if trimmed.hasPrefix("/") {
        return trimmed
    }

    return nil
}

func candidateChildPath(named name: String, in directory: String?) -> String? {
    guard let directory else { return nil }

    let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        .trimmingCharacters(in: CharacterSet(charactersIn: "\"'“”"))
    guard !trimmed.isEmpty else { return nil }
    guard !trimmed.contains("/") && !trimmed.contains(":") else { return nil }

    let candidate = (directory as NSString).appendingPathComponent(trimmed)
    guard fileManager.fileExists(atPath: candidate) else { return nil }
    return candidate
}

func pathCandidates(from text: String, baseDirectory: String? = nil) -> [String] {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return [] }

    var results: [String] = []

    if let direct = normalizePath(trimmed) {
        results.append(direct)
    }

    if let child = candidateChildPath(named: trimmed, in: baseDirectory) {
        results.append(child)
    }

    let tokenSeparators = CharacterSet.whitespacesAndNewlines.union(
        CharacterSet(charactersIn: ",;()[]{}<>")
    )

    for rawToken in trimmed.components(separatedBy: tokenSeparators) {
        let token = rawToken.trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
        guard !token.isEmpty else { continue }

        if let normalized = normalizePath(token) {
            results.append(normalized)
            continue
        }

        if let child = candidateChildPath(named: token, in: baseDirectory) {
            results.append(child)
        }
    }

    var seen = Set<String>()
    return results.filter { seen.insert($0).inserted }
}

func pathCandidates(from value: CFTypeRef, baseDirectory: String? = nil) -> [String] {
    if CFGetTypeID(value) == AXUIElementGetTypeID() {
        return []
    }

    if let url = value as? URL, url.isFileURL {
        return [url.path]
    }

    if let url = value as? NSURL, let path = url.path {
        return [path]
    }

    if let text = value as? String {
        return pathCandidates(from: text, baseDirectory: baseDirectory)
    }

    if let text = value as? NSString {
        return pathCandidates(from: text as String, baseDirectory: baseDirectory)
    }

    if let attributed = value as? NSAttributedString {
        return pathCandidates(from: attributed.string, baseDirectory: baseDirectory)
    }

    if let items = value as? [Any] {
        return items.flatMap { item in
            pathCandidates(from: item as CFTypeRef, baseDirectory: baseDirectory)
        }
    }

    return []
}

func copyAttribute(_ element: AXUIElement, name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
    guard error == .success, let value else { return nil }
    return value
}

func copyElementAttribute(_ element: AXUIElement, name: String) -> AXUIElement? {
    guard let value = copyAttribute(element, name: name) else { return nil }
    guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return unsafeBitCast(value, to: AXUIElement.self)
}

func copyElementAtPosition(_ point: CGPoint) -> AXUIElement? {
    let system = AXUIElementCreateSystemWide()
    var element: AXUIElement?
    let error = AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &element)
    guard error == .success else { return nil }
    return element
}

func hoveredElement() -> AXUIElement? {
    var points: [CGPoint] = []

    if let cgPoint = CGEvent(source: nil)?.location {
        points.append(cgPoint)
    }

    let appKitPoint = NSEvent.mouseLocation
    points.append(appKitPoint)

    if let primaryHeight = NSScreen.screens.first?.frame.height, primaryHeight > 0 {
        points.append(CGPoint(x: appKitPoint.x, y: primaryHeight - appKitPoint.y))
    }

    var seen = Set<String>()
    for point in points {
        let key = "\(Int(point.x.rounded())):\(Int(point.y.rounded()))"
        guard seen.insert(key).inserted else { continue }
        if let element = copyElementAtPosition(point) {
            return element
        }
    }

    return nil
}

func ancestorChain(startingAt element: AXUIElement?) -> [AXUIElement] {
    var chain: [AXUIElement] = []
    var current = element

    for _ in 0..<16 {
        guard let element = current else { break }
        chain.append(element)
        current = copyElementAttribute(element, name: kAXParentAttribute as String)
    }

    return chain
}

func elementCandidates(_ element: AXUIElement, baseDirectory: String?) -> [String] {
    let interestingAttributes = [
        "AXDocument",
        "AXFilename",
        "AXPath",
        kAXTitleAttribute as String,
        kAXValueAttribute as String,
        "AXDescription",
        "AXHelp",
        "AXURL",
    ]

    var candidates: [String] = []

    for current in ancestorChain(startingAt: element) {
        for attribute in interestingAttributes {
            guard let value = copyAttribute(current, name: attribute) else { continue }
            candidates.append(contentsOf: pathCandidates(from: value, baseDirectory: baseDirectory))
        }
    }

    var seen = Set<String>()
    return candidates.filter { seen.insert($0).inserted }
}

func finderFrontDirectory() -> String? {
    let script = """
    tell application "Finder"
        if (count of windows) is 0 then
            return POSIX path of (desktop as alias)
        end if
        return POSIX path of ((target of front Finder window) as alias)
    end tell
    """
    return runAppleScript(script).flatMap(normalizePath)
}

func finderSelectionPaths() -> [String] {
    let script = """
    tell application "Finder"
        set sel to selection
        if (count of sel) is 0 then return ""
        set outList to {}
        repeat with itemRef in sel
            set end of outList to POSIX path of (itemRef as alias)
        end repeat
        set AppleScript's text item delimiters to linefeed
        return outList as text
    end tell
    """

    guard let output = runAppleScript(script), !output.isEmpty else { return [] }
    return output
        .split(separator: "\n")
        .compactMap { normalizePath(String($0)) }
}

let frontmostApp = NSWorkspace.shared.frontmostApplication
let appName = frontmostApp?.localizedName ?? "Unknown"
let appPID = frontmostApp?.processIdentifier ?? 0
let appElement = appPID > 0 ? AXUIElementCreateApplication(appPID) : nil
let trusted = AXIsProcessTrusted()
let finderDirectory = appName == "Finder" ? finderFrontDirectory() : nil

var candidates: [String] = []

if let hovered = hoveredElement() {
    candidates.append(contentsOf: elementCandidates(hovered, baseDirectory: finderDirectory))
}

let systemWide = AXUIElementCreateSystemWide()
if let focused = copyElementAttribute(systemWide, name: kAXFocusedUIElementAttribute as String) {
    candidates.append(contentsOf: elementCandidates(focused, baseDirectory: finderDirectory))
}

if let appElement {
    if let focusedWindow = copyElementAttribute(appElement, name: kAXFocusedWindowAttribute as String) {
        candidates.append(contentsOf: elementCandidates(focusedWindow, baseDirectory: finderDirectory))
    }
    candidates.append(contentsOf: elementCandidates(appElement, baseDirectory: finderDirectory))
}

if appName == "Finder" {
    candidates.append(contentsOf: finderSelectionPaths())
    if let finderDirectory {
        candidates.append(finderDirectory)
    }
}

var seen = Set<String>()
let uniqueCandidates = candidates
    .map { ($0 as NSString).standardizingPath }
    .filter { seen.insert($0).inserted }

if let detectedPath = uniqueCandidates.first {
    printResult(app: appName, path: detectedPath)
} else if !trusted {
    printResult(app: appName, error: "Accessibility permission not granted for hover detection")
} else {
    printResult(app: appName, error: "No hovered file or project path could be determined")
}

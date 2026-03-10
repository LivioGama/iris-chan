import Foundation
import AppKit
import Carbon.HIToolbox
import ApplicationServices

let syntheticEventUserData: Int64 = 0x49524953

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
	let position: String?
	let x2: Double?
	let y2: Double?
	let button: String?
	let region: String?
	let width: Int?
	let height: Int?
	let query: String?
	let role: String?
	let value: String?
	let exact: Bool?
	let limit: Int?
}

struct Response: Encodable {
	let ok: Bool
	let result: String
}

struct AXMatchSummary: Encodable {
	let text: String
	let role: String
	let subrole: String
	let score: Int
}

struct AXFindResponse: Encodable {
	let count: Int
	let matches: [AXMatchSummary]
}

struct AXSnapshotNode: Encodable {
	let role: String
	let subrole: String
	let title: String
	let value: String
	let help: String
	let detail: String
	let enabled: Bool
	let focused: Bool
}

struct AXSnapshotResponse: Encodable {
	let appName: String
	let windowTitle: String
	let focused: AXSnapshotNode?
	let elements: [AXSnapshotNode]
}

func respond(_ ok: Bool, _ result: String) -> Never {
	let response = Response(ok: ok, result: result)
	let data = try! JSONEncoder().encode(response)
	print(String(data: data, encoding: .utf8)!)
	exit(ok ? 0 : 1)
}

func writeStdoutLine(_ text: String) {
	if let data = (text + "\n").data(using: .utf8) {
		FileHandle.standardOutput.write(data)
	}
}

func encodeJSONString<T: Encodable>(_ value: T) -> String {
	let data = try! JSONEncoder().encode(value)
	return String(data: data, encoding: .utf8) ?? "{}"
}

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

func monitorEventName(for type: CGEventType) -> String {
	switch type {
	case .keyDown:
		return "keypress"
	case .leftMouseDown, .rightMouseDown, .otherMouseDown:
		return "mouse-click"
	case .mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged:
		return "mouse-move"
	case .scrollWheel:
		return "scroll"
	default:
		return "input"
	}
}

func startInputMonitor() -> Never {
	requireAccessibility("user input monitoring")

	let watchedTypes: [CGEventType] = [
		.keyDown,
		.leftMouseDown,
		.rightMouseDown,
		.otherMouseDown,
		.mouseMoved,
		.scrollWheel,
	]
	var mask: CGEventMask = 0
	for type in watchedTypes {
		mask |= (1 << type.rawValue)
	}

	let callback: CGEventTapCallBack = { _, type, event, _ in
		if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
			return Unmanaged.passUnretained(event)
		}
		if event.getIntegerValueField(.eventSourceUserData) == syntheticEventUserData {
			return Unmanaged.passUnretained(event)
		}
		if type == .mouseMoved {
			let dx = abs(event.getIntegerValueField(.mouseEventDeltaX))
			let dy = abs(event.getIntegerValueField(.mouseEventDeltaY))
			if dx < 2 && dy < 2 {
				return Unmanaged.passUnretained(event)
			}
		}
		writeStdoutLine("{\"type\":\"\(monitorEventName(for: type))\",\"timestamp\":\(Int(Date().timeIntervalSince1970 * 1000))}")
		CFRunLoopStop(CFRunLoopGetCurrent())
		return Unmanaged.passUnretained(event)
	}

	guard let tap = CGEvent.tapCreate(
		tap: .cgSessionEventTap,
		place: .headInsertEventTap,
		options: .listenOnly,
		eventsOfInterest: mask,
		callback: callback,
		userInfo: nil
	) else {
		respond(false, "Could not start input monitor. Accessibility permission is required.")
	}

	let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
	CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
	CGEvent.tapEnable(tap: tap, enable: true)
	CFRunLoopRun()
	exit(0)
}

if CommandLine.arguments.count > 1, CommandLine.arguments[1] == "--monitor-input" {
	startInputMonitor()
}

guard CommandLine.arguments.count > 1 else {
	respond(false, "Usage: iris-helper '{\"action\":\"...\",…}'")
}

guard let data = CommandLine.arguments[1].data(using: .utf8),
	  let cmd = try? JSONDecoder().decode(Command.self, from: data) else {
	respond(false, "Invalid JSON input")
}

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

func markSynthetic(_ event: CGEvent) {
	event.setIntegerValueField(.eventSourceUserData, value: syntheticEventUserData)
}

func frontmostApplication() -> NSRunningApplication? {
	NSWorkspace.shared.frontmostApplication
}

func frontmostAppName() -> String {
	frontmostApplication()?.localizedName ?? ""
}

func frontmostAXApplication() -> AXUIElement? {
	guard let app = frontmostApplication() else { return nil }
	return AXUIElementCreateApplication(app.processIdentifier)
}

func copyAttribute(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
	var value: CFTypeRef?
	let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
	if error == .success {
		return value
	}
	return nil
}

func stringAttribute(_ element: AXUIElement, _ attribute: String) -> String {
	if let value = copyAttribute(element, attribute) as? String {
		return value.trimmingCharacters(in: .whitespacesAndNewlines)
	}
	if let value = copyAttribute(element, attribute) as? NSAttributedString {
		return value.string.trimmingCharacters(in: .whitespacesAndNewlines)
	}
	if let value = copyAttribute(element, attribute) as? NSNumber {
		return value.stringValue
	}
	return ""
}

func boolAttribute(_ element: AXUIElement, _ attribute: String) -> Bool {
	if let value = copyAttribute(element, attribute) as? NSNumber {
		return value.boolValue
	}
	return false
}

func enabledAttribute(_ element: AXUIElement) -> Bool {
	guard let value = copyAttribute(element, kAXEnabledAttribute as String) as? NSNumber else {
		return true
	}
	return value.boolValue
}

func uiElementAttribute(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
	guard let value = copyAttribute(element, attribute) else { return nil }
	return unsafeBitCast(value, to: AXUIElement.self)
}

func elementArrayAttribute(_ element: AXUIElement, _ attribute: String) -> [AXUIElement] {
	copyAttribute(element, attribute) as? [AXUIElement] ?? []
}

func actionNames(_ element: AXUIElement) -> [String] {
	var names: CFArray?
	let error = AXUIElementCopyActionNames(element, &names)
	if error != .success {
		return []
	}
	return names as? [String] ?? []
}

func canPerformPress(_ element: AXUIElement) -> Bool {
	let names = actionNames(element)
	return names.contains(kAXPressAction as String) || names.contains(kAXConfirmAction as String)
}

func performPress(_ element: AXUIElement) -> Bool {
	let names = actionNames(element)
	if names.contains(kAXPressAction as String) {
		return AXUIElementPerformAction(element, kAXPressAction as CFString) == .success
	}
	if names.contains(kAXConfirmAction as String) {
		return AXUIElementPerformAction(element, kAXConfirmAction as CFString) == .success
	}
	return false
}

func setFocused(_ element: AXUIElement) -> Bool {
	let focusedValue = NSNumber(value: true)
	let error = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, focusedValue)
	return error == .success
}

func isSettableValue(_ element: AXUIElement) -> Bool {
	var settable = DarwinBoolean(false)
	let error = AXUIElementIsAttributeSettable(element, kAXValueAttribute as CFString, &settable)
	return error == .success && settable.boolValue
}

func setValue(_ element: AXUIElement, _ value: String) -> Bool {
	if !isSettableValue(element) {
		return false
	}
	let error = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFTypeRef)
	return error == .success
}

func normalizedText(_ value: String) -> String {
	value.lowercased().replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
}

func elementRole(_ element: AXUIElement) -> String {
	stringAttribute(element, kAXRoleAttribute as String)
}

func elementSubrole(_ element: AXUIElement) -> String {
	stringAttribute(element, kAXSubroleAttribute as String)
}

func elementDetail(_ element: AXUIElement) -> String {
	let parts = [
		stringAttribute(element, kAXTitleAttribute as String),
		stringAttribute(element, kAXValueAttribute as String),
		stringAttribute(element, kAXDescriptionAttribute as String),
		stringAttribute(element, kAXHelpAttribute as String),
	].filter { !$0.isEmpty }
	return parts.joined(separator: " • ")
}

func searchableTexts(for element: AXUIElement) -> [String] {
	let texts = [
		stringAttribute(element, kAXTitleAttribute as String),
		stringAttribute(element, kAXValueAttribute as String),
		stringAttribute(element, kAXDescriptionAttribute as String),
		stringAttribute(element, kAXHelpAttribute as String),
	]
	return Array(Set(texts.filter { !$0.isEmpty }))
}

func childElements(of element: AXUIElement) -> [AXUIElement] {
	let attributes = [
		kAXChildrenAttribute as String,
		kAXVisibleChildrenAttribute as String,
		kAXRowsAttribute as String,
		kAXTabsAttribute as String,
	]
	var result: [AXUIElement] = []
	for attribute in attributes {
		result.append(contentsOf: elementArrayAttribute(element, attribute))
	}
	return result
}

func focusedWindow(of appElement: AXUIElement) -> AXUIElement? {
	uiElementAttribute(appElement, kAXFocusedWindowAttribute as String)
		?? elementArrayAttribute(appElement, kAXWindowsAttribute as String).first
}

func focusedElement(of appElement: AXUIElement) -> AXUIElement? {
	uiElementAttribute(appElement, kAXFocusedUIElementAttribute as String)
}

struct AXCandidate {
	let element: AXUIElement
	let parent: AXUIElement?
	let text: String
	let role: String
	let subrole: String
	let score: Int
}

func roleMatches(element: AXUIElement, requestedRole: String) -> Bool {
	let normalizedRole = normalizedText(requestedRole)
	if normalizedRole.isEmpty { return true }
	let haystacks = [normalizedText(elementRole(element)), normalizedText(elementSubrole(element))]
	return haystacks.contains { $0.contains(normalizedRole) }
}

func scoreElement(_ element: AXUIElement, query: String, requestedRole: String, exact: Bool) -> AXCandidate? {
	let normalizedQuery = normalizedText(query)
	if normalizedQuery.isEmpty { return nil }

	let texts = searchableTexts(for: element)
	var bestText = ""
	var bestScore = 0
	for text in texts {
		let normalized = normalizedText(text)
		var score = 0
		if normalized == normalizedQuery {
			score = 120
		} else if normalized.hasPrefix(normalizedQuery) {
			score = 90
		} else if normalized.contains(normalizedQuery) {
			score = 60
		}
		if exact && normalized != normalizedQuery {
			score = 0
		}
		if score > bestScore {
			bestScore = score
			bestText = text
		}
	}
	if bestScore == 0 || !roleMatches(element: element, requestedRole: requestedRole) {
		return nil
	}
	if canPerformPress(element) {
		bestScore += 8
	}
	if boolAttribute(element, kAXFocusedAttribute as String) {
		bestScore += 3
	}
	return AXCandidate(
		element: element,
		parent: nil,
		text: bestText,
		role: elementRole(element),
		subrole: elementSubrole(element),
		score: bestScore
	)
}

func searchCandidates(in root: AXUIElement, query: String, requestedRole: String, exact: Bool, limit: Int) -> [AXCandidate] {
	var results: [AXCandidate] = []
	var visited = Set<Int>()

	func walk(_ element: AXUIElement, parent: AXUIElement?, depth: Int) {
		if depth > 10 || results.count >= limit { return }
		let identifier = Int(bitPattern: Unmanaged.passUnretained(element).toOpaque())
		if visited.contains(identifier) { return }
		visited.insert(identifier)

		if var candidate = scoreElement(element, query: query, requestedRole: requestedRole, exact: exact) {
			candidate = AXCandidate(
				element: candidate.element,
				parent: parent,
				text: candidate.text,
				role: candidate.role,
				subrole: candidate.subrole,
				score: candidate.score
			)
			results.append(candidate)
		}

		for child in childElements(of: element) {
			walk(child, parent: element, depth: depth + 1)
			if results.count >= limit { return }
		}
	}

	walk(root, parent: nil, depth: 0)
	return results.sorted { lhs, rhs in
		if lhs.score == rhs.score {
			return lhs.text.count < rhs.text.count
		}
		return lhs.score > rhs.score
	}
}

func topCandidates(query: String, requestedRole: String, exact: Bool, limit: Int) -> [AXCandidate] {
	guard let appElement = frontmostAXApplication() else { return [] }
	var roots: [AXUIElement] = []
	if let window = focusedWindow(of: appElement) {
		roots.append(window)
	}
	roots.append(appElement)

	var merged: [AXCandidate] = []
	for root in roots {
		merged.append(contentsOf: searchCandidates(in: root, query: query, requestedRole: requestedRole, exact: exact, limit: limit))
		if merged.count >= limit { break }
	}
	return merged.sorted { lhs, rhs in
		if lhs.score == rhs.score {
			return lhs.text.count < rhs.text.count
		}
		return lhs.score > rhs.score
	}
}

func candidateSummaries(_ candidates: [AXCandidate]) -> [AXMatchSummary] {
	candidates.prefix(5).map {
		AXMatchSummary(text: $0.text, role: $0.role, subrole: $0.subrole, score: $0.score)
	}
}

func resolveActionTarget(for candidate: AXCandidate) -> AXUIElement {
	if canPerformPress(candidate.element) {
		return candidate.element
	}
	if let parent = candidate.parent, canPerformPress(parent) {
		return parent
	}
	return candidate.element
}

func resolveValueTarget(for candidate: AXCandidate?) -> AXUIElement? {
	if let candidate, isSettableValue(candidate.element) {
		return candidate.element
	}
	if let parent = candidate?.parent, isSettableValue(parent) {
		return parent
	}
	if let appElement = frontmostAXApplication(), let focused = focusedElement(of: appElement), isSettableValue(focused) {
		return focused
	}
	return candidate?.element
}

func snapshotNode(for element: AXUIElement) -> AXSnapshotNode {
	AXSnapshotNode(
		role: elementRole(element),
		subrole: elementSubrole(element),
		title: stringAttribute(element, kAXTitleAttribute as String),
		value: stringAttribute(element, kAXValueAttribute as String),
		help: stringAttribute(element, kAXHelpAttribute as String),
		detail: elementDetail(element),
		enabled: enabledAttribute(element),
		focused: boolAttribute(element, kAXFocusedAttribute as String)
	)
}

func buildSnapshot(limit: Int) -> AXSnapshotResponse {
	guard let appElement = frontmostAXApplication() else {
		return AXSnapshotResponse(appName: "", windowTitle: "", focused: nil, elements: [])
	}
	let appName = frontmostAppName()
	let windowTitle = focusedWindow(of: appElement).map { stringAttribute($0, kAXTitleAttribute as String) } ?? ""
	let focused = focusedElement(of: appElement).map(snapshotNode)
	let root = focusedWindow(of: appElement) ?? appElement
	var nodes: [AXSnapshotNode] = []
	var visited = Set<Int>()

	func walk(_ element: AXUIElement, depth: Int) {
		if depth > 8 || nodes.count >= limit { return }
		let identifier = Int(bitPattern: Unmanaged.passUnretained(element).toOpaque())
		if visited.contains(identifier) { return }
		visited.insert(identifier)
		let node = snapshotNode(for: element)
		if !node.detail.isEmpty || !node.title.isEmpty || !node.value.isEmpty {
			nodes.append(node)
		}
		for child in childElements(of: element) {
			walk(child, depth: depth + 1)
			if nodes.count >= limit { return }
		}
	}

	walk(root, depth: 0)
	return AXSnapshotResponse(appName: appName, windowTitle: windowTitle, focused: focused, elements: nodes)
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
	let vUp = CGEvent(keyboardEventSource: src, virtualKey: 9, keyDown: false)!
	vDown.flags = .maskCommand
	vUp.flags = .maskCommand
	markSynthetic(vDown)
	markSynthetic(vUp)
	vDown.post(tap: .cghidEventTap)
	vUp.post(tap: .cghidEventTap)

	usleep(300_000)
	pb.clearContents()
	for (typeStr, restoredData) in oldContents {
		pb.setData(restoredData, forType: NSPasteboard.PasteboardType(typeStr))
	}

	respond(true, "Typed \(text.count) characters")

case "press_key":
	guard let key = cmd.key?.lowercased(), !key.isEmpty else {
		respond(false, "Missing key")
	}
	requireAccessibility("keyboard input")

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
	let up = CGEvent(keyboardEventSource: src, virtualKey: keycode, keyDown: false)!
	down.flags = flags
	up.flags = flags
	markSynthetic(down)
	markSynthetic(up)
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
	markSynthetic(event)
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

	let preMove = CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)!
	markSynthetic(preMove)
	preMove.post(tap: .cghidEventTap)
	usleep(40_000)
	let movedActual = requireCursor(at: point, action: "Mouse move before click")

	if isRight {
		let down = CGEvent(mouseEventSource: src, mouseType: .rightMouseDown, mouseCursorPosition: point, mouseButton: .right)!
		let up = CGEvent(mouseEventSource: src, mouseType: .rightMouseUp, mouseCursorPosition: point, mouseButton: .right)!
		markSynthetic(down)
		markSynthetic(up)
		down.post(tap: .cghidEventTap)
		usleep(50_000)
		up.post(tap: .cghidEventTap)
	} else {
		let down = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)!
		let up = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)!
		markSynthetic(down)
		markSynthetic(up)
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
	let point = CGPoint(x: x, y: y)
	let src = CGEventSource(stateID: .hidSystemState)
	let preMove = CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)!
	markSynthetic(preMove)
	preMove.post(tap: .cghidEventTap)
	usleep(40_000)
	_ = requireCursor(at: point, action: "Mouse move before double click")
	for i in 0..<2 {
		let down = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)!
		let up = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)!
		down.setIntegerValueField(.mouseEventClickState, value: Int64(i + 1))
		up.setIntegerValueField(.mouseEventClickState, value: Int64(i + 1))
		markSynthetic(down)
		markSynthetic(up)
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
	let point = CGPoint(x: x, y: y)
	let src = CGEventSource(stateID: .hidSystemState)
	let event = CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)!
	markSynthetic(event)
	event.post(tap: .cghidEventTap)
	usleep(30_000)
	let actual = requireCursor(at: point, action: "Mouse move")
	respond(true, "Moved to \(describe(point: point)) — verified at \(describe(point: actual))")

case "drag":
	guard let x = cmd.x, let y = cmd.y, let x2 = cmd.x2, let y2 = cmd.y2 else {
		respond(false, "Missing coordinates (need x, y, x2, y2)")
	}
	requireAccessibility("mouse input")

	let from = CGPoint(x: x, y: y)
	var to = CGPoint(x: x2, y: y2)
	let primaryH = NSScreen.screens.first?.frame.height ?? 0

	guard let startScreen = NSScreen.screens.first(where: { screen in
		let frame = screen.frame
		let cgMinY = primaryH - frame.maxY
		let cgMaxY = primaryH - frame.minY
		return from.x >= frame.minX && from.x <= frame.maxX &&
			   from.y >= cgMinY && from.y <= cgMaxY
	}) else {
		respond(false, "Start position not on any screen: (\(Int(x)),\(Int(y)))")
	}

	let frame = startScreen.frame
	let cgMinY = primaryH - frame.maxY
	let cgMaxY = primaryH - frame.minY
	to.x = max(frame.minX, min(frame.maxX - 1, to.x))
	to.y = max(cgMinY, min(cgMaxY - 1, to.y))

	let src = CGEventSource(stateID: .hidSystemState)
	let moveStart = CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: from, mouseButton: .left)!
	markSynthetic(moveStart)
	moveStart.post(tap: .cghidEventTap)
	usleep(50_000)
	_ = requireCursor(at: from, action: "Mouse move before drag")

	let dragDown = CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: from, mouseButton: .left)!
	markSynthetic(dragDown)
	dragDown.post(tap: .cghidEventTap)
	usleep(60_000)

	let steps = 30
	for i in 1...steps {
		let progressFraction = Double(i) / Double(steps)
		var progress = CGPoint(
			x: from.x + (to.x - from.x) * progressFraction,
			y: from.y + (to.y - from.y) * progressFraction
		)
		progress.x = max(frame.minX, min(frame.maxX - 1, progress.x))
		progress.y = max(cgMinY, min(cgMaxY - 1, progress.y))
		let dragMove = CGEvent(mouseEventSource: src, mouseType: .leftMouseDragged, mouseCursorPosition: progress, mouseButton: .left)!
		markSynthetic(dragMove)
		dragMove.post(tap: .cghidEventTap)
		usleep(12_000)
	}

	usleep(40_000)
	let dragUp = CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: to, mouseButton: .left)!
	markSynthetic(dragUp)
	dragUp.post(tap: .cghidEventTap)
	usleep(30_000)
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
	default:
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
	let point = CGPoint(x: x, y: y)
	let src = CGEventSource(stateID: .hidSystemState)
	let startPos = currentCursorPositionCG() ?? point

	for i in 0...20 {
		let progress = Double(i) / 20.0
		let mid = CGPoint(
			x: startPos.x + (point.x - startPos.x) * progress,
			y: startPos.y + (point.y - startPos.y) * progress
		)
		let event = CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: mid, mouseButton: .left)!
		markSynthetic(event)
		event.post(tap: .cghidEventTap)
		usleep(25_000)
	}

	let finalActual = requireCursor(at: point, action: "Slow mouse move")
	respond(true, "Slowly moved to \(describe(point: point)) — verified at \(describe(point: finalActual))")

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
			usleep(100_000)
			respond(true, "Activated \(name)")
		} else {
			respond(false, "Failed to activate \(name)")
		}
	} catch {
		respond(false, "Error activating app: \(error.localizedDescription)")
	}

case "ax_snapshot":
	requireAccessibility("accessibility automation")
	let snapshot = buildSnapshot(limit: max(20, min(cmd.limit ?? 160, 400)))
	respond(true, encodeJSONString(snapshot))

case "ax_find":
	requireAccessibility("accessibility automation")
	guard let query = cmd.query, !query.isEmpty else {
		respond(false, "Missing query")
	}
	let candidates = topCandidates(query: query, requestedRole: cmd.role ?? "", exact: cmd.exact ?? false, limit: max(1, min(cmd.limit ?? 8, 20)))
	let response = AXFindResponse(count: candidates.count, matches: candidateSummaries(candidates))
	respond(true, encodeJSONString(response))

case "ax_press":
	requireAccessibility("accessibility automation")
	guard let query = cmd.query, !query.isEmpty else {
		respond(false, "Missing query")
	}
	let candidates = topCandidates(query: query, requestedRole: cmd.role ?? "", exact: cmd.exact ?? false, limit: 8)
	if candidates.isEmpty {
		respond(false, "No accessibility element matched \"\(query)\"")
	}
	if candidates.count > 1 && candidates[0].score == candidates[1].score {
		let response = ["ambiguous": true, "matches": candidateSummaries(candidates)] as [String: Any]
		if let data = try? JSONSerialization.data(withJSONObject: response),
		   let json = String(data: data, encoding: .utf8) {
			respond(true, json)
		}
	}
	let target = resolveActionTarget(for: candidates[0])
	_ = setFocused(target)
	if performPress(target) {
		let message = ["message": "Activated \"\(candidates[0].text)\""] as [String: Any]
		if let data = try? JSONSerialization.data(withJSONObject: message),
		   let json = String(data: data, encoding: .utf8) {
			respond(true, json)
		}
	}
	respond(false, "Matched \"\(candidates[0].text)\" but could not perform an accessibility action")

case "ax_focus":
	requireAccessibility("accessibility automation")
	guard let query = cmd.query, !query.isEmpty else {
		respond(false, "Missing query")
	}
	let candidates = topCandidates(query: query, requestedRole: cmd.role ?? "", exact: cmd.exact ?? false, limit: 4)
	guard let candidate = candidates.first else {
		respond(false, "No accessibility element matched \"\(query)\"")
	}
	if setFocused(candidate.element) || (candidate.parent != nil && setFocused(candidate.parent!)) {
		let message = ["message": "Focused \"\(candidate.text)\""] as [String: Any]
		if let data = try? JSONSerialization.data(withJSONObject: message),
		   let json = String(data: data, encoding: .utf8) {
			respond(true, json)
		}
	}
	respond(false, "Matched \"\(candidate.text)\" but could not focus it")

case "ax_set_value":
	requireAccessibility("accessibility automation")
	guard let value = cmd.value, !value.isEmpty else {
		respond(false, "Missing value")
	}
	let candidate: AXCandidate? = {
		guard let query = cmd.query, !query.isEmpty else { return nil }
		return topCandidates(query: query, requestedRole: cmd.role ?? "", exact: cmd.exact ?? false, limit: 4).first
	}()
	guard let target = resolveValueTarget(for: candidate) else {
		respond(false, "No editable accessibility element is focused or matched the query")
	}
	_ = setFocused(target)
	if setValue(target, value) {
		let detail = candidate?.text.isEmpty == false ? candidate!.text : "focused field"
		let message = ["message": "Set value on \(detail)"] as [String: Any]
		if let data = try? JSONSerialization.data(withJSONObject: message),
		   let json = String(data: data, encoding: .utf8) {
			respond(true, json)
		}
	}
	respond(false, "Matched an accessibility element but could not set its value")

default:
	respond(false, "Unknown action: \(cmd.action)")
}

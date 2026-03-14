const { normalizeText } = require('./memory-store');
const { PILLARS } = require('../../shared/core-principles');

function containsAny(text, patterns) {
	const normalized = normalizeText(text);
	return patterns.some((pattern) => normalized.includes(normalizeText(pattern)));
}

function matchesTransliteratedWhatAreYouDoing(text = '') {
	return /(হোয়াট|হোয়াট|ह्वाट|व्हाट|वाट)\s+(আর|आर|आर)\s+(ইউ|यू)\s+(ডুইং|ডूইং|डुइंग|डूइंग)/i.test(String(text || '').trim());
}

function matchesTransliteratedWhatsDoneAlready(text = '') {
	return /(হোয়াটস|হোয়াটস|व्हाट्स|व्हाट)\s+(ডান|ডোন|डन|डोन)\s+(অলরেডি|আলরেডি|अलरेडी|ऑलरेडी)/i.test(String(text || '').trim());
}

const POINTER_TOOL_NAMES = new Set(['click_at', 'double_click', 'mouse_move', 'drag']);

function hasPointerActivity(events = []) {
	return events.some((item) => item && POINTER_TOOL_NAMES.has(item.name));
}

function hasRecentPointerContext(context = {}) {
	const recentTools = Array.isArray(context.recentToolExecutions) ? context.recentToolExecutions.slice(-6) : [];
	return recentTools.some((item) => {
		if (!item || !item.name) return false;
		return POINTER_TOOL_NAMES.has(item.name) || (item.name === 'run_ui_task' && item.success === false);
	});
}

function looksLikeGenericPointerCorrection(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;
	if (/\b(screen|screenshot|display|monitor|status bar|menu bar|default browser|default mail|default app)\b/.test(normalized)) {
		return false;
	}
	if (/\b(what are you doing|whats done already|what's done already|keep working|continue working)\b/.test(normalized)) {
		return false;
	}
	if (/\b(click|open|tap|press|select|move|drag)\b.{0,20}\b(there|here|that|this|it)\b/.test(normalized)) return true;
	if (/\b(move|drag)\b.{0,20}\b(mouse|cursor|pointer)\b/.test(normalized)) return true;
	if (/\b(make your move|move your move|your move)\b/.test(normalized)) return true;
	return /[^\u0000-\u007f]/.test(text) && normalized.split(/\s+/).length <= 12;
}

function buildScreenReferencePolicyPayload(text = '', confidence = 0.94) {
	return {
		kind: 'fallback_policy',
		scope: 'machine',
		key: 'policy.screen_reference_direct_action',
		value: {
			enabled: true,
			message: 'When the user gives a deictic or otherwise ambiguous pointer correction during active UI work, treat it as a screen-referential request. Use the latest screen context and visible target instead of asking them to restate or point again.',
			evidence: text.trim(),
		},
		source: 'user_correction',
		confidence,
		evidence: text,
	};
}

function buildActionVerificationPolicyPayload(text = '', confidence = 0.97) {
	return {
		kind: 'fallback_policy',
		scope: 'machine',
		key: 'policy.action_verification',
		value: {
			enabled: true,
			message: 'For screen-based actions, never claim "clicked", "opened", or "went there" until a fresh screenshot, DOM/app checkpoint, or other direct verification confirms the result. Do not rely on stale screenshots when deciding where to click. If verification is unavailable, say the action is unverified or blocked instead of claiming success.',
			evidence: text.trim(),
		},
		source: 'user_correction',
		confidence,
		evidence: text,
	};
}

function buildPreClickPreparationPolicyPayload(text = '', confidence = 0.96) {
	return {
		kind: 'fallback_policy',
		scope: 'machine',
		key: 'policy.pre_click_preparation',
		value: {
			enabled: true,
			message: 'When a UI task depends on a specific app or window, open or focus that app first, refresh the screen context, and only then use pointer actions or resolve visible targets. Treat run_ui_task -> open_app recovery as missing preparation rather than a reason to ask the user for the same guidance again.',
			evidence: text.trim(),
		},
		source: 'observed_recovery',
		confidence,
		evidence: text,
	};
}

function buildPositiveFeedbackClosurePolicyPayload(text = '', confidence = 0.96) {
	return {
		kind: 'fallback_policy',
		scope: 'machine',
		key: 'policy.positive_feedback_closure',
		value: {
			enabled: true,
			message: 'When the user gives a short approval or satisfaction update such as saying the latest result looks good now, treat it as confirmation that the current direction worked. Acknowledge briefly, preserve the current task context, and do not reopen task discovery or ask for the same guidance again.',
			evidence: text.trim(),
		},
		source: 'user_correction',
		confidence,
		evidence: text,
	};
}

function buildCancellationClosurePolicyPayload(text = '', confidence = 0.96) {
	return {
		kind: 'fallback_policy',
		scope: 'machine',
		key: 'policy.cancellation_closure',
		value: {
			enabled: true,
			message: 'When the user gives a short cancellation or dismissal acknowledgment such as "never mind" or "cancelling works", acknowledge briefly, preserve the current task context, and stop asking them to restate or re-approve the cancellation.',
			evidence: text.trim(),
		},
		source: 'user_correction',
		confidence,
		evidence: text,
	};
}

function isStatusBarIconCorrection(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;
	const mentionsBar = /\b(status bar|menu bar)\b/.test(normalized);
	const mentionsIcon = /\b(icon|indicator|toggle|item)\b/.test(normalized)
		|| /\b(battery|wifi|wi-fi|bluetooth|volume|clock|focus|control center)\b/.test(normalized);
	const asksAboutVisibility = /\b(do|can|now do|now can|are)\s+you\s+(see|seeing|spot|find|notice|read)\b/.test(normalized);
	return mentionsBar && mentionsIcon && asksAboutVisibility;
}

function isScreenReferenceCorrection(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;
	const mentionsScreen = /\b(screen|screenshot|display|monitor)\b/.test(normalized);
	const asksAboutVision = /\b(can you|cant you|cannot you|why (?:can|cant|cannot) you|you can)\s+(see|watch|read)\b/.test(normalized);
	const deicticAction = /\b(click|open|tap|select|press)\b/.test(normalized) && /\b(there|here|that|this|where i (?:said|told you|pointed)|the one i (?:said|told you))\b/.test(normalized);
	return (mentionsScreen && /\b(click|open|tap|select|press|see|read)\b/.test(normalized)) || asksAboutVision || deicticAction;
}

function isVisibleControlReferenceCorrection(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;
	const mentionsNamedControl = /\b(focus toggle|focus mode toggle|mute button|share switch|toggle|button|switch|checkbox|tab|icon)\b/.test(normalized);
	const asksAboutSeeingControl = /\b(do|can|did)\s+you\s+see\b/.test(normalized) && mentionsNamedControl;
	const deicticControlAction = mentionsNamedControl
		&& /\b(click|open|tap|select|press|toggle|enable|disable|turn on|turn off)\b/.test(normalized)
		&& /\b(there|here|that|this|it|the)\b/.test(normalized);
	return asksAboutSeeingControl || deicticControlAction;
}

function isScreenVisibilityQuestion(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;
	if (!/\b(screen|screenshot|display|monitor)\b/.test(normalized)) return false;
	if (/\b(click|open|tap|select|press|drag|scroll|type)\b/.test(normalized)) return false;
	if (/\b(there|here|that|this)\b/.test(normalized)) return false;
	return /\b(do|can|cant|cannot|are)\s+you\s+(see|seeing|watch|watching|read|reading)\b/.test(normalized)
		|| /\bdo you see my screen\b/.test(normalized)
		|| /\bcan you see my screen\b/.test(normalized)
		|| /\byou see my screen\b/.test(normalized);
}

function isActionVerificationGuidance(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;
	const mentionsVerification = /\b(verif\w*|check|confirm(?:ation|ed)?|validated?)\b/.test(normalized);
	const mentionsFalseClaim = /\b(you say you did|you said you did|say you clicked|say you opened|say you went|already went to that page|not actually gone to that page|havent actually gone to that page|have not actually gone to that page)\b/.test(normalized);
	const mentionsStaleScreen = /\b(outdated|stale|old)\b.{0,20}\b(screen|screenshot|capture|image)s?\b|\b(screen|screenshot|capture|image)s?\b.{0,20}\b(outdated|stale|old)\b/.test(normalized);
	const mentionsPointerAction = /\b(click|tap|open|go|went|gone|page)\b/.test(normalized);
	const mentionsTiming = /\bbefore (?:you )?(?:tap|click|say|claim|report)\b/.test(normalized);
	return (
		(mentionsVerification && (mentionsFalseClaim || mentionsStaleScreen || mentionsPointerAction))
		|| (mentionsFalseClaim && mentionsStaleScreen)
		|| (mentionsVerification && mentionsTiming)
	);
}

function needsPreparationBeforeClick(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;
	return (
		/\bbefore (?:you )?(?:click|right click|double click)\b/.test(normalized)
		|| /\b(?:need|needs|have|has|had|should|must|want|wants)\s+to\b.{0,80}\bbefore\b.{0,40}\b(?:click|right click|double click)\b/.test(normalized)
		|| /\b(?:first|start by)\b.{0,80}\b(?:then|before)\b.{0,40}\b(?:click|right click|double click)\b/.test(normalized)
		|| /\b(?:prepare|prep|focus|open|run|search|launch)\b.{0,80}\b(?:before|then)\b.{0,40}\b(?:click|right click|double click)\b/.test(normalized)
	);
}

function isScreenReferentialGoal(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;
	if (/\b(click|open|tap|press|select)\b.{0,20}\b(there|here|that|this|it)\b/.test(normalized)) return true;
	if (/\b(where i (?:said|told you|pointed)|the one i (?:said|told you))\b/.test(normalized)) return true;
	if (/\b(written there|what is written there|that channel|that link|that button|that result)\b/.test(normalized)) return true;
	return false;
}

function isAutonomousContinuationGuidance(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;
	const mentionsContinue = /\b(keep working(?: on (?:it|this|the task))?|keep going|continue working|continue on (?:it|this|the task)|dont stop|don't stop|until i get back|while im away|while i'm away|when im back|when i'm back)\b/.test(normalized);
	const mentionsAbsenceWindow = /\b(i(?:'| a)?ll get back (?:in|after) (?:a |few |couple of )?hours?|get back in a few hours|be back in a few hours|until then|till then|til then)\b/.test(normalized);
	const mentionsBacklogClearance = /\b(clear(?: out)? (?:all )?(?:your|the)? ?(?:todo|to do|to-do|tasks?|backlog)|finish (?:off )?(?:your|the)? ?(?:todo|to do|tasks?|backlog)|wrap up (?:your|the)? ?(?:todo|to do|tasks?|backlog))\b/.test(normalized);
	const mentionsSelfVerification = /\b(self[- ]?verif(?:y|ying)|keep (?:self )?verifying|verify yourself|verify your(?:self| work)|check your own work|keep checking)\b/.test(normalized);
	const mentionsSelfInput = /\b(giv(?:e|ing) yourself input|feed yourself input|generate your own (?:next )?input|decide the next step yourself|figure out the next step yourself)\b/.test(normalized);
	const mentionsAutonomy = /\b(work autonomously|autonomously|on your own|by yourself)\b/.test(normalized);
	return (
		((mentionsContinue || mentionsAbsenceWindow) && (mentionsSelfVerification || mentionsSelfInput || mentionsAutonomy || mentionsBacklogClearance))
		|| (mentionsContinue && mentionsBacklogClearance)
		|| (mentionsAbsenceWindow && mentionsBacklogClearance)
		|| (mentionsSelfVerification && mentionsSelfInput)
	);
}

function isProgressAccountabilityGuidance(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;
	const asksCurrentWork = /\b(what are you (?:doing|working on)|whatre you doing|whats happening|what is happening|where are you at|what's the status|status update|progress update)\b/.test(normalized)
		|| matchesTransliteratedWhatAreYouDoing(text);
	const asksCompletedWork = /\b(what(?:'s| is)? done already|whats done already|what have you done|what did you finish|what is finished|what's finished|done already|already done)\b/.test(normalized)
		|| matchesTransliteratedWhatsDoneAlready(text);
	const asksBoth = (/\bwhat are you doing\b/.test(normalized) || matchesTransliteratedWhatAreYouDoing(text))
		&& (/\bdone already\b/.test(normalized) || matchesTransliteratedWhatsDoneAlready(text));
	return asksCurrentWork || asksBoth || (asksCurrentWork && asksCompletedWork);
}

function isTerminalLogObservabilityGuidance(text = '') {
	const normalized = normalizeText(text);
	if (!normalized && !String(text || '').trim()) return false;
	const mentionsTerminal = /\b(terminal|console)\b/.test(normalized) || /(टर्मिनल|कन्सोल|कंसोल)/.test(text);
	if (!mentionsTerminal) return false;
	const mentionsLogs = /\b(runtime log|runtime logs|run time log|run time logs|logs|log output|console output|terminal output|stdout|stderr)\b/.test(normalized)
		|| /(रन\s*टाइम|रनटाइम|लॉग|लॉग्स|आउटपुट)/.test(text);
	const asksVisibility = /\b(do|can|did|are)\s+you\s+(see|seeing|read|reading|notice|spot)\b/.test(normalized)
		|| /\bdo you see\b/.test(normalized)
		|| /(डू यू सी|सी|रीड|देख)/i.test(text);
	return mentionsTerminal && (mentionsLogs || asksVisibility);
}

function isTaskCreationAccountabilityGuidance(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;
	const mentionsTasks = /\b(task|tasks|todo|to do|backlog)\b/.test(normalized)
		|| /(टास्क|टास्क्स|कामहरू|कामहर|काम)/.test(text);
	const mentionsCreation = /\b(created|create|queued|queue|opened|open|made|added|spawned)\b/.test(normalized)
		|| /(क्रिएटेड|क्रिएट|क्युड|क्यूड|ओपन|बनाए|एडेड)/.test(text);
	const asksOverview = /\b(tell me about|what all|show me|list|summari[sz]e|everything|details?|regarding|regards|for this|for this task|for this issue)\b/.test(normalized)
		|| /(टेल मी|अबाउट|ऑल|एवरीथिंग|डिटेल|रिगार्ड्स|दिस)/.test(text);
	return mentionsTasks && mentionsCreation && asksOverview;
}

function isPositiveFeedbackClosureGuidance(text = '') {
	const raw = String(text || '').trim();
	if (!raw) return false;
	const normalized = normalizeText(raw);
	if (!normalized) return false;
	const shortApproval = normalized.split(/\s+/).length <= 10;
	const englishApproval = /\b(?:this|it|that)?\s*(?:is|looks|feels)?\s*(?:pretty\s+|really\s+|much\s+)?(?:nice|good|better|great|solid)\s+now\b/.test(normalized)
		|| /\blooks\s+(?:good|better|great|nice)\s+now\b/.test(normalized)
		|| /\b(?:much\s+)?better\s+now\b/.test(normalized);
	const devanagariApproval = /(ओ|ओह|oh)\s+(दिस|this)\s+(इज|is)\s+((?:प्रीटी|प्रिटी|pretty)\s+)?(नाइस|nice|गुड|good|बेटर|better)\s+(नाउ|now)/i.test(raw);
	return shortApproval && (englishApproval || devanagariApproval);
}

function isCancellationClosureGuidance(text = '') {
	const raw = String(text || '').trim();
	if (!raw) return false;
	const normalized = normalizeText(raw);
	if (!normalized) return false;
	const shortAck = normalized.split(/\s+/).length <= 8;
	if (!shortAck) return false;
	const mentionsDismissal = /\b(never mind|nevermind|cancel|canceling|cancelling|cancelled|dismiss|skip it|leave it|forget it)\b/.test(normalized)
		|| /(नेवर\s*माइन्ड|नेभर\s*माइन्ड|एवर\s*माइन्ड|कैंसिल(?:िंग)?|क्यान्सिल(?:िंग)?|क्यान्सल(?:िंग)?)/i.test(raw);
	const mentionsAck = /\b(ok|okay|works?|worked|fine|good|alright|all right)\b/.test(normalized)
		|| /(ओके|ओक|वर्क्स|वर्क|ठिक|ठीक)/i.test(raw);
	const isBareNeverMind = /^(never mind|nevermind|forget it|leave it)$/i.test(normalized)
		|| /^(नेवर\s*माइन्ड|नेभर\s*माइन्ड|एवर\s*माइन्ड)$/i.test(raw);
	return isBareNeverMind || (mentionsDismissal && mentionsAck);
}

function isDirectTaskCreationGuidance(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;
	const mentionsTaskAction = /\b(add|create|queue|open|make)\b.{0,24}\b(task|tasks|todo|to do|backlog)\b/.test(normalized);
	if (!mentionsTaskAction) return false;
	const asksAssistant = /\b(can|could|would|will)\s+you\b/.test(normalized) || normalized.startsWith('please ');
	const hasTaskContent = /\b(task|tasks|todo|to do|backlog)\b.{0,120}\b(to|for|about)\b/.test(normalized)
		|| /\bbenchmark|benchmarks|performance|profile|profiling|measure|measurement|latency|throughput|regression\b/.test(normalized);
	return asksAssistant && hasTaskContent;
}

function isEditorSelfImprovementGeneralizationGuidance(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;
	const mentionsWhyShouldITellYouThat = (
		/\b(?:why|what(?:\s+the\s+fuck)?)\b.{0,32}\b(?:am i|do i need to|should i|supposed to)\b.{0,28}\b(?:tell|inform|say|mention|explain|repeat)\b.{0,20}\b(?:you|that)\b/.test(normalized)
		|| /(एम|am)\s+आई\s+(?:सपोज(?:्ड)?|सज|supposed)\s+(?:टु|टू|to)\s+(?:इंफॉर्म|इनफॉर्म|टेल|से|inform|tell|say)/i.test(text)
		|| /(म(?:ै|े)ले|मलाई)\s+(?:फेरि\s*)?(?:भन्नु|बताउनु|सुनाउनु)\s+पर्ने/i.test(text)
	);
	const mentionsRepeatedTeaching = (
		/\b(keep telling you|keep teaching you|ive just taught you|i've just taught you|stop asking|same guidance|every time)\b/.test(normalized)
		|| /\b(how many times do i have to tell you|i have to tell you again|told you already|already told you|why do i need to tell you again)\b/.test(normalized)
		|| /(कति\s*चोटी|कति\s*पटक|कति\s*चोटि|बार\s*बार|फेरि\s*भन्नु|फेरि\s*भन|कतिचोटी)/i.test(text)
		|| /(বলেছি|বলেন|বলতে|বারবার|কত\s*বার|আবার\s*বল)/i.test(text)
	);
	const mentionsNoNeedToAskAgain = (
		/\b(?:dont|don't|do not|no need to)\b.{0,20}\b(?:ask|re-ask|reask|repeat|clarify|question)\b/.test(normalized)
		|| /\b(?:stop|quit)\b.{0,20}\b(?:asking|re-asking|reasking|repeating)\b/.test(normalized)
		|| /(सोध्न(?:े|ु)?|प्रश्न\s*गर्न|फेरि\s*सोध्न)\s*पर्दैन/i.test(text)
		|| /के\s+\S+\s+हो\s+पर्दैन\s*नि?/i.test(text)
	);
	const mentionsSelfModification = /\b(modify your own code|change your own code|improve yourself|fix yourself)\b/.test(normalized);
	const mentionsGeneralization = /\b(generic way|generally|broader range|broader set|not in a specific problem|not specific problem solving|similar problems|range of problems)\b/.test(normalized);
	return mentionsNoNeedToAskAgain
		|| mentionsWhyShouldITellYouThat
		|| (mentionsRepeatedTeaching && (mentionsSelfModification || mentionsGeneralization || !/^\s*$/.test(String(text || ''))));
}

function isThoroughExecutionGuidance(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;
	return (
		/\b(do it properly|do it well|do it right|do it thoroughly|do it carefully|be more thorough|be thorough|be more decisive|handle it properly|properly this time|just do it|do it already)\b/.test(normalized)
		|| /\b(?:all\s*right|alright)\b.{0,20}\bdo it\b/.test(normalized)
		|| /\bdo it\b.{0,30}\b(?:dont|don't)\s+hesitate\b/.test(normalized)
		|| /\b(?:dont|don't)\s+hesitate\b/.test(normalized)
		|| /बेसरी\s+गर/.test(text)
	);
}

function isConflictResolutionContinuationGuidance(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;
	const mentionsConflict = /\b(resolve|fix|handle|sort out|merge)\b.{0,24}\bconflicts?\b|\bconflicts?\b/.test(normalized)
		|| /(कॉन्फ्लिक्ट|कन्फ्लिक्ट|कन्फ्लीक्ट|मर्ज\s*कॉन्फ्लिक्ट|कन्फ्लिक्ट्स)/i.test(text);
	const mentionsResolve = /\b(resolve|fix|handle|sort out|merge)\b/.test(normalized)
		|| /(रिजॉल्व|रिजल्व|रिजल्भ|सुल्झा)/i.test(text);
	const mentionsContinue = /\b(continue|keep going|keep working|move on|carry on)\b/.test(normalized)
		|| /(कंटिन्यू|कन्टिन्यू|जारी|अगाडि\s*बढ)/i.test(text);
	const mentionsLightTouchReview = (
		/\b(without|dont|don't|avoid|stop)\b.{0,24}\b(over[- ]?read(?:ing)?|overthink(?:ing)?|reading too much|digging too deep|deep reading)\b/.test(normalized)
		|| (/\b(either|both)\b.{0,18}\b(change|changes|side|sides|version|versions|diff|diffs)\b/.test(normalized)
			&& /\b(over[- ]?read(?:ing)?|overthink(?:ing)?|reading too much)\b/.test(normalized))
		|| /(ओवर\s*रेड(?:िंग|ing)?|ओभर\s*रेड(?:िंग|ing)?)/i.test(text)
		|| (/(इदर|ईदर|either)/i.test(text) && /(चेंज|चेन्ज|changes?)/i.test(text))
	);
	return mentionsConflict && mentionsResolve && mentionsContinue && mentionsLightTouchReview;
}

const ASSISTANT_NAME_PATTERN = /(?:iris|iris[- ]?chan|एरिस|इरिस|आइरिस|आयरिश|आईरिस|आईरिश)/iu;

function mentionsAssistantName(text = '') {
	return ASSISTANT_NAME_PATTERN.test(String(text || '').trim());
}

function isPresenceReassuranceGuidance(text = '') {
	const normalized = normalizeText(text);
	if (!normalized) return false;
	const asksWhereabouts = /\b(where are you|where you at|where're you|wherere you|hello where are you)\b/.test(normalized);
	const asksAvailability = /\b(are you there|you there|are you here|hello are you there|can you hear me|are you listening)\b/.test(normalized);
	const asksGreetingStatus = /\b(?:hi|hii|hiii|hello|helo|hey|yo)\b.*\b(?:what(?:'s| is)? going on|whats going on|what(?:'s| is)? happening|whats happening)\b/.test(normalized)
		|| /\b(?:what(?:'s| is)? going on|whats going on|what(?:'s| is)? happening|whats happening)\b.*\b(?:iris|iris chan)\b/.test(normalized);
	const raw = String(text || '').trim();
	const rawTerms = raw.split(/\s+/).filter(Boolean);
	const greetingLead = /^(?:hi|hii|hiii|hello|helo|hey|yo|sup|namaste|namaskar|हेलो|हैलो|हेल्लो|नमस्ते|नमस्कार)[,\s!?.…-]+/iu;
	const greetingTail = raw.replace(greetingLead, '').trim();
	const greetsAssistantByName = !!greetingTail
		&& rawTerms.length <= 4
		&& mentionsAssistantName(greetingTail)
		&& !/\b(open|click|type|run|search|find|fix|edit|write|create)\b/i.test(normalizeText(greetingTail));
	const plainGreeting = rawTerms.length > 0
		&& rawTerms.length <= 3
		&& /^(?:hi|hii|hiii|hello|helo|hey|yo|sup|namaste|namaskar|हेलो|हैलो|हेल्लो|नमस्ते|नमस्कार)[!?.…\s]*$/iu.test(raw)
		&& !/\b(open|click|type|run|search|find|fix|edit|write|create)\b/i.test(raw);
	const shortNoisyListeningPing = rawTerms.length > 0
		&& rawTerms.length <= 4
		&& /(सुन(?:ेको|ि?र(?:हे|हुन)|े|्छ|्?नु)|सुनेको|सुनेको)/i.test(raw)
		&& !/(स्क्रिन|स्क्रीन|टर्मिनल|कन्सोल|कंसोल|लॉग|स्टेटस|मेनु|बार|टास्क|कन्फ्लिक्ट|क्लिक|ओपन|पोयम|कविता)/i.test(raw);
	const nepaliPresence = /(हेलो\s*)?(कता|कहाँ|कताहो|कहां)\s*(हो|छौ|छ|chau|cha|chhau)?\s*(साथी)?/.test(normalized)
		|| /\b(kata ho|kata chau|kata cha|kahaa chau|kaha chau|sathi)\b/.test(normalized);
	return asksWhereabouts || asksAvailability || asksGreetingStatus || plainGreeting || greetsAssistantByName || nepaliPresence || shortNoisyListeningPing;
}

function isBareAssistantAttentionPing(text = '', context = {}) {
	const raw = String(text || '').trim();
	if (!raw) return false;
	const normalized = normalizeText(raw);
	if (!normalized) return false;
	const stripped = raw.replace(/^(?:hi|hello|helo|hey|yo|ok|okay|namaste|namaskar|हेलो|हैलो|हेल्लो|नमस्ते|नमस्कार)[,\s!?.…-]+/iu, '').trim();
	const directNamePing = !!stripped
		&& raw.split(/\s+/).filter(Boolean).length <= 4
		&& /^[\p{L}\p{M}\s\-!.?…]+$/u.test(raw)
		&& mentionsAssistantName(stripped);
	if (!directNamePing) return false;
	const recentTurns = Array.isArray(context.recentTurns) ? context.recentTurns.slice(-6) : [];
	const activeConversation = recentTurns.some((turn) => turn && String(turn.role || '') !== 'user' && String(turn.text || '').trim());
	return activeConversation || hasRecentPointerContext(context);
}

class LearningClassifier {
	classifyConversation(text = '', context = {}) {
		const normalized = normalizeText(text);
		if (!normalized) return null;
		if (isAutonomousContinuationGuidance(normalized)) {
			return {
				type: 'memory',
				key: 'policy.autonomous_self_drive',
				pillar: PILLARS.AUTONOMY.name,
				reason: 'autonomous continuation guidance',
				payload: {
					kind: 'fallback_policy',
					scope: 'machine',
					key: 'policy.autonomous_self_drive',
					value: {
						enabled: true,
						message: 'During autonomous coding or self-fix work, keep iterating without waiting for more user input. Self-verify each step, use verification results as the next input, keep working until the user returns, and clear the remaining todo/backlog before stopping unless a concrete blocker is reached.',
						evidence: text.trim(),
					},
					source: 'user_correction',
					confidence: 0.98,
					evidence: text,
				},
			};
		}
		if (isProgressAccountabilityGuidance(normalized)) {
			return {
				type: 'memory',
				key: 'policy.progress_accountability',
				pillar: PILLARS.VERIFICATION.name,
				reason: 'progress accountability guidance',
				payload: {
					kind: 'fallback_policy',
					scope: 'machine',
					key: 'policy.progress_accountability',
					value: {
						enabled: true,
						message: 'When the user asks what you are doing or what is already done during active work, answer with a concise progress report: current task, concrete completed work, next step, and any blocker. Do not ask them to restate the task if active work context already exists.',
						evidence: text.trim(),
					},
					source: 'user_correction',
					confidence: 0.97,
					evidence: text,
				},
			};
		}
		if (isTerminalLogObservabilityGuidance(text)) {
			return {
				type: 'memory',
				key: 'policy.terminal_log_observability',
				pillar: PILLARS.VERIFICATION.name,
				reason: 'terminal log observability guidance',
				payload: {
					kind: 'fallback_policy',
					scope: 'machine',
					key: 'policy.terminal_log_observability',
					value: {
						enabled: true,
						message: 'When the user asks whether you can see terminal output, runtime logs, or console lines that are visible on screen, inspect the visible terminal/log pane and answer concretely from the current screen context instead of asking them to repeat it. If the text is unreadable or capture is stale, report that concrete blocker.',
						evidence: text.trim(),
					},
					source: 'user_correction',
					confidence: 0.97,
					evidence: text,
				},
			};
		}
		if (isTaskCreationAccountabilityGuidance(text)) {
			return {
				type: 'memory',
				key: 'policy.task_creation_accountability',
				pillar: PILLARS.AUTONOMY.name,
				reason: 'task creation accountability guidance',
				payload: {
					kind: 'fallback_policy',
					scope: 'machine',
					key: 'policy.task_creation_accountability',
					value: {
						enabled: true,
						message: 'When the user asks about tasks you created, queued, or opened for the current work, answer from the active work state and task history instead of asking them to restate it. Summarize each relevant task for this request, its status, completed work, next step, and any blocker. Check tasks.json when available before saying context is missing.',
						evidence: text.trim(),
					},
					source: 'user_correction',
					confidence: 0.97,
					evidence: text,
				},
			};
		}
		if (isDirectTaskCreationGuidance(text)) {
			return {
				type: 'memory',
				key: 'policy.direct_task_creation',
				pillar: PILLARS.AUTONOMY.name,
				reason: 'direct task creation guidance',
				payload: {
					kind: 'fallback_policy',
					scope: 'machine',
					key: 'policy.direct_task_creation',
					value: {
						enabled: true,
						message: 'When the user asks you to add, create, or queue a task and the requested work is clear, create the task directly instead of asking them to restate it. Preserve the requested goal in the task description, infer the active project context when available, and only ask follow-up questions when the task target is genuinely ambiguous.',
						evidence: text.trim(),
					},
					source: 'user_correction',
					confidence: 0.97,
					evidence: text,
				},
			};
		}
		if (isPositiveFeedbackClosureGuidance(text)) {
			return {
				type: 'memory',
				key: 'policy.positive_feedback_closure',
				pillar: PILLARS.LEARNING.name,
				reason: 'positive feedback closure guidance',
				payload: buildPositiveFeedbackClosurePolicyPayload(text, 0.97),
			};
		}
		if (isCancellationClosureGuidance(text)) {
			return {
				type: 'memory',
				key: 'policy.cancellation_closure',
				pillar: PILLARS.AUTONOMY.name,
				reason: 'cancellation closure guidance',
				payload: buildCancellationClosurePolicyPayload(text, 0.97),
			};
		}
		if (isEditorSelfImprovementGeneralizationGuidance(text)) {
			return {
				type: 'memory',
				key: 'policy.editor_self_improvement_generalization',
				pillar: PILLARS.LEARNING.name,
				reason: 'editor self-improvement generalization guidance',
				payload: {
					kind: 'fallback_policy',
					scope: 'machine',
					key: 'policy.editor_self_improvement_generalization',
					value: {
						enabled: true,
						message: 'When repeated user friction reveals a reusable editor or self-modification pattern, update your own code in a generic way instead of fixing only the narrow case. Generalize the learned stop/continuation behavior across similar editor tasks and do not ask for the same guidance again when the surrounding pattern matches.',
						evidence: text.trim(),
					},
					source: 'user_correction',
					confidence: 0.98,
					evidence: text,
				},
			};
		}
		if (isThoroughExecutionGuidance(text)) {
			return {
				type: 'memory',
				key: 'policy.thorough_execution',
				pillar: PILLARS.AUTONOMY.name,
				reason: 'thorough execution guidance',
				payload: {
					kind: 'fallback_policy',
					scope: 'machine',
					key: 'policy.thorough_execution',
					value: {
						enabled: true,
						message: 'When the user gives terse follow-up guidance meaning "do it properly", "just do it", or "don\'t hesitate" during active work, continue the current task without asking them to restate it. Take a stronger end-to-end pass: investigate the root cause, complete the action decisively, rerun verification, and stop only at a concrete blocker.',
						evidence: text.trim(),
					},
					source: 'user_correction',
					confidence: 0.93,
					evidence: text,
				},
			};
		}
		if (isConflictResolutionContinuationGuidance(text)) {
			return {
				type: 'memory',
				key: 'policy.conflict_resolution_continuation',
				pillar: PILLARS.AUTONOMY.name,
				reason: 'conflict resolution continuation guidance',
				payload: {
					kind: 'fallback_policy',
					scope: 'machine',
					key: 'policy.conflict_resolution_continuation',
					value: {
						enabled: true,
						message: 'When resolving conflicts between two change sets during active work, do a light-touch comparison first. Do not over-read either side if the intent is already clear. Preserve compatible intent from both changes, resolve the conflict decisively, and continue the active task without asking for the same guidance again.',
						evidence: text.trim(),
					},
					source: 'user_correction',
					confidence: 0.97,
					evidence: text,
				},
			};
		}
		if (isPresenceReassuranceGuidance(text)) {
			return {
				type: 'memory',
				key: 'policy.presence_reassurance',
				pillar: PILLARS.ANTICIPATION.name,
				reason: 'presence reassurance guidance',
				payload: {
					kind: 'fallback_policy',
					scope: 'machine',
					key: 'policy.presence_reassurance',
					value: {
						enabled: true,
						message: 'When the user greets you, says your name to get your attention, asks where you are, or opens with a quick status ping like "Hello Iris, what\'s going on?", answer briefly that you are here and listening. If active work is already in progress, treat it as a request for a concise status update instead of asking them to restate the task.',
						evidence: text.trim(),
					},
					source: 'user_correction',
					confidence: 0.96,
					evidence: text,
				},
			};
		}
		if (isBareAssistantAttentionPing(text, context)) {
			return {
				type: 'memory',
				key: 'policy.presence_reassurance',
				pillar: PILLARS.ANTICIPATION.name,
				reason: 'assistant attention ping guidance',
				payload: {
					kind: 'fallback_policy',
					scope: 'machine',
					key: 'policy.presence_reassurance',
					value: {
						enabled: true,
						message: 'When the user greets you, says your name to get your attention, asks where you are, or opens with a quick status ping like "Hello Iris, what\'s going on?", answer briefly that you are here and listening. If active work is already in progress, treat it as a request for a concise status update instead of asking them to restate the task.',
						evidence: text.trim(),
					},
					source: 'user_correction',
					confidence: 0.97,
					evidence: text,
				},
			};
		}
		if (isStatusBarIconCorrection(normalized)) {
			return {
				type: 'memory',
				key: 'policy.status_bar_icon_visibility',
				pillar: PILLARS.ANTICIPATION.name,
				reason: 'status-bar icon visibility guidance',
				payload: {
					kind: 'fallback_policy',
					scope: 'machine',
					key: 'policy.status_bar_icon_visibility',
					value: {
						enabled: true,
						message: 'When the user asks about a visible status or menu bar icon such as the battery indicator, inspect the latest screen context and answer concretely from what is visible instead of asking them to restate it.',
					},
					source: 'user_correction',
					confidence: 0.98,
					evidence: text,
				},
			};
		}
		if (needsPreparationBeforeClick(normalized)) {
			return {
				type: 'memory',
				key: 'policy.pre_click_preparation',
				pillar: PILLARS.VERIFICATION.name,
				reason: 'pre-click preparation guidance',
				payload: {
					kind: 'fallback_policy',
					scope: 'machine',
					key: 'policy.pre_click_preparation',
					value: {
						enabled: true,
						message: 'When a click depends on prior setup, do the preparation first and verify the context before using pointer tools.',
						evidence: text.trim(),
					},
					source: 'user_correction',
					confidence: 0.94,
					evidence: text,
				},
			};
		}
		if (containsAny(normalized, ['default browser', 'default mail', 'default app'])) {
			return {
				type: 'memory',
				key: 'policy.default_app_resolution',
				pillar: PILLARS.LEARNING.name,
				reason: 'default-app guidance',
				payload: {
					kind: 'fallback_policy',
					scope: 'machine',
					key: 'policy.default_app_resolution',
					value: {
						preferNativeMacOS: true,
						message: 'Prefer native macOS system-resolution before random app guesses for default-app requests.',
					},
					source: 'user_correction',
					confidence: 0.98,
					evidence: text,
				},
			};
		}
		if (containsAny(normalized, ['check system settings', 'native macos', 'do not ask me this again', "don't ask me this again"])) {
			return {
				type: 'memory',
				key: 'policy.native_resolution_before_guess',
				pillar: PILLARS.LEARNING.name,
				reason: 'fallback preference guidance',
				payload: {
					kind: 'fallback_policy',
					scope: 'user',
					key: 'policy.native_resolution_before_guess',
					value: { enabled: true, message: text.trim() },
					source: 'user_correction',
					confidence: 0.92,
					evidence: text,
				},
			};
		}
		if (isScreenVisibilityQuestion(normalized)) {
			return {
				type: 'memory',
				key: 'policy.screen_visibility_reassurance',
				pillar: PILLARS.ANTICIPATION.name,
				reason: 'screen visibility reassurance guidance',
				payload: {
					kind: 'fallback_policy',
					scope: 'machine',
					key: 'policy.screen_visibility_reassurance',
					value: {
						enabled: true,
						message: 'When the user asks whether you can see the screen, answer yes and clarify that you see periodic screenshots unless capture is unavailable.',
					},
					source: 'user_correction',
					confidence: 0.98,
					evidence: text,
				},
			};
		}
		if (isActionVerificationGuidance(text)) {
			return {
				type: 'core-gap',
				key: 'issue:action-verification',
				pillar: PILLARS.VERIFICATION.name,
				reason: 'action verification guidance',
				payload: {
					issueSignature: 'issue:action-verification',
					description: `Iris should verify screen-based actions with fresh evidence before claiming success or navigation completion: ${text.trim()}`,
					memory: buildActionVerificationPolicyPayload(text, 0.98),
					evidence: text,
				},
			};
		}
		if (isScreenReferenceCorrection(normalized)) {
			return {
				type: 'core-gap',
				key: 'issue:screen-reference-direct-action',
				pillar: PILLARS.ANTICIPATION.name,
				reason: 'screen-reference action guidance',
				payload: {
					issueSignature: 'issue:screen-reference-direct-action',
					description: `Iris should use visible screen context for direct references instead of asking the user to restate or point again: ${text.trim()}`,
					memory: buildScreenReferencePolicyPayload(text, 0.97),
					evidence: text,
				},
			};
		}
		if (isVisibleControlReferenceCorrection(normalized)) {
			return {
				type: 'core-gap',
				key: 'issue:visible-control-direct-action',
				pillar: PILLARS.ANTICIPATION.name,
				reason: 'visible control action guidance',
				payload: {
					issueSignature: 'issue:visible-control-direct-action',
					description: `Iris should treat named visible controls like toggles and buttons as actionable on-screen targets instead of asking the user to confirm visibility again: ${text.trim()}`,
					evidence: text,
				},
			};
		}
		if (hasRecentPointerContext(context) && looksLikeGenericPointerCorrection(text)) {
			return {
				type: 'core-gap',
				key: 'issue:screen-reference-direct-action',
				pillar: PILLARS.ANTICIPATION.name,
				reason: 'contextual pointer action guidance',
				payload: {
					issueSignature: 'issue:screen-reference-direct-action',
					description: `Iris should treat generic pointer corrections as screen-referential guidance when fresh UI context exists instead of asking the user to restate the target: ${text.trim()}`,
					semanticText: 'screen reference click there direct action pointer guidance',
					memory: buildScreenReferencePolicyPayload(text),
					evidence: text,
				},
			};
		}
		return {
			type: 'core-gap',
			key: `issue:${normalized}`,
			pillar: PILLARS.LEARNING.name,
			reason: 'generic user correction',
			payload: {
				issueSignature: `issue:${normalized}`,
				description: `User correction suggests a structural gap: ${text.trim()}`,
				evidence: text,
			},
		};
	}

	classifyRecovery({ failedTools = [], successfulTools = [], latestUserText = '' } = {}) {
		if (!failedTools.length || !successfulTools.length) return null;
		const failedNames = failedTools.map((item) => item.name).filter(Boolean);
		const successNames = successfulTools.map((item) => item.name).filter(Boolean);
		const userText = normalizeText(latestUserText);
		const latestPlannerGoal = [...failedTools]
			.reverse()
			.find((item) => item?.name === 'run_ui_task')
			?.args?.goal || '';
		const pointerHeavy = hasPointerActivity(successfulTools);
		const pointerContext = pointerHeavy || hasPointerActivity(failedTools);
		const preparationRecovery = failedNames.includes('run_ui_task')
			&& successNames.includes('open_app')
			&& (pointerContext || isScreenReferentialGoal(latestUserText) || isScreenReferentialGoal(latestPlannerGoal));

		if (containsAny(userText, ['default browser']) && successNames.includes('open_app')) {
			return {
				type: 'memory',
				key: 'environment.default_browser',
				reason: 'resolved default browser after correction',
			};
		}

		if (containsAny(userText, ['default browser', 'default mail']) && successNames.includes('get_default_app')) {
			return {
				type: 'memory',
				key: userText.includes('mail') ? 'environment.default_mail' : 'environment.default_browser',
				reason: 'resolved default app query after correction',
			};
		}

		if (preparationRecovery) {
			const evidenceText = String(latestUserText || latestPlannerGoal || '').trim();
			return {
				type: 'memory',
				key: 'policy.pre_click_preparation',
				reason: 'run_ui_task recovery exposed missing app/window preparation',
				payload: buildPreClickPreparationPolicyPayload(evidenceText, 0.97),
			};
		}

		if (pointerHeavy && userText) {
			return {
				type: 'stabilization_candidate',
				key: `stabilize:${userText}`,
				reason: 'pointer-based recovery needs stabilization',
				payload: {
					issueSignature: `stabilize:${userText}`,
					description: `Pointer-based recovery should be converted into a semantic/native strategy: ${latestUserText}`,
					evidence: latestUserText,
				},
			};
		}

		if (successfulTools.length && latestUserText && /(didn'?t work|wrong|not what i asked|not what i wanted|that is not it|not correct)/i.test(latestUserText)) {
			return {
				type: 'false_positive_skill',
				key: `false_positive:${userText}`,
				reason: 'user correction after apparent success',
				payload: {
					issueSignature: `false_positive:${userText}`,
					description: `Apparent success was corrected by user: ${latestUserText}`,
					evidence: latestUserText,
				},
			};
		}

		if (!successNames.includes('run_ui_task') && successfulTools.length >= 1 && latestUserText) {
			return {
				type: 'skill',
				key: `skill:${successNames.join(',')}:${userText}`,
				reason: 'recovered via reusable tool sequence',
			};
		}

		if (failedNames.some((name) => name === 'run_ui_task') && successNames.some((name) => name === 'open_app')) {
			return {
				type: 'core-gap',
				key: `recovery:${failedNames.join(',')}->${successNames.join(',')}`,
				reason: 'cross-tool recovery indicates missing planner/tooling capability',
				payload: {
					issueSignature: `recovery:${failedNames.join(',')}->${successNames.join(',')}:${userText}`,
					description: `Recovered from ${failedNames.join(', ')} to ${successNames.join(', ')} after user guidance: ${latestUserText}`,
					evidence: latestUserText,
				},
			};
		}

		return null;
	}
}

module.exports = {
	LearningClassifier,
};

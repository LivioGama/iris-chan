export const CH = {
  // ── Core lifecycle ──
  CORE_MODULE_LOADED: 'core:module-loaded',
  CORE_MODULE_UNLOADED: 'core:module-unloaded',
  CORE_SHUTDOWN: 'core:shutdown',
  CORE_HEALTH_CHECK: 'core:health-check',
  CORE_HEALTH_RESULT: 'core:health-result',

  // ── Voice ──
  VOICE_STATE_CHANGED: 'voice:state-changed',
  VOICE_TRANSCRIPT: 'voice:transcript',
  VOICE_USER_SPEAKING: 'voice:user-speaking',
  VOICE_BARGE_IN: 'voice:barge-in',
  VOICE_PLAYBACK_START: 'voice:playback-start',
  VOICE_PLAYBACK_END: 'voice:playback-end',
  VOICE_TOGGLE: 'voice:toggle',

  // ── Gemini ──
  GEMINI_CONNECTED: 'gemini:connected',
  GEMINI_DISCONNECTED: 'gemini:disconnected',
  GEMINI_RESPONSE: 'gemini:response',
  GEMINI_TOOL_CALL: 'gemini:tool-call',
  GEMINI_TOOL_RESULT: 'gemini:tool-result',
  GEMINI_SEND_AUDIO: 'gemini:send-audio',
  GEMINI_SEND_TEXT: 'gemini:send-text',
  GEMINI_SEND_SCREEN: 'gemini:send-screen',

  // ── Screen ──
  SCREEN_CAPTURE: 'screen:capture',
  SCREEN_CAPTURE_READY: 'screen:capture-ready',
  SCREEN_VISION_REQUEST: 'screen:vision-request',
  SCREEN_VISION_RESULT: 'screen:vision-result',
  SCREEN_OBSERVATION_SAVED: 'screen:observation-saved',

  // ── Automation ──
  AUTO_TASK_START: 'automation:task-start',
  AUTO_TASK_PROGRESS: 'automation:task-progress',
  AUTO_TASK_COMPLETE: 'automation:task-complete',
  AUTO_TASK_FAILED: 'automation:task-failed',
  AUTO_RUN_UI_TASK: 'automation:run-ui-task',
  AUTO_STOP_UI_TASK: 'automation:stop-ui-task',
  AUTO_VERIFY_RESULT: 'automation:verify-result',
  AUTO_USER_INTERVENED: 'automation:user-intervened',

  // ── Tools ──
  TOOL_EXECUTE: 'tools:execute',
  TOOL_RESULT: 'tools:result',
  TOOL_REGISTER: 'tools:register',
  TOOL_LIST: 'tools:list',
  TOOL_START: 'tools:start',
  TOOL_END: 'tools:end',

  // ── 2FA ──
  TFA_FIELD_DETECTED: '2fa:field-detected',
  TFA_FILL_START: '2fa:fill-start',
  TFA_FILL_SUCCESS: '2fa:fill-success',
  TFA_FILL_FAILED: '2fa:fill-failed',
  TFA_CODE_CACHED: '2fa:code-cached',
  TFA_NO_CODE: '2fa:no-code',
  TFA_LOW_CONFIDENCE: '2fa:low-confidence',

  // ── Coding ──
  CODING_TASK_START: 'coding:task-start',
  CODING_TASK_LOG: 'coding:task-log',
  CODING_TASK_DONE: 'coding:task-done',
  CODING_SELF_FIX: 'coding:self-fix',

  // ── Autonomy ──
  INTENT_PREDICTION: 'autonomy:intent-prediction',
  PROACTIVE_SUGGESTION: 'autonomy:proactive-suggestion',
  DAILY_DRAFT_CREATED: 'autonomy:daily-draft-created',

  // ── Search ──
  SEARCH_WEB: 'search:web',
  SEARCH_SEMANTIC: 'search:semantic',
  SEARCH_RESULT: 'search:result',
  LINK_CAPTURED: 'search:link-captured',

  // ── Vocab ──
  VOCAB_TERMS_UPDATED: 'vocab:terms-updated',
  VOCAB_TRACK: 'vocab:track',
  VOCAB_CORRECTION: 'vocab:correction',
  VOCAB_GET_TERMS: 'vocab:get-terms',

  // ── Tasks ──
  TASK_CREATED: 'tasks:created',
  TASK_UPDATED: 'tasks:updated',
  TASK_COMPLETED: 'tasks:completed',
  TASK_QUEUE_CHANGED: 'tasks:queue-changed',
  TASK_MILESTONE: 'tasks:milestone',
  TASK_RUN: 'tasks:run',
  TASK_STOP: 'tasks:stop',
  KANBAN_SYNC: 'tasks:kanban-sync',

  // ── Skills ──
  SKILL_RUN: 'skills:run',
  SKILL_RESULT: 'skills:result',
  SKILL_CATALOG: 'skills:catalog',

  // ── Feedback ──
  FEEDBACK_ADD: 'feedback:add',
  FEEDBACK_UPDATED: 'feedback:updated',

  // ── Convex ──
  CONVEX_CONNECTED: 'convex:connected',
  CONVEX_DISCONNECTED: 'convex:disconnected',
  CONVEX_SAVE: 'convex:save',
  CONVEX_QUERY: 'convex:query',

  // ── Settings ──
  SETTINGS_CHANGED: 'settings:changed',
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',

  // ── Behavior ──
  BEHAVIOR_MODE_CHANGED: 'behavior:mode-changed',
  BEHAVIOR_STATE_GET: 'behavior:state-get',
  BEHAVIOR_STATE_SET: 'behavior:state-set',

  // ── UI ──
  UI_BUBBLE_SHOW: 'ui:bubble-show',
  UI_BUBBLE_STREAM: 'ui:bubble-stream',
  UI_BUBBLE_STREAM_END: 'ui:bubble-stream-end',
  UI_BUBBLE_CLEAR: 'ui:bubble-clear',
  UI_TIMELINE_EVENT: 'ui:timeline-event',
  UI_STATUS_UPDATE: 'ui:status-update',
  UI_TOOL_LOG: 'ui:tool-log',
  UI_PRESENCE_SET: 'ui:presence-set',
  UI_MOUSE_IGNORE: 'ui:mouse-ignore',

  // ── MACP ──
  MACP_MESSAGE: 'macp:message',
  MACP_TASK_DISPATCHED: 'macp:task-dispatched',
} as const;

export type Channel = (typeof CH)[keyof typeof CH];

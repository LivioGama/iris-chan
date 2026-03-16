import type { ToolDeclaration } from './registry';

/**
 * All 55 tool declarations for Gemini function calling.
 * Modules register handlers; this file provides the declarations.
 */

export const CORE_DECLARATIONS: ToolDeclaration[] = [
  // ── UI Control ──
  {
    name: 'run_ui_task',
    description: 'Execute a high-level UI automation goal (e.g. "open Safari and navigate to google.com")',
    parameters: {
      type: 'OBJECT',
      properties: {
        goal: { type: 'STRING', description: 'Natural language goal' },
        app_hint: { type: 'STRING', description: 'Target app name (optional)' },
        success_signal: { type: 'STRING', description: 'Expected outcome to verify' },
      },
      required: ['goal'],
    },
  },
  {
    name: 'click_at',
    description: 'Click at image coordinates (from a screenshot)',
    parameters: {
      type: 'OBJECT',
      properties: {
        x: { type: 'NUMBER', description: 'X coordinate in image pixels' },
        y: { type: 'NUMBER', description: 'Y coordinate in image pixels' },
        capture_id: { type: 'STRING', description: 'Screenshot capture ID for coordinate mapping' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'double_click',
    description: 'Double-click at image coordinates',
    parameters: {
      type: 'OBJECT',
      properties: {
        x: { type: 'NUMBER', description: 'X coordinate' },
        y: { type: 'NUMBER', description: 'Y coordinate' },
        capture_id: { type: 'STRING', description: 'Capture ID' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'mouse_move',
    description: 'Move mouse to coordinates',
    parameters: {
      type: 'OBJECT',
      properties: {
        x: { type: 'NUMBER', description: 'X coordinate' },
        y: { type: 'NUMBER', description: 'Y coordinate' },
        capture_id: { type: 'STRING', description: 'Capture ID' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'drag',
    description: 'Drag from one point to another',
    parameters: {
      type: 'OBJECT',
      properties: {
        from_x: { type: 'NUMBER', description: 'Start X' },
        from_y: { type: 'NUMBER', description: 'Start Y' },
        to_x: { type: 'NUMBER', description: 'End X' },
        to_y: { type: 'NUMBER', description: 'End Y' },
        capture_id: { type: 'STRING', description: 'Capture ID' },
      },
      required: ['from_x', 'from_y', 'to_x', 'to_y'],
    },
  },
  {
    name: 'type_text',
    description: 'Type text at current cursor position',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING', description: 'Text to type' },
      },
      required: ['text'],
    },
  },
  {
    name: 'press_key',
    description: 'Press a keyboard shortcut (e.g. "cmd+c", "return", "escape")',
    parameters: {
      type: 'OBJECT',
      properties: {
        key: { type: 'STRING', description: 'Key combo (e.g. "cmd+shift+s")' },
      },
      required: ['key'],
    },
  },
  {
    name: 'scroll',
    description: 'Scroll up or down',
    parameters: {
      type: 'OBJECT',
      properties: {
        direction: { type: 'STRING', description: 'up or down', enum: ['up', 'down'] },
        amount: { type: 'NUMBER', description: 'Scroll amount (default 3)' },
      },
      required: ['direction'],
    },
  },
  {
    name: 'get_mouse_position',
    description: 'Get current mouse position in screen coordinates',
    parameters: { type: 'OBJECT', properties: {}, required: [] },
  },
  {
    name: 'open_app',
    description: 'Open an application by name',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Application name' },
      },
      required: ['name'],
    },
  },
  {
    name: 'get_frontmost_app',
    description: 'Get the name and window title of the currently focused application',
    parameters: { type: 'OBJECT', properties: {}, required: [] },
  },
  {
    name: 'window_manage',
    description: 'Manage a window (minimize, maximize, hide, close)',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { type: 'STRING', description: 'Action to perform', enum: ['minimize', 'maximize', 'hide', 'close'] },
        app: { type: 'STRING', description: 'Target app name (optional, defaults to frontmost)' },
      },
      required: ['action'],
    },
  },

  // ── Files ──
  {
    name: 'read_file',
    description: 'Read contents of a file',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'File path' },
        max_lines: { type: 'NUMBER', description: 'Max lines to read (default: all)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'File path' },
        content: { type: 'STRING', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and directories at a path',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Directory path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'move_file',
    description: 'Move or rename a file',
    parameters: {
      type: 'OBJECT',
      properties: {
        from: { type: 'STRING', description: 'Source path' },
        to: { type: 'STRING', description: 'Destination path' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'get_finder_selection',
    description: 'Get currently selected files in Finder',
    parameters: { type: 'OBJECT', properties: {}, required: [] },
  },
  {
    name: 'download_browser_image',
    description: 'Download an image from a URL in the browser',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'Image URL' },
        save_path: { type: 'STRING', description: 'Local save path' },
      },
      required: ['url'],
    },
  },

  // ── System ──
  {
    name: 'run_terminal_command',
    description: 'Execute a terminal command and return output',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: { type: 'STRING', description: 'Shell command to execute' },
        cwd: { type: 'STRING', description: 'Working directory (optional)' },
        timeout_ms: { type: 'NUMBER', description: 'Timeout in milliseconds (default: 30000)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'set_volume',
    description: 'Set system volume (0-100)',
    parameters: {
      type: 'OBJECT',
      properties: {
        level: { type: 'NUMBER', description: 'Volume level 0-100' },
      },
      required: ['level'],
    },
  },
  {
    name: 'check_permissions',
    description: 'Check macOS permission status for a capability',
    parameters: {
      type: 'OBJECT',
      properties: {
        permission: { type: 'STRING', description: 'Permission to check', enum: ['screen', 'accessibility', 'microphone', 'camera'] },
      },
      required: ['permission'],
    },
  },
  {
    name: 'notify',
    description: 'Show a macOS notification',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Notification title' },
        body: { type: 'STRING', description: 'Notification body' },
      },
      required: ['title', 'body'],
    },
  },
  {
    name: 'get_default_app',
    description: 'Get the default app for a file type or URL scheme',
    parameters: {
      type: 'OBJECT',
      properties: {
        type: { type: 'STRING', description: 'File extension or URL scheme (e.g. "pdf", "https")' },
      },
      required: ['type'],
    },
  },

  // ── Clipboard ──
  {
    name: 'clipboard_read',
    description: 'Read current clipboard contents',
    parameters: { type: 'OBJECT', properties: {}, required: [] },
  },
  {
    name: 'clipboard_write',
    description: 'Write text to clipboard',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING', description: 'Text to copy' },
      },
      required: ['text'],
    },
  },

  // ── Search & Links ──
  {
    name: 'web_search',
    description: 'Search the web and return results',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'recall_link',
    description: 'Search captured links by semantic query',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Search query' },
        limit: { type: 'NUMBER', description: 'Max results (default: 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'open_link',
    description: 'Open a URL in the default browser',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'URL to open' },
      },
      required: ['url'],
    },
  },

  // ── Settings ──
  {
    name: 'query_settings',
    description: 'Query current settings for a namespace',
    parameters: {
      type: 'OBJECT',
      properties: {
        namespace: { type: 'STRING', description: 'Settings namespace (voice, behavior, avatar, logging, 2fa)' },
        key: { type: 'STRING', description: 'Specific key (optional, returns all if omitted)' },
      },
      required: ['namespace'],
    },
  },
  {
    name: 'update_settings',
    description: 'Update a settings value',
    parameters: {
      type: 'OBJECT',
      properties: {
        namespace: { type: 'STRING', description: 'Settings namespace' },
        key: { type: 'STRING', description: 'Setting key' },
        value: { type: 'STRING', description: 'New value (JSON-encoded)' },
      },
      required: ['namespace', 'key', 'value'],
    },
  },

  // ── Workspace & Skills ──
  {
    name: 'set_workspace',
    description: 'Set the active working directory',
    parameters: {
      type: 'OBJECT',
      properties: {
        path: { type: 'STRING', description: 'Directory path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'get_workspace',
    description: 'Get the active working directory',
    parameters: { type: 'OBJECT', properties: {}, required: [] },
  },
  {
    name: 'use_skill',
    description: 'Execute a custom Iris skill',
    parameters: {
      type: 'OBJECT',
      properties: {
        skill_name: { type: 'STRING', description: 'Skill name' },
        args: { type: 'STRING', description: 'Arguments (JSON-encoded)' },
      },
      required: ['skill_name'],
    },
  },
  {
    name: 'create_skill',
    description: 'Create a new custom skill from a pattern',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: { type: 'STRING', description: 'Skill name' },
        description: { type: 'STRING', description: 'What the skill does' },
        steps: { type: 'STRING', description: 'Steps to execute (JSON array)' },
      },
      required: ['name', 'description', 'steps'],
    },
  },

  // ── Project Autonomy ──
  {
    name: 'fix_project',
    description: 'Analyze and fix issues in a project',
    parameters: {
      type: 'OBJECT',
      properties: {
        project_path: { type: 'STRING', description: 'Path to project' },
        issue: { type: 'STRING', description: 'Description of the issue' },
      },
      required: ['issue'],
    },
  },
  {
    name: 'self_fix',
    description: 'Fix an issue in Iris itself',
    parameters: {
      type: 'OBJECT',
      properties: {
        issue: { type: 'STRING', description: 'Description of the issue' },
        hypothesis: { type: 'STRING', description: 'Suspected cause' },
      },
      required: ['issue'],
    },
  },
  {
    name: 'add_task',
    description: 'Add a task to the autonomous task queue',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: { type: 'STRING', description: 'Task description' },
        priority: { type: 'STRING', description: 'Priority', enum: ['p0', 'p1', 'p2'] },
        project_path: { type: 'STRING', description: 'Project path (optional)' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'extract_tasks',
    description: 'Extract actionable tasks from a description',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING', description: 'Text to extract tasks from' },
      },
      required: ['text'],
    },
  },

  // ── Code ──
  {
    name: 'import_logs',
    description: 'Import and analyze log output from a command or file',
    parameters: {
      type: 'OBJECT',
      properties: {
        source: { type: 'STRING', description: 'Log file path or command' },
        max_lines: { type: 'NUMBER', description: 'Max lines (default: 180)' },
      },
      required: ['source'],
    },
  },

  // ── Messaging ──
  {
    name: 'propose_reply',
    description: 'Suggest a reply to a message visible on screen',
    parameters: {
      type: 'OBJECT',
      properties: {
        context: { type: 'STRING', description: 'Message context' },
        tone: { type: 'STRING', description: 'Desired tone (casual, professional, friendly)' },
      },
      required: ['context'],
    },
  },

  // ── 2FA ──
  {
    name: 'get_codes',
    description: 'Get recently received 2FA/verification codes',
    parameters: {
      type: 'OBJECT',
      properties: {
        keyword: { type: 'STRING', description: 'Filter by service name (optional)' },
      },
    },
  },
  {
    name: 'paste_code',
    description: 'Paste a 2FA code into the currently focused field',
    parameters: {
      type: 'OBJECT',
      properties: {
        code: { type: 'STRING', description: 'Code to paste' },
      },
      required: ['code'],
    },
  },

  // ── Installers ──
  {
    name: 'list_mounted_installers',
    description: 'List mounted DMG volumes and installers',
    parameters: { type: 'OBJECT', properties: {}, required: [] },
  },
  {
    name: 'cleanup_install_artifact',
    description: 'Eject DMG and move installer to trash',
    parameters: {
      type: 'OBJECT',
      properties: {
        volume: { type: 'STRING', description: 'Volume name to eject' },
      },
      required: ['volume'],
    },
  },

  // ── Memory ──
  {
    name: 'save_observation',
    description: 'Save a visual observation with embedding for later recall',
    parameters: {
      type: 'OBJECT',
      properties: {
        description: { type: 'STRING', description: 'What was observed' },
        app_name: { type: 'STRING', description: 'App where observation was made' },
        tags: { type: 'STRING', description: 'Comma-separated tags' },
        note: { type: 'STRING', description: 'Additional notes' },
      },
      required: ['description'],
    },
  },
  {
    name: 'recall_observations',
    description: 'Search past visual observations by semantic query',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Search query' },
        app_filter: { type: 'STRING', description: 'Filter by app name (optional)' },
        limit: { type: 'NUMBER', description: 'Max results (default: 5)' },
      },
      required: ['query'],
    },
  },

  // ── Capture ──
  {
    name: 'capture_screen',
    description: 'Take a screenshot of the current screen',
    parameters: { type: 'OBJECT', properties: {}, required: [] },
  },
];

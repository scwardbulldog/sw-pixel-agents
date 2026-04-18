/**
 * Copilot CLI transcript parser.
 *
 * Parses events.jsonl records from ~/.copilot/session-state/<session-id>/events.jsonl
 * into normalized AgentEvent types for the Pixel Agents extension.
 */

import type { AgentEvent } from '../../../provider.js';
import {
  COPILOT_BASH_COMMAND_DISPLAY_MAX_LENGTH,
  COPILOT_EVENT_TYPES,
  COPILOT_GITHUB_MCP_PREFIX,
  COPILOT_TASK_DESCRIPTION_DISPLAY_MAX_LENGTH,
  COPILOT_TOOL_DISPLAY_NAMES,
} from './constants.js';

/**
 * Raw event structure from Copilot's events.jsonl.
 */
interface CopilotEvent {
  type: string;
  data?: Record<string, unknown>;
  id?: string;
  timestamp?: string;
  parentId?: string;
}

/**
 * Tool execution start event data.
 */
interface ToolExecutionStartData {
  toolCallId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
}

/**
 * Tool execution complete event data.
 */
interface ToolExecutionCompleteData {
  toolCallId: string;
  success: boolean;
  result?: unknown;
  model?: string;
  interactionId?: string;
}

/**
 * Session start event data.
 */
interface SessionStartData {
  sessionId: string;
  version?: number;
  producer?: string;
  copilotVersion?: string;
  startTime?: string;
  selectedModel?: string;
  context?: {
    cwd?: string;
    gitRoot?: string;
    branch?: string;
    repository?: string;
  };
}

/**
 * Parse a line from events.jsonl into an AgentEvent.
 *
 * @param line - A single line from the events.jsonl file
 * @returns The parsed AgentEvent, or null if the line should be ignored
 */
export function parseTranscriptLine(line: string): AgentEvent | null {
  try {
    const event = JSON.parse(line) as CopilotEvent;
    return normalizeEvent(event);
  } catch {
    // Ignore malformed JSON lines
    return null;
  }
}

/**
 * Normalize a Copilot event into an AgentEvent.
 */
function normalizeEvent(event: CopilotEvent): AgentEvent | null {
  switch (event.type) {
    case COPILOT_EVENT_TYPES.TOOL_EXECUTION_START: {
      const data = event.data as ToolExecutionStartData | undefined;
      if (!data?.toolCallId || !data?.toolName) return null;
      return {
        kind: 'toolStart',
        toolId: data.toolCallId,
        toolName: data.toolName,
        input: data.arguments,
      };
    }

    case COPILOT_EVENT_TYPES.TOOL_EXECUTION_COMPLETE: {
      const data = event.data as ToolExecutionCompleteData | undefined;
      if (!data?.toolCallId) return null;
      return {
        kind: 'toolEnd',
        toolId: data.toolCallId,
      };
    }

    case COPILOT_EVENT_TYPES.ASSISTANT_TURN_END: {
      return { kind: 'turnEnd' };
    }

    case COPILOT_EVENT_TYPES.USER_MESSAGE: {
      return { kind: 'userTurn' };
    }

    case COPILOT_EVENT_TYPES.SESSION_START: {
      const data = event.data as SessionStartData | undefined;
      return {
        kind: 'sessionStart',
        source: data?.producer,
      };
    }

    // Events we acknowledge but don't produce AgentEvents for
    case COPILOT_EVENT_TYPES.ASSISTANT_TURN_START:
    case COPILOT_EVENT_TYPES.SESSION_MODE_CHANGED:
    case COPILOT_EVENT_TYPES.SYSTEM_MESSAGE:
    case COPILOT_EVENT_TYPES.FUNCTION:
      return null;

    default:
      // Unknown event types are silently ignored
      return null;
  }
}

/**
 * Format a tool status line for display in the webview.
 *
 * @param toolName - The Copilot tool name (e.g., 'bash', 'view', 'edit')
 * @param input - The tool input arguments
 * @returns A human-readable status string
 */
export function formatToolStatus(toolName: string, input?: unknown): string {
  const inp = (input ?? {}) as Record<string, unknown>;

  // Handle GitHub MCP server tools
  if (toolName.startsWith(COPILOT_GITHUB_MCP_PREFIX)) {
    const mcpTool = toolName.slice(COPILOT_GITHUB_MCP_PREFIX.length);
    return `GitHub: ${formatMcpToolName(mcpTool)}`;
  }

  // Check for known tool display name
  const displayName = COPILOT_TOOL_DISPLAY_NAMES[toolName];

  switch (toolName) {
    case 'view': {
      const filePath = typeof inp.path === 'string' ? inp.path : '';
      const baseName = filePath.split('/').pop() || filePath;
      return `Reading ${baseName}`;
    }

    case 'edit': {
      const filePath = typeof inp.path === 'string' ? inp.path : '';
      const baseName = filePath.split('/').pop() || filePath;
      return `Editing ${baseName}`;
    }

    case 'create': {
      const filePath = typeof inp.path === 'string' ? inp.path : '';
      const baseName = filePath.split('/').pop() || filePath;
      return `Creating ${baseName}`;
    }

    case 'bash': {
      const cmd = typeof inp.command === 'string' ? inp.command : '';
      if (cmd.length > COPILOT_BASH_COMMAND_DISPLAY_MAX_LENGTH) {
        return `Running: ${cmd.slice(0, COPILOT_BASH_COMMAND_DISPLAY_MAX_LENGTH)}…`;
      }
      return `Running: ${cmd}`;
    }

    case 'task': {
      const desc = typeof inp.description === 'string' ? inp.description : '';
      if (desc) {
        if (desc.length > COPILOT_TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) {
          return `Subtask: ${desc.slice(0, COPILOT_TASK_DESCRIPTION_DISPLAY_MAX_LENGTH)}…`;
        }
        return `Subtask: ${desc}`;
      }
      return 'Running subtask';
    }

    case 'grep': {
      const pattern = typeof inp.pattern === 'string' ? inp.pattern : '';
      return pattern ? `Searching: ${pattern}` : 'Searching code';
    }

    case 'glob': {
      const pattern = typeof inp.pattern === 'string' ? inp.pattern : '';
      return pattern ? `Finding: ${pattern}` : 'Searching files';
    }

    case 'web_fetch': {
      const url = typeof inp.url === 'string' ? inp.url : '';
      try {
        const hostname = new URL(url).hostname;
        return `Fetching ${hostname}`;
      } catch {
        return 'Fetching web content';
      }
    }

    case 'web_search': {
      const query = typeof inp.query === 'string' ? inp.query : '';
      return query ? `Searching: ${query.slice(0, 40)}` : 'Searching the web';
    }

    case 'sql': {
      const desc = typeof inp.description === 'string' ? inp.description : '';
      return desc ? `SQL: ${desc}` : 'Querying database';
    }

    default:
      // Use display name if available, otherwise format the tool name
      if (displayName) {
        return displayName;
      }
      // Convert snake_case to readable format
      return `Using ${toolName.replace(/_/g, ' ')}`;
  }
}

/**
 * Format MCP tool names for display.
 * Converts names like 'get_file_contents' to 'Get file contents'.
 */
function formatMcpToolName(toolName: string): string {
  // Common MCP tool shortcuts
  const shortcuts: Record<string, string> = {
    get_file_contents: 'Reading file',
    list_commits: 'Listing commits',
    list_issues: 'Listing issues',
    list_pull_requests: 'Listing PRs',
    search_code: 'Searching code',
    search_issues: 'Searching issues',
    search_repositories: 'Searching repos',
    get_commit: 'Getting commit',
    issue_read: 'Reading issue',
    pull_request_read: 'Reading PR',
  };

  if (shortcuts[toolName]) {
    return shortcuts[toolName];
  }

  // Default: convert snake_case to Title Case
  return toolName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Extract session ID from a Copilot session directory path.
 *
 * @param dirPath - Path like ~/.copilot/session-state/abc123-def456/
 * @returns The session ID (directory name)
 */
export function extractSessionId(dirPath: string): string {
  const parts = dirPath.replace(/\/$/, '').split('/');
  return parts[parts.length - 1];
}

/**
 * GitHub Copilot CLI-specific constants.
 *
 * Kept separate from `server/src/constants.ts` so provider-specific builds can
 * exclude unused provider code.
 */

/**
 * Session state directory under user's home directory.
 * Copilot stores sessions at ~/.copilot/session-state/<session-id>/
 */
export const COPILOT_SESSION_DIR = '.copilot/session-state';

/**
 * Events file within each session directory.
 */
export const COPILOT_EVENTS_FILE = 'events.jsonl';

/**
 * Workspace metadata file within each session directory.
 * Contains cwd, git_root, repository, branch, and summary.
 */
export const COPILOT_WORKSPACE_FILE = 'workspace.yaml';

/**
 * Lock file pattern to detect active sessions.
 * Format: inuse.<pid>.lock
 */
export const COPILOT_LOCK_FILE_PATTERN = /^inuse\.\d+\.lock$/;

/**
 * Tool name mappings from Copilot's internal names to display names.
 * Copilot uses snake_case tool names (e.g., report_intent, web_fetch).
 */
export const COPILOT_TOOL_DISPLAY_NAMES: Record<string, string> = {
  report_intent: 'Setting intent',
  view: 'Reading',
  edit: 'Editing',
  create: 'Creating',
  bash: 'Running',
  grep: 'Searching code',
  glob: 'Searching files',
  web_fetch: 'Fetching web content',
  web_search: 'Searching the web',
  task: 'Subtask',
  read_bash: 'Reading output',
  write_bash: 'Writing input',
  stop_bash: 'Stopping process',
  read_agent: 'Reading agent',
  list_agents: 'Listing agents',
  list_bash: 'Listing shells',
  ask_user: 'Waiting for answer',
  exit_plan_mode: 'Finishing plan',
  sql: 'Querying database',
  skill: 'Invoking skill',
  fetch_copilot_cli_documentation: 'Reading docs',
  ide_get_selection: 'Getting selection',
  ide_get_diagnostics: 'Getting diagnostics',
};

/**
 * GitHub MCP server tool prefixes.
 * Tools from the GitHub MCP server are prefixed with 'github-mcp-server-'.
 */
export const COPILOT_GITHUB_MCP_PREFIX = 'github-mcp-server-';

/**
 * Maximum length for bash command display in status text.
 */
export const COPILOT_BASH_COMMAND_DISPLAY_MAX_LENGTH = 60;

/**
 * Maximum length for task description display in status text.
 */
export const COPILOT_TASK_DESCRIPTION_DISPLAY_MAX_LENGTH = 80;

/**
 * Tools that don't trigger permission timers (they spawn sub-agents or wait for user).
 */
export const COPILOT_PERMISSION_EXEMPT_TOOLS = new Set([
  'task',
  'ask_user',
  'read_agent',
  'write_agent',
  'skill',
  'exit_plan_mode',
]);

/**
 * Tools that spawn sub-agent characters.
 */
export const COPILOT_SUBAGENT_TOOLS = new Set(['task']);

/**
 * Event types in Copilot's events.jsonl file.
 */
export const COPILOT_EVENT_TYPES = {
  SESSION_START: 'session.start',
  SESSION_END: 'session.end',
  SESSION_MODE_CHANGED: 'session.mode_changed',
  TOOL_EXECUTION_START: 'tool.execution_start',
  TOOL_EXECUTION_COMPLETE: 'tool.execution_complete',
  ASSISTANT_TURN_START: 'assistant.turn_start',
  ASSISTANT_TURN_END: 'assistant.turn_end',
  USER_MESSAGE: 'user.message',
  SYSTEM_MESSAGE: 'system.message',
  FUNCTION: 'function',
} as const;

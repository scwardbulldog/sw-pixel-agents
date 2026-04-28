/** Map status prefixes back to tool names for animation selection */
const STATUS_TO_TOOL: Record<string, string> = {
  // Reading animation tools
  Reading: 'Read',
  Searching: 'Grep', // "Searching: pattern" or "Searching code"
  Globbing: 'Glob',
  Finding: 'Glob', // Copilot glob
  Fetching: 'WebFetch',
  'Searching web': 'WebSearch',
  'Searching the web': 'WebSearch', // Copilot web_search
  Thinking: 'Read', // Show reading animation while thinking
  GitHub: 'Read', // GitHub MCP tools - reading

  // Writing animation tools
  Writing: 'Write',
  Editing: 'Edit',
  Creating: 'Write', // Copilot create
  Running: 'Bash',
  Task: 'Task',
  Subtask: 'Task', // Copilot task

  // User interaction
  'Waiting for': 'Read', // "Waiting for answer" - Copilot ask_user
};

export function extractToolName(status: string): string | null {
  for (const [prefix, tool] of Object.entries(STATUS_TO_TOOL)) {
    if (status.startsWith(prefix)) return tool;
  }
  const first = status.split(/[\s:]/)[0];
  return first || null;
}

import { ZOOM_DEFAULT_DPR_FACTOR, ZOOM_MIN } from '../constants.js';

/** Compute a default integer zoom level (device pixels per sprite pixel) */
export function defaultZoom(): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.max(ZOOM_MIN, Math.round(ZOOM_DEFAULT_DPR_FACTOR * dpr));
}

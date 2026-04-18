/**
 * GitHub Copilot CLI provider implementation.
 *
 * Implements the HookProvider interface for GitHub Copilot CLI sessions.
 * Currently file-based only (no hooks API available yet), using events.jsonl
 * polling for session detection.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { AgentEvent, HookProvider } from '../../../provider.js';
import {
  COPILOT_EVENTS_FILE,
  COPILOT_PERMISSION_EXEMPT_TOOLS,
  COPILOT_SESSION_DIR,
  COPILOT_SUBAGENT_TOOLS,
} from './constants.js';
import { formatToolStatus, parseTranscriptLine } from './copilotTranscriptParser.js';

/**
 * Get session directories to scan for Copilot sessions.
 *
 * Unlike Claude which uses workspace-path-based directories, Copilot uses a
 * flat structure: ~/.copilot/session-state/<session-uuid>/
 *
 * We return the parent directory and let the scanner find active sessions
 * by looking for events.jsonl files within each UUID directory.
 */
function getSessionDirs(_workspacePath: string): string[] {
  const sessionRoot = path.join(os.homedir(), COPILOT_SESSION_DIR);

  // Return the session root directory if it exists
  if (fs.existsSync(sessionRoot)) {
    return [sessionRoot];
  }

  return [];
}

/**
 * Build the command to launch a new Copilot CLI session.
 *
 * For resuming existing sessions: `copilot --resume=<sessionId>`
 * For new sessions: `copilot` (without args, a new session ID is generated)
 */
function buildLaunchCommand(
  sessionId: string,
  cwd: string,
): { command: string; args: string[]; env?: Record<string, string> } {
  // If we have a session ID, resume that session
  if (sessionId) {
    return {
      command: 'copilot',
      args: [`--resume=${sessionId}`],
      env: { PWD: cwd },
    };
  }

  // Otherwise start a new session
  return {
    command: 'copilot',
    args: [],
    env: { PWD: cwd },
  };
}

/**
 * Normalize a hook event from Copilot CLI.
 *
 * NOTE: Copilot CLI does not currently have a hooks API. This stub is here
 * for future compatibility if/when Copilot adds hooks support. For now,
 * all session detection is done via file polling of events.jsonl.
 */
function normalizeHookEvent(
  _raw: Record<string, unknown>,
): { sessionId: string; event: AgentEvent } | null {
  // Copilot CLI doesn't have hooks yet - this is a placeholder
  // for future compatibility. Return null to indicate no event.
  return null;
}

/**
 * Install hooks for Copilot CLI.
 *
 * NOTE: Copilot CLI does not currently support hooks. This is a no-op stub.
 */
async function installHooks(_serverUrl: string, _authToken: string): Promise<void> {
  // No-op: Copilot doesn't support hooks yet
  return Promise.resolve();
}

/**
 * Uninstall hooks for Copilot CLI.
 *
 * NOTE: Copilot CLI does not currently support hooks. This is a no-op stub.
 */
async function uninstallHooks(): Promise<void> {
  // No-op: Copilot doesn't support hooks yet
  return Promise.resolve();
}

/**
 * Check if hooks are installed for Copilot CLI.
 *
 * NOTE: Copilot CLI does not currently support hooks. Always returns false.
 */
async function areHooksInstalled(): Promise<boolean> {
  // Copilot doesn't support hooks yet
  return false;
}

/**
 * The Copilot CLI provider.
 */
export const copilotProvider: HookProvider = {
  kind: 'hook',
  id: 'copilot',
  displayName: 'GitHub Copilot CLI',

  normalizeHookEvent,

  installHooks,
  uninstallHooks,
  areHooksInstalled,

  formatToolStatus,
  permissionExemptTools: COPILOT_PERMISSION_EXEMPT_TOOLS,
  subagentToolNames: COPILOT_SUBAGENT_TOOLS,

  getSessionDirs,
  sessionFilePattern: `*/${COPILOT_EVENTS_FILE}`,
  parseTranscriptLine,
  buildLaunchCommand,

  // No team provider for Copilot (Claude-specific feature)
  team: undefined,
};

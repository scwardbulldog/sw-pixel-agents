/**
 * Copilot CLI transcript processor.
 *
 * Processes events.jsonl records from Copilot CLI sessions and updates
 * agent state, sending appropriate messages to the webview.
 */
import type * as vscode from 'vscode';

import { TOOL_DONE_DELAY_MS } from '../server/src/constants.js';
import { COPILOT_PERMISSION_EXEMPT_TOOLS } from '../server/src/providers/hook/copilot/constants.js';
import {
  formatToolStatus,
  parseTranscriptLine,
} from '../server/src/providers/hook/copilot/copilotTranscriptParser.js';
import { logger } from './logger.js';
import {
  cancelPermissionTimer,
  cancelWaitingTimer,
  clearAgentActivity,
  startPermissionTimer,
} from './timerManager.js';
import type { AgentState } from './types.js';

/**
 * Process a single line from a Copilot events.jsonl file.
 *
 * Maps Copilot events to webview messages:
 * - tool.execution_start → agentToolStart
 * - tool.execution_complete → agentToolDone (delayed)
 * - assistant.turn_end → clear activity, mark waiting
 * - user.message → clear activity for new turn
 */
export function processCopilotTranscriptLine(
  agentId: number,
  line: string,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  webview: vscode.Webview | undefined,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  const event = parseTranscriptLine(line);
  if (!event) return;

  switch (event.kind) {
    case 'toolStart': {
      const toolId = event.toolId;
      const toolName = event.toolName ?? 'unknown';
      const input = (event.input ?? {}) as Record<string, unknown>;
      const status = formatToolStatus(toolName, input);

      logger.debug(`JSONL (Copilot): Agent ${agentId} - tool start: ${toolName} (${toolId})`);

      // Track active tool
      agent.activeToolIds.add(toolId);
      agent.activeToolStatuses.set(toolId, status);
      agent.activeToolNames.set(toolId, toolName);
      agent.hadToolsInTurn = true;

      // Cancel waiting timer (agent is now active)
      cancelWaitingTimer(agentId, waitingTimers);
      if (agent.isWaiting) {
        agent.isWaiting = false;
        webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
      }

      // Send tool start to webview
      webview?.postMessage({
        type: 'agentToolStart',
        id: agentId,
        toolId,
        status,
        toolName,
        permissionActive: agent.permissionSent,
      });

      // Start permission timer for non-exempt tools
      const exemptTools = new Set(COPILOT_PERMISSION_EXEMPT_TOOLS);
      if (!exemptTools.has(toolName)) {
        startPermissionTimer(agentId, agents, permissionTimers, exemptTools, webview);
      }
      break;
    }

    case 'toolEnd': {
      const toolId = event.toolId;
      const toolName = agent.activeToolNames.get(toolId);
      logger.debug(`JSONL (Copilot): Agent ${agentId} - tool end: ${toolName ?? toolId}`);

      // Clear active tool tracking
      agent.activeToolIds.delete(toolId);
      agent.activeToolStatuses.delete(toolId);
      agent.activeToolNames.delete(toolId);

      // Cancel permission timer - tool completed successfully
      cancelPermissionTimer(agentId, permissionTimers);
      if (agent.permissionSent) {
        agent.permissionSent = false;
        webview?.postMessage({ type: 'agentToolPermissionClear', id: agentId });
      }

      // Delay tool done message slightly to prevent flicker
      setTimeout(() => {
        webview?.postMessage({
          type: 'agentToolDone',
          id: agentId,
          toolId,
        });
      }, TOOL_DONE_DELAY_MS);
      break;
    }

    case 'turnEnd': {
      logger.debug(`JSONL (Copilot): Agent ${agentId} - turn end`);

      // Clear all active tool state
      clearAgentActivity(agent, agentId, permissionTimers, webview);

      // Mark as waiting (turn complete, waiting for user input).
      // Note: Unlike Claude (which uses turn_duration only for tool-using turns),
      // Copilot's assistant.turn_end fires for ALL turns including text-only responses.
      // This means we don't need the TEXT_IDLE_DELAY timer that Claude uses.
      cancelWaitingTimer(agentId, waitingTimers);
      cancelPermissionTimer(agentId, permissionTimers);
      agent.isWaiting = true;
      agent.hadToolsInTurn = false;
      webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
      break;
    }

    case 'userTurn': {
      logger.debug(`JSONL (Copilot): Agent ${agentId} - user turn`);

      // Clear waiting state (user submitted a new prompt)
      cancelWaitingTimer(agentId, waitingTimers);
      cancelPermissionTimer(agentId, permissionTimers);
      agent.isWaiting = false;
      agent.hadToolsInTurn = false;
      agent.permissionSent = false;
      webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
      webview?.postMessage({ type: 'agentToolPermissionClear', id: agentId });
      break;
    }

    case 'sessionStart': {
      logger.debug(`JSONL (Copilot): Agent ${agentId} - session start`);
      // Session started, agent is now active
      agent.isWaiting = false;
      webview?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
      break;
    }

    default:
      // Unknown event kind - ignore
      break;
  }
}

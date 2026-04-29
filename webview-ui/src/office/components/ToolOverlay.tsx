import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/Button.js';
import {
  CHARACTER_SITTING_OFFSET_PX,
  FUEL_COLOR_CRITICAL,
  FUEL_COLOR_DANGER,
  FUEL_COLOR_OK,
  FUEL_COLOR_WARN,
  FUEL_GAUGE_BG,
  FUEL_GAUGE_HEIGHT_PX,
  FUEL_GAUGE_WIDTH_PX,
  MAX_CONTEXT_TOKENS,
  PROVIDER_COLOR_COPILOT,
  PROVIDER_LABEL_COPILOT,
  SUBAGENT_STATUS_COMPLETED_LABEL,
  SUBAGENT_STATUS_FAILED_LABEL,
  SUBAGENT_STATUS_RUNNING_LABEL,
  TEAM_LEAD_COLOR,
  TEAM_ROLE_COLOR,
  TOKEN_CRITICAL_THRESHOLD,
  TOKEN_DANGER_THRESHOLD,
  TOKEN_WARN_THRESHOLD,
  TOOL_OVERLAY_VERTICAL_OFFSET,
} from '../../constants.js';
import type { SubagentCharacter } from '../../hooks/useExtensionMessages.js';
import { SubagentStatus } from '../../hooks/useExtensionMessages.js';
import type { OfficeState } from '../engine/officeState.js';
import type { ToolActivity } from '../types.js';
import { CharacterState, TILE_SIZE } from '../types.js';

interface ToolOverlayProps {
  officeState: OfficeState;
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  subagentCharacters: SubagentCharacter[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
  onCloseAgent: (id: number) => void;
  alwaysShowOverlay: boolean;
}

/** Derive a short human-readable activity string from tools/status */
function getActivityText(
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
  isActive: boolean,
): string {
  const tools = agentTools[agentId];
  if (tools && tools.length > 0) {
    // Find the latest non-done tool
    const activeTool = [...tools].reverse().find((t) => !t.done);
    if (activeTool) {
      if (activeTool.permissionWait) return 'Needs approval';
      return activeTool.status;
    }
    // All tools done but agent still active (mid-turn) — keep showing last tool status
    if (isActive) {
      const lastTool = tools[tools.length - 1];
      if (lastTool) return lastTool.status;
    }
  }

  return 'Idle';
}

function getFuelColor(ratio: number): string {
  if (ratio >= TOKEN_CRITICAL_THRESHOLD) return FUEL_COLOR_CRITICAL;
  if (ratio >= TOKEN_DANGER_THRESHOLD) return FUEL_COLOR_DANGER;
  if (ratio >= TOKEN_WARN_THRESHOLD) return FUEL_COLOR_WARN;
  return FUEL_COLOR_OK;
}

function getProviderInfo(providerId: 'claude' | 'copilot' | undefined): {
  label: string;
  color: string;
} | null {
  if (!providerId || providerId === 'claude') {
    // Don't show label for Claude (default) to keep UI clean
    return null;
  }
  if (providerId === 'copilot') {
    return { label: PROVIDER_LABEL_COPILOT, color: PROVIDER_COLOR_COPILOT };
  }
  return null;
}

/** Get status label and dot color for a sub-agent based on its lifecycle status */
function getSubagentStatusInfo(sub: SubagentCharacter): { label: string; dotColor: string } {
  switch (sub.status) {
    case SubagentStatus.COMPLETED:
      return { label: SUBAGENT_STATUS_COMPLETED_LABEL, dotColor: 'var(--color-status-success)' };
    case SubagentStatus.FAILED:
      return { label: SUBAGENT_STATUS_FAILED_LABEL, dotColor: 'var(--color-status-error)' };
    default:
      return { label: SUBAGENT_STATUS_RUNNING_LABEL, dotColor: 'var(--color-status-active)' };
  }
}

/** Format elapsed time as a human-readable duration string */
function formatDuration(startedAt: number, completedAt: number | null): string {
  const endTime = completedAt ?? Date.now();
  const elapsed = Math.max(0, endTime - startedAt);
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export function ToolOverlay({
  officeState,
  agents,
  agentTools,
  subagentCharacters,
  containerRef,
  zoom,
  panRef,
  onCloseAgent,
  alwaysShowOverlay,
}: ToolOverlayProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const el = containerRef.current;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const canvasW = Math.round(rect.width * dpr);
  const canvasH = Math.round(rect.height * dpr);
  const layout = officeState.getLayout();
  const mapW = layout.cols * TILE_SIZE * zoom;
  const mapH = layout.rows * TILE_SIZE * zoom;
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x);
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y);

  const selectedId = officeState.selectedAgentId;
  const hoveredId = officeState.hoveredAgentId;

  // All character IDs
  const allIds = [...agents, ...subagentCharacters.map((s) => s.id)];

  return (
    <>
      {allIds.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch) return null;

        const isSelected = selectedId === id;
        const isHovered = hoveredId === id;
        const isSub = ch.isSubagent;

        // Only show for hovered or selected agents (unless always-show is on)
        if (!alwaysShowOverlay && !isSelected && !isHovered) return null;

        // Position above character
        const sittingOffset = ch.state === CharacterState.TYPE ? CHARACTER_SITTING_OFFSET_PX : 0;
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr;
        const screenY =
          (deviceOffsetY + (ch.y + sittingOffset - TOOL_OVERLAY_VERTICAL_OFFSET) * zoom) / dpr;

        // Get activity text
        const subHasPermission = isSub && ch.bubbleType === 'permission';
        const sub = isSub ? subagentCharacters.find((s) => s.id === id) : null;
        let activityText: string;
        if (isSub) {
          if (subHasPermission) {
            activityText = 'Needs approval';
          } else if (sub && sub.status !== SubagentStatus.RUNNING) {
            const statusInfo = getSubagentStatusInfo(sub);
            activityText = statusInfo.label;
          } else {
            activityText = sub ? sub.label || 'Subtask' : 'Subtask';
          }
        } else {
          activityText = getActivityText(id, agentTools, ch.isActive);
        }

        // Determine dot color
        const tools = agentTools[id];
        const hasPermission = subHasPermission || tools?.some((t) => t.permissionWait && !t.done);
        const hasActiveTools = tools?.some((t) => !t.done);
        const isActive = ch.isActive;

        let dotColor: string | null = null;
        if (isSub && sub) {
          const statusInfo = getSubagentStatusInfo(sub);
          if (hasPermission) {
            dotColor = 'var(--color-status-permission)';
          } else {
            dotColor = statusInfo.dotColor;
          }
        } else if (hasPermission) {
          dotColor = 'var(--color-status-permission)';
        } else if (isActive && hasActiveTools) {
          dotColor = 'var(--color-status-active)';
        }

        // Sub-agent metadata
        const subDuration = sub ? formatDuration(sub.startedAt, sub.completedAt) : null;
        const subParentLabel = sub ? `Agent #${sub.parentAgentId}` : null;

        // Team info
        const isTeamAgent = !!ch.teamName;
        const teamRoleLabel = ch.isTeamLead ? 'LEAD' : ch.agentName || null;
        const totalTokens = ch.inputTokens + ch.outputTokens;
        const tokenRatio = totalTokens / MAX_CONTEXT_TOKENS;
        const providerInfo = !isSub ? getProviderInfo(ch.providerId) : null;
        const hasExtraLines = !!(ch.folderName || teamRoleLabel || providerInfo || (isSub && sub));

        return (
          <div
            key={id}
            className="absolute flex flex-col items-center -translate-x-1/2"
            style={{
              left: screenX,
              top: screenY - (hasExtraLines ? 34 : 28),
              pointerEvents: isSelected ? 'auto' : 'none',
              opacity: alwaysShowOverlay && !isSelected && !isHovered ? (isSub ? 0.5 : 0.75) : 1,
              zIndex: isSelected ? 42 : 41,
            }}
          >
            <div className="flex items-center border-border px-8 pt-2 pb-4 gap-5 pixel-panel whitespace-nowrap max-w-2xs">
              {dotColor && (
                <span
                  className={`w-6 h-6 rounded-full shrink-0 ${isActive && !hasPermission ? 'pixel-pulse' : ''}`}
                  style={{ background: dotColor }}
                />
              )}
              <div className="flex flex-col gap-0 overflow-hidden">
                {providerInfo && (
                  <span
                    className="overflow-hidden text-ellipsis block leading-none"
                    style={{
                      fontSize: '16px',
                      color: providerInfo.color,
                      fontWeight: 'bold',
                    }}
                  >
                    {providerInfo.label}
                  </span>
                )}
                {teamRoleLabel && (
                  <span
                    className="overflow-hidden text-ellipsis block leading-none"
                    style={{
                      fontSize: '18px',
                      color: ch.isTeamLead ? TEAM_LEAD_COLOR : TEAM_ROLE_COLOR,
                      fontWeight: ch.isTeamLead ? 'bold' : undefined,
                    }}
                  >
                    {teamRoleLabel}
                  </span>
                )}
                {isSub && sub && (
                  <span
                    className="overflow-hidden text-ellipsis block leading-none"
                    style={{
                      fontSize: '16px',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {subParentLabel} · {subDuration}
                  </span>
                )}
                <span
                  className="overflow-hidden text-ellipsis block leading-none"
                  style={{
                    fontSize: isSub ? '20px' : '22px',
                    fontStyle: isSub ? 'italic' : undefined,
                  }}
                >
                  {activityText}
                </span>
                {isSub && sub && sub.label && sub.status === SubagentStatus.RUNNING && (
                  <span className="text-2xs leading-none overflow-hidden text-ellipsis block">
                    {sub.label}
                  </span>
                )}
                {ch.folderName && (
                  <span className="text-2xs leading-none overflow-hidden text-ellipsis block">
                    {ch.folderName}
                  </span>
                )}
              </div>
              {isSelected && !isSub && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseAgent(id);
                  }}
                  title="Close agent"
                  className="ml-2 shrink-0 leading-none"
                >
                  ×
                </Button>
              )}
            </div>
            {isTeamAgent && totalTokens > 0 && (
              <div
                style={{
                  width: FUEL_GAUGE_WIDTH_PX,
                  height: FUEL_GAUGE_HEIGHT_PX,
                  background: FUEL_GAUGE_BG,
                  marginTop: 2,
                }}
                title={`${Math.round(tokenRatio * 100)}% context used (${(totalTokens / 1000).toFixed(0)}k tokens)`}
              >
                <div
                  style={{
                    width: `${Math.min(tokenRatio * 100, 100)}%`,
                    height: '100%',
                    background: getFuelColor(tokenRatio),
                  }}
                />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

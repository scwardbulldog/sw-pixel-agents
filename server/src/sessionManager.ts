/**
 * Session manager for standalone mode.
 *
 * Coordinates session discovery, transcript parsing, and event broadcasting.
 * This is the "brain" of the standalone server - equivalent to PixelAgentsViewProvider
 * but without VS Code dependencies.
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  decodeAllCharacters,
  decodeAllFloors,
  decodeAllFurniture,
  decodeAllWalls,
} from '../../shared/assets/loader.js';
import type { CatalogEntry } from '../../shared/assets/types.js';
import { TOOL_DONE_DELAY_MS } from './constants.js';
import { logger } from './logger.js';
import {
  formatToolStatus as formatCopilotToolStatus,
  parseTranscriptLine as parseCopilotLine,
} from './providers/hook/copilot/copilotTranscriptParser.js';
import { claudeProvider } from './providers/index.js';
import type { DiscoveredSession, SessionScanner } from './sessionScanner.js';
import type { WebSocketBroadcaster, WebviewMessage } from './webSocketServer.js';

/** Agent state tracked for each active session */
interface AgentState {
  id: number;
  sessionId: string;
  providerId: 'claude' | 'copilot';
  transcriptPath: string;
  cwd?: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  isWaiting: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  lastDataAt: number;
  inputTokens: number;
  outputTokens: number;
}

/** Tool done messages waiting to be sent (delay prevents UI flicker) */
interface PendingToolDone {
  agentId: number;
  toolId: string;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Manages all active agent sessions and broadcasts events to connected browsers.
 */
export class SessionManager {
  private broadcaster: WebSocketBroadcaster;
  private scanner: SessionScanner;
  private agents = new Map<number, AgentState>();
  private sessionIdToAgentId = new Map<string, number>();
  private nextAgentId = 1;
  private pendingToolDone = new Map<string, PendingToolDone>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  // Cached asset data (loaded once)
  private assetsDir: string | null = null;
  private assetMessages: WebviewMessage[] | null = null;

  constructor(broadcaster: WebSocketBroadcaster, scanner: SessionScanner) {
    this.broadcaster = broadcaster;
    this.scanner = scanner;
  }

  /** Set the assets directory for loading sprites */
  setAssetsDir(dir: string): void {
    this.assetsDir = dir;
  }

  /** Start the session manager */
  start(): void {
    // Poll sessions for new data
    this.pollTimer = setInterval(() => {
      this.pollAllSessions();
    }, 500);

    logger.info('SessionManager: started');
  }

  /** Stop the session manager */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Clear pending tool done timers
    for (const pending of this.pendingToolDone.values()) {
      clearTimeout(pending.timer);
    }
    this.pendingToolDone.clear();

    this.agents.clear();
    this.sessionIdToAgentId.clear();
    logger.info('SessionManager: stopped');
  }

  /** Find the highest-versioned default layout file */
  private findDefaultLayout(): string | null {
    if (!this.assetsDir) return null;

    try {
      // Scan for versioned default layouts: default-layout-{N}.json
      let bestRevision = 0;
      let bestPath: string | null = null;

      if (fs.existsSync(this.assetsDir)) {
        for (const file of fs.readdirSync(this.assetsDir)) {
          const match = /^default-layout-(\d+)\.json$/.exec(file);
          if (match) {
            const rev = parseInt(match[1], 10);
            if (rev > bestRevision) {
              bestRevision = rev;
              bestPath = path.join(this.assetsDir, file);
            }
          }
        }
      }

      // Fall back to unversioned default-layout.json
      if (!bestPath) {
        const fallback = path.join(this.assetsDir, 'default-layout.json');
        if (fs.existsSync(fallback)) {
          bestPath = fallback;
        }
      }

      return bestPath;
    } catch {
      return null;
    }
  }

  /** Handle a newly discovered session */
  handleSessionDiscovered(session: DiscoveredSession): void {
    // Create agent for this session
    const agentId = this.nextAgentId++;

    const agent: AgentState = {
      id: agentId,
      sessionId: session.sessionId,
      providerId: session.providerId,
      transcriptPath: session.transcriptPath,
      cwd: session.cwd,
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      lastDataAt: Date.now(),
      inputTokens: 0,
      outputTokens: 0,
    };

    this.agents.set(agentId, agent);
    this.sessionIdToAgentId.set(session.sessionId, agentId);

    // Determine folder name from cwd
    const folderName = session.cwd ? path.basename(session.cwd) : 'Unknown';

    // Broadcast agent creation
    this.broadcaster.broadcast({
      type: 'agentCreated',
      id: agentId,
      folderName,
      providerId: session.providerId,
    });

    logger.info(`SessionManager: created agent ${agentId} for session ${session.sessionId}`);
  }

  /** Handle session becoming stale (inactive or deleted) */
  handleSessionStale(sessionId: string): void {
    const agentId = this.sessionIdToAgentId.get(sessionId);
    if (agentId === undefined) return;

    this.sessionIdToAgentId.delete(sessionId);
    this.agents.delete(agentId);

    this.broadcaster.broadcast({
      type: 'agentClosed',
      id: agentId,
    });

    logger.info(`SessionManager: closed agent ${agentId} (session stale)`);
  }

  /** Poll all sessions for new transcript data */
  private pollAllSessions(): void {
    for (const sessionId of this.scanner.getActiveSessions()) {
      const lines = this.scanner.readNewLines(sessionId);
      if (lines.length > 0) {
        this.processTranscriptLines(sessionId, lines);
      }
    }
  }

  /** Process transcript lines for a session */
  private processTranscriptLines(sessionId: string, lines: string[]): void {
    const agentId = this.sessionIdToAgentId.get(sessionId);
    if (agentId === undefined) return;

    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.lastDataAt = Date.now();

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        // Route to the appropriate parser based on provider
        if (agent.providerId === 'copilot') {
          this.processCopilotLine(agent, line);
        } else {
          const record = JSON.parse(line) as Record<string, unknown>;
          this.processClaudeRecord(agent, record);
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  /** Process a Copilot transcript line */
  private processCopilotLine(agent: AgentState, line: string): void {
    const event = parseCopilotLine(line);
    if (!event) return;

    switch (event.kind) {
      case 'toolStart': {
        agent.isWaiting = false;
        agent.hadToolsInTurn = true;

        const status = formatCopilotToolStatus(event.toolName, event.input);

        agent.activeToolIds.add(event.toolId);
        agent.activeToolStatuses.set(event.toolId, status);
        agent.activeToolNames.set(event.toolId, event.toolName);

        this.broadcaster.broadcast({
          type: 'agentStatus',
          id: agent.id,
          status: 'active',
        });

        this.broadcaster.broadcast({
          type: 'agentToolStart',
          id: agent.id,
          toolId: event.toolId,
          status,
          toolName: event.toolName,
          permissionActive: agent.permissionSent,
        });
        break;
      }

      case 'toolEnd': {
        this.scheduleToolDone(agent.id, event.toolId);
        break;
      }

      case 'turnEnd': {
        // Clear all active tools and set waiting
        this.clearAllTools(agent);
        agent.isWaiting = true;
        agent.hadToolsInTurn = false;

        this.broadcaster.broadcast({
          type: 'agentStatus',
          id: agent.id,
          status: 'waiting',
        });
        break;
      }

      case 'userTurn': {
        // New user prompt - agent becomes active
        agent.isWaiting = false;
        agent.hadToolsInTurn = false;

        this.broadcaster.broadcast({
          type: 'agentStatus',
          id: agent.id,
          status: 'active',
        });
        break;
      }
    }
  }

  /** Process a single Claude transcript record */
  private processClaudeRecord(agent: AgentState, record: Record<string, unknown>): void {
    const type = record.type as string;

    // Extract content from assistant messages
    const assistantContent = (record.message as Record<string, unknown>)?.content ?? record.content;

    if (type === 'assistant' && Array.isArray(assistantContent)) {
      const blocks = assistantContent as Array<{
        type: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;

      const hasToolUse = blocks.some((b) => b.type === 'tool_use');

      if (hasToolUse) {
        agent.isWaiting = false;
        agent.hadToolsInTurn = true;
        this.broadcaster.broadcast({
          type: 'agentStatus',
          id: agent.id,
          status: 'active',
        });

        for (const block of blocks) {
          if (block.type === 'tool_use' && block.id) {
            const toolName = block.name || '';
            const status = this.formatToolStatus(toolName, block.input || {});

            agent.activeToolIds.add(block.id);
            agent.activeToolStatuses.set(block.id, status);
            agent.activeToolNames.set(block.id, toolName);

            this.broadcaster.broadcast({
              type: 'agentToolStart',
              id: agent.id,
              toolId: block.id,
              status,
              toolName,
              permissionActive: agent.permissionSent,
            });
          }
        }
      }
    } else if (type === 'user') {
      // User message - check for tool results
      const userContent = (record.message as Record<string, unknown>)?.content ?? record.content;

      if (Array.isArray(userContent)) {
        for (const block of userContent as Array<{ type: string; tool_use_id?: string }>) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            this.scheduleToolDone(agent.id, block.tool_use_id);
          }
        }
      }

      // Reset turn state for new user prompt
      agent.hadToolsInTurn = false;
      agent.permissionSent = false;
    } else if (type === 'system' && record.subtype === 'turn_duration') {
      // Turn complete - clear all tools and mark as waiting
      this.clearAllTools(agent);
      agent.isWaiting = true;
      agent.hadToolsInTurn = false;

      this.broadcaster.broadcast({
        type: 'agentStatus',
        id: agent.id,
        status: 'waiting',
      });
    }

    // Extract token usage
    const usage = (record.message as Record<string, unknown>)?.usage as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;
    if (usage) {
      if (typeof usage.input_tokens === 'number') {
        agent.inputTokens += usage.input_tokens;
      }
      if (typeof usage.output_tokens === 'number') {
        agent.outputTokens += usage.output_tokens;
      }
      this.broadcaster.broadcast({
        type: 'agentTokenUsage',
        id: agent.id,
        inputTokens: agent.inputTokens,
        outputTokens: agent.outputTokens,
      });
    }
  }

  /** Format tool status for display */
  private formatToolStatus(toolName: string, input: Record<string, unknown>): string {
    // Use Claude provider's format (works for both Claude and Copilot)
    return claudeProvider.formatToolStatus(toolName, input);
  }

  /** Schedule a tool done message with delay (prevents UI flicker) */
  private scheduleToolDone(agentId: number, toolId: string): void {
    const key = `${agentId}:${toolId}`;

    // Cancel existing pending done for this tool
    const existing = this.pendingToolDone.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(() => {
      this.pendingToolDone.delete(key);

      const agent = this.agents.get(agentId);
      if (agent) {
        agent.activeToolIds.delete(toolId);
        agent.activeToolStatuses.delete(toolId);
        agent.activeToolNames.delete(toolId);
      }

      this.broadcaster.broadcast({
        type: 'agentToolDone',
        id: agentId,
        toolId,
      });
    }, TOOL_DONE_DELAY_MS);

    this.pendingToolDone.set(key, { agentId, toolId, timer });
  }

  /** Clear all active tools for an agent */
  private clearAllTools(agent: AgentState): void {
    // Cancel pending tool done timers for this agent
    for (const [key, pending] of this.pendingToolDone) {
      if (pending.agentId === agent.id) {
        clearTimeout(pending.timer);
        this.pendingToolDone.delete(key);
      }
    }

    agent.activeToolIds.clear();
    agent.activeToolStatuses.clear();
    agent.activeToolNames.clear();

    this.broadcaster.broadcast({
      type: 'agentToolsClear',
      id: agent.id,
    });
  }

  /** Get initial state messages for a newly connected client */
  getInitialStateMessages(): WebviewMessage[] {
    const messages: WebviewMessage[] = [];

    // Load assets if not already cached
    if (!this.assetMessages && this.assetsDir) {
      this.assetMessages = this.loadAssets();
    }

    // Add asset messages (sprites, catalog) but NOT layoutLoaded yet
    // Layout must come AFTER existingAgents so buffered agents are added
    let layoutMessage: WebviewMessage | null = null;
    if (this.assetMessages) {
      for (const msg of this.assetMessages) {
        if (msg.type === 'layoutLoaded') {
          layoutMessage = msg;
        } else {
          messages.push(msg);
        }
      }
    }

    // Settings (minimal for standalone)
    messages.push({
      type: 'settingsLoaded',
      soundEnabled: true,
      extensionVersion: '1.0.0-standalone',
      lastSeenVersion: '1.0.0',
      enabledProviders: ['claude', 'copilot'],
      defaultProvider: 'claude',
    });

    // Existing agents BEFORE layout - format must match extension's sendExistingAgents
    if (this.agents.size > 0) {
      const agentIds: number[] = [];
      const agentMeta: Record<string, { providerId?: string }> = {};
      const folderNames: Record<number, string> = {};

      for (const agent of this.agents.values()) {
        agentIds.push(agent.id);
        agentMeta[String(agent.id)] = {
          providerId: agent.providerId,
        };
        if (agent.cwd) {
          folderNames[agent.id] = path.basename(agent.cwd);
        }
      }

      agentIds.sort((a, b) => a - b);

      messages.push({
        type: 'existingAgents',
        agents: agentIds,
        agentMeta,
        folderNames,
      });
    }

    // Layout LAST - this triggers adding buffered agents to OfficeState
    if (layoutMessage) {
      messages.push(layoutMessage);
    }

    return messages;
  }

  /** Load assets from disk and return as WebviewMessages */
  private loadAssets(): WebviewMessage[] {
    if (!this.assetsDir) return [];

    const messages: WebviewMessage[] = [];

    try {
      // Load character sprites
      const characters = decodeAllCharacters(this.assetsDir);
      if (characters.length > 0) {
        messages.push({ type: 'characterSpritesLoaded', characters });
        logger.debug(`Loaded ${characters.length} character sprites`);
      }

      // Load floor tiles
      const floors = decodeAllFloors(this.assetsDir);
      if (floors.length > 0) {
        messages.push({ type: 'floorTilesLoaded', sprites: floors });
        logger.debug(`Loaded ${floors.length} floor tiles`);
      }

      // Load wall tiles
      const walls = decodeAllWalls(this.assetsDir);
      if (walls.length > 0) {
        messages.push({ type: 'wallTilesLoaded', sets: walls });
        logger.debug(`Loaded ${walls.length} wall sets`);
      }

      // Load furniture catalog and sprites
      const catalogPath = path.join(this.assetsDir, 'furniture-catalog.json');
      if (fs.existsSync(catalogPath)) {
        const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8')) as CatalogEntry[];
        const sprites = decodeAllFurniture(this.assetsDir, catalog);
        messages.push({
          type: 'furnitureAssetsLoaded',
          catalog,
          sprites,
        });
        logger.debug(`Loaded ${catalog.length} furniture items`);
      }

      // Load default layout (find highest versioned file)
      const layoutPath = this.findDefaultLayout();
      if (layoutPath) {
        const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf-8')) as unknown;
        messages.push({ type: 'layoutLoaded', layout });
        logger.debug('Loaded default layout');
      }

      logger.info('Assets loaded successfully');
    } catch (e) {
      logger.error(`Failed to load assets: ${e}`);
    }

    return messages;
  }
}

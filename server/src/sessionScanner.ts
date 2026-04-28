/**
 * Session scanner for standalone mode.
 *
 * Discovers and monitors active Claude Code and Copilot CLI sessions
 * by watching the filesystem. Used when running without VS Code.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  EXTERNAL_ACTIVE_THRESHOLD_MS,
  FILE_WATCHER_POLL_INTERVAL_MS,
  GLOBAL_SCAN_ACTIVE_MAX_AGE_MS,
  GLOBAL_SCAN_ACTIVE_MIN_SIZE,
  MAX_JSONL_LINE_LENGTH,
  PROJECT_SCAN_INTERVAL_MS,
} from './constants.js';
import { logger } from './logger.js';

/** Represents a discovered session file */
export interface DiscoveredSession {
  /** Unique session ID (from filename or directory) */
  sessionId: string;
  /** Provider: 'claude' or 'copilot' */
  providerId: 'claude' | 'copilot';
  /** Absolute path to the JSONL transcript file */
  transcriptPath: string;
  /** Working directory (project path) if determinable */
  cwd?: string;
  /** Last modification time */
  mtime: number;
  /** File size in bytes */
  size: number;
}

/** Callback for session lifecycle events */
export interface SessionScannerCallbacks {
  /** Called when a new session is discovered */
  onSessionDiscovered: (session: DiscoveredSession) => void;
  /** Called when a session file is updated (new data available) */
  onSessionUpdated: (sessionId: string, newSize: number) => void;
  /** Called when a session appears to be inactive (stale) */
  onSessionStale: (sessionId: string) => void;
}

/** State tracked per session */
interface SessionState {
  session: DiscoveredSession;
  fileOffset: number;
  lineBuffer: string;
  lastChecked: number;
}

/**
 * Scans filesystem for active CLI sessions.
 *
 * Monitors:
 * - ~/.claude/projects/<hash>/*.jsonl (Claude Code sessions)
 * - ~/.copilot/session-state/<uuid>/events.jsonl (Copilot CLI sessions)
 */
export class SessionScanner {
  private callbacks: SessionScannerCallbacks;
  private sessions = new Map<string, SessionState>();
  private knownFiles = new Set<string>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(callbacks: SessionScannerCallbacks) {
    this.callbacks = callbacks;
  }

  /** Start scanning for sessions */
  start(): void {
    // Initial scan
    this.scanAllProviders();

    // Periodic scan for new sessions (every 1s)
    this.scanTimer = setInterval(() => {
      this.scanAllProviders();
    }, PROJECT_SCAN_INTERVAL_MS);

    // Frequent polling for file updates (every 500ms)
    this.pollTimer = setInterval(() => {
      this.pollAllSessions();
    }, FILE_WATCHER_POLL_INTERVAL_MS);

    logger.info('SessionScanner: started');
  }

  /** Stop scanning */
  stop(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.sessions.clear();
    this.knownFiles.clear();
    logger.info('SessionScanner: stopped');
  }

  /** Get all active session IDs */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /** Get session state by ID */
  getSession(sessionId: string): SessionState | undefined {
    return this.sessions.get(sessionId);
  }

  /** Read new lines from a session's transcript file */
  readNewLines(sessionId: string): string[] {
    const state = this.sessions.get(sessionId);
    if (!state) return [];

    try {
      const stat = fs.statSync(state.session.transcriptPath);
      if (stat.size <= state.fileOffset) return [];

      // Cap single read at 64KB
      const MAX_READ_BYTES = 65536;
      const bytesToRead = Math.min(stat.size - state.fileOffset, MAX_READ_BYTES);
      const buf = Buffer.alloc(bytesToRead);
      const fd = fs.openSync(state.session.transcriptPath, 'r');
      fs.readSync(fd, buf, 0, buf.length, state.fileOffset);
      fs.closeSync(fd);
      state.fileOffset += bytesToRead;

      const text = state.lineBuffer + buf.toString('utf-8');
      const lines = text.split('\n');
      state.lineBuffer = lines.pop() || '';

      // Truncate line buffer if too large (SEC-011)
      if (state.lineBuffer.length > MAX_JSONL_LINE_LENGTH) {
        logger.warn(`Session ${sessionId}: line buffer too large, truncating`);
        state.lineBuffer = '';
        state.fileOffset = stat.size;
        return [];
      }

      return lines.filter((l) => l.trim() && l.length <= MAX_JSONL_LINE_LENGTH);
    } catch (e) {
      if (e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`Session ${sessionId}: read error: ${e}`);
      }
      return [];
    }
  }

  /** Scan all provider directories for sessions */
  private scanAllProviders(): void {
    this.scanClaudeSessions();
    this.scanCopilotSessions();
    this.checkStaleSessions();
  }

  /** Scan ~/.claude/projects for Claude Code sessions */
  private scanClaudeSessions(): void {
    const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');

    try {
      if (!fs.existsSync(claudeProjectsDir)) return;

      const projectDirs = fs.readdirSync(claudeProjectsDir);
      for (const projectHash of projectDirs) {
        const projectDir = path.join(claudeProjectsDir, projectHash);
        try {
          const stat = fs.statSync(projectDir);
          if (!stat.isDirectory()) continue;

          const files = fs.readdirSync(projectDir).filter((f) => f.endsWith('.jsonl'));
          for (const file of files) {
            const filePath = path.join(projectDir, file);
            this.checkAndAdoptFile(filePath, 'claude', projectDir);
          }
        } catch {
          // Skip inaccessible directories
        }
      }
    } catch {
      // Claude directory doesn't exist or is inaccessible
    }
  }

  /** Check if a Copilot session directory has an active lock file */
  private hasActiveLockFile(sessionDir: string): boolean {
    try {
      const files = fs.readdirSync(sessionDir);
      // Lock file pattern: inuse.<pid>.lock
      return files.some((f) => /^inuse\.\d+\.lock$/.test(f));
    } catch {
      return false;
    }
  }

  /** Scan ~/.copilot/session-state for Copilot CLI sessions */
  private scanCopilotSessions(): void {
    const copilotDir = path.join(os.homedir(), '.copilot', 'session-state');

    try {
      if (!fs.existsSync(copilotDir)) return;

      const sessionDirs = fs.readdirSync(copilotDir);
      for (const sessionId of sessionDirs) {
        const sessionDir = path.join(copilotDir, sessionId);
        const eventsFile = path.join(sessionDir, 'events.jsonl');

        try {
          if (!fs.existsSync(eventsFile)) continue;

          // If we're already tracking this session, check if lock file was removed
          // (indicates session ended). Not all Copilot versions create lock files,
          // so we only use this as a signal for sessions that HAD a lock file.
          const state = this.sessions.get(sessionId);
          if (state && state.session.providerId === 'copilot') {
            // Check if session had a lock file and it's now gone
            const hadLockFile = (state.session as DiscoveredSession & { hadLockFile?: boolean })
              .hadLockFile;
            if (hadLockFile && !this.hasActiveLockFile(sessionDir)) {
              logger.info(`SessionScanner: Copilot session ${sessionId} lock file removed`);
              this.sessions.delete(sessionId);
              this.knownFiles.delete(eventsFile);
              this.callbacks.onSessionStale(sessionId);
              continue;
            }
          }

          // Check for new sessions
          this.checkAndAdoptFile(eventsFile, 'copilot', sessionDir, sessionId);

          // Record if lock file exists for future detection
          const newState = this.sessions.get(sessionId);
          if (newState && this.hasActiveLockFile(sessionDir)) {
            (newState.session as DiscoveredSession & { hadLockFile?: boolean }).hadLockFile = true;
          }
        } catch {
          // Skip inaccessible session directories
        }
      }
    } catch {
      // Copilot directory doesn't exist or is inaccessible
    }
  }

  /** Check if a file should be adopted as an active session */
  private checkAndAdoptFile(
    filePath: string,
    providerId: 'claude' | 'copilot',
    cwd: string,
    overrideSessionId?: string,
  ): void {
    // Already tracking this file
    if (this.knownFiles.has(filePath)) return;

    try {
      const stat = fs.statSync(filePath);
      const now = Date.now();
      const age = now - stat.mtimeMs;

      // Filter: must be recently modified and have content
      if (age > GLOBAL_SCAN_ACTIVE_MAX_AGE_MS) return;
      if (stat.size < GLOBAL_SCAN_ACTIVE_MIN_SIZE) return;

      // Additional freshness check
      if (age > EXTERNAL_ACTIVE_THRESHOLD_MS) return;

      const sessionId = overrideSessionId || path.basename(filePath, '.jsonl');

      // Already tracking this session ID (maybe from a different file)
      if (this.sessions.has(sessionId)) return;

      const session: DiscoveredSession = {
        sessionId,
        providerId,
        transcriptPath: filePath,
        cwd,
        mtime: stat.mtimeMs,
        size: stat.size,
      };

      const state: SessionState = {
        session,
        fileOffset: 0, // Start from beginning to show history
        lineBuffer: '',
        lastChecked: now,
      };

      this.sessions.set(sessionId, state);
      this.knownFiles.add(filePath);

      logger.info(`SessionScanner: discovered ${providerId} session ${sessionId}`);
      this.callbacks.onSessionDiscovered(session);
    } catch {
      // File may have been deleted between scan and stat
    }
  }

  /** Poll all tracked sessions for updates */
  private pollAllSessions(): void {
    for (const [sessionId, state] of this.sessions) {
      try {
        const stat = fs.statSync(state.session.transcriptPath);
        state.lastChecked = Date.now();
        state.session.mtime = stat.mtimeMs;
        state.session.size = stat.size;

        if (stat.size > state.fileOffset) {
          this.callbacks.onSessionUpdated(sessionId, stat.size);
        }
      } catch (e) {
        if (e instanceof Error && 'code' in e && (e as NodeJS.ErrnoException).code === 'ENOENT') {
          // File was deleted
          logger.info(`SessionScanner: session ${sessionId} file deleted`);
          this.sessions.delete(sessionId);
          this.knownFiles.delete(state.session.transcriptPath);
          this.callbacks.onSessionStale(sessionId);
        }
      }
    }
  }

  /** Check for stale sessions - only removes if file is deleted or Copilot lock file removed */
  private checkStaleSessions(): void {
    // The extension keeps agents alive as long as the file exists (sessions can be resumed).
    // File deletion is handled in pollAllSessions (ENOENT).
    // Copilot lock file removal is handled in scanCopilotSessions.
    // No additional mtime-based staleness check needed.
  }
}

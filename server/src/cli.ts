/**
 * CLI entrypoint for standalone Pixel Agents server.
 *
 * Usage:
 *   pixel-agents [options]
 *
 * Options:
 *   --port <number>    Port to listen on (default: auto)
 *   --no-open          Don't open browser automatically
 *   --no-hooks         Don't auto-install Claude hooks
 *   --help             Show this help message
 */
import * as childProcess from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import { HOOK_API_PREFIX, MAX_HOOK_BODY_SIZE } from './constants.js';
import { logger } from './logger.js';
import { installHooks, uninstallHooks } from './providers/hook/claude/claudeHookInstaller.js';
import { SessionManager } from './sessionManager.js';
import { SessionScanner } from './sessionScanner.js';
import { createStaticHandler, findAssetsDir, findWebviewDist } from './staticServer.js';
import { WebSocketBroadcaster } from './webSocketServer.js';

interface CliOptions {
  port: number | null;
  openBrowser: boolean;
  installHooks: boolean;
  help: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    port: null,
    openBrowser: true,
    installHooks: true,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--port':
        options.port = parseInt(args[++i], 10);
        if (isNaN(options.port)) {
          console.error('Invalid port number');
          process.exit(1);
        }
        break;
      case '--no-open':
        options.openBrowser = false;
        break;
      case '--no-hooks':
        options.installHooks = false;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
    }
  }

  return options;
}

function showHelp(): void {
  console.log(`
Pixel Agents - Standalone Agent Monitor

Usage: pixel-agents [options]

Options:
  --port <number>    Port to listen on (default: auto-assign)
  --no-open          Don't open browser automatically
  --no-hooks         Don't auto-install Claude Code hooks
  --help, -h         Show this help message

Description:
  Monitors all Claude Code and GitHub Copilot CLI sessions running on
  your machine, displaying them as animated characters in a pixel art
  office visualization.

Examples:
  pixel-agents                    # Start with defaults
  pixel-agents --port 8080        # Use specific port
  pixel-agents --no-open          # Start without opening browser

Session Detection:
  - Claude Code: ~/.claude/projects/<hash>/*.jsonl
  - Copilot CLI: ~/.copilot/session-state/<uuid>/events.jsonl

More info: https://github.com/pablodelucca/pixel-agents
`);
}

function openBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;

  switch (platform) {
    case 'darwin':
      cmd = 'open';
      break;
    case 'win32':
      cmd = 'start';
      break;
    default:
      cmd = 'xdg-open';
  }

  try {
    if (platform === 'win32') {
      childProcess.exec(`${cmd} "" "${url}"`);
    } else {
      childProcess.exec(`${cmd} "${url}"`);
    }
  } catch (e) {
    logger.warn(`Failed to open browser: ${e}`);
    console.log(`\nOpen in browser: ${url}`);
  }
}

async function writeServerJson(port: number, token: string): Promise<void> {
  const dir = path.join(os.homedir(), '.pixel-agents');
  const filePath = path.join(dir, 'server.json');

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    const config = {
      port,
      pid: process.pid,
      token,
      startedAt: Date.now(),
    };

    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    logger.error(`Failed to write server.json: ${e}`);
  }
}

function deleteServerJson(): void {
  const filePath = path.join(os.homedir(), '.pixel-agents', 'server.json');
  try {
    if (fs.existsSync(filePath)) {
      const config = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { pid: number };
      if (config.pid === process.pid) {
        fs.unlinkSync(filePath);
      }
    }
  } catch {
    // Ignore errors
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  // Find webview dist directory and assets directory
  const webviewDist = findWebviewDist();
  const assetsDir = findAssetsDir();

  if (!webviewDist && !assetsDir) {
    console.error(
      'Error: Neither webview dist nor source assets found. Run `npm run build` first.',
    );
    process.exit(1);
  }

  console.log('🎮 Pixel Agents - Standalone Mode\n');

  // Generate auth token for hooks
  const token = crypto.randomUUID();

  // Create HTTP server
  const staticHandler = webviewDist ? createStaticHandler({ root: webviewDist }) : null;
  const server = http.createServer((req, res) => {
    // Try static files first
    if (staticHandler && staticHandler(req, res)) return;

    // Health endpoint
    if (req.method === 'GET' && req.url === '/api/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', mode: 'standalone' }));
      return;
    }

    // Hook endpoint: POST /api/hooks/:providerId
    if (req.method === 'POST' && req.url?.startsWith(HOOK_API_PREFIX + '/')) {
      handleHookRequest(req, res, token, (providerId, event) => {
        sessionManager.handleHookEvent(providerId, event);
      });
      return;
    }

    // 404 for unknown routes
    res.writeHead(404);
    res.end('Not Found');
  });

  // Create WebSocket broadcaster
  const broadcaster = new WebSocketBroadcaster();
  broadcaster.attach(server);

  // Create session scanner
  const scanner = new SessionScanner({
    onSessionDiscovered: (session) => {
      sessionManager.handleSessionDiscovered(session);
    },
    onSessionUpdated: () => {
      // Handled by polling in sessionManager
    },
    onSessionStale: (sessionId) => {
      sessionManager.handleSessionStale(sessionId);
    },
  });

  // Create session manager
  const sessionManager = new SessionManager(broadcaster, scanner);

  // Set assets directory for the session manager
  if (assetsDir) {
    sessionManager.setAssetsDir(assetsDir);
  } else if (webviewDist) {
    const distAssets = path.join(webviewDist, 'assets');
    if (fs.existsSync(distAssets)) {
      sessionManager.setAssetsDir(distAssets);
    }
  }

  // Handle inbound WebSocket messages from browser clients
  broadcaster.onMessage((msg) => {
    switch (msg.type) {
      case 'saveLayout':
        sessionManager.handleSaveLayout(msg.layout as Record<string, unknown>);
        break;
      case 'setEnabledProviders':
        sessionManager.handleSetEnabledProviders(
          msg.providers as ('claude' | 'copilot')[],
        );
        break;
      case 'openClaude':
      case 'openCopilot':
      case 'focusAgent':
      case 'closeAgent':
        break; // no-op — no terminals in standalone mode
      case 'webviewReady':
        break; // already handled by onConnection callback
    }
  });

  // Handle new WebSocket connections - send initial state
  broadcaster.onConnection((ws) => {
    const messages = sessionManager.getInitialStateMessages();
    broadcaster.sendInitialState(ws, messages);
  });

  // Start server
  const port = options.port ?? 0;
  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve();
    });
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;

  // Write server.json for hook discovery
  await writeServerJson(actualPort, token);

  // Install Claude hooks if enabled
  if (options.installHooks) {
    try {
      // Copy hook script to ~/.pixel-agents/hooks/ if not present
      const hooksDir = path.join(os.homedir(), '.pixel-agents', 'hooks');
      const hookScriptDest = path.join(hooksDir, 'claude-hook.js');

      // Search multiple candidate paths for the built hook script:
      // 1. Next to bundled CLI (server/dist/hooks/) — production build
      // 2. Root dist/hooks/ from server/src/ — tsx dev mode
      // 3. Root dist/hooks/ from project root — tsx dev mode (alt)
      const hookScriptCandidates = [
        path.join(__dirname, 'hooks', 'claude-hook.js'),
        path.join(__dirname, '..', '..', 'dist', 'hooks', 'claude-hook.js'),
        path.join(__dirname, '..', 'dist', 'hooks', 'claude-hook.js'),
      ];
      const hookScriptSrc = hookScriptCandidates.find((p) => fs.existsSync(p));

      if (!fs.existsSync(hooksDir)) {
        fs.mkdirSync(hooksDir, { recursive: true, mode: 0o700 });
      }

      if (hookScriptSrc && !fs.existsSync(hookScriptDest)) {
        fs.copyFileSync(hookScriptSrc, hookScriptDest);
        fs.chmodSync(hookScriptDest, 0o755);
      }

      // Only install hooks in ~/.claude/settings.json if the script exists at destination
      if (fs.existsSync(hookScriptDest)) {
        installHooks();
        console.log('✓ Claude Code hooks installed');
      } else {
        console.warn(
          '⚠ Hook script not found — run `npm run build` first to enable Claude Code hooks',
        );
      }
    } catch (e) {
      console.warn(`⚠ Could not install hooks: ${e}`);
    }
  }

  // Start session scanning
  scanner.start();
  sessionManager.start();

  const url = `http://localhost:${actualPort}`;
  console.log(`✓ Server running at ${url}`);
  console.log('✓ Scanning for active sessions...\n');

  // Open browser (only when serving static files — in dev mode the webview runs via Vite)
  if (options.openBrowser && staticHandler) {
    openBrowser(url);
  } else if (!staticHandler) {
    console.log(
      `ℹ No built webview found. Use \`npm run dev:webview-standalone\` to start the dev UI.\n`,
    );
  } else {
    console.log(`Open in browser: ${url}\n`);
  }

  console.log('Press Ctrl+C to stop\n');

  // Graceful shutdown
  const shutdown = (): void => {
    console.log('\nShutting down...');

    scanner.stop();
    sessionManager.stop();
    broadcaster.close();
    server.close();

    // Uninstall hooks
    if (options.installHooks) {
      try {
        uninstallHooks();
      } catch {
        // Ignore errors during shutdown
      }
    }

    deleteServerJson();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Handle POST /api/hooks/:providerId requests.
 * Validates auth, enforces body size limit, parses JSON, and dispatches.
 */
function handleHookRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string,
  onEvent: (providerId: string, event: Record<string, unknown>) => void,
): void {
  // Validate auth token (timing-safe comparison)
  const authHeader = req.headers['authorization'] ?? '';
  const expectedToken = `Bearer ${token}`;
  const authBuf = Buffer.from(authHeader);
  const expectedBuf = Buffer.from(expectedToken);
  if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
    res.writeHead(401);
    res.end('unauthorized');
    return;
  }

  // Extract provider ID from URL: /api/hooks/claude -> "claude"
  const providerId = req.url!.slice(HOOK_API_PREFIX.length + 1);
  if (!providerId || !/^[a-z0-9-]+$/.test(providerId)) {
    res.writeHead(400);
    res.end('invalid provider id');
    return;
  }

  // Read body with size limit
  let body = '';
  let bodySize = 0;
  let responded = false;

  req.on('data', (chunk: Buffer) => {
    bodySize += chunk.length;
    if (bodySize > MAX_HOOK_BODY_SIZE && !responded) {
      responded = true;
      res.writeHead(413);
      res.end('payload too large');
      req.destroy();
      return;
    }
    if (!responded) {
      body += chunk.toString();
    }
  });

  req.on('end', () => {
    if (responded) return;
    try {
      const event = JSON.parse(body) as Record<string, unknown>;
      if (event.session_id && event.hook_event_name) {
        onEvent(providerId, event);
      }
      res.writeHead(200);
      res.end('ok');
    } catch {
      res.writeHead(400);
      res.end('invalid json');
    }
  });
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});

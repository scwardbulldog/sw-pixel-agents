/**
 * WebSocket client for standalone mode.
 *
 * Connects to the standalone server's WebSocket endpoint and dispatches
 * messages to the existing useExtensionMessages hook via window events.
 *
 * Messages are queued until the webview signals it's ready (after React mounts).
 */

/** WebSocket connection state */
type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting';

/** Callbacks for connection state changes */
interface StandaloneClientCallbacks {
  onStateChange?: (state: ConnectionState) => void;
}

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let callbacks: StandaloneClientCallbacks = {};
let messageQueue: Array<{ type: string }>[] = [];
let isReady = false;

const RECONNECT_DELAY_MS = 2000;

/**
 * Initialize WebSocket connection to standalone server.
 * Call this before useExtensionMessages hook is mounted.
 */
export function initStandaloneClient(cbs: StandaloneClientCallbacks = {}): void {
  callbacks = cbs;

  // Determine WebSocket URL from current page location
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  console.log('[StandaloneClient] Connecting to', wsUrl);
  connect(wsUrl);
}

/**
 * Send a message to the server (equivalent to vscode.postMessage).
 * Messages are sent as JSON arrays to match the batched format.
 */
export function sendMessage(msg: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify([msg]));
  } else {
    console.warn('[StandaloneClient] Cannot send - not connected');
  }
}

/**
 * Close the WebSocket connection.
 */
export function disconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  setConnectionState('disconnected');
}

/**
 * Dispatch messages to window event handlers.
 */
function dispatchMessages(messages: Array<{ type: string }>): void {
  for (const msg of messages) {
    // Dispatch as window message event (same as VS Code postMessage)
    window.dispatchEvent(new MessageEvent('message', { data: msg }));
  }
}

/**
 * Signal that the React app is ready to receive messages.
 * Call this after useExtensionMessages hook is mounted.
 * Flushes any queued messages.
 */
export function signalReady(): void {
  if (isReady) return;
  isReady = true;
  console.log('[StandaloneClient] Ready, flushing', messageQueue.length, 'queued batches');

  // Flush queued messages
  for (const batch of messageQueue) {
    dispatchMessages(batch);
  }
  messageQueue = [];
}

/**
 * Check if running in standalone mode (served from localhost with WebSocket available).
 */
export function isStandaloneMode(): boolean {
  // In standalone mode, we're served from the pixel-agents server
  // Detection: not in VS Code (no acquireVsCodeApi) and on localhost
  if (typeof acquireVsCodeApi !== 'undefined') {
    return false;
  }
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

// ── Internal functions ────────────────────────────────────────────

function connect(url: string): void {
  if (ws) {
    ws.close();
  }

  setConnectionState('connecting');
  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[StandaloneClient] Connected');
    setConnectionState('connected');

    // Signal webview ready
    sendMessage({ type: 'webviewReady' });
  };

  ws.onmessage = (event) => {
    try {
      // Server sends batched messages as JSON array
      const messages = JSON.parse(event.data as string) as Array<{ type: string }>;

      if (!isReady) {
        // Queue messages until React app is ready
        messageQueue.push(messages);
        console.log('[StandaloneClient] Queued', messages.length, 'messages (waiting for ready)');
        return;
      }

      dispatchMessages(messages);
    } catch (e) {
      console.error('[StandaloneClient] Failed to parse message:', e);
    }
  };

  ws.onclose = () => {
    console.log('[StandaloneClient] Disconnected');
    ws = null;
    setConnectionState('disconnected');
    scheduleReconnect(url);
  };

  ws.onerror = (err) => {
    console.error('[StandaloneClient] Error:', err);
  };
}

function scheduleReconnect(url: string): void {
  if (reconnectTimer) return;

  setConnectionState('reconnecting');
  console.log(`[StandaloneClient] Reconnecting in ${RECONNECT_DELAY_MS}ms...`);

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(url);
  }, RECONNECT_DELAY_MS);
}

function setConnectionState(state: ConnectionState): void {
  callbacks.onStateChange?.(state);
}

// Declare acquireVsCodeApi for type checking
declare function acquireVsCodeApi(): unknown;

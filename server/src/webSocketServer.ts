/**
 * WebSocket server for real-time communication with browser clients.
 *
 * Used in standalone mode to broadcast agent events to connected browsers.
 * Replaces VS Code's postMessage protocol with WebSocket messages.
 */
import type * as http from 'http';
import { WebSocket, WebSocketServer as WSServer } from 'ws';

import { logger } from './logger.js';

/** Message sent from server to browser (same shape as VS Code postMessage) */
export interface WebviewMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * WebSocket server that broadcasts messages to all connected browser clients.
 * Attaches to an existing HTTP server for upgrade handling.
 */
export class WebSocketBroadcaster {
  private wss: WSServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private messageQueue: WebviewMessage[] = [];
  private queueFlushPending = false;
  private messageCallback: ((msg: WebviewMessage) => void) | null = null;

  /**
   * Attach WebSocket upgrade handler to an existing HTTP server.
   * @param server The HTTP server to attach to
   * @param path WebSocket endpoint path (default: '/ws')
   */
  attach(server: http.Server, path = '/ws'): void {
    this.wss = new WSServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url ?? '', `http://${request.headers.host}`);
      if (url.pathname === path) {
        this.wss!.handleUpgrade(request, socket, head, (ws) => {
          this.wss!.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      logger.info(`WebSocket: client connected (${this.clients.size} total)`);

      ws.on('message', (data) => {
        // Handle incoming messages from browser (future: save layout, etc.)
        try {
          const msg = JSON.parse(data.toString()) as { type: string };
          this.handleClientMessage(ws, msg);
        } catch {
          logger.warn('WebSocket: invalid message from client');
        }
      });

      ws.on('close', () => {
        this.clients.delete(ws);
        logger.info(`WebSocket: client disconnected (${this.clients.size} remaining)`);
      });

      ws.on('error', (err) => {
        logger.error(`WebSocket: client error: ${err.message}`);
        this.clients.delete(ws);
      });
    });

    logger.info(`WebSocket: attached to server at ${path}`);
  }

  /**
   * Handle incoming message from a browser client.
   */
  private handleClientMessage(_ws: WebSocket, msg: { type: string }): void {
    logger.debug(`WebSocket: received message type=${msg.type}`);
    this.messageCallback?.(msg as WebviewMessage);
  }

  /**
   * Broadcast a message to all connected clients.
   * Messages are batched and sent on next tick to avoid flooding.
   */
  broadcast(message: WebviewMessage): void {
    this.messageQueue.push(message);
    if (!this.queueFlushPending) {
      this.queueFlushPending = true;
      setImmediate(() => this.flushQueue());
    }
  }

  /**
   * Flush queued messages to all connected clients.
   */
  private flushQueue(): void {
    this.queueFlushPending = false;
    if (this.messageQueue.length === 0) return;
    if (this.clients.size === 0) {
      this.messageQueue = [];
      return;
    }

    // Batch all queued messages into a single send
    const messages = this.messageQueue;
    this.messageQueue = [];

    const payload = JSON.stringify(messages);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  /**
   * Send a single message immediately to all clients (bypasses batching).
   * Use for high-priority messages like initial state.
   */
  sendImmediate(message: WebviewMessage): void {
    if (this.clients.size === 0) return;
    const payload = JSON.stringify([message]);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  /**
   * Send initial state to a newly connected client.
   * Called when a client connects to sync current state.
   */
  sendInitialState(ws: WebSocket, messages: WebviewMessage[]): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(messages));
    }
  }

  /**
   * Get the number of connected clients.
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Register a callback for when clients connect (to send initial state).
   */
  onConnection(callback: (ws: WebSocket) => void): void {
    this.wss?.on('connection', callback);
  }

  /**
   * Register a callback for incoming messages from browser clients.
   */
  onMessage(callback: (msg: WebviewMessage) => void): void {
    this.messageCallback = callback;
  }

  /**
   * Close all connections and clean up.
   */
  close(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
  }
}

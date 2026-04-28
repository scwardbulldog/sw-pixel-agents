import { isBrowserRuntime } from './runtime';
import { isStandaloneMode, sendMessage } from './standaloneClient';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

/**
 * Unified message sender that works in all modes:
 * - VS Code webview: uses acquireVsCodeApi().postMessage()
 * - Standalone server: uses WebSocket via standaloneClient
 * - Browser dev/mock: logs to console
 */
function createPostMessage(): (msg: unknown) => void {
  if (!isBrowserRuntime) {
    // Running inside VS Code webview
    return (acquireVsCodeApi() as { postMessage(msg: unknown): void }).postMessage;
  }

  if (isStandaloneMode()) {
    // Running in standalone mode (served from pixel-agents server)
    return sendMessage;
  }

  // Running in browser dev mode (npm run dev)
  return (msg: unknown) => console.log('[vscode.postMessage]', msg);
}

export const vscode: { postMessage(msg: unknown): void } = {
  postMessage: createPostMessage(),
};

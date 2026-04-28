/**
 * Static file server for serving the webview SPA.
 *
 * In standalone mode, serves the built webview-ui files from disk.
 * Supports SPA fallback (index.html for all non-file routes).
 */
import * as fs from 'fs';
import type * as http from 'http';
import * as path from 'path';

import { logger } from './logger.js';

/** MIME types for common static assets */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

/**
 * Static file server configuration.
 */
export interface StaticServerOptions {
  /** Root directory to serve files from */
  root: string;
  /** File to serve for SPA routes (default: 'index.html') */
  indexFile?: string;
}

/**
 * Create a request handler for serving static files.
 * Returns null if the request was not handled (pass to next handler).
 */
export function createStaticHandler(
  options: StaticServerOptions,
): (req: http.IncomingMessage, res: http.ServerResponse) => boolean {
  const root = path.resolve(options.root);
  const indexFile = options.indexFile ?? 'index.html';

  return (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return false;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    let pathname = decodeURIComponent(url.pathname);

    // Security: prevent path traversal
    if (pathname.includes('..') || pathname.includes('\0')) {
      res.writeHead(400);
      res.end('Bad Request');
      return true;
    }

    // API routes are not handled by static server
    if (pathname.startsWith('/api/')) {
      return false;
    }

    // Resolve file path
    let filePath = path.join(root, pathname);

    // If path is a directory, try index file
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        filePath = path.join(filePath, indexFile);
      }
    } catch {
      // File doesn't exist, will be handled below
    }

    // Try to serve the file
    if (serveFile(filePath, res)) {
      return true;
    }

    // SPA fallback: serve index.html for non-file routes
    const indexPath = path.join(root, indexFile);
    if (serveFile(indexPath, res)) {
      logger.debug(`Static: SPA fallback for ${pathname}`);
      return true;
    }

    // Nothing found
    res.writeHead(404);
    res.end('Not Found');
    return true;
  };
}

/**
 * Serve a single file. Returns true if successful.
 */
function serveFile(filePath: string, res: http.ServerResponse): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      return false;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

    // Set cache headers for static assets
    const cacheControl = ext === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': cacheControl,
    });

    if (res.req.method === 'HEAD') {
      res.end();
      return true;
    }

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the webview build directory.
 * Looks in multiple locations for flexibility during development.
 */
export function findWebviewDist(): string | null {
  // Possible locations for the webview build
  const candidates = [
    // When running from server/dist (standalone CLI built with npm run build)
    path.join(__dirname, '../webview'),
    // When running from server/dist (npx, global install)
    path.join(__dirname, '../../dist/webview'),
    // When running from repo root
    path.join(process.cwd(), 'dist/webview'),
    // Alternative: webview-ui/dist (Vite output before copy)
    path.join(process.cwd(), 'webview-ui/dist'),
    // When running from server directory
    path.join(process.cwd(), '../dist/webview'),
    // Bundled with CLI (future: single binary)
    path.join(__dirname, '../webview'),
  ];

  for (const candidate of candidates) {
    const indexPath = path.join(candidate, 'index.html');
    if (fs.existsSync(indexPath)) {
      logger.debug(`Static: found webview at ${candidate}`);
      return candidate;
    }
  }

  logger.warn('Static: webview dist not found');
  return null;
}

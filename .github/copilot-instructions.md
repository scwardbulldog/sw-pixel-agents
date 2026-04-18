# Pixel Agents

VS Code extension with embedded React webview: a pixel art office where AI agents (Claude Code terminals) are animated characters.

## Build & Test Commands

```bash
# Install dependencies (all three packages)
npm install && cd webview-ui && npm install && cd ../server && npm install && cd ..

# Full build (type-check → lint → esbuild extension → vite webview)
npm run build

# Watch mode (extension + TypeScript, but NOT webview)
npm run watch

# Rebuild webview only
npm run build:webview
```

### Testing

```bash
# All tests
npm test

# Server tests only (Vitest)
npm run test:server

# Single server test file
cd server && npx vitest run __tests__/server.test.ts

# Single server test by name
cd server && npx vitest run -t "should return 401"

# Webview tests only (Node test runner)
npm run test:webview

# E2E tests (requires build first)
npm run build && npm run e2e
```

### Linting

```bash
npm run lint           # All packages
npm run lint:fix       # Auto-fix
```

## Architecture

**Three-package monorepo:**

| Package       | Purpose                                                               | Runtime               |
| ------------- | --------------------------------------------------------------------- | --------------------- |
| `src/`        | Extension backend — terminal lifecycle, JSONL watching, asset loading | Node.js + VS Code API |
| `server/`     | Standalone HTTP server for Claude Code hooks                          | Node.js only          |
| `webview-ui/` | React game UI — canvas rendering, character FSM, layout editor        | Browser (Vite)        |

**Key data flows:**

1. **Agent lifecycle**: "+ Agent" click → VS Code terminal (`claude --session-id <uuid>`) → JSONL file polling → character spawned in webview
2. **Status tracking**: JSONL records (`tool_use`, `tool_result`, `turn_duration`) → extension parses → `postMessage` to webview → character animation updates
3. **Hooks mode** (preferred): Claude Code hooks → HTTP POST to `server/` → instant status updates without polling
4. **Layout persistence**: Webview editor → `saveLayout` message → extension writes `~/.pixel-agents/layout.json`

**Extension ↔ Webview communication**: `postMessage` protocol. Key messages: `openClaude`, `agentCreated/Closed`, `agentToolStart/Done/Clear`, `agentStatus`, `layoutLoaded`, `furnitureAssetsLoaded`.

## Key Conventions

### TypeScript Constraints

- **No `enum`** — use `as const` objects (required by `erasableSyntaxOnly`)
- **`import type`** required for type-only imports (`verbatimModuleSyntax`)
- **No unused locals/parameters** — `noUnusedLocals` and `noUnusedParameters` are enabled

### Constants

All magic numbers and strings must be centralized — never add inline constants:

- **Extension**: `src/constants.ts`
- **Webview**: `webview-ui/src/constants.ts`
- **CSS variables**: `webview-ui/src/index.css` `:root` block (`--pixel-*` properties)

### UI Styling (Webview)

Pixel art aesthetic enforced by custom ESLint rules (`eslint-rules/pixel-agents-rules.mjs`):

- `no-inline-colors`: No hex/rgb/rgba literals outside `constants.ts`
- `pixel-shadow`: Box shadows must use `var(--pixel-shadow)` or `2px 2px 0px`
- `pixel-font`: Font family must reference FS Pixel Sans

Style requirements:

- Sharp corners (`border-radius: 0`)
- Solid backgrounds, `2px solid` borders
- Hard offset shadows (`2px 2px 0px`, no blur)

### Commit Messages

PRs use **squash and merge** with conventional commit format:

- `feat: add zoom controls`
- `fix: character freezing on terminal close`
- `refactor: extract pathfinding module`

## Testing Notes

- **Mock claude**: E2E tests use `e2e/fixtures/mock-claude` instead of real CLI
- **Server tests** require built hook script — run `npm run build` first for `claude-hook.test.ts`
- **Isolated environments**: Each E2E test gets its own `HOME` and `--user-data-dir`

## Development Tips

- Press **F5** in VS Code to launch Extension Development Host
- Run `cd webview-ui && npm run dev` to preview the webview in a browser with mock data
- Debug view: Settings → toggle "Debug View" to see JSONL connection diagnostics

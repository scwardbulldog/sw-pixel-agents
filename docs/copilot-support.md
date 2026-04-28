# GitHub Copilot CLI Support

Pixel Agents now supports GitHub Copilot CLI alongside Claude Code. This document explains how the integration works and any differences from the Claude Code experience.

## Overview

When you click **+ Agent** in the Pixel Agents toolbar, you can now choose between:

- **Claude Code** — The original provider, with instant detection via hooks
- **Copilot CLI** — GitHub's AI coding assistant CLI

Both providers spawn animated characters that react to agent activity in real time.

## How It Works

### Session Detection

Copilot CLI stores its session data in a different location than Claude Code:

| Provider    | Session Directory                        | Event File           |
| ----------- | ---------------------------------------- | -------------------- |
| Claude Code | `~/.claude/projects/<workspace-hash>/`   | `<session-id>.jsonl` |
| Copilot CLI | `~/.copilot/session-state/<session-id>/` | `events.jsonl`       |

When you launch a Copilot agent, Pixel Agents:

1. Snapshots existing session directories
2. Starts the `copilot` CLI
3. Watches for a new UUID directory to appear
4. Associates the terminal with that session

### Event Format

Copilot uses a different event format in its JSONL files:

```json
{"type":"session.start","data":{"sessionId":"<uuid>","version":1,"producer":"copilot-agent"}}
{"type":"tool.execution_start","data":{"toolCallId":"toolu_xxx","toolName":"view","arguments":{}}}
{"type":"tool.execution_complete","data":{"toolCallId":"toolu_xxx","success":true,"result":{}}}
{"type":"assistant.turn_end","data":{"turnId":"0"}}
```

The extension maps these events to the same internal representation used for Claude Code, so characters animate correctly for both providers.

### Tool Name Mapping

Copilot uses different tool names that are displayed in the character overlays:

| Copilot Tool          | Display Text             |
| --------------------- | ------------------------ |
| `view`                | "Reading {filename}"     |
| `edit`                | "Editing {filename}"     |
| `create`              | "Creating {filename}"    |
| `bash`                | "Running: {command}"     |
| `grep`                | "Searching code"         |
| `glob`                | "Searching files"        |
| `web_fetch`           | "Fetching web content"   |
| `web_search`          | "Searching the web"      |
| `task`                | "Subtask: {description}" |
| `github-mcp-server-*` | "GitHub: {action}"       |

## Differences from Claude Code

### Detection Mode

- **Claude Code**: Uses hooks for instant detection when enabled (sub-second updates)
- **Copilot CLI**: Uses polling-based detection (500ms intervals)

Copilot does not currently have a hooks API, so all detection is done by watching the filesystem for changes to `events.jsonl`.

### Provider Indicator

Copilot agents display a "Copilot" label in their character overlay to distinguish them from Claude agents. Claude agents don't show a provider label since they're the default.

### Session Resumption

Copilot generates its own session IDs (UUID directory names). When resuming a session, use:

```bash
copilot --resume=<session-id>
```

The extension handles this automatically when adopting existing sessions.

## Configuration

### Enabling/Disabling Providers

Open **Settings** in the Pixel Agents panel to enable or disable providers:

- **Claude Code** — Enabled by default
- **Copilot CLI** — Enabled by default

When both are enabled, clicking **+ Agent** shows a provider selection menu. When only one is enabled, clicking **+ Agent** launches that provider directly.

### Provider Settings

Provider preferences are stored in `~/.pixel-agents/config.json`:

```json
{
  "enabledProviders": ["claude", "copilot"],
  "defaultProvider": "claude"
}
```

## Troubleshooting

### Agent Not Appearing

1. **Check session directory**: Verify Copilot is creating sessions in `~/.copilot/session-state/`
2. **Check events.jsonl**: Ensure the session directory contains an `events.jsonl` file
3. **Enable Debug View**: Settings → Debug View shows connection diagnostics per agent

### Events Not Detected

Copilot must be writing events to its JSONL file. If the character appears but doesn't animate:

1. Run a command that produces output (like `view` or `bash`)
2. Check that `events.jsonl` is being updated (file modification time changes)
3. Check the Debug View for parsing errors

### Permission Bubbles Not Appearing

Permission detection for Copilot relies on tool execution timing. If a tool runs for longer than the permission threshold without producing output, a permission bubble appears. This heuristic may not be as accurate as Claude's hooks-based detection.

## Technical Details

### Provider Interface

Copilot support is implemented via the `HookProvider` interface in `server/src/providers/hook/copilot/`:

- `copilot.ts` — Main provider implementation
- `copilotTranscriptParser.ts` — JSONL event parsing
- `constants.ts` — Tool names, event types, and thresholds

### Adding New Providers

The multi-provider architecture makes it straightforward to add support for other AI CLIs. See `server/src/providers/` for the provider interface definition.

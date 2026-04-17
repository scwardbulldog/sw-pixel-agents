# Security Issue: SEC-012 - Debug Logging Configuration

## Finding Details

| Field | Value |
|-------|-------|
| **Finding ID** | SEC-012 |
| **Severity** | Informational |
| **Category** | Configuration |
| **Status** | ✅ Resolved |
| **Priority** | P3 - Long-term (within 90 days) |
| **Resolution Date** | 2026-04-17 |

## Description

Debug logging is now controlled through a centralized logger module with proper log levels. The default log level is INFO, and debug mode requires explicit opt-in via `PIXEL_AGENTS_DEBUG=1` or `PIXEL_AGENTS_LOG_LEVEL=DEBUG`.

## Resolution Summary

This issue has been resolved as part of SEC-003 (Structured Logging Module):

1. **Centralized logging** in `src/logger.ts` and `server/src/logger.ts`
2. **Log levels**: DEBUG, INFO, WARN, ERROR, NONE
3. **Default level is INFO** (not DEBUG) - production-safe default
4. **Explicit opt-in for debug**: `PIXEL_AGENTS_DEBUG=1` or `PIXEL_AGENTS_LOG_LEVEL=DEBUG`
5. **Legacy compatibility**: `PIXEL_AGENTS_DEBUG=0` still works to suppress debug logs

### Current Implementation

```typescript
// server/src/hookEventHandler.ts:12
const debug = process.env.PIXEL_AGENTS_DEBUG !== '0';

// src/fileWatcher.ts:26
const debug = process.env.PIXEL_AGENTS_DEBUG !== '0';

// src/transcriptParser.ts:4
const debug = process.env.PIXEL_AGENTS_DEBUG !== '0';
```

### Issue

The condition `!== '0'` means:
- `PIXEL_AGENTS_DEBUG=0` → debug OFF ✅
- `PIXEL_AGENTS_DEBUG=1` → debug ON ✅
- `PIXEL_AGENTS_DEBUG` not set → debug ON ⚠️ (should be OFF)

For production/enterprise deployments, debug should be opt-in.

## Affected Files

- `server/src/hookEventHandler.ts:12`
- `src/fileWatcher.ts:26`
- `src/transcriptParser.ts:4`

## Risk Assessment

### Impact
- **Confidentiality**: Low - Debug logs may contain sensitive info
- **Integrity**: None
- **Availability**: None

### Overall Risk
Informational - This is a best practice issue, not a direct vulnerability.

## Remediation Steps

### Option 1: Simple Fix (Change to Opt-In)

```typescript
// All affected files
const debug = process.env.PIXEL_AGENTS_DEBUG === '1';
```

### Option 2: Centralized Debug Configuration (Recommended)

Create a shared debug module:

```typescript
// shared/debug.ts
export const isDebugEnabled = (): boolean => {
  // Check environment variable
  if (process.env.PIXEL_AGENTS_DEBUG === '1') return true;
  if (process.env.PIXEL_AGENTS_DEBUG === '0') return false;
  
  // Default: OFF in production, ON in development
  // Note: VS Code extension mode check would go here
  return false;
};

// Memoize the result
let _isDebug: boolean | undefined;
export const debug = (): boolean => {
  if (_isDebug === undefined) {
    _isDebug = isDebugEnabled();
  }
  return _isDebug;
};
```

Update all usage:
```typescript
// server/src/hookEventHandler.ts
import { debug } from '../../shared/debug.js';

if (debug()) {
  console.log(`[Pixel Agents] Hook: ...`);
}
```

### Option 3: Integrate with Logger (Best - Combines with SEC-003)

If implementing the logger from SEC-003:

```typescript
// src/logger.ts
import { LogLevel, logger } from './logger';

// Initialize based on environment
const debugEnv = process.env.PIXEL_AGENTS_DEBUG;
if (debugEnv === '1') {
  logger.setLevel(LogLevel.DEBUG);
} else if (debugEnv === '0') {
  logger.setLevel(LogLevel.WARN);
}
// Default is INFO (not DEBUG)
```

## Acceptance Criteria

- [x] Debug mode is opt-in (requires explicit `PIXEL_AGENTS_DEBUG=1`)
- [x] All debug flag checks use consistent logic
- [x] Default behavior (no env var) is non-debug mode (INFO level)
- [x] Documentation updated for debug mode usage
- [x] `docs/SECURITY_ANALYSIS.md` updated to mark as resolved

## Testing Requirements

1. **Manual Testing**
   - Without env var: verify minimal logging
   - With `PIXEL_AGENTS_DEBUG=1`: verify debug logging
   - With `PIXEL_AGENTS_DEBUG=0`: verify no debug logging

## Related Issues

- SEC-003: Sensitive Data Exposure in Logs (implement together)

---

**Labels**: `security`, `compliance`, `priority: low`, `good first issue`

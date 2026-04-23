# InfoSec Issues for SOC 2 Compliance Review

> **Review Date:** 2026-04-23
> **Scope:** Full codebase security review for enterprise SOC 2 Type II compliance
> **Repository:** sw-pixel-agents (Pixel Agents VS Code Extension)
> **Reviewer:** Automated Security Audit

This document contains security findings intended to be filed as individual GitHub Issues. Each section corresponds to one issue with a full writeup, SOC 2 control mapping, and remediation guidance.

---

## Table of Contents

| # | Severity | Title | SOC 2 Controls |
|---|----------|-------|----------------|
| 1 | High | Insecure File Permissions on Config & Layout Files | CC6.1, CC6.3 |
| 2 | High | `--dangerously-skip-permissions` Flag Lacks Enterprise Guardrails | CC6.1, CC6.3, CC7.2 |
| 3 | Medium | Missing Security Response Headers on HTTP Server | CC6.6, CC6.7 |
| 4 | Medium | `~/.claude/settings.json` Written Without Restrictive File Permissions | CC6.1, CC6.3 |
| 5 | Medium | Auth Token Stored in Plaintext on Disk (`server.json`) | CC6.1, CC6.7 |
| 6 | Medium | HTTP Server Uses Unencrypted Transport (No TLS) | CC6.7 |
| 7 | Low | Symlink Attack Surface on File Watchers and Asset Loading | CC6.1, CC6.6 |
| 8 | Low | No Formal Audit Logging for Security-Relevant Events | CC7.2, CC7.3 |
| 9 | Low | CSP Allows `unsafe-inline` for Styles | CC6.6 |
| 10 | Informational | No Automated Dependency Vulnerability Scanning in CI/CD | CC7.1, CC8.1 |
| 11 | Informational | Security Policy References Upstream Repository | CC1.4 |

---

## Issue 1: Insecure File Permissions on Config and Layout Files

**Severity:** High
**Labels:** `security`, `soc2`, `high-priority`
**SOC 2 Controls:** CC6.1 (Logical Access Controls), CC6.3 (Security for Assets)

### Description

The configuration file (`~/.pixel-agents/config.json`) and layout file (`~/.pixel-agents/layout.json`) are created without explicit restrictive file permissions. The `fs.mkdirSync()` and `fs.writeFileSync()` calls rely on the system's default `umask`, which on many Linux systems is `0022` — resulting in world-readable files (`0644`).

On multi-user systems (shared development servers, CI/CD runners, containers with shared volumes), other local users can read these files. While these files don't currently contain secrets, the directory and file creation pattern should follow the same security hardening applied to `server.json` for defense-in-depth.

### Affected Files

**`src/configPersistence.ts` (lines 28-33):**
```typescript
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true }); // ← No mode specified
}
const json = JSON.stringify(config, null, 2);
const tmpPath = filePath + '.tmp';
fs.writeFileSync(tmpPath, json, 'utf-8'); // ← No mode specified
```

**`src/layoutPersistence.ts` (lines 46-51):**
```typescript
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true }); // ← No mode specified
}
const json = JSON.stringify(layout, null, 2);
const tmpPath = filePath + '.tmp';
fs.writeFileSync(tmpPath, json, 'utf-8'); // ← No mode specified
```

**Contrast with the properly hardened `server/src/server.ts` (lines 277-282):**
```typescript
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); // ✅ Correct
}
const tmpPath = filePath + '.tmp';
fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 }); // ✅ Correct
```

### Impact

- On shared systems with permissive `umask`, other users can read the config/layout files
- If sensitive data is ever added to config (e.g., API keys for future features), it would be immediately exposed
- Inconsistent with the security posture established in `server.ts`
- Violates principle of least privilege for file system access

### Remediation

Apply explicit restrictive permissions matching the pattern used in `server.ts`:

```typescript
// src/configPersistence.ts
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}
const json = JSON.stringify(config, null, 2);
const tmpPath = filePath + '.tmp';
fs.writeFileSync(tmpPath, json, { encoding: 'utf-8', mode: 0o600 });
```

```typescript
// src/layoutPersistence.ts
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}
const json = JSON.stringify(layout, null, 2);
const tmpPath = filePath + '.tmp';
fs.writeFileSync(tmpPath, json, { encoding: 'utf-8', mode: 0o600 });
```

### SOC 2 Mapping

| Control | Relevance |
|---------|-----------|
| CC6.1 | Logical access controls must restrict unauthorized access to information assets |
| CC6.3 | The entity implements controls to prevent unauthorized access to system components |

---

## Issue 2: `--dangerously-skip-permissions` Flag Lacks Enterprise Guardrails

**Severity:** High
**Labels:** `security`, `soc2`, `high-priority`, `enterprise`
**SOC 2 Controls:** CC6.1 (Logical Access Controls), CC6.3 (Security for Assets), CC7.2 (System Monitoring)

### Description

The extension exposes a right-click context menu option on the "+ Agent" button that launches Claude Code with the `--dangerously-skip-permissions` flag. This flag bypasses **all** Claude Code permission prompts, allowing unrestricted file operations, command execution, and network access without user approval.

For enterprise SOC 2 environments, this is a significant risk vector:
1. An employee could accidentally enable it
2. There is no organization-level policy to disable this feature
3. There is no audit trail when the flag is used
4. There is no warning dialog confirming the security implications

### Affected Files

- **`src/agentManager.ts` (lines 94-98):** Command construction with the flag
- **`src/PixelAgentsViewProvider.ts` (line 361):** Message handler accepting `bypassPermissions`
- **`webview-ui/src/components/BottomToolbar.tsx` (lines 68-79):** UI for enabling bypass mode

### Impact

- Claude Code running with `--dangerously-skip-permissions` can execute arbitrary shell commands, modify/delete any user-accessible file, and make network requests without any approval gating
- No organizational policy mechanism to prevent usage
- No logging or alerting when bypass mode is activated
- Violates principle of least privilege and separation of duties

### Remediation

**Short-term (Required for SOC 2):**

1. **Add a VS Code setting to disable bypass mode at the workspace or policy level:**
   ```jsonc
   // settings.json (can be managed via MDM/GPO)
   {
     "pixelAgents.allowBypassPermissions": false // default: false
   }
   ```

2. **Add a confirmation dialog before enabling bypass mode:**
   ```typescript
   const confirm = await vscode.window.showWarningMessage(
     'WARNING: This will launch Claude Code with --dangerously-skip-permissions. ' +
     'All tool calls will execute without approval prompts. ' +
     'This should only be used in isolated environments.',
     { modal: true },
     'I understand the risks'
   );
   if (confirm !== 'I understand the risks') return;
   ```

3. **Add audit logging when bypass mode is activated:**
   ```typescript
   logger.warn(`Agent ${id} launched with --dangerously-skip-permissions by user action`);
   ```

**Long-term:**

4. Add telemetry/audit event for enterprise SIEM integration
5. Consider making the feature opt-in via a separate extension setting with clear security documentation
6. Add a visual indicator in the webview when an agent is running in bypass mode

### SOC 2 Mapping

| Control | Relevance |
|---------|-----------|
| CC6.1 | Unrestricted tool execution bypasses logical access controls |
| CC6.3 | Security controls for code execution and file system access are circumvented |
| CC7.2 | No monitoring or alerting when elevated permissions are used |

---

## Issue 3: Missing Security Response Headers on HTTP Server

**Severity:** Medium
**Labels:** `security`, `soc2`
**SOC 2 Controls:** CC6.6 (External Threats), CC6.7 (Data Transmission Security)

### Description

The HTTP server at `server/src/server.ts` does not set standard security response headers. While the server is bound to `127.0.0.1` only (mitigating external access), defense-in-depth best practices require hardening even for localhost services.

Missing headers:
- `X-Content-Type-Options: nosniff` — prevents MIME type sniffing
- `X-Frame-Options: DENY` — prevents framing attacks
- `Cache-Control: no-store` — prevents caching of authenticated responses
- `Content-Security-Policy: default-src 'none'` — restricts response processing

### Affected Files

- **`server/src/server.ts` (lines 138-175):** `handleRequest()` method
- Response writes at lines 156-164 (health endpoint) and line 243 (hook response)

### Impact

- While the localhost-only binding significantly reduces the attack surface, browsers on the same machine could potentially interact with the server via JavaScript fetch requests from malicious web pages
- Without `X-Content-Type-Options: nosniff`, response bodies could be misinterpreted
- Missing `Cache-Control` could allow proxy caches to store authenticated responses

### Remediation

Add a helper method to set security headers on all responses:

```typescript
private setSecurityHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'");
}
```

Call this at the top of `handleRequest()`:
```typescript
private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  this.setSecurityHeaders(res);
  // ... rest of handler
}
```

### SOC 2 Mapping

| Control | Relevance |
|---------|-----------|
| CC6.6 | Standard HTTP security headers protect against common attack vectors |
| CC6.7 | Headers ensure proper handling of data in transit |

---

## Issue 4: `~/.claude/settings.json` Written Without Restrictive File Permissions

**Severity:** Medium
**Labels:** `security`, `soc2`
**SOC 2 Controls:** CC6.1 (Logical Access Controls), CC6.3 (Security for Assets)

### Description

When the extension installs hooks into `~/.claude/settings.json`, the file is written without explicit restrictive permissions. The `writeClaudeSettings()` function in `claudeHookInstaller.ts` uses the default `umask` for both the directory and the file.

This file contains configuration for Claude Code including hook commands. If an attacker on the same multi-user system can modify this file, they could inject malicious hook commands that execute arbitrary code every time Claude Code starts a session.

### Affected Files

**`server/src/providers/hook/claude/claudeHookInstaller.ts` (lines 52-66):**
```typescript
function writeClaudeSettings(settings: ClaudeSettings): void {
  const settingsPath = getClaudeSettingsPath();
  const dir = path.dirname(settingsPath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true }); // ← No mode specified
    }
    const tmpPath = settingsPath + '.pixel-agents-tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), 'utf-8'); // ← No mode specified
    fs.renameSync(tmpPath, settingsPath);
  } catch (e) {
    logger.error(` Failed to write Claude settings: ${e}`);
  }
}
```

### Impact

- On multi-user systems with permissive `umask`, `~/.claude/settings.json` becomes world-readable
- If an attacker can write to the file (world-writable scenario), they can inject hook commands that execute as the user
- Hook commands run with the user's full privileges whenever Claude Code hooks fire
- This is a privilege escalation vector via configuration injection

### Remediation

Add explicit permissions to match the security hardening in `server.ts`:

```typescript
function writeClaudeSettings(settings: ClaudeSettings): void {
  const settingsPath = getClaudeSettingsPath();
  const dir = path.dirname(settingsPath);
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const tmpPath = settingsPath + '.pixel-agents-tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), { encoding: 'utf-8', mode: 0o600 });
    fs.renameSync(tmpPath, settingsPath);
  } catch (e) {
    logger.error(` Failed to write Claude settings: ${e}`);
  }
}
```

**Note:** Verify that Claude Code itself can still read the file with `0o600` permissions (it should, since it runs as the same user).

### SOC 2 Mapping

| Control | Relevance |
|---------|-----------|
| CC6.1 | Configuration files controlling code execution must have restricted access |
| CC6.3 | Hook configurations are security-sensitive assets requiring protection |

---

## Issue 5: Auth Token Stored in Plaintext on Disk (`server.json`)

**Severity:** Medium
**Labels:** `security`, `soc2`, `defense-in-depth`
**SOC 2 Controls:** CC6.1 (Logical Access Controls), CC6.7 (Data Transmission Security)

### Description

The HTTP server's authentication token is stored in plaintext in `~/.pixel-agents/server.json`. While the file has restrictive permissions (`0o600`), the token is directly readable by:
1. Root/administrator users
2. Any process running as the same user
3. Backup systems that capture home directory contents
4. Forensic analysis of disk contents

The token provides full access to the hook event API, allowing an attacker to inject arbitrary hook events that the extension processes as legitimate Claude Code activity.

### Affected Files

**`server/src/server.ts` (lines 272-283):**
```typescript
private writeServerJson(config: ServerConfig): void {
  // ...
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  // config contains: { port, pid, token, startedAt }
  // token is a plain UUID string
}
```

**`server/src/providers/hook/claude/hooks/claude-hook.ts` (line 24):**
```typescript
server = JSON.parse(fs.readFileSync(SERVER_JSON, 'utf-8'));
// Reads plaintext token and uses in Authorization header
```

### Mitigating Factors

- File permissions are `0o600` (owner-only read/write) ✅
- Directory permissions are `0o700` ✅
- Token is regenerated on every server start (not persistent across sessions) ✅
- Server is bound to `127.0.0.1` only ✅

### Impact

- Any process running as the same user can read the token and inject fake hook events
- Backup systems may capture the token in plaintext
- On compromised systems, the token enables event injection into the Pixel Agents UI

### Remediation

**Short-term (Recommended):**

1. Document the risk in the security analysis
2. Ensure the token file is included in backup exclusion lists
3. Consider reducing token lifetime or implementing token rotation during long sessions

**Long-term (Ideal):**

4. Use OS keychain/credential manager for token storage:
   - macOS: Keychain Services
   - Windows: Credential Manager (via `keytar` or VS Code `SecretStorage`)
   - Linux: Secret Service API (via `libsecret`)

5. Alternatively, use Unix domain sockets instead of TCP (eliminates need for bearer token entirely):
   ```typescript
   this.server.listen(path.join(os.tmpdir(), `pixel-agents-${process.pid}.sock`));
   ```

### SOC 2 Mapping

| Control | Relevance |
|---------|-----------|
| CC6.1 | Authentication credentials should be protected from unauthorized access |
| CC6.7 | Secrets at rest should be encrypted or protected by OS-level controls |

---

## Issue 6: HTTP Server Uses Unencrypted Transport (No TLS)

**Severity:** Medium
**Labels:** `security`, `soc2`, `defense-in-depth`
**SOC 2 Controls:** CC6.7 (Data Transmission Security)

### Description

The internal HTTP server communicates over plain HTTP (unencrypted). The auth token is transmitted in the `Authorization` header on every hook event request. While the server binds exclusively to `127.0.0.1`, data in transit on localhost is still visible to:
1. Local packet capture tools (e.g., Wireshark, tcpdump on loopback interface)
2. Other processes using raw sockets
3. System-level security monitoring tools

### Affected Files

- **`server/src/server.ts` (line 84):** `http.createServer()` (plain HTTP, not HTTPS)
- **`server/src/providers/hook/claude/hooks/claude-hook.ts` (lines 31-41):** `http.request()` with Bearer token

### Mitigating Factors

- Localhost-only binding (`127.0.0.1`) prevents remote interception ✅
- Token is regenerated on every server start ✅
- Random port assignment makes endpoint discovery harder ✅

### Impact

- Bearer token visible on the loopback network interface
- Local packet capture can extract the auth token
- On security-monitored enterprise systems, tokens may appear in network logs

### Remediation

**Recommended approach — Unix domain sockets (eliminates network transport entirely):**

```typescript
import * as os from 'os';

const socketPath = path.join(os.tmpdir(), `pixel-agents-${process.pid}.sock`);
this.server.listen(socketPath);

// Set restrictive permissions on the socket
fs.chmodSync(socketPath, 0o600);
```

This approach:
- Eliminates network-layer interception entirely
- Leverages filesystem permissions for access control
- Removes the need for the bearer token (filesystem ACLs provide auth)
- Is supported on macOS, Linux, and Windows 10+ (AF_UNIX)

**Alternative — TLS with self-signed certificate:**

```typescript
import * as https from 'https';
import * as tls from 'tls';

const { privateKey, cert } = generateSelfSignedCert(); // Per-session ephemeral cert
this.server = https.createServer({ key: privateKey, cert }, handler);
```

### SOC 2 Mapping

| Control | Relevance |
|---------|-----------|
| CC6.7 | Data in transit must be protected; even localhost traffic should use encrypted channels in high-security environments |

---

## Issue 7: Symlink Attack Surface on File Watchers and Asset Loading

**Severity:** Low
**Labels:** `security`, `soc2`, `defense-in-depth`
**SOC 2 Controls:** CC6.1 (Logical Access Controls), CC6.6 (External Threats)

### Description

The extension reads files from user-writable directories (`~/.pixel-agents/`, `~/.claude/projects/`, external asset directories) using `fs.readFileSync` and `fs.existsSync` without checking for symbolic links. An attacker with local access could create symlinks pointing to sensitive system files, potentially causing the extension to read and process unintended file content.

### Affected Areas

1. **JSONL file watching** (`src/fileWatcher.ts`): Reads session transcript files from `~/.claude/projects/`. A symlink could redirect reads to other files.

2. **Asset loading** (`src/assetLoader.ts`): While there is path traversal protection (checking `startsWith(resolvedDir)`), `path.resolve()` follows symlinks, meaning a symlink within the asset directory could bypass the containment check.

3. **Layout file watching** (`src/layoutPersistence.ts`): Reads `~/.pixel-agents/layout.json` — a symlink could redirect to reading arbitrary files.

4. **Config file** (`src/configPersistence.ts`): Same symlink concern for `~/.pixel-agents/config.json`.

### Mitigating Factors

- The extension doesn't transmit file contents externally ✅
- File contents are parsed as JSON/JSONL and invalid data is rejected ✅
- Asset loader has path traversal checks ✅
- All operations are local to the user's filesystem ✅

### Impact

- Low direct impact since parsed content is used only for local UI rendering
- Could cause the extension to process unexpected data if symlinks point to large files (DoS)
- In theory, if symlinked to a very large file, could cause excessive memory usage

### Remediation

Add symlink validation for security-sensitive file reads:

```typescript
import * as fs from 'fs';

function isSymlink(filePath: string): boolean {
  try {
    const stat = fs.lstatSync(filePath);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

// Before reading security-sensitive files:
if (isSymlink(filePath)) {
  logger.warn(`Refusing to read symlinked file: ${filePath}`);
  return null;
}
```

Apply this check in:
- `layoutPersistence.ts` — `readLayoutFromFile()`
- `configPersistence.ts` — `readConfig()`
- `fileWatcher.ts` — before reading JSONL files
- `assetLoader.ts` — additionally to the existing path containment check

### SOC 2 Mapping

| Control | Relevance |
|---------|-----------|
| CC6.1 | File access should be validated to prevent unintended data access |
| CC6.6 | Symlink attacks are a known OS-level threat vector |

---

## Issue 8: No Formal Audit Logging for Security-Relevant Events

**Severity:** Low
**Labels:** `security`, `soc2`, `audit`
**SOC 2 Controls:** CC7.2 (System Monitoring), CC7.3 (Evaluation of Findings)

### Description

While the extension has a well-implemented logging module with sanitization and log levels, it lacks formal audit logging for security-relevant events. SOC 2 CC7.2 requires monitoring of security events, and CC7.3 requires evaluation of detected issues.

Currently, security-relevant events are logged at various log levels mixed with operational messages. There is no:
1. Distinct audit log category or destination
2. Structured format for security events (e.g., JSON with event type, actor, resource, outcome)
3. Log retention policy documentation
4. Integration guidance for SIEM/log aggregation systems

### Security Events That Should Be Audited

| Event | Current Logging | Required |
|-------|----------------|----------|
| Agent launched with `--dangerously-skip-permissions` | Not logged | ⚠️ Required |
| Server auth token generated | Not logged | ⚠️ Required |
| Authentication failure (401 response) | Implicit (HTTP status) | ⚠️ Should be explicit |
| Rate limit triggered (429 response) | Not logged explicitly | ⚠️ Should be explicit |
| Hook script installed/uninstalled | Logged (INFO) | ✅ Adequate |
| External asset directory added/removed | Not logged | ⚠️ Required |
| Layout imported from external file | Not logged | ⚠️ Required |
| Extension activated/deactivated | Logged (INFO) | ✅ Adequate |

### Remediation

1. **Create a dedicated audit logger or audit event type:**
   ```typescript
   // src/auditLogger.ts
   interface AuditEvent {
     timestamp: string;
     event: string;
     actor: string; // 'user' | 'system'
     resource: string;
     outcome: 'success' | 'failure';
     details?: Record<string, unknown>;
   }

   export function auditLog(event: AuditEvent): void {
     logger.warn(`[AUDIT] ${JSON.stringify(event)}`);
   }
   ```

2. **Add audit logging to security-relevant code paths:**
   - `agentManager.ts`: Log bypass permissions usage
   - `server.ts`: Log auth failures and rate limiting
   - `PixelAgentsViewProvider.ts`: Log layout imports and asset directory changes
   - `claudeHookInstaller.ts`: Already logs hook install/uninstall (adequate)

3. **Document log retention and SIEM integration guidance** for enterprise deployment

### SOC 2 Mapping

| Control | Relevance |
|---------|-----------|
| CC7.2 | Security events must be monitored and logged |
| CC7.3 | Detected security issues must be evaluated and remediated |

---

## Issue 9: CSP Allows `unsafe-inline` for Styles

**Severity:** Low
**Labels:** `security`, `soc2`, `defense-in-depth`
**SOC 2 Controls:** CC6.6 (External Threats)

### Description

The webview's Content Security Policy includes `style-src ${cspSource} 'unsafe-inline'`, which weakens protection against style-based injection attacks. While script injection is properly prevented by nonce-based CSP, inline style injection could be used for:
1. CSS-based data exfiltration (reading attribute values via CSS selectors + background URL)
2. UI redressing/clickjacking via CSS positioning
3. Content spoofing via CSS `content` property

### Affected Files

**`src/PixelAgentsViewProvider.ts` (lines 1003-1010):**
```typescript
const cspContent = [
  `default-src 'none'`,
  `img-src ${cspSource} data: blob:`,
  `script-src ${cspSource} 'nonce-${nonce}'`,
  `style-src ${cspSource} 'unsafe-inline'`,  // ← Weakens CSP
  `font-src ${cspSource}`,
  `connect-src ${cspSource}`,
].join('; ');
```

### Mitigating Factors

- The webview is sandboxed by VS Code's webview API ✅
- `default-src 'none'` provides defense-in-depth ✅
- Scripts use nonce-based allowlisting (properly hardened) ✅
- `connect-src` restricts network access ✅
- The `unsafe-inline` is documented as required for Tailwind CSS ✅
- No external content is loaded into the webview ✅

### Impact

Low practical impact due to the VS Code webview sandbox and the fact that no untrusted content is rendered in the webview. However, for SOC 2 compliance documentation, this should be formally risk-accepted.

### Remediation

**Option A (Preferred — if feasible):**
Migrate from Tailwind CSS inline styles to a build-time CSS extraction approach that generates static CSS files with hashes:
```typescript
`style-src ${cspSource} 'sha256-<hash>'`
```

**Option B (Pragmatic):**
Document a formal risk acceptance in the security analysis:
```markdown
## Risk Acceptance: CSP unsafe-inline for Styles

**Risk:** CSP allows `unsafe-inline` for style-src directive
**Justification:** Required by Tailwind CSS framework for dynamic class generation
**Mitigating Controls:**
1. VS Code webview sandbox prevents arbitrary code execution
2. No untrusted content is rendered in the webview
3. Script injection is prevented by nonce-based CSP
4. connect-src restricts all network access
**Risk Level After Mitigation:** Negligible
**Review Date:** [Annual review required]
```

### SOC 2 Mapping

| Control | Relevance |
|---------|-----------|
| CC6.6 | CSP is a key control against injection-based external threats |

---

## Issue 10: No Automated Dependency Vulnerability Scanning in CI/CD

**Severity:** Informational
**Labels:** `security`, `soc2`, `ci-cd`
**SOC 2 Controls:** CC7.1 (Change Management), CC8.1 (Vulnerability Management)

### Description

While the repository has:
- A `.gitleaks.toml` configuration for secret scanning ✅
- Clean `npm audit` results at time of review ✅
- Minimal production dependencies (reducing attack surface) ✅

There is no evidence of automated, continuous dependency vulnerability scanning integrated into the CI/CD pipeline. SOC 2 CC8.1 requires ongoing vulnerability management, not just point-in-time audits.

### Current State

- `npm audit` returns 0 vulnerabilities across all three `package.json` files
- Root: `zod` (1 production dependency)
- Server: 1 production dependency
- Webview: `react`, `react-dom` (2 production dependencies)

### Recommended Tools

1. **GitHub Dependabot** (free, native integration):
   ```yaml
   # .github/dependabot.yml
   version: 2
   updates:
     - package-ecosystem: "npm"
       directory: "/"
       schedule:
         interval: "weekly"
       open-pull-requests-limit: 10

     - package-ecosystem: "npm"
       directory: "/server"
       schedule:
         interval: "weekly"

     - package-ecosystem: "npm"
       directory: "/webview-ui"
       schedule:
         interval: "weekly"
   ```

2. **GitHub Actions workflow for npm audit:**
   ```yaml
   name: Security Audit
   on:
     schedule:
       - cron: '0 6 * * 1' # Weekly on Monday
     push:
       branches: [main]

   jobs:
     audit:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
         - run: npm audit --audit-level=moderate
         - run: cd server && npm audit --audit-level=moderate
         - run: cd webview-ui && npm audit --audit-level=moderate
   ```

3. **Consider adding Snyk or Socket.dev** for deeper supply chain analysis

### SOC 2 Mapping

| Control | Relevance |
|---------|-----------|
| CC7.1 | Changes (including dependency updates) must be managed and monitored |
| CC8.1 | Vulnerabilities must be identified and remediated on an ongoing basis |

---

## Issue 11: Security Policy References Upstream Repository

**Severity:** Informational
**Labels:** `security`, `soc2`, `documentation`
**SOC 2 Controls:** CC1.4 (Organizational Structure and Reporting)

### Description

The `SECURITY.md` file references the upstream repository (`pablodelucca/pixel-agents`) for vulnerability reporting, not this fork (`scwardbulldog/sw-pixel-agents`). For an enterprise deployment, the security policy should point to the internal repository's security advisory system.

### Affected Files

**`SECURITY.md` (line 11):**
```markdown
Please report security vulnerabilities through [GitHub's private vulnerability reporting](https://github.com/pablodelucca/pixel-agents/security/advisories/new).
```

### Remediation

Update `SECURITY.md` to reference this repository:

```markdown
Please report security vulnerabilities through [GitHub's private vulnerability reporting](https://github.com/scwardbulldog/sw-pixel-agents/security/advisories/new).
```

Also consider adding:
- Internal security team contact information
- Escalation procedures
- SLA expectations aligned with enterprise policy
- Scope clarification for the fork vs. upstream

### SOC 2 Mapping

| Control | Relevance |
|---------|-----------|
| CC1.4 | Security incident reporting must be directed to the responsible organization |

---

## Summary of Positive Security Controls

The codebase demonstrates several strong security practices that should be maintained:

| Control | Implementation | Location |
|---------|---------------|----------|
| Cryptographically secure token generation | `crypto.randomUUID()` | `server/src/server.ts:80` |
| Timing-safe authentication | `crypto.timingSafeEqual()` | `server/src/server.ts:188` |
| Rate limiting | 100 req/s per provider, 50 max connections | `server/src/server.ts`, `server/src/rateLimiter.ts` |
| Body size limits | 64KB max hook body, 1MB max JSONL line | `server/src/constants.ts` |
| Atomic file writes | tmp + rename pattern | All persistence files |
| Log sanitization | Path + UUID redaction | `src/logger.ts`, `server/src/logger.ts` |
| CSP with nonces | `default-src 'none'` + script nonces | `src/PixelAgentsViewProvider.ts` |
| Provider ID validation | `/^[a-z0-9-]+$/` regex | `server/src/server.ts:196` |
| Path traversal protection | `path.resolve()` + `startsWith()` | `src/assetLoader.ts` |
| Localhost-only binding | `127.0.0.1` | `server/src/server.ts:91` |
| No telemetry/analytics | Zero outbound network requests | Verified across codebase |
| Minimal dependencies | 3-4 production deps total | All `package.json` files |
| Schema validation | Zod schemas for all external data | `src/schemas/` |
| Secret file permissions | `0o600` on `server.json` | `server/src/server.ts:282` |
| PID-based multi-window safety | Process validation before reuse | `server/src/server.ts:69` |
| No `eval()`/`Function()` usage | Zero unsafe code execution patterns | Verified across codebase |
| Gitleaks configuration | Secret scanning ready | `.gitleaks.toml` |
| Security policy | Vulnerability reporting process | `SECURITY.md` |

---

## Appendix: SOC 2 Trust Service Criteria Mapping

| SOC 2 Criteria | Description | Findings |
|----------------|-------------|----------|
| CC6.1 | Logical and Physical Access Controls | Issues #1, #2, #4, #5, #7 |
| CC6.3 | Security for Assets | Issues #1, #2, #4 |
| CC6.6 | External Threats | Issues #3, #7, #9 |
| CC6.7 | Data Transmission Security | Issues #3, #5, #6 |
| CC7.1 | Change Management | Issue #10 |
| CC7.2 | System Monitoring | Issues #2, #8 |
| CC7.3 | Evaluation of Findings | Issue #8 |
| CC8.1 | Vulnerability Management | Issue #10 |
| CC1.4 | Organizational Structure | Issue #11 |

---

## How to File These as GitHub Issues

Each section above (Issues 1-11) is formatted as a standalone GitHub issue. To create them:

```bash
# Example for Issue 1:
gh issue create \
  --title "[Security] Insecure File Permissions on Config & Layout Files" \
  --body "$(cat issue-1-body.md)" \
  --label "security,soc2,high-priority" \
  --repo scwardbulldog/sw-pixel-agents
```

Recommended labels to create first:
- `security` — All security-related issues
- `soc2` — SOC 2 compliance specific
- `high-priority` — High/Critical severity
- `defense-in-depth` — Hardening improvements
- `enterprise` — Enterprise deployment concerns
- `audit` — Audit and logging
- `ci-cd` — CI/CD pipeline
- `documentation` — Documentation updates

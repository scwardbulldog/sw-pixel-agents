# Consolidated Security Findings Inventory

> **Last Audit Date:** 2026-04-25
> **Repository:** scwardbulldog/sw-pixel-agents (Pixel Agents VS Code Extension)
> **Overall Risk Assessment:** LOW (all High/Medium findings resolved)
> **npm audit:** 0 vulnerabilities across all packages (root, server, webview-ui)

This document is the single consolidated inventory of all security and infosec findings
identified across the project. It supersedes and consolidates:

- `docs/SECURITY_ANALYSIS.md` — Original security analysis report
- `docs/INFOSEC_ISSUES.md` — SOC 2 compliance review findings
- `docs/security-issues/` — Individual finding writeups and verification records

---

## Finding Summary

| ID | Title | Severity | Status | Last Verified |
|--------|--------------------------------------------------------------|----------|------------------|---------------|
| SEC-001 | JSON Parsing Without Schema Validation | Medium | ✅ Resolved | 2026-04-25 |
| SEC-002 | Insecure File Permissions on Config & Layout Files | High | ✅ Resolved | 2026-04-25 |
| SEC-003 | Sensitive Data Exposure in Logs | Medium | ✅ Resolved | 2026-04-25 |
| SEC-004 | Missing Content Security Policy | Medium | ✅ Resolved | 2026-04-25 |
| SEC-005 | `--dangerously-skip-permissions` Lacks Guardrails | High | ✅ Mitigated | 2026-04-25 |
| SEC-006 | Unencrypted Local Transport (No TLS) | Medium | ✅ Resolved | 2026-04-25 |
| SEC-007 | Missing Rate Limiting on HTTP Server | Low | ✅ Resolved | 2026-04-25 |
| SEC-008 | No Formal Audit Logging for Security-Relevant Events | Low | ✅ Resolved | 2026-04-25 |
| SEC-009 | CSP Allows `unsafe-inline` for Styles | Low | ✅ Risk Accepted | 2026-04-25 |
| SEC-010 | `~/.claude/settings.json` Without Restrictive Permissions | Medium | ✅ Resolved | 2026-04-25 |
| SEC-011 | JSONL Input Length Validation | Low | ✅ Resolved | 2026-04-25 |
| SEC-012 | Debug Logging Configuration | Info | ✅ Resolved | 2026-04-25 |
| SEC-013 | Auth Token Stored in Plaintext on Disk | Medium | ✅ Mitigated | 2026-04-25 |
| SEC-014 | Symlink Attack Surface on File Watchers | Low | ⚠️ Open | 2026-04-25 |
| SEC-015 | Security Policy References Upstream Repository | Info | ⚠️ Open | 2026-04-25 |
| SEC-016 | No Automated Dependency Vulnerability Scanning | Info | ✅ Resolved | 2026-04-25 |
| SEC-017 | Vite Path Traversal Vulnerabilities | High | ✅ Mitigated | 2026-04-25 |
| SEC-018 | Incomplete SEC-003: Console Logging Bypass | Medium | ✅ Resolved | 2026-04-25 |
| INFOSEC-003 | Missing Security Response Headers on HTTP Server | Medium | ✅ Resolved | 2026-04-25 |

### Status Summary

| Status | Count | Details |
|--------|-------|---------|
| ✅ Resolved | 14 | SEC-001, 002, 003, 004, 006, 007, 008, 010, 011, 012, 016, 018, INFOSEC-003 |
| ✅ Mitigated | 3 | SEC-005 (confirmation dialog + audit + setting), SEC-013 (0o600 + Unix socket), SEC-017 (Dependabot monitoring) |
| ✅ Risk Accepted | 1 | SEC-009 (required by Tailwind CSS, mitigated by VS Code sandbox) |
| ⚠️ Open | 2 | SEC-014 (symlink), SEC-015 (SECURITY.md URL) |

---

## Open Findings

### SEC-014: Symlink Attack Surface on File Watchers

**Severity:** Low | **Priority:** P4 — Backlog | **SOC 2:** CC6.1, CC6.6

**Issue Tracker:** [docs/security-issues/tracker-SEC-014.md](security-issues/tracker-SEC-014.md)

**Description:** The extension reads files from user-writable directories (`~/.pixel-agents/`,
`~/.claude/projects/`, external asset directories) using `fs.readFileSync` and `fs.existsSync`
without checking for symbolic links. An attacker with local access could create symlinks pointing
to sensitive system files.

**Affected Files:**
- `src/layoutPersistence.ts` — `readLayoutFromFile()` reads without symlink check
- `src/configPersistence.ts` — `readConfig()` reads without symlink check
- `src/fileWatcher.ts` — JSONL reads without symlink check
- `src/assetLoader.ts` — asset reads (has path traversal protection, but no symlink check)

**Mitigating Factors:**
- Extension doesn't transmit file contents externally
- File contents are parsed as JSON/JSONL; invalid data is rejected by Zod schemas
- Asset loader has path traversal checks (`startsWith(resolvedDir)`)
- All operations are local to the user's filesystem
- Requires local access to exploit

**Remediation:** Add `fs.lstatSync()` symlink validation before security-sensitive file reads.

---

### SEC-015: Security Policy References Upstream Repository

**Severity:** Informational | **Priority:** P4 — Backlog | **SOC 2:** CC1.4

**Issue Tracker:** [docs/security-issues/tracker-SEC-015.md](security-issues/tracker-SEC-015.md)

**Description:** `SECURITY.md` references the upstream repository (`pablodelucca/pixel-agents`)
for vulnerability reporting instead of this fork (`scwardbulldog/sw-pixel-agents`).

**Affected Files:**
- `SECURITY.md` line 11 — URL points to `pablodelucca/pixel-agents`

**Remediation:** Update the vulnerability reporting URL to reference `scwardbulldog/sw-pixel-agents`.

---

## Risk-Accepted Findings

### SEC-009: CSP Allows `unsafe-inline` for Styles

**Severity:** Low | **SOC 2:** CC6.6

**Justification:** Required by Tailwind CSS framework for dynamic class generation.

**Mitigating Controls:**
1. VS Code webview sandbox prevents arbitrary code execution
2. No untrusted content is rendered in the webview
3. Script injection is prevented by nonce-based CSP (`script-src` uses per-instance nonces)
4. `connect-src` restricts all network access
5. `default-src 'none'` denies everything by default

**Risk Level After Mitigation:** Negligible

**Evidence:** `src/PixelAgentsViewProvider.ts:1076` — `style-src ${cspSource} 'unsafe-inline'`

**Annual Review Required:** Next review by 2027-04-25

---

## Mitigated Findings

### SEC-005: `--dangerously-skip-permissions` Lacks Enterprise Guardrails

**Severity:** High | **Status:** Mitigated

**Controls in place:**
- ✅ Confirmation dialog before enabling bypass mode (VS Code modal warning)
- ✅ Audit logging when bypass mode is activated (`auditLog()` in `src/agentManager.ts`)
- ✅ VS Code setting `pixelAgents.security.allowBypassPermissions` (default: allowed; can be
  disabled via workspace/policy settings for enterprise lockdown)

**Residual Risk:** Low — user must explicitly opt-in via context menu + confirmation dialog.

### SEC-013: Auth Token Stored in Plaintext on Disk

**Severity:** Medium | **Status:** Mitigated

**Controls in place:**
- ✅ File permissions `0o600` (owner-only read/write) on `~/.pixel-agents/server.json`
- ✅ Directory permissions `0o700` (owner-only) on `~/.pixel-agents/`
- ✅ Token regenerated on every server start (not persistent across sessions)
- ✅ Unix domain socket transport (eliminates network-layer token exposure)
- ✅ Bearer token retained as defense-in-depth only

**Residual Risk:** Low — token is ephemeral, file is owner-only, no network exposure.

### SEC-017: Vite Path Traversal Vulnerabilities

**Severity:** High | **Status:** Mitigated

**Controls in place:**
- ✅ Vite updated to 8.0.5+ (webview-ui) — all known CVEs patched
- ✅ Vitest updated to 3.2.2+ (server) — internal vite dependency patched
- ✅ Dependabot enabled for weekly dependency updates
- ✅ `npm audit` runs in CI pipeline at moderate level
- ✅ 0 vulnerabilities in npm audit as of 2026-04-25

**Residual Risk:** Low — dev dependency only, actively monitored, currently patched.

---

## Resolved Findings Summary

All resolved findings have been verified in the current codebase. Evidence:

| ID | Resolution | Verification |
|--------|------------------------------------------------------------------|-----------------------------------|
| SEC-001 | Zod schema validation for all external JSON parsing | `src/schemas/*.ts`, tests in `server/__tests__/schemas.test.ts` |
| SEC-002 | Explicit `0o700`/`0o600` permissions on config/layout files | `src/configPersistence.ts:29,33`, `src/layoutPersistence.ts:47,51` |
| SEC-003 | Centralized logger with path/UUID sanitization and log levels | `src/logger.ts`, `server/src/logger.ts` |
| SEC-004 | CSP with nonces, `default-src 'none'`, `localResourceRoots` | `src/PixelAgentsViewProvider.ts:1058-1085` |
| SEC-006 | Unix domain socket transport (no TCP/network exposure) | `server/src/server.ts` — `server.listen(socketPath)` |
| SEC-007 | Rate limiter (100 req/s/provider) + connection limit (50) | `server/src/rateLimiter.ts`, `server/src/server.ts` |
| SEC-008 | Structured `[AUDIT]` JSON logging for all security events | `src/auditLogger.ts`, `server/src/auditLogger.ts` |
| SEC-010 | `writeClaudeSettings()` uses `mode: 0o700`/`0o600` | `server/src/providers/hook/claude/claudeHookInstaller.ts` |
| SEC-011 | `MAX_JSONL_LINE_LENGTH` (1MB) enforced in `readNewLines()` | `src/fileWatcher.ts`, `server/src/constants.ts` |
| SEC-012 | Debug opt-in only (`PIXEL_AGENTS_DEBUG=1`), default is INFO | `src/logger.ts`, `server/src/logger.ts` |
| SEC-016 | Dependabot + npm audit in CI | `.github/dependabot.yml`, `.github/workflows/ci.yml` |
| SEC-018 | All `console.*` calls in schemas replaced with `logger.*` | `src/configPersistence.ts`, `src/schemas/config.ts`, `src/schemas/layout.ts` |
| INFOSEC-003 | Security response headers on all HTTP responses | `server/src/server.ts` — `setSecurityHeaders()` |

---

## Security Controls in Place

| Control | Location | Status |
|-----------------------------------------------|--------------------------------------|--------|
| JSON Schema Validation (Zod) | `src/schemas/*.ts` | ✅ |
| Auth Token for HTTP API | `server/src/server.ts` | ✅ |
| Timing-Safe Token Comparison | `server/src/server.ts` | ✅ |
| Unix Domain Socket Transport | `server/src/server.ts` | ✅ |
| File Permission Restrictions (0o700/0o600) | Multiple persistence files | ✅ |
| Path Traversal Prevention | `src/assetLoader.ts` | ✅ |
| HTTP Body Size Limits (64KB) | `server/src/server.ts` | ✅ |
| JSONL Line Length Limits (1MB) | `src/fileWatcher.ts` | ✅ |
| Rate Limiting (100 req/s) | `server/src/rateLimiter.ts` | ✅ |
| Connection Limiting (50 max) | `server/src/server.ts` | ✅ |
| Atomic File Writes (tmp + rename) | Multiple locations | ✅ |
| Provider ID Validation (regex) | `server/src/server.ts` | ✅ |
| VS Code Webview Sandbox | Inherent | ✅ |
| Content Security Policy (nonce-based) | `src/PixelAgentsViewProvider.ts` | ✅ |
| Structured Logging with Sanitization | `src/logger.ts`, `server/src/logger.ts` | ✅ |
| Audit Logging (JSON, WARN level, [AUDIT] prefix) | `src/auditLogger.ts`, `server/src/auditLogger.ts` | ✅ |
| Security Response Headers | `server/src/server.ts` | ✅ |
| No `eval()`/`Function()`/`innerHTML` with user data | Verified across codebase | ✅ |
| Dependabot Weekly Updates | `.github/dependabot.yml` | ✅ |
| npm audit in CI | `.github/workflows/ci.yml` | ✅ |
| Gitleaks Configuration | `.gitleaks.toml` | ✅ |
| TypeScript Strict Mode | `tsconfig.json` | ✅ |

---

## SOC 2 Trust Service Criteria Mapping

| SOC 2 Criteria | Description | Covered By |
|----------------|---------------------------------------------|----------------------------------------------|
| CC6.1 | Logical and Physical Access Controls | SEC-002, 005, 010, 013, 014 |
| CC6.3 | Security for Assets | SEC-002, 005, 010 |
| CC6.6 | External Threats | SEC-004, 009, 014, INFOSEC-003 |
| CC6.7 | Data Transmission Security | SEC-006, 013, INFOSEC-003 |
| CC7.1 | Change Management | SEC-016 |
| CC7.2 | System Monitoring | SEC-005, 008 |
| CC7.3 | Evaluation of Findings | SEC-008 |
| CC8.1 | Vulnerability Management | SEC-016, 017 |
| CC1.4 | Organizational Structure and Reporting | SEC-015 |

---

## Compliance Frameworks

These findings support compliance with:

- **SOC 2 Type II** — Security, availability, and processing integrity controls
- **GDPR** — Data protection and privacy (no PII collected, local-only storage)
- **ISO 27001** — Information security management
- **OWASP ASVS** — Application security verification

---

## Severity Definitions

| Severity | CVSS Range | Description |
|-----------------|------------|-----------------------------------------------------|
| **Critical** | 9.0–10.0 | Immediate exploitation risk, data breach potential |
| **High** | 7.0–8.9 | Significant risk requiring urgent attention |
| **Medium** | 4.0–6.9 | Moderate risk, should be addressed promptly |
| **Low** | 0.1–3.9 | Minor risk, address as resources allow |
| **Informational** | 0.0 | Best practice recommendation, no direct risk |

## Priority Levels

| Priority | Timeline | Description |
|----------|----------------|---------------------------------------------|
| **P1** | Within 7 days | Immediate — Critical for security posture |
| **P2** | Within 30 days | Short-term — Important for compliance |
| **P3** | Within 90 days | Long-term — Best practice improvements |
| **P4** | Backlog | Low priority — Address when convenient |

---

## Related Documents

- [SECURITY.md](../SECURITY.md) — Security policy and vulnerability reporting
- [Individual Finding Writeups](security-issues/) — Detailed writeups (archived)
- [Security Issue Template](.github/ISSUE_TEMPLATE/security_finding.yml) — GitHub issue template

---

_Last audit: 2026-04-25 | Next review: Quarterly or on significant changes_

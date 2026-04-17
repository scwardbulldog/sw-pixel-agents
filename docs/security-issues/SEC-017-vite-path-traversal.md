# Security Issue: SEC-017 - Vite Path Traversal Vulnerabilities

## Finding Details

| Field | Value |
|-------|-------|
| **Finding ID** | SEC-017 |
| **Severity** | High |
| **CVSS Score** | 7.5 (estimated) |
| **Category** | Dependency Vulnerability |
| **Status** | ✅ Resolved |
| **Priority** | P1 - Immediate (within 7 days) |
| **Resolution Date** | 2026-04-17 |

## Description

High severity vulnerabilities were identified in the Vite dependency used by both the server tests (via vitest) and the webview-ui build system:

1. **GHSA-4w7w-66w2-5vf9**: Path Traversal in Optimized Deps `.map` Handling (CVE-2026-39365)
2. **GHSA-v2wj-q39q-566r**: `server.fs.deny` bypassed with queries
3. **GHSA-p9ff-h696-f583**: Arbitrary File Read via Vite Dev Server WebSocket

These vulnerabilities could allow attackers to read arbitrary files from the filesystem when running the Vite dev server.

## Affected Files

- `server/package.json` - vitest dependency (uses vite internally)
- `webview-ui/package.json` - vite dependency

### Vulnerable Versions

- **server**: vitest 3.2.1 (internally uses vite 7.x affected by GHSA-4w7w-66w2-5vf9)
- **webview-ui**: vite 8.0.3 (affected by all three CVEs)

## Risk Assessment

### Impact
- **Confidentiality**: High - Arbitrary file read could expose source code, credentials, env files
- **Integrity**: Low - Read-only vulnerability
- **Availability**: Low - No direct impact

### Likelihood
- **Exploitability**: Medium - Requires attacker access to dev server (localhost by default)
- **Attack Vector**: Network (dev server)

### Mitigating Factors
- Vite is a development dependency, not used in production
- Dev server typically runs on localhost only
- Vulnerability requires attacker to be on same network or have local access

### Overall Risk
High for development environments, but limited production impact as Vite is only used during development/build.

## Resolution Summary

Updated dependencies to patched versions:

1. **server/package.json**:
   ```diff
   - "vitest": "^3.2.1"
   + "vitest": "^3.2.2"
   ```
   (vitest 3.2.2 includes vite 7.3.2+ which fixes the vulnerability)

2. **webview-ui/package.json**:
   ```diff
   - "vite": "^8.0.3"
   + "vite": "^8.0.5"
   ```

## Verification

After updating dependencies:

```bash
# Server audit
cd server && npm install && npm audit
# Result: found 0 vulnerabilities

# Webview audit
cd webview-ui && npm install && npm audit
# Result: found 0 vulnerabilities
```

## Acceptance Criteria

- [x] Vite vulnerability in server/package.json resolved
- [x] Vite vulnerability in webview-ui/package.json resolved
- [x] All tests pass after update
- [x] Build completes successfully
- [x] npm audit shows 0 vulnerabilities in both packages
- [x] Documentation updated in `docs/SECURITY_ANALYSIS.md`

## Testing Requirements

1. **Automated Testing**
   - [x] All existing tests pass with updated dependencies
   - [x] Build completes successfully

2. **Manual Testing**
   - Dev server starts correctly
   - Hot reload works
   - No regressions in development workflow

## References

- [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9) - Vite Path Traversal
- [GHSA-v2wj-q39q-566r](https://github.com/advisories/GHSA-v2wj-q39q-566r) - server.fs.deny bypass
- [GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583) - WebSocket File Read
- [Vite Security Advisories](https://github.com/vitejs/vite/security/advisories)

---

**Labels**: `security`, `compliance`, `priority: high`, `dependencies`

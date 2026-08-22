# Online Login Redirect Fix

## Goal

Prevent the production app from returning to the login page immediately after a successful login when the browser uses `kairosq.cn` but the server was configured with the historical IP origin.

## Scope

- Keep authentication and Paper-only execution unchanged.
- Accept the configured origin and, behind the trusted reverse proxy, the actual HTTPS host that matches the browser Origin.
- Distinguish WebSocket origin rejection from an expired session so the frontend does not misdiagnose a deployment mismatch as logout.
- Add regression tests and publish through the existing restricted production workflow.

## Verification

- Server regression coverage includes configured-origin, trusted-proxy host, untrusted-proxy, and mismatched-origin cases.
- Frontend regression coverage distinguishes `ORIGIN_MISMATCH` from `UNAUTHORIZED`.
- Server tests: 58 files / 845 tests passed.
- Web tests: 31 files / 110 tests passed.
- TypeScript and Vite production build passed.

## Safety

No credentials, broker connections, order limits, fees, cash, position, T+1, circuit-breaker, or daily Paper order caps are changed.

## Status

Code fix verified locally; commit and production deployment are pending.

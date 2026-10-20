# Phase 1 · Step 1 — Fail-closed authentication

- Date: 2026-10-20
- Baseline: `30341a4`. Scope: authentication, Smart OCR document permissions, network exposure. BI 360, Copilot and ERP routes keep their existing role checks (they now sit behind the same authentication).

## 1. What changed

### 1.1 Explicit authentication mode

`AUTH_MODE` is **required**; the API refuses to start without it (`server/config.ts`, `server/index.ts` exits with code 1 and a clear message).

| Mode | Accepts | Constraints enforced at startup |
|---|---|---|
| `oidc` | Identity-provider JWTs (issuer, audience, remote JWKS) | `OIDC_ISSUER`, `OIDC_AUDIENCE`, `OIDC_JWKS_URL` all required. Mandatory when `NODE_ENV=production` |
| `local-dev` | Development session tokens; also identity-provider tokens if a complete OIDC configuration is present | Forbidden when `NODE_ENV=production`. `HOST` must be `127.0.0.1`, `::1` or `localhost` |

Other startup rules: OIDC variables are all-or-nothing (a partial set would skip issuer/audience checks); `AUTH_DEV_SIGNING_KEY`, when set, must be ≥ 32 characters. `NODE_ENV` no longer influences authentication at all.

### 1.2 No static or bundled credentials

- The static tokens `dev-admin`, `dev-manager-sfax`, `dev-commercial-tunis` no longer exist; sent as bearer tokens they return 401 in every mode.
- In `local-dev`, `POST /api/v1/auth/dev-session` issues a **1-hour HS256 token** for one catalogued identity (`admin`, `manager-sfax`, `commercial-tunis`). The signing key is random per API process unless `AUTH_DEV_SIGNING_KEY` is set. The endpoint accepts JSON only (a cross-site form cannot reach it without a CORS preflight), answers `Cache-Control: no-store` and writes an `auth.dev_session.issued` audit event. It is not registered in `oidc` mode.
- A development token carries only the identity key. Role and agencies come from the **server-side catalogue**; role/agency claims inside the token are ignored.
- Token routing: the unverified `iss` claim only chooses which single verification path applies (development key or identity provider); there is no fallback between them.
- Frontend (`src/api.ts`): the `VITE_DEV_TOKEN` / `dev-admin` fallback is removed. In `npm run dev`, the browser requests a session for `VITE_DEV_IDENTITY` (a name, not a credential) and renews it once on 401. In production builds `import.meta.env.DEV` is false, so this code is removed; without a token the API answers 401.
- Development identity display names are no longer personal names ("Administrateur (développement)", …).

### 1.3 Network exposure

- The API binds to `HOST`, default `127.0.0.1` (previously all interfaces). Containers set `HOST=0.0.0.0` with `AUTH_MODE=oidc` (`Dockerfile`, `docker-compose.yml`).
- In `local-dev`, every `/api/v1` request (including the session endpoint) must come from a loopback address **and** carry no proxy/tunnel header (`X-Forwarded-For`, `X-Forwarded-Host`, `Forwarded`, `X-Real-IP`, `CF-Connecting-IP`, `True-Client-IP`); otherwise `403 LOCAL_DEV_ONLY`. `livez` and `readyz` stay public.
- Verified on this machine: requests to the LAN address `172.19.224.1:3201` cannot connect while the API runs in `local-dev`.

### 1.4 Server-side permissions (Smart OCR)

`server/permissions.ts` maps roles to named permissions; the four document routes use `requirePermission`:

| Permission | admin | accountant | manager | commercial | Used by |
|---|---|---|---|---|---|
| `documents.read` | ✓ | ✓ | ✓ | | `GET /documents`, `GET /documents/:id` |
| `documents.upload` | ✓ | ✓ | ✓ | | `POST /documents` |
| `invoice.approve` | ✓ | ✓ | | | `POST /documents/:id/approve` |
| `invoice.correct` | ✓ | ✓ | ✓ | | not used yet |
| `mapping.approve` | ✓ | | | | not used yet |
| `erp.integrate` | ✓ | | | | not used yet |

The first three rows reproduce the previous role checks exactly. The last three are least-privilege defaults **not yet validated by the business**. Agency scope checks are unchanged.

### 1.5 Logging

Redaction now covers `authorization`, `cookie` and `set-cookie` headers (plus request/response bodies, as before). Verification errors and tokens are never logged. A test captures the real log stream and checks that issued and forged tokens never appear.

### 1.6 Other

- `scripts/migrate.ts` reads `DATABASE_URL` directly (migrations no longer depend on API authentication settings).
- `scripts/check-bundle.ts` (`npm run check:bundle`, added to CI after the build): fails if `dist/` contains the session endpoint, development identity/token names, database URL schemes, secret variable names, or the **value** of any secret present in the environment.
- Playwright stack: `AUTH_MODE=local-dev`, `HOST=127.0.0.1`, `VITE_DEV_IDENTITY=admin`, API URL on `127.0.0.1`.

## 2. How to run locally

`.env` (never committed) must contain `AUTH_MODE=local-dev`, and `VITE_DEV_IDENTITY=admin` for the browser. `npm run dev:api`, `npm run migrate` and the Vite auto-started API read `.env`. Without `AUTH_MODE` the API does not start; this also applies to any environment (such as a hosted preview) that starts the API without that file.

## 3. Tests

New suite `tests/qa/auth-hardening.test.ts` (62 tests): configuration fail-closed rules; loopback detection; refusal of legacy/static tokens in both modes; session endpoint (identity catalogue incl. `__proto__`/`constructor`, JSON-only, audit, per-process keys); tampering (foreign key, expiry, payload swap, `alg=none`, wrong issuer/audience, unknown identity, smuggled role claims); permission matrix; every registered route except `livez`/`readyz`/`dev-session` returns 401 without a token in both modes; proxy headers refused in `local-dev` but accepted in `oidc`; real process starts of `server/index.ts` (no `AUTH_MODE` → exit 1; `local-dev` on `0.0.0.0` → exit 1; default bind `127.0.0.1`); log redaction.

Mutation check: disabling the loopback guard made 4 tests fail; trusting token role claims made 2 tests fail; the file was restored byte-identical.

Existing tests now authenticate with signed session tokens minted by the harness (`bearer("dev-admin")` mints a token for identity `admin` with a test-only key); the raw string `dev-admin` is not a credential anywhere.

## 4. Known limitations and remaining risks

1. **No production login in the frontend.** With `AUTH_MODE=oidc` the SPA has no OIDC sign-in flow yet, so it cannot be used against a production API. Required before any pilot.
2. `local-dev` trusts every process and user on the workstation (anyone able to call loopback can request an admin session). Acceptable only on a single-user developer machine.
3. BI 360, Copilot and ERP routes still use role checks (`requireRoles`), by scope decision; all of them require authentication.
4. Identity-provider tokens: accepted algorithms are not pinned (pin them once the provider is known); no revocation besides expiry; one role per user.
5. Tenant isolation does not exist yet (Step 2); access is still scoped by agency name.
6. UI still shows hardcoded "Sonia Ben Amor" (sidebar, greeting, settings): display only, handled in Step 5.
7. `readyz` remains public; CSP still disabled (Phase 12).
8. If the database is down, `POST /auth/dev-session` fails with 500 (its audit write fails); no token is issued in that case (fail closed).

## 5. Incident during this step (development environment only)

At 14:14 the local Postgres container was recreated with the `17-alpine` image on the volume initialized by PostgreSQL 16 and refused to start (`database files are incompatible with server`). Cause: a `docker compose up` launched earlier in Phase 0.5 (before `POSTGRES_IMAGE_TAG=16-alpine` existed) and then stopped from the agent side, survived as a CLI process and completed once the 17 image finished downloading. Re-running `npm run db:dev:up` restored the 16.14 container on the intact volume. No data was lost (the database held no documents). Lesson: a dev volume is tied to its major version; switching to 17 requires a dump/restore or a new volume.

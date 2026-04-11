# Release checklist

## Pre-release

- `npm install`
- `npm run build`
- `npm run lint`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`
- Confirm `.env` or production config has `MONGODB_URI`, `SESSION_SECRET`, and `APP_BASE_URL`
- Confirm Google OAuth config is set: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- Confirm session cookie settings are correct for the environment: `SESSION_SECRET`, `SESSION_NAME`, `TRUST_PROXY`
- Confirm `AUTH_BYPASS_ENABLED=false` outside local/test environments
- Confirm Playwright/Chromium is available on the runtime image
- Confirm Japanese fallback fonts are installed and `/readyz` reports `checks.exportRuntime=true`
- Confirm the deploy target is running as a single instance if collaborative editing is enabled

## Smoke test checklist

- Visit `/`
- Visit `/login`
- Sign in through the development bypass or configured auth flow
- Confirm `/app` renders seeded or real projects
- Confirm the dashboard shows projects, pending invites, unread inbox state, and recent activity
- Change locale and verify the authenticated layout updates
- Open `/inbox`, switch filters, and mark an unread item read
- Open a project, a script, and the editor shell page
- Load each fragment route from the browser or a tool and confirm it returns HTML
- Call `/api/v1/me`
- Call `/healthz`
- Call `/readyz`
- Confirm `/readyz` fails when Mongo connectivity is intentionally removed in a test environment
- Confirm `/readyz` reports export runtime readiness details when Mongo is connected
- Confirm a socket connection to `/collab` fails without auth and succeeds with an authenticated session
- Send an invite, verify the recipient sees unread inbox state, then accept or decline it
- Change a member role and verify the affected user sees the inbox/dashboard update
- Open a script overview and export a full standard PDF
- Open a script editor and export a full mobile `9:16` PDF
- Export a partial scene selection and confirm the numbered pages preserve canonical page numbers
- Confirm export creates one new activity entry and one new audit entry
- Confirm export does not create a new major-save checkpoint
- Confirm forced auth expiry or a denied API request surfaces a visible reauth message instead of failing silently

## Release-readiness notes

- Google OAuth requires verified Google emails and configured callback credentials in each environment.
- Yjs sync events validate payloads but remain intentionally unimplemented.
- Multi-dyno Socket.IO support is deferred until later realtime epics.
- PDF export depends on Playwright/Chromium plus installed CJK-capable fonts for multilingual output.
- Inbox unread state is derived from invites and activity plus per-user read markers; there is no second notification event bus.
- Collaboration and in-memory action gates remain single-instance for this MVP release.

## Rollback basics

- Roll back to the previous slug or release before re-enabling traffic if `/readyz` is degraded in production.
- If export runtime readiness fails after deploy, disable release traffic until Chromium and font dependencies are restored.
- If realtime behavior regresses, keep the app on a single instance and verify sticky session/session store config before retrying the release.

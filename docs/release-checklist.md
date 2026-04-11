# Release checklist

## Pre-release

- `npm install`
- `npm run build`
- `npm run lint`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:e2e`
- Confirm `.env` or production config has `MONGODB_URI`, `SESSION_SECRET`, and `APP_BASE_URL`
- Confirm `AUTH_BYPASS_ENABLED=false` outside local/test environments

## Smoke test checklist

- Visit `/`
- Visit `/login`
- Sign in through the development bypass or configured auth flow
- Confirm `/app` renders seeded or real projects
- Change locale and verify the authenticated layout updates
- Open a project, a script, and the editor shell page
- Load each fragment route from the browser or a tool and confirm it returns HTML
- Call `/api/v1/me`
- Call `/healthz`
- Call `/readyz`
- Confirm `/readyz` fails when Mongo connectivity is intentionally removed in a test environment
- Confirm a socket connection to `/collab` fails without auth and succeeds with an authenticated session
- Open a script overview and export a full standard PDF
- Open a script editor and export a full mobile `9:16` PDF
- Export a partial scene selection and confirm the numbered pages preserve canonical page numbers
- Confirm export creates one new activity entry and one new audit entry
- Confirm export does not create a new major-save checkpoint

## Release-readiness notes

- Google OAuth requires verified Google emails and configured callback credentials in each environment.
- Yjs sync events validate payloads but remain intentionally unimplemented.
- Multi-dyno Socket.IO support is deferred until later realtime epics.
- PDF export depends on Playwright/Chromium plus installed CJK-capable fonts for multilingual output.

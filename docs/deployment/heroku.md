# Heroku deployment baseline

Courier Draft ships a production-ready baseline for Heroku with:

- `Procfile` using `npm start`
- `heroku-postbuild` running the Tailwind build
- secure cookie/session defaults
- readiness checks that fail when Mongo is disconnected
- on-demand Playwright/Chromium PDF export

## Required environment variables

Set these in Heroku config vars:

- `NODE_ENV=production`
- `PORT` is provided by Heroku
- `APP_BASE_URL=https://<your-heroku-app>.herokuapp.com`
- `MONGODB_URI=<MongoDB Atlas connection string>`
- `SESSION_SECRET=<long random string>`
- `SESSION_NAME=courier.sid`
- `TRUST_PROXY=true`
- `DEFAULT_LOCALE=en`
- `LOCALE_COOKIE_NAME=courier_locale`
- `RATE_LIMIT_WINDOW_MS=900000`
- `RATE_LIMIT_MAX=300`
- `LOG_LEVEL=info`
- `AUTH_BYPASS_ENABLED=false`
- `GOOGLE_CLIENT_ID=<Google OAuth client id>`
- `GOOGLE_CLIENT_SECRET=<Google OAuth client secret>`
- `GOOGLE_CALLBACK_URL=https://<your-heroku-app>.herokuapp.com/auth/google/callback`

## MongoDB Atlas

1. Create an Atlas cluster and database user.
2. Add the Heroku outbound IP rules you require, or use an Atlas network policy that matches your environment.
3. Store the full Atlas connection string in `MONGODB_URI`.
4. Verify `/readyz` returns `200` after deployment.

## WebSockets on Heroku

- Heroku supports WebSockets on the web dyno.
- This foundation PR keeps Socket.IO simple: one namespace, shared Express session auth, and no multi-dyno adapter yet.
- For now, run a single web dyno for reliable realtime behavior.
- When later epics add full collaboration at scale, add a shared Socket.IO adapter and shared presence backend before scaling horizontally.

## Realtime scene collaboration

- Realtime scene collaboration is process-local in this release.
- Active scene sessions keep one in-memory Yjs document plus awareness state per scene on the running app instance.
- Current-head persistence is still written back to MongoDB, but the live collaborative state is not shared across dynos.
- Run a single app instance for collaborative scene editing until a shared session backend such as Redis is introduced in a later epic.

## PDF export runtime

Courier Draft renders screenplay exports with:

- canonical pagination in app code
- Nunjucks HTML templates
- Playwright/Chromium PDF output

For Heroku deployments, provision:

- Chromium available to Playwright at build/runtime
- system libraries required by headless Chromium on your chosen Heroku stack
- a CJK-capable font package such as `fonts-noto-cjk` so Japanese export fallback works

Recommended setup:

1. Keep the `playwright` package installed in the slug build.
2. Add the platform-specific Chromium shared-library dependencies required by Playwright for your stack.
3. Install `fonts-noto-cjk` or an equivalent Noto CJK package through your stack image or buildpack layer.
4. Smoke-test both standard and `mobile_9_16` export after deploy.

Operational notes:

- export is generated on demand and not persisted in MongoDB
- partial exports preserve canonical standard page numbers, so full-script pagination still needs accurate live scene heads
- if a live collaborative scene flush fails, export fails instead of emitting stale content

## Recommended deploy flow

1. `npm ci`
2. `npm run build`
3. `npm test`
4. Push to Heroku or GitHub-connected deploy target.
5. Run `npm run seed` against the target database only if you want development/demo data.

## Smoke checks after deploy

- `GET /healthz` returns `200`
- `GET /readyz` returns `200`
- `/login` renders
- Google sign-in completes with a verified Google account
- locale switching updates the locale cookie
- `/app` loads after authentication
- `/collab` rejects unauthenticated sockets
- standard screenplay PDF export succeeds
- mobile `9:16` PDF export succeeds
- Japanese text exports without missing-glyph fallback failures

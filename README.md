# Courier Draft

Courier Draft is a collaborative screenplay authoring platform for small writing teams.

The product is designed around:

- Google authentication
- project-based collaboration
- multiple scripts per project
- structured screenplay scenes
- realtime collaboration
- version history with major saves
- standard screenplay PDF export
- 9:16 mobile-reading PDF export

## Architecture notes

Before implementing routes, sockets, or editor behavior, read these documents:

- [Route map](docs/architecture/route-map.md)
- [WebSocket contract](docs/architecture/socket-contract.md)

These two files are the canonical references for:

- SSR page routing
- JSON API routing
- fragment routing for the no-React UI
- durable HTTP responsibilities
- realtime WebSocket responsibilities
- room membership
- presence
- event naming
- fan-out behavior after durable writes

## Intended stack

Courier Draft is intended to use:

- Node.js
- Express
- Nunjucks
- Tailwind CSS
- MongoDB Atlas
- Socket.IO

Important constraint:

- **Do not use React**

## Current status

This repository is expected to evolve in phases. The route map and socket contract should be treated as architecture-first documents that coding agents can reference while building the foundation.

The current foundation includes:

- Express + Nunjucks SSR shell
- Tailwind CSS + screenplay tokens
- MongoDB/Mongoose models and indexes
- session, Google auth, onboarding, locale, CSRF, and Socket.IO collaboration flows
- Vitest/Supertest/Playwright test foundations
- Heroku deployment and release-readiness docs

## Related docs

- [Route map](docs/architecture/route-map.md)
- [WebSocket contract](docs/architecture/socket-contract.md)

## Local development

```bash
cp .env.example .env
npm install
npm run build
npm run seed
npm run dev
```

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL` in `.env` to use the real Google sign-in flow locally.

For local shell access without full Google OAuth, set `AUTH_BYPASS_ENABLED=true` and use any existing user shown on `/login`.

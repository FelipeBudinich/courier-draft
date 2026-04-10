# Courier Draft Route Map

Status: Foundation scaffolding implemented for E1 + E12  
Scope: v1 foundation  
Audience: developers, coding agents, reviewers

Foundation implementation note:

- The current repository implements this route surface as the production foundation baseline.
- `/auth/dev-login` exists only for non-production development and e2e smoke coverage; it is not part of the public product contract.

## Purpose

This document defines the HTTP route surface for Courier Draft.

It is the canonical reference for:

- server-rendered page routes
- JSON API routes
- HTML fragment routes
- health/readiness routes
- the boundary between HTTP and WebSockets

This document does **not** define full request/response schemas. It defines route intent, access level, and architectural constraints so agents can scaffold and implement consistently.

---

## Architectural conventions

Courier Draft uses a mixed architecture:

- **SSR pages** for navigation, dashboards, workspaces, settings, and editor shell
- **JSON API** for durable commands and read models
- **HTML fragments** for dynamic server-rendered partials in a no-React UI
- **WebSockets** for presence, room membership, future realtime sync, and post-write fan-out
- **On-demand export** through HTTP

### Surface prefixes

| Surface | Prefix | Returns | Purpose |
|---|---|---:|---|
| SSR pages | `/` | HTML | Main app shell and user-facing screens |
| JSON API | `/api/v1` | JSON | Durable commands and read models |
| HTML fragments | `/fragments` | HTML partials | Server-rendered dynamic panels and lists |
| Ops | `/healthz`, `/readyz` | text/json | Health and readiness |
| WebSockets | `/collab` | Socket.IO | Presence and live collaboration transport |

---

## Access levels

| Label | Meaning |
|---|---|
| Public | No session required |
| Auth | Any signed-in user |
| Member | Any project member |
| Editor+ | Project owner or editor |
| Owner | Project owner only |
| Member* | Any member, but reviewer is restricted to their own notes |

### Roles

Courier Draft uses these project roles:

- `owner`
- `editor`
- `reviewer`

Reviewers can read content and create notes, but cannot edit screenplay content.

---

## Core routing rules

### 1. HTTP owns durable writes

Durable writes should happen over HTTP, not WebSockets.

Use HTTP for:

- create/update/delete project data
- invites and membership changes
- outline changes
- script metadata changes
- major save and restore operations
- diff requests
- export requests
- registry/entity updates

### 2. WebSockets own high-frequency collaboration

Use WebSockets for:

- authenticated room join/leave
- presence
- live cursors and awareness
- future Yjs sync for scenes and notes
- server fan-out after durable HTTP writes commit

### 3. Fragments exist to support a no-React UI

Dynamic UI panels that do not need a full page reload should be renderable as server HTML fragments.

---

## SSR page routes

These routes render complete HTML pages using server-side templates.

| Method | Path | Access | Purpose |
|---|---|---:|---|
| GET | `/` | Public | Landing page, or redirect to `/app` if authenticated |
| GET | `/login` | Public | Google sign-in entry page |
| GET | `/auth/google` | Public | Start Google OAuth flow |
| GET | `/auth/google/callback` | Public | Google OAuth callback |
| POST | `/logout` | Auth | End authenticated session |
| POST | `/locale` | Public/Auth | Switch locale cookie; if authenticated, may also persist preference |
| GET | `/app` | Auth | Dashboard with projects, invites, recent activity |
| GET | `/inbox` | Auth | Invite inbox and in-app notifications |
| GET | `/settings/profile` | Auth | Username/profile settings |
| GET | `/settings/preferences` | Auth | Locale and user preferences |
| GET | `/projects/new` | Auth | New project page/form |
| GET | `/projects/:projectId` | Member | Project workspace |
| GET | `/projects/:projectId/members` | Member | Project members and role view |
| GET | `/projects/:projectId/activity` | Member | Project activity feed |
| GET | `/projects/:projectId/audit` | Owner | Project audit log |
| GET | `/projects/:projectId/characters` | Member | Character registry and metrics |
| GET | `/projects/:projectId/locations` | Member | Location registry and metrics |
| GET | `/projects/:projectId/settings` | Owner | Project settings |
| GET | `/projects/:projectId/scripts/new` | Editor+ | New script page/form |
| GET | `/projects/:projectId/scripts/:scriptId` | Member | Script overview, metadata, outline |
| GET | `/projects/:projectId/scripts/:scriptId/editor` | Member | Screenplay editor shell; reviewer is read-only |

### SSR route notes

- `/projects/:projectId/scripts/:scriptId/editor` renders the editor shell only. The full collaborative editor behavior is layered on top with browser JS and WebSockets.
- `/locale` must work for both anonymous and authenticated users.
- `/app` is the authenticated landing surface after login.

---

## JSON API routes

These routes return JSON and should be treated as the main durable command/read API for the application.

---

### Account, session, and invites

| Method | Path | Access | Purpose |
|---|---|---:|---|
| GET | `/api/v1/me` | Auth | Current user/session bootstrap |
| PATCH | `/api/v1/me` | Auth | Update profile fields such as username |
| PATCH | `/api/v1/me/preferences` | Auth | Persist locale and user preferences |
| GET | `/api/v1/users/search?q=` | Auth | Search existing users by username or email |
| GET | `/api/v1/invites` | Auth | List current user invites |
| POST | `/api/v1/invites/:inviteId/accept` | Auth | Accept an invite |
| POST | `/api/v1/invites/:inviteId/decline` | Auth | Decline an invite |

---

### Projects, members, activity, audit

| Method | Path | Access | Purpose |
|---|---|---:|---|
| GET | `/api/v1/projects` | Auth | List current user projects |
| POST | `/api/v1/projects` | Auth | Create project |
| GET | `/api/v1/projects/:projectId` | Member | Project detail read model |
| PATCH | `/api/v1/projects/:projectId` | Owner | Update project title/settings |
| GET | `/api/v1/projects/:projectId/members` | Member | List members and roles |
| POST | `/api/v1/projects/:projectId/invites` | Owner | Invite an existing platform user |
| PATCH | `/api/v1/projects/:projectId/members/:memberId` | Owner | Change member role |
| DELETE | `/api/v1/projects/:projectId/members/:memberId` | Owner | Remove member |
| POST | `/api/v1/projects/:projectId/ownership-transfer` | Owner | Transfer ownership |
| GET | `/api/v1/projects/:projectId/activity` | Member | Activity feed JSON |
| GET | `/api/v1/projects/:projectId/audit` | Owner | Audit log JSON |

---

### Scripts, outline, scenes

| Method | Path | Access | Purpose |
|---|---|---:|---|
| GET | `/api/v1/projects/:projectId/scripts` | Member | List scripts in a project |
| POST | `/api/v1/projects/:projectId/scripts` | Editor+ | Create script |
| GET | `/api/v1/projects/:projectId/scripts/:scriptId` | Member | Script detail read model |
| PATCH | `/api/v1/projects/:projectId/scripts/:scriptId` | Editor+ | Update script metadata |
| DELETE | `/api/v1/projects/:projectId/scripts/:scriptId` | Owner | Delete script |
| PATCH | `/api/v1/projects/:projectId/scripts/:scriptId/scene-numbering` | Editor+ | Set scene numbering mode |
| GET | `/api/v1/projects/:projectId/scripts/:scriptId/outline` | Member | Ordered act/beat/scene outline |
| POST | `/api/v1/projects/:projectId/scripts/:scriptId/outline/nodes` | Editor+ | Create act, beat, or scene node |
| PATCH | `/api/v1/projects/:projectId/scripts/:scriptId/outline/nodes/:nodeId` | Editor+ | Update outline node metadata |
| POST | `/api/v1/projects/:projectId/scripts/:scriptId/outline/nodes/:nodeId/move` | Editor+ | Move/reorder outline node |
| DELETE | `/api/v1/projects/:projectId/scripts/:scriptId/outline/nodes/:nodeId` | Editor+ | Delete outline node |
| GET | `/api/v1/projects/:projectId/scripts/:scriptId/scenes/:sceneId` | Member | Scene bootstrap with current head and metadata |
| PATCH | `/api/v1/projects/:projectId/scripts/:scriptId/scenes/:sceneId` | Editor+ | Update scene metadata only |
| PUT | `/api/v1/projects/:projectId/scripts/:scriptId/scenes/:sceneId/head` | Editor+ | Persist the current scene head draft |
| GET | `/api/v1/projects/:projectId/scripts/:scriptId/scenes/:sceneId/versions` | Member | Scene version list |
| GET | `/api/v1/projects/:projectId/scripts/:scriptId/scenes/:sceneId/versions/:versionId` | Member | Scene version detail |
| POST | `/api/v1/projects/:projectId/scripts/:scriptId/scenes/:sceneId/versions/major-save` | Editor+ | Create scene major save |
| POST | `/api/v1/projects/:projectId/scripts/:scriptId/scenes/:sceneId/versions/:versionId/restore` | Editor+ | Restore scene version as new head |
| POST | `/api/v1/projects/:projectId/scripts/:scriptId/scenes/:sceneId/diff` | Member | Compute default or arbitrary version diff |

---

### Notes, entities, metrics, export

| Method | Path | Access | Purpose |
|---|---|---:|---|
| GET | `/api/v1/projects/:projectId/notes` | Member | List notes by scope/filter |
| POST | `/api/v1/projects/:projectId/notes` | Member | Create standalone or anchored note |
| GET | `/api/v1/projects/:projectId/notes/:noteId` | Member | Note detail |
| PATCH | `/api/v1/projects/:projectId/notes/:noteId` | Member* | Update note |
| DELETE | `/api/v1/projects/:projectId/notes/:noteId` | Member* | Delete note |
| PUT | `/api/v1/projects/:projectId/notes/:noteId/head` | Member* | Persist the current note head draft |
| GET | `/api/v1/projects/:projectId/notes/:noteId/versions` | Member | Note version list |
| POST | `/api/v1/projects/:projectId/notes/:noteId/versions/major-save` | Member* | Create note major save |
| POST | `/api/v1/projects/:projectId/notes/:noteId/versions/:versionId/restore` | Member* | Restore note version |
| POST | `/api/v1/projects/:projectId/notes/:noteId/diff` | Member | Compute note diff |
| GET | `/api/v1/projects/:projectId/entities?type=character|location` | Member | Entity registry view |
| POST | `/api/v1/projects/:projectId/entities` | Editor+ | Create entity manually |
| PATCH | `/api/v1/projects/:projectId/entities/:entityId` | Editor+ | Update canonical name or aliases |
| POST | `/api/v1/projects/:projectId/entities/:entityId/merge` | Editor+ | Merge alias into canonical entity |
| GET | `/api/v1/projects/:projectId/metrics/characters` | Member | Character metrics for latest draft |
| GET | `/api/v1/projects/:projectId/metrics/locations` | Member | Location metrics for latest draft |
| POST | `/api/v1/projects/:projectId/scripts/:scriptId/exports/pdf` | Member | Stream on-demand PDF export |

### API route notes

- `POST /api/v1/projects/:projectId/scripts/:scriptId/exports/pdf` is the single canonical export entry point. The export payload should later distinguish:
  - full script export
  - selected acts/scenes export
  - standard US Letter export
  - 9:16 export
- Scene body content realtime sync is not represented as generic scene `PATCH` requests. That belongs to the collaborative document layer.

---

## HTML fragment routes

These routes return partial HTML for dynamic UI updates in a no-React application.

| Method | Path | Access | Purpose |
|---|---|---:|---|
| GET | `/fragments/inbox/invites` | Auth | Invite list partial |
| GET | `/fragments/projects/:projectId/activity-feed` | Member | Activity feed partial |
| GET | `/fragments/projects/:projectId/members/list` | Member | Members list partial |
| GET | `/fragments/projects/:projectId/scripts/:scriptId/outline-tree` | Member | Outline sidebar partial |
| GET | `/fragments/projects/:projectId/scripts/:scriptId/notes-panel` | Member | Notes sidebar partial |
| GET | `/fragments/projects/:projectId/scripts/:scriptId/version-sidebar` | Member | Version list and diff sidebar partial |

### Fragment route notes

- These routes are useful for HTMX-style or fetch-and-swap patterns.
- They should render from the same source templates/partials used in SSR pages when possible.
- They should never bypass permission checks.

---

## Operations routes

| Method | Path | Access | Purpose |
|---|---|---:|---|
| GET | `/healthz` | Public | Process health |
| GET | `/readyz` | Public | App readiness, including DB connectivity |

### Ops route notes

- `/healthz` should report whether the process is responsive.
- `/readyz` should fail if MongoDB is not connected or the app cannot serve requests safely.

---

## Route behavior expectations

### Authentication

- All authenticated routes must use the same session/auth mechanism.
- Route guards must behave consistently across:
  - SSR pages
  - API routes
  - fragment routes
  - WebSocket namespace access

### Authorization

Route handlers that work with a project should load membership and enforce role checks using shared middleware/helpers.

Recommended middleware layers:

- `requireAuth`
- `loadProjectMembership`
- `requireProjectRole`

### Localization

- All page routes should render using the active locale.
- `/locale` should support changing locale for anonymous and signed-in users.
- If signed in, locale should also be persistable through `/api/v1/me/preferences`.

### Error handling

- SSR routes should render user-safe error pages.
- API routes should return safe JSON error envelopes.
- Fragment routes should return partial-safe error states.
- Permission failures should not leak private project existence.

---

## Relationship to WebSockets

The HTTP route map is intentionally paired with a separate WebSocket contract.

### HTTP responsibilities

HTTP owns:

- project and script CRUD
- invite and membership changes
- outline mutations
- note CRUD
- versioning operations
- diffs
- exports
- entity and metrics reads
- audit/activity reads

### WebSocket responsibilities

WebSockets own:

- connection auth
- room join/leave
- presence
- future scene and note sync
- awareness/cursors
- fan-out notifications after durable HTTP writes

### Broadcast model

After a durable HTTP mutation commits, the server should emit the corresponding WebSocket event to affected rooms. The HTTP route remains the system of record.

---

## Suggested implementation grouping

This grouping is recommended for route modules:

### Web route groups
- auth
- locale
- app/dashboard
- inbox
- settings
- projects
- scripts

### API route groups
- me
- users
- invites
- projects
- members
- activity
- audit
- scripts
- outline
- scenes
- notes
- entities
- metrics
- exports

### Fragment route groups
- inbox
- activity
- members
- outline
- notes
- versions

---

## Future extensions intentionally not included in v1 route map

These may be added later, but should not be assumed in foundation work:

- email notification routes
- public sharing links
- import/export for Fountain or FDX
- comment threads separate from notes
- billing/subscription routes
- org/team administration above project level

---

## Summary

Courier Draft route design follows these principles:

1. SSR for navigation and shell
2. JSON API for durable commands and read models
3. fragment routes for no-React dynamic UI
4. WebSockets for presence and live collaboration
5. shared auth and authz across all surfaces
6. HTTP remains the source of truth for durable project state

This document should be used as the baseline reference when scaffolding routes, middleware, controllers, and tests.

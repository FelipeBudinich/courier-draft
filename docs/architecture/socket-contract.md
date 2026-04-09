# Courier Draft WebSocket Contract

Status: Foundation scaffolding implemented for E1 + E12  
Scope: v1 foundation  
Audience: developers, coding agents, reviewers

Foundation implementation note:

- `/collab` is implemented with shared session auth, room helpers, presence updates, and placeholder Yjs handlers.
- Full collaborative syncing and multi-node fan-out are intentionally deferred to later epics.

## Purpose

This document defines the WebSocket contract for Courier Draft.

It is the canonical reference for:

- Socket.IO namespace structure
- authentication and room membership
- presence semantics
- realtime scene and note transport boundaries
- event names
- payload shape conventions
- acknowledgement envelopes
- the relationship between WebSockets and durable HTTP writes

This document does **not** define the full collaborative editor implementation. It defines the contract agents should follow when scaffolding and extending realtime behavior.

---

## Architectural role

Courier Draft uses WebSockets for realtime collaboration concerns that are not well-suited to plain request/response flows.

### WebSockets are responsible for

- authenticated connection establishment
- room join and leave
- presence
- live awareness
- future Yjs document sync for scenes and notes
- server fan-out after durable HTTP writes commit

### WebSockets are not the source of truth for durable state

Durable project mutations should remain HTTP-first.

Examples of durable HTTP mutations:

- create/update/delete project data
- invites and membership changes
- outline mutations
- script metadata updates
- note CRUD
- major save and restore
- diff requests
- export requests
- entity/metrics operations

WebSockets may later carry high-frequency collaborative document updates for current head editing, but major saves, restores, and other canonical state transitions still need durable server-side handling.

---

## Transport basics

| Item | Contract |
|---|---|
| Library | Socket.IO |
| Namespace | `/collab` |
| Auth | Session-based, validated in namespace middleware |
| Auto-joined room | `user:{userId}` |
| Project room | `project:{projectId}` |
| Script room | `script:{scriptId}` |
| Scene room | `scene:{sceneId}` |
| Note room | `note:{noteId}` |
| Time format | ISO 8601 UTC string |
| Acknowledgement | Standard success/failure envelope |
| Binary sync payloads | `ArrayBuffer` or equivalent binary payload over Socket.IO |
| Error model | Small fixed error code set |

---

## Namespace

All Courier Draft realtime collaboration traffic should use a single namespace:

`/collab`

This keeps:

- authentication centralized
- room behavior predictable
- future editor sync isolated from unrelated sockets

---

## Authentication

### Connection requirements

A socket connection to `/collab` must:

- use the same session/auth mechanism as the Express app
- reject unauthenticated users
- resolve the current user identity before joining any project/script/scene/note room

### Namespace middleware responsibilities

The namespace middleware should:

1. read the session
2. verify that the session is authenticated
3. resolve the current user
4. attach a normalized user identity to the socket context
5. automatically join the socket to `user:{userId}`

### Failure behavior

If authentication fails, the connection should be rejected with a safe error.

Recommended error code:

- `AUTH_REQUIRED`

---

## Room model

### User room

Every authenticated socket should automatically join:

`user:{userId}`

This room is used for user-targeted events such as:

- invite created
- invite updated
- permission changed
- project access revoked

### Project room

A client joins a project room after explicit request:

`project:{projectId}`

This room is used for:

- project-level presence
- activity fan-out
- broad project notifications

Joining a project room requires project membership.

### Script room

A client joins a script room after explicit request:

`script:{scriptId}`

This room is used for:

- script-level presence
- outline change fan-out
- script metadata updates

Joining a script room requires membership in the parent project.

### Scene room

A client joins a scene room after explicit request:

`scene:{sceneId}`

This room is used for:

- scene editing presence
- scene awareness/cursors
- future scene Yjs sync
- scene version broadcast events

Joining a scene room requires project membership. Edit permissions are tracked separately from room membership.

### Note room

A client joins a note room after explicit request:

`note:{noteId}`

This room is used for:

- note editing presence
- note awareness
- future note Yjs sync
- note version events

Joining a note room requires project membership and access to the note scope.

---

## Access and authorization rules

### Membership before room join

Before a socket joins any project/script/scene/note room, the server must verify:

- the user is authenticated
- the user has access to the relevant project
- the requested script/scene/note belongs to that project

### Read access vs edit access

Room membership does not automatically imply edit permission.

For example:
- a reviewer may join a scene room in read-only mode
- an editor may join the same room with edit capability

The join acknowledgement should explicitly indicate whether the user can edit.

### Permission changes during a live session

If a user’s role changes or access is revoked while connected:

- the server must notify the user through the `user:{userId}` room
- the socket should be removed from rooms it no longer has access to
- the client should update UI or disconnect from affected editor surfaces

---

## Acknowledgement envelope

All ack-based client-to-server events should use a standard envelope.

### Success

```json
{
  "ok": true,
  "data": {}
}
````

### Failure

```json
{
  "ok": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have access to this project."
  }
}
```

### Error fields

| Field     | Meaning                              |
| --------- | ------------------------------------ |
| `code`    | Stable machine-readable error code   |
| `message` | User-safe explanation                |
| `details` | Optional structured debugging detail |

---

## Standard error codes

Use this fixed set unless there is a strong reason to extend it:

* `AUTH_REQUIRED`
* `FORBIDDEN`
* `NOT_FOUND`
* `INVALID_PAYLOAD`
* `CONFLICT`
* `STALE_STATE`
* `RATE_LIMITED`
* `SERVER_ERROR`

---

## Connection lifecycle

### Typical client flow

1. Client connects to `/collab`
2. Server authenticates session
3. Server auto-joins `user:{userId}`
4. Client emits `project:join`
5. Client emits `script:join` if inside a script
6. Client emits `scene:join` and/or `note:join` for active panels
7. Client emits presence updates
8. Client exchanges future Yjs sync and awareness payloads where applicable

### Disconnect behavior

On disconnect:

* the user should be removed from relevant presence maps
* project/script/scene/note presence updates should be broadcast as needed
* ephemeral view state should expire automatically

---

## Client-to-server events

These are the canonical client-emitted event names.

---

### `project:join`

Join a project room and initialize project-level presence.

#### Payload

```json
{
  "projectId": "prj_123"
}
```

#### Server responsibilities

* validate payload
* verify project membership
* join `project:{projectId}`
* return project role and presence snapshot

#### Ack success shape

```json
{
  "ok": true,
  "data": {
    "projectId": "prj_123",
    "role": "editor",
    "presence": [],
    "serverTime": "2026-04-09T12:00:00.000Z"
  }
}
```

---

### `project:leave`

Leave a project room.

#### Payload

```json
{
  "projectId": "prj_123"
}
```

#### Server responsibilities

* leave project room
* leave child rooms associated with that project if appropriate
* update presence

---

### `script:join`

Join a script room.

#### Payload

```json
{
  "projectId": "prj_123",
  "scriptId": "scr_123"
}
```

#### Server responsibilities

* verify project membership
* verify script belongs to the project
* join `script:{scriptId}`
* return script-level metadata useful for the shell

#### Ack success shape

```json
{
  "ok": true,
  "data": {
    "projectId": "prj_123",
    "scriptId": "scr_123",
    "sceneNumberMode": "auto",
    "activeUsers": []
  }
}
```

---

### `script:leave`

Leave a script room.

#### Payload

```json
{
  "projectId": "prj_123",
  "scriptId": "scr_123"
}
```

---

### `scene:join`

Join a scene room.

#### Payload

```json
{
  "projectId": "prj_123",
  "scriptId": "scr_123",
  "sceneId": "scn_123"
}
```

#### Server responsibilities

* verify project membership
* verify script and scene relationship
* determine whether the current user can edit
* join `scene:{sceneId}`

#### Ack success shape

```json
{
  "ok": true,
  "data": {
    "sceneId": "scn_123",
    "canEdit": true,
    "latestMajorVersionId": "ver_100",
    "headUpdatedAt": "2026-04-09T12:00:00.000Z"
  }
}
```

---

### `scene:leave`

Leave a scene room.

#### Payload

```json
{
  "sceneId": "scn_123"
}
```

---

### `note:join`

Join a note room.

#### Payload

```json
{
  "projectId": "prj_123",
  "noteId": "note_123"
}
```

#### Server responsibilities

* verify project membership
* verify note visibility for the current user
* determine whether the user can edit the note
* join `note:{noteId}`

#### Ack success shape

```json
{
  "ok": true,
  "data": {
    "noteId": "note_123",
    "canEdit": true,
    "latestMajorVersionId": "ver_200",
    "headUpdatedAt": "2026-04-09T12:00:00.000Z",
    "isDetached": false
  }
}
```

---

### `note:leave`

Leave a note room.

#### Payload

```json
{
  "noteId": "note_123"
}
```

---

### `presence:set-view`

Set ephemeral view state for presence.

#### Payload

```json
{
  "projectId": "prj_123",
  "scriptId": "scr_123",
  "sceneId": "scn_123",
  "noteId": null,
  "mode": "editing"
}
```

### Allowed `mode` values

* `viewing`
* `editing`
* `idle`

#### Notes

* This is ephemeral only.
* This should not create durable project activity.
* The server may coalesce or rate-limit frequent presence updates.

---

### `scene:yjs-sync`

Future Yjs sync handshake/update for scene documents.

#### Payload

```json
{
  "sceneId": "scn_123",
  "payload": "<binary>"
}
```

#### Notes

* Reserve this event now even if full Yjs sync is not implemented yet.
* Payload is intended to be binary.

---

### `scene:yjs-update`

Future incremental Yjs update for scene documents.

#### Payload

```json
{
  "sceneId": "scn_123",
  "payload": "<binary>"
}
```

---

### `scene:yjs-awareness`

Future awareness payload for scene documents.

#### Payload

```json
{
  "sceneId": "scn_123",
  "payload": "<binary>"
}
```

---

### `note:yjs-sync`

Future Yjs sync handshake/update for note documents.

#### Payload

```json
{
  "noteId": "note_123",
  "payload": "<binary>"
}
```

---

### `note:yjs-update`

Future incremental Yjs update for note documents.

#### Payload

```json
{
  "noteId": "note_123",
  "payload": "<binary>"
}
```

---

### `note:yjs-awareness`

Future awareness payload for note documents.

#### Payload

```json
{
  "noteId": "note_123",
  "payload": "<binary>"
}
```

---

## Server-to-client events

These are the canonical server-emitted event names.

---

### Join confirmations

#### `project:joined`

Sent to the requesting socket after successful `project:join`.

```json
{
  "projectId": "prj_123",
  "role": "editor",
  "presence": [],
  "serverTime": "2026-04-09T12:00:00.000Z"
}
```

#### `script:joined`

Sent to the requesting socket after successful `script:join`.

```json
{
  "projectId": "prj_123",
  "scriptId": "scr_123",
  "sceneNumberMode": "auto",
  "activeUsers": []
}
```

#### `scene:joined`

Sent to the requesting socket after successful `scene:join`.

```json
{
  "sceneId": "scn_123",
  "canEdit": true,
  "latestMajorVersionId": "ver_100",
  "headUpdatedAt": "2026-04-09T12:00:00.000Z"
}
```

#### `note:joined`

Sent to the requesting socket after successful `note:join`.

```json
{
  "noteId": "note_123",
  "canEdit": true,
  "latestMajorVersionId": "ver_200",
  "headUpdatedAt": "2026-04-09T12:00:00.000Z",
  "isDetached": false
}
```

---

### Presence events

#### `presence:snapshot`

Initial presence state for the requesting client.

```json
{
  "projectId": "prj_123",
  "users": []
}
```

#### `presence:user-joined`

Broadcast when a user becomes present in a project room.

```json
{
  "userId": "usr_123",
  "username": "ana",
  "displayName": "Ana",
  "view": {
    "projectId": "prj_123",
    "scriptId": "scr_123",
    "sceneId": null,
    "noteId": null,
    "mode": "viewing"
  }
}
```

#### `presence:user-left`

Broadcast when a user disconnects or leaves the project.

```json
{
  "userId": "usr_123"
}
```

#### `presence:view-changed`

Broadcast when a user changes their current view state.

```json
{
  "userId": "usr_123",
  "projectId": "prj_123",
  "scriptId": "scr_123",
  "sceneId": "scn_123",
  "noteId": null,
  "mode": "editing"
}
```

---

### Outline and script events

#### `outline:changed`

Broadcast after a durable outline mutation commits over HTTP.

This event should carry a delta payload.

```json
{
  "projectId": "prj_123",
  "scriptId": "scr_123",
  "op": "created",
  "revision": 42,
  "actor": {
    "userId": "usr_123",
    "username": "ana"
  },
  "node": {
    "id": "node_123",
    "type": "scene",
    "title": "INT. KITCHEN - DAY",
    "placementParentId": "act_1",
    "positionKey": "aV",
    "sceneId": "scn_123",
    "actId": "act_1",
    "beatId": null,
    "autoSceneNumber": "12",
    "manualSceneNumber": null
  },
  "ts": "2026-04-09T12:00:00.000Z"
}
```

Allowed `op` values should include at least:

* `created`
* `updated`
* `moved`
* `deleted`
* `renumbered`

#### `script:updated`

Broadcast after script metadata changes commit over HTTP.

```json
{
  "scriptId": "scr_123",
  "changedFields": ["title", "status"],
  "actor": {
    "userId": "usr_123",
    "username": "ana"
  },
  "ts": "2026-04-09T12:00:00.000Z"
}
```

---

### Scene persistence and versioning events

#### `scene:head-persisted`

Broadcast when current head/autosave state is durably flushed.

```json
{
  "sceneId": "scn_123",
  "persistedAt": "2026-04-09T12:00:00.000Z",
  "latestHeadRevision": 17
}
```

#### `scene:version-created`

Broadcast after a scene major save commits.

```json
{
  "sceneId": "scn_123",
  "versionId": "ver_456",
  "versionLabel": "1.2.4.7",
  "actor": {
    "userId": "usr_123",
    "username": "ana"
  },
  "ts": "2026-04-09T12:00:00.000Z"
}
```

#### `scene:version-restored`

Broadcast after a scene restore operation commits.

```json
{
  "sceneId": "scn_123",
  "restoredFromVersionId": "ver_123",
  "newHeadVersionId": "ver_999",
  "actor": {
    "userId": "usr_123",
    "username": "ana"
  },
  "ts": "2026-04-09T12:00:00.000Z"
}
```

---

### Note persistence and versioning events

#### `note:head-persisted`

Broadcast when a note current head/autosave state is durably flushed.

```json
{
  "noteId": "note_123",
  "persistedAt": "2026-04-09T12:00:00.000Z",
  "latestHeadRevision": 12
}
```

#### `note:version-created`

Broadcast after a note major save commits.

```json
{
  "noteId": "note_123",
  "versionId": "ver_555",
  "actor": {
    "userId": "usr_123",
    "username": "ana"
  },
  "ts": "2026-04-09T12:00:00.000Z"
}
```

#### `note:version-restored`

Broadcast after a note restore operation commits.

```json
{
  "noteId": "note_123",
  "restoredFromVersionId": "ver_111",
  "newHeadVersionId": "ver_777",
  "actor": {
    "userId": "usr_123",
    "username": "ana"
  },
  "ts": "2026-04-09T12:00:00.000Z"
}
```

---

### Note lifecycle events

#### `note:created`

Broadcast after a note is created through HTTP.

```json
{
  "noteId": "note_123",
  "projectId": "prj_123",
  "scriptId": "scr_123",
  "containerType": "scene",
  "containerId": "scn_123",
  "author": {
    "userId": "usr_123",
    "username": "ana"
  },
  "ts": "2026-04-09T12:00:00.000Z"
}
```

#### `note:updated`

Broadcast after note metadata changes commit through HTTP.

```json
{
  "noteId": "note_123",
  "projectId": "prj_123",
  "updatedFields": ["text"],
  "actor": {
    "userId": "usr_123",
    "username": "ana"
  },
  "ts": "2026-04-09T12:00:00.000Z"
}
```

#### `note:deleted`

Broadcast after note deletion.

```json
{
  "noteId": "note_123",
  "actor": {
    "userId": "usr_123",
    "username": "ana"
  },
  "ts": "2026-04-09T12:00:00.000Z"
}
```

#### `note:anchor-detached`

Broadcast if an anchored note can no longer be mapped to scene text.

```json
{
  "noteId": "note_123",
  "sceneId": "scn_123",
  "previousAnchor": {
    "blockId": "blk_1"
  },
  "ts": "2026-04-09T12:00:00.000Z"
}
```

---

### Invite, permission, and access events

#### `invite:created`

Sent to a user room when the user is invited.

```json
{
  "inviteId": "inv_123",
  "projectId": "prj_123",
  "projectTitle": "Courier Draft Pilot",
  "role": "reviewer",
  "invitedBy": {
    "userId": "usr_555",
    "username": "owner"
  },
  "ts": "2026-04-09T12:00:00.000Z"
}
```

#### `invite:updated`

Sent to the relevant user room when invite state changes.

```json
{
  "inviteId": "inv_123",
  "status": "accepted",
  "projectId": "prj_123",
  "ts": "2026-04-09T12:00:00.000Z"
}
```

#### `permission:changed`

Sent to a user room when a project role changes.

```json
{
  "projectId": "prj_123",
  "newRole": "editor",
  "ts": "2026-04-09T12:00:00.000Z"
}
```

#### `project:access-revoked`

Sent to a user room when project access is removed.

```json
{
  "projectId": "prj_123",
  "reason": "member_removed",
  "ts": "2026-04-09T12:00:00.000Z"
}
```

---

### Activity fan-out

#### `activity:new`

Broadcast after any activity-feed-worthy mutation commits.

```json
{
  "activityId": "act_123",
  "projectId": "prj_123",
  "scriptId": "scr_123",
  "type": "scene.major_saved",
  "actor": {
    "userId": "usr_123",
    "username": "ana"
  },
  "targetType": "scene",
  "targetId": "scn_123",
  "ts": "2026-04-09T12:00:00.000Z"
}
```

---

### Async server errors

#### `server:error`

Sent when an asynchronous socket operation fails outside a normal ack path.

```json
{
  "code": "SERVER_ERROR",
  "message": "Unexpected collaboration transport error."
}
```

---

## Presence model

Presence is ephemeral.

It should not be persisted as canonical durable project state.

### Presence state fields

| Field       | Meaning                         |
| ----------- | ------------------------------- |
| `projectId` | Current project context         |
| `scriptId`  | Current script context, if any  |
| `sceneId`   | Current scene context, if any   |
| `noteId`    | Current note context, if any    |
| `mode`      | `viewing`, `editing`, or `idle` |

### Presence expectations

* A user may be present in a project without actively editing.
* A user may be in a script room but not in a scene room.
* A reviewer may be present in `editing` mode for a note even if they cannot edit screenplay content.
* Presence should expire automatically after disconnect or timeout.

---

## Mapping from HTTP mutations to WebSocket broadcasts

The HTTP route remains the source of truth. After a durable mutation commits, the server should emit corresponding events.

| HTTP mutation                              | WebSocket broadcast                                              |
| ------------------------------------------ | ---------------------------------------------------------------- |
| invite created                             | `invite:created`, `activity:new`                                 |
| invite accepted/declined                   | `invite:updated`, `activity:new`                                 |
| role changed                               | `permission:changed`, `activity:new`                             |
| member removed                             | `project:access-revoked`, `activity:new`                         |
| ownership transferred                      | `permission:changed`, `activity:new`                             |
| script metadata updated                    | `script:updated`, `activity:new`                                 |
| outline node created/updated/moved/deleted | `outline:changed`, `activity:new`                                |
| note created/updated/deleted               | `note:created` / `note:updated` / `note:deleted`, `activity:new` |
| scene major save                           | `scene:version-created`, `activity:new`                          |
| scene restore                              | `scene:version-restored`, `activity:new`                         |
| note major save                            | `note:version-created`, `activity:new`                           |
| note restore                               | `note:version-restored`, `activity:new`                          |
| export created                             | `activity:new`                                                   |

---

## Validation expectations

All client-emitted events should validate payload shape before doing any work.

Validation should reject:

* missing required IDs
* malformed payloads
* mismatched project/script/scene relationships
* requests for resources outside the user’s membership scope
* unsupported enum values

Recommended error code:

* `INVALID_PAYLOAD`

---

## Logging expectations

The socket layer should log at least:

* connection established
* auth success/failure
* room join success/failure
* permission denial
* disconnect
* unexpected handler errors

Log entries should include:

* request or connection ID if available
* user ID where resolved
* event name
* relevant resource IDs

Do not log raw sensitive payloads unless explicitly safe.

---

## Testing expectations

The following should be covered in foundation tests:

* unauthenticated socket connection is rejected
* authenticated socket auto-joins user room
* project join succeeds for members and fails for non-members
* scene join returns `canEdit` correctly by role
* presence updates broadcast correctly
* permission changes can revoke room access
* malformed payloads return `INVALID_PAYLOAD`

---

## Future extensions intentionally reserved

These are reserved but not fully implemented by this contract:

* full Yjs scene sync
* full Yjs note sync
* conflict-resolution semantics beyond Yjs layer
* collaborative outline editing over sockets rather than HTTP
* typing indicators separate from presence
* mention notifications over sockets
* background job progress channels

---

## Summary

Courier Draft WebSocket design follows these rules:

1. one authenticated Socket.IO namespace: `/collab`
2. one auto-joined user room per connection
3. explicit project/script/scene/note room joins
4. HTTP remains the durable source of truth
5. WebSockets handle presence, awareness, and fan-out
6. shared auth and authz rules apply to socket joins
7. stable event names and ack envelopes are mandatory

This document should be used as the baseline reference when implementing socket middleware, room helpers, event handlers, tests, and future realtime collaboration layers.

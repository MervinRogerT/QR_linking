# Sealine — 1:1 Chat & Group Permissions (full-stack demo)

Two flows, kept fully separate, backed by a real Express server:

1. **New Chat** — tap any synced contact to start or reopen a 1:1 chat.
2. **Group Info** — visible to every member, but *settings changes are
   restricted to the group Owner/Admin*, and that restriction is enforced by
   the backend, not just hidden in the UI.

## Why this is a "real" permission model, not a UI trick

Every write endpoint re-checks the requester's actual role, stored server-side,
before doing anything:

```
requireUser        → is there a valid logged-in user at all? (401 if not)
requireGroupMember  → is this user actually in the group? (403 if not)
requireGroupAdmin   → is this user's *stored* role owner/admin? (403 if not)
canManageMember()   → owner can never be touched; only the owner can
                       demote/remove another admin; owner/admin can manage
                       regular members
```

A malicious or buggy client can send any request it wants (skip the UI
entirely, edit `fetch` calls in devtools, etc.) — the server will still
reject anything the caller's role doesn't permit. `public/app.js` reads a
`canEditSettings` flag from the server purely to decide what to *show*; it is
never trusted for the actual write, which is checked again on the server.

## Run it

```bash
npm install
npm start          # http://localhost:3001
```

Open `http://localhost:3001` in a browser. Use the "Logged in as" dropdown in
the top bar to switch between users (Samson S. is the group owner, Arjun
Mehta is admin, the rest are regular members; Priya Sharma is a DM-only
contact outside the group) and watch the Group Info panel change what it
lets you do.

## Prove it: automated backend test

```bash
npm start            # in one terminal
npm test             # in another — hits the live API as different users
```

`test/run-tests.js` calls the API directly (no browser involved) as several
different users and asserts the exact status codes a permission system
should return — e.g. a regular member gets `403` trying to change group
settings, an admin gets `200`, nobody but the owner can demote a fellow
admin, and the owner can never be removed. All 25 checks currently pass.

## API summary

| Method | Path | Who |
|---|---|---|
| GET | `/api/users` | anyone |
| GET | `/api/chats` | logged in |
| POST | `/api/dm/start` | logged in |
| GET/POST | `/api/dm/:chatId/messages` | DM participants only |
| GET | `/api/groups/:id` | group members only |
| GET/POST | `/api/groups/:id/messages` | group members (send blocked if group is admins-only and you're a member) |
| PATCH | `/api/groups/:id/settings` | owner/admin only |
| PATCH | `/api/groups/:id/name` | owner/admin only |
| POST | `/api/groups/:id/members/:id/promote` | owner/admin, can't target owner |
| POST | `/api/groups/:id/members/:id/demote` | owner only, target must be admin |
| DELETE | `/api/groups/:id/members/:id` | owner/admin, can't remove owner or (if you're admin) another admin |

Auth is simulated with an `x-user-id` header instead of a real login system,
since the point of this demo is the authorization model, not authentication —
swap in real sessions/JWTs and the permission logic underneath is unchanged.

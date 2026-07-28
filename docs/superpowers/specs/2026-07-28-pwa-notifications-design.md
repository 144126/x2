# PWA + Notifications — design

Date: 2026-07-28
Status: approved, pre-implementation

## Problem

`ws/src/hub.ts:134` drops messages for any user with no live WebSocket:

```
[HUB-DELIVER] NO SOCKETS FOUND for uid=… — message dropped!
```

An offline or backgrounded user learns about a message only by reloading `/app`. Nothing
in the repo installs, caches, or notifies: no manifest, no service worker, no
`PushManager`, no `Notification`, no icons past `static/logo.svg`.

Secondary defect: `src/app.html:5` omits `viewport-fit=cover`, so the
`env(safe-area-inset-bottom)` padding in `+layout.svelte:69` resolves to `0` and the bottom
nav sits under the iOS home indicator once installed.

## Scope

Full industry-standard surface: installability, offline shell, Web Push end-to-end, unread
counts with app badging, an offline outbox, and OS share-target integration.

No new npm dependencies. `web-push` needs Node crypto and does not run on Workers; VAPID and
`aes128gcm` are implemented directly on WebCrypto, which both Workers and Node 24 provide.

## Architecture

### Push trigger

`ws/src/index.ts:40` already fans a relay out to N hubs and collects per-hub statuses, then
throws them away. The hub's `/relay` starts reporting whether `deliver()` found a socket, the
worker aggregates that into `{ ok, undelivered: string[] }`, and `/api/send` pushes to exactly
that set. One round trip, no extra Durable Object calls, no check-then-send race.

```
POST /api/send
  └─ send_msg()                       → Qdrant
  └─ X2_WS /relay  ──────────────────→ ChatHub × N  → { undelivered: [uid…] }
  └─ push_to(env, undelivered, …)     → subs lookup → encrypt → push service
```

### Modules

| File | Responsibility |
|---|---|
| `src/lib/server/push.ts` | VAPID JWT (ES256), RFC 8291 ECDH + RFC 8188 `aes128gcm`, send, prune-on-410 |
| `src/lib/server/subs.ts` | Subscription records in Qdrant (`s:'ps'`), keyed by endpoint hash |
| `src/lib/server/unread.ts` | Read markers (`s:'rd'`), per-conversation and total unread |
| `src/lib/sw-core.ts` | Pure service-worker logic: cache routing, notification building, click targeting |
| `src/service-worker.ts` | Thin shim binding `sw-core` to `self` and the `$service-worker` module |
| `src/lib/push-client.ts` | Permission/subscription state machine, iOS gating, `pushsubscriptionchange` |
| `src/lib/install.ts` | `beforeinstallprompt` capture, dismissal memory, iOS manual hint |
| `src/lib/outbox.ts` | IndexedDB-backed send queue, drained by Background Sync |
| `src/lib/b64.ts` | `b64u`/`unb64u` moved out of `server/qdrant.ts` so the client can reuse them |

Both new payload types reuse payload indexes that `ensure()` already creates (`s`, `f`, `c`),
so no Qdrant index migration is required. `qdrant.ts` gains one missing primitive: `remove()`.

### Data

```ts
interface PushSub { s:'ps'; f:string; ep:string; k:string; au:string; ua?:string; d:number }
interface Read    { s:'rd'; f:string; c:string;  d:number }
```

`PushSub` id is `uuid_from(endpoint)` — re-subscribing the same device upserts rather than
duplicating. `Read` id is `read:<uid>:<conv>`, likewise upsert-by-construction.

## Behaviour

### Manifest

`id`, `name`, `short_name`, `description`, `start_url`, `scope`, `display`,
`display_override`, `background_color`, `theme_color` (`#0b0b0c`, matching `--color-base`),
`orientation`, `lang`, `dir`, `categories`, `launch_handler: navigate-existing`, icons
(192/512 `any`, 192/512 `maskable`, 96 `monochrome` badge), `screenshots` (one `wide`, one
`narrow` — Chrome requires both for the rich install dialog), `shortcuts` (people/rooms/
discover), and `share_target` POSTing to `/app/share`.

Icons are rasterized from `static/logo.svg` with inkscape; maskable variants carry the 20%
safe-zone padding the spec requires.

### Service worker

- **install** — precache `build` + `files` + `/offline`; do *not* `skipWaiting` (the update
  toast drives that).
- **activate** — drop caches whose name is not the current version, `clients.claim()`.
- **fetch** — bypass non-GET, `/api/*`, `/logout`, `/google`, cross-origin, and any request
  carrying a `Range` header (a 206 cannot be `cache.put`); immutable cache-first for hashed
  build assets and `/media/*`; network-first with an offline fallback for navigations.
- **push** — always shows a notification (the `userVisibleOnly` contract), falling back to a
  generic body if the payload fails to parse. `tag` is `x2:<conv>` so a thread collapses,
  `renotify` re-alerts, `data.url` targets the click, actions are inline `reply` and
  `mark-read`, and the payload's unread total drives `navigator.setAppBadge`.
- **notificationclick** — inline reply POSTs `/api/send` (queued to the outbox on failure);
  otherwise focus a client already on that conversation, else any client, else open a window.
- **pushsubscriptionchange** — re-subscribe with the same key and re-register with the server.
- **sync** (`x2-outbox`) — drain the outbox; throw to retry.

### Permission UX

Never prompt on load. A soft-ask in the profile page explains the value; only the explicit
toggle calls `Notification.requestPermission()`. `denied` shows recovery instructions and
never re-asks. On iOS the toggle is replaced by an install hint until
`display-mode: standalone` is true, since Safari only grants push to installed apps.

### Suppression

A push is not shown when a visible client is already focused on that conversation.

## Testing

Every unit above is pure or dependency-injected so it runs in the existing `environment:
'node'` vitest setup. The encryption path is proven against the RFC 8291 §5 vector — fixed
salt and application-server key in, byte-exact header framing and a round-trip decrypt out.
Manifest, `app.html`, and the icon set are asserted against disk, including PNG dimensions
read from the IHDR chunk, so a missing or mis-sized icon fails the suite.

## Deliberately excluded

Per-conversation mute, quiet hours, notification grouping beyond `tag`, and Periodic
Background Sync. All are additive later; none change the schema above.

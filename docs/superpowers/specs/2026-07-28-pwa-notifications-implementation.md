# PWA + Web Push — implementation plan

Status: N1/N2 done. Everything below is remaining work.

Companion docs: `2026-07-28-pwa-notifications-design.md` (why), `-plan.md` (node graph).
This doc is the *how*: exact signatures, types, behaviour, and the tests still missing.

---

## 0. Done

- **N1** `src/lib/b64.ts` — `b64u(buf: ArrayBuffer|Uint8Array): string`, `unb64u(s: string): Uint8Array`.
  Re-exported from `src/lib/server/qdrant.ts` so every existing caller is untouched.
  Imported by relative path (`../b64`) because `ws/` builds outside the `$lib` alias.
- **N2** `remove(env: QEnv, ids: string[]): Promise<void>` in `qdrant.ts` — no-op on `[]`,
  `.catch(() => {})` like its siblings.

---

## 1. `src/lib/server/push.ts` (N3) — VAPID + aes128gcm

Test file exists: `src/lib/server/__tests__/push.test.ts` (36 tests). No new tests needed.

```ts
export type PushKeys = { public: string; private: string; subject: string };
//  public  = base64url raw 65-byte P-256 point (what the browser gets)
//  private = the JWK `d` component, base64url
//  subject = 'mailto:…' or an https origin

export type WebPushSub = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushOpts = { ttl?: number; urgency?: 'very-low'|'low'|'normal'|'high'; topic?: string };
export type PushResult = { ok: boolean; status: number; gone: boolean };

export const MAX_PLAINTEXT = 4096 - 16 - 4 - 1 - 65 - 16 - 1; // 3993

export function encrypt_payload(
  sub: WebPushSub,
  plaintext: string,
  seed?: { salt: Uint8Array; as_private: Uint8Array; as_public: Uint8Array }
): Promise<Uint8Array>;

export function vapid_auth(keys: PushKeys, endpoint: string, now?: number): Promise<string>;
export function push_topic(conv: string): string;
export function clamp_payload(obj: Record<string, unknown>): string;
export function send_push(
  sub: WebPushSub, payload: string, keys: PushKeys,
  opts?: PushOpts, f?: typeof fetch
): Promise<PushResult>;
```

**`encrypt_payload`** — throws when `plaintext` (UTF-8 bytes) exceeds `MAX_PLAINTEXT`.
`seed` exists only so the RFC vector is reproducible; without it, generate a random
16-byte salt and a fresh P-256 ECDH pair per call.

Derivation, in order (all HMAC-SHA256, `cat` = concat, `ascii` = UTF-8 bytes):

```
ecdh    = ECDH(as_private, ua_public)                       // 32 bytes, deriveBits 256
PRK_key = HMAC(auth, ecdh)
IKM     = HMAC(PRK_key, "WebPush: info" ‖ 0x00 ‖ ua_pub(65) ‖ as_pub(65) ‖ 0x01)
PRK     = HMAC(salt, IKM)
CEK     = HMAC(PRK, "Content-Encoding: aes128gcm" ‖ 0x00 ‖ 0x01)[0..16]
NONCE   = HMAC(PRK, "Content-Encoding: nonce"     ‖ 0x00 ‖ 0x01)[0..12]
```

Body: `salt(16) ‖ rs(4 = 00 00 10 00) ‖ idlen(1 = 65) ‖ as_public(65) ‖ AESGCM(CEK,NONCE, plaintext ‖ 0x02)`.

Importing the ECDH private key: WebCrypto has no raw-private import, so build a JWK —
`{ kty:'EC', crv:'P-256', d: b64u(as_private), x: b64u(as_public.slice(1,33)), y: b64u(as_public.slice(33,65)), ext:true }`.

**`vapid_auth`** — `now` defaults to `Date.now()`. Header `{typ:'JWT',alg:'ES256'}`, claims
`{ aud: new URL(endpoint).origin, exp: Math.floor(now/1000) + 12*3600, sub: keys.subject }`.
Sign `${head}.${body}` with ECDSA/SHA-256 — WebCrypto already emits the raw 64-byte
(r‖s) form, so no DER unwrapping. Return `` `vapid t=${jwt},k=${keys.public}` ``.
Private key import: same JWK trick, `d = keys.private`, x/y from `keys.public`.

**`push_topic`** — must be sync (tests call it bare). Two 32-bit FNV-1a passes over the
string with different offset bases, hex-joined → 16 chars, `/^[A-Za-z0-9_-]+$/`, ≤32.

**`clamp_payload`** — `JSON.stringify(obj)`; if longer than `MAX_PLAINTEXT`, shrink
`obj.body` by binary search / by the overflow amount and append `'…'`; if it still
does not fit (an oversized non-body field), truncate that field too. Must always
return parseable JSON.

**`send_push`** — `f` defaults to `globalThis.fetch`. Headers:
`Content-Encoding: aes128gcm`, `Content-Type: application/octet-stream`,
`Content-Length`, `TTL: String(opts.ttl ?? 86400)`, `Urgency: opts.urgency ?? 'high'`,
`Topic` **only when given**, `Authorization: await vapid_auth(...)`.
`gone = status === 404 || status === 410`. Retry exactly once on 429/500/503.
Never throws — a rejected fetch returns `{ ok:false, status:0, gone:false }`.

---

## 2. `src/lib/server/subs.ts` (N4) — subscription storage

Tests exist (`__tests__/subs.test.ts`, 17). Qdrant point:

```ts
type PushSub = { s:'ps'; f:string; ep:string; k:string; au:string; ua?:string; d:number };
// f = owner uid, ep = endpoint, k = p256dh, au = auth, ua = user-agent, d = created ms
// id = await uuid_from(endpoint)  ⇒ re-subscribing upserts instead of duplicating
```

```ts
save_sub(env, uid: string, sub: WebPushSub, ua?: string): Promise<void>
  // rejects (returns without writing) unless endpoint starts 'https://' and both keys present
list_subs(env, uid: string): Promise<StoredSub[]>            // scroll f(eq('s','ps'), eq('f',uid))
list_subs_many(env, uids: string[]): Promise<StoredSub[]>    // one scroll with should[]-style
                                                             // filter; [] ⇒ no query, returns []
                                                             // de-dupes by endpoint
delete_sub(env, endpoint: string): Promise<void>             // remove([uuid_from(endpoint)])
delete_subs(env, endpoints: string[]): Promise<void>
to_web_push(p: StoredSub): WebPushSub
```

No index migration: `s` and `f` are already in `ensure()`.

---

## 3. `src/lib/server/unread.ts` (N5) — read markers

Tests exist (`__tests__/unread.test.ts`, 16).

```ts
type Read = { s:'rd'; f:string; c:string; d:number };   // id = `read:${uid}:${conv}`
read_id(uid: string, conv: string): string
mark_read(env, uid, conv, ts = Date.now()): Promise<void>   // never moves a marker backwards
unread_by_conv(env, uid, group_convs?: string[]): Promise<Record<string, number>>
total_unread(env, uid, group_convs?): Promise<number>
```

`unread_by_conv` scrolls messages (`s:'m'`) addressed to `uid` plus any conv in
`group_convs`, drops messages where `f === uid`, drops those with `ts <= marker`,
and **omits** a conversation entirely rather than reporting `0`.

---

## 4. `src/lib/server/notify.ts` (N6) — fan-out

Tests exist (`__tests__/notify.test.ts`, 10).

```ts
notify(env, uids: string[], payload: Record<string, unknown>):
  Promise<{ sent: number; pruned: number }>
```

Reads `VAPID_PUBLIC` / `VAPID_PRIVATE` / `VAPID_SUBJECT` via `get_secret`; silently
returns `{sent:0,pruned:0}` when unset. `list_subs_many` → `clamp_payload` once →
`send_push` for each (Promise.all) → collect `gone` endpoints → **one** `delete_subs`.
Never throws.

---

## 5. Relay returns undelivered (N7, N8, N9)

- **N7 `ws/src/hub.ts`** — `deliver()` returns `boolean` (had ≥1 socket); the `/relay`
  handler returns `Response.json({ delivered })`. The socket payload shape
  `{type:'msg', id, from, from_name, text, image, group, ts}` must stay byte-identical.
- **N8 `ws/src/relay.ts`** (new) — extracted from `index.ts`:
  ```ts
  export type HubNs = { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  export function relay(body: unknown, ns: HubNs): Promise<null | { ok: boolean; undelivered: string[] }>
  ```
  `null` when there is nobody to relay to (no `to`, empty `members`, null body).
  A hub that throws **or** answers non-JSON counts as undelivered. `ok` is false only
  when *every* hub failed.
- **N9 `ws/src/index.ts`** — `/relay` delegates to `relay()` and returns its JSON.

Tests exist: `ws/src/__tests__/relay.test.ts` (13), `hub-do.test.ts` (+2).

---

## 6. `src/routes/api/send/+server.ts` (N10)

Tests exist (20). Replace the fire-and-forget `relay()` helper with one that parses
`{ ok, undelivered }`. Then, for the undelivered set minus the sender:

- direct: `{ title: sender_name, body: text, url: `/app/chat/${sender}`, conv, id, ts, unread }`
  where `unread` comes from `total_unread` for that one recipient.
- group: `{ title: group_name, body: `${sender}: ${text}`, url: `/app/groups/${gid}`, conv: `g:${gid}`, id, ts }` — **no** `unread` (N queries).
- image-only message: body becomes the media URL `/media/<uid>/<file>`.
- a relay that throws ⇒ push everyone; a non-JSON relay response ⇒ push everyone.

Push via `platform.context.waitUntil(notify(...))` so the response is not blocked.

---

## 7. Client library

| Node | File | Tests |
|---|---|---|
| N13 | `src/lib/push-client.ts` | exist (24) |
| N14 | `src/lib/install.ts` | exist (18) |
| N15 | `src/lib/outbox.ts` | exist (13) |
| N16 | `src/lib/badge.ts` | **to write** |
| N17 | `src/lib/sw-core.ts` | exist (46) |

**`push-client.ts`** — `b64_to_bytes`, `push_available(): boolean`,
`push_state(): Promise<'unsupported'|'blocked'|'off'|'on'>`, `enable_push(key)`,
`disable_push()`, `sync_subscription(key)` (re-POSTs an existing subscription so a
server-side prune self-heals).

**`install.ts`** — captures `beforeinstallprompt`; `watch_install()`, `can_install()`,
`install()`, `ios_hint_needed()` (iOS Safari + not `display-mode: standalone`),
`dismiss_install(now?)` / `install_hidden(now?)` backed by localStorage,
`REASK_MS = 14 * 864e5`.

**`outbox.ts`** — IndexedDB-backed `queue(msg)` / `drain(send)`, `MAX_TRIES = 5`,
types `OutStore`, `Outgoing`. Registers Background Sync tag `x2-outbox` when available,
falls back to draining on `online`.

**`badge.ts` (tests to write, ~8):**
```ts
set_badge(n: number): Promise<void>   // navigator.setAppBadge / clearAppBadge at 0
bump_badge(by = 1): Promise<void>     // reads a cached count; SW increments locally
sync_badge(): Promise<number>         // GET /api/read → set_badge(total)
```
Cases: no-ops when the API is absent; clears at 0; never throws when the promise
rejects (Safari); `sync_badge` tolerates a failed fetch and returns the last known value.

---

## 8. Service worker (N18–N20)

`src/service-worker.ts` — SvelteKit's native slot, `$service-worker` virtual module.
All logic lives in `sw-core.ts` (pure, testable); the SW file is thin wiring.

`sw-core.ts` exports (tests exist): `cache_name(version)`, `stale_caches(names, keep)`,
`is_cacheable(req)`, `cache_mode(req, ctx): 'precache'|'network-first'|'stale-while-revalidate'|'passthrough'`,
`notification_from(data)`, `target_url(data)`, `pick_client(clients, url)`, `should_notify(data, focused)`,
`type SwClient`.

Notification options are pinned by test: `icon:'/icons/icon-192.png'`,
`badge:'/icons/badge-96.png'`, `tag:'x2:<conv>'`, `renotify:true`,
`requireInteraction:false`, `silent:false`, actions `reply` (`type:'text'`, with
placeholder) and `mark-read`; **no actions when there is no conv**.

SW event wiring (no unit tests — covered by the e2e in §11):
- `install` → precache `build`+`files`+`/offline`, `skipWaiting()`
- `activate` → delete `stale_caches`, `clients.claim()`
- `fetch` → route by `cache_mode`; navigation failure → `/offline`. Never cache a 206.
- `push` → **always** `showNotification` (userVisibleOnly), even if decrypt/parse fails
- `notificationclick` → `pick_client` focus-or-open; `mark-read` action POSTs `/api/read`;
  `reply` action POSTs `/api/send` with `event.reply`
- `sync` (tag `x2-outbox`) → drain the outbox

---

## 9. Routes (N21–N23, N25)

- **`/api/push/+server.ts`** — tests exist (15).
  `GET → { key: VAPID_PUBLIC }`, **503 when unset**, never returns the private key.
  `POST { endpoint, keys, ua } → save_sub`, 401 signed out.
  `DELETE { endpoint } → delete_sub`.
- **`/api/read/+server.ts`** — tests exist (10). `GET → { total, by_conv }`, computing
  group convs from `list_groups(env, uid)` as `g:${id}`. `POST { conv, ts? } → mark_read`,
  returns the fresh `{ total }`.
- **`/app/share/+server.ts`** — tests exist (9). Web Share Target POST; stores an image
  via `put_image(blob, locals.user.id)`; redirects to `/app?share_text=…&share_image=…`.
- **`/offline/+page.svelte`** — static, `prerender = true`, no data loads.

---

## 10. Assets and head (N24, N26, N27)

- `static/manifest.webmanifest` — `id:'/app'`, `start_url:'/app'`, `scope:'/'`,
  `display:'standalone'`, `display_override:['standalone','minimal-ui']`,
  `launch_handler:{client_mode:'navigate-existing'}`, `theme_color:'#0b0b0c'`,
  `background_color:'#0b0b0c'`, `share_target`, `shortcuts`, `screenshots`
  (Chrome needs both a `wide` and a `narrow` entry).
- `static/icons/*` from `static/logo.svg` via inkscape: `icon-192.png`, `icon-512.png`,
  `icon-192-maskable.png`, `icon-512-maskable.png` (≥20% safe-area padding),
  `apple-touch-icon.png` (180×180, PNG — iOS rejects SVG), `badge-96.png` (monochrome).
- `src/app.html` — add `viewport-fit=cover` to the viewport meta (currently missing;
  makes every `env(safe-area-inset-*)` resolve to 0), `<link rel="manifest">`,
  `<meta name="theme-color">`, `apple-mobile-web-app-*`, `<link rel="apple-touch-icon">`.

`src/lib/__tests__/pwa-assets.test.ts` (39) already reads these off disk and checks each
declared icon's real PNG IHDR dimensions against its `sizes` string.

---

## 11. UI and e2e — **tests to write**

- **N28 `src/lib/components/NotifyPrompt.svelte`** — asks for permission *after* a first
  send, never on load. Svelte 5 runes. ~6 component tests: hidden when `push_state()`
  is `'on'` or `'blocked'`, shows the iOS install hint instead when `ios_hint_needed()`,
  re-ask suppressed for `REASK_MS` after dismissal.
- **N29 install banner** in `src/routes/app/+layout.svelte` — ~4 tests, same shape.
- **N30 badge wiring** — `sync_badge()` on focus and after `mark_read`; ~3 tests.
- **N31 `e2e/pwa.spec.ts`** (playwright, ~8): manifest is served and parses; SW
  registers and reaches `activated`; offline navigation renders `/offline`; a push
  delivered through `page.evaluate` on the SW shows a notification; clicking it focuses
  the existing client; share target POST lands on `/app` with the text prefilled.

---

## Order

1. push.ts (N3) → 2. subs/unread (N4,N5) → 3. notify (N6) → 4. relay chain (N7–N9) →
5. /api/send (N10) → 6. client libs (N13–N17) → 7. SW + routes (N18–N23,N25) →
8. assets + head (N24,N26,N27) → 9. UI (N28–N30) → 10. e2e (N31).

Each step is green when its named suite passes **and** the pre-existing 104 tests still do.

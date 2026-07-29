# x2 platform expansion — master technical spec + test plan

Covers, in the order the user listed them:

1. Responsive pass, send icon button, custom radio (`/app/random`), custom select (used on `/app/profile` + `/app`), realtime presence correctness.
2. Message scheduling (Cloudflare Cron), file sending, chat folders, message embedding + search.
3. Groups-in-common on `/app/user/[id]`.
4. Credits system (ported from `../e4`, bugs fixed).
5. Partner/referral program (ported from `../beee`, Paystack, 54%).
6. Groq llama3-8b "what you have in common" on user profile.
7. Robust PWA push (reboot-survivable).

**This turn implements only §1 (Step 1) with TDD, then stops.** §2–7 are specified in full below so no detail is lost, and are explicitly out of scope for this pass.

---

## §1 — STEP 1 (implemented this turn)

### 1.1 Presence bug (found during audit)

`ws/src/hub.ts` `webSocketClose()` currently announces `online:false` for a uid the instant _any one_ of its sockets closes, even if the same uid has another live socket (second tab/device). `getWebSockets(uid)` is never re-checked after removal.

Fix: only announce offline when zero sockets remain for that uid.

```ts
async webSocketClose(ws: WebSocket): Promise<void> {
	const uid = this.state.getTags(ws)[0];
	ws.close();
	if (uid && this.state.getWebSockets(uid).length === 0) {
		this.announce(uid, false);
		await this.notify_watchers(uid, false);
	}
}
```

Note: `ws.close()` must run before the socket-count check only matters if the runtime hasn't already evicted `ws` from `getWebSockets()` at close time — Workers' `getWebSockets()` reflects hibernatable-websocket state immediately, so checking after `ws.close()` is safe; the important change is checking length, not the close-vs-check ordering.

The `connect`-side `announce(uid, true)` is harmless when redundant (second tab connecting while first is open) — no change needed there.

### 1.2 Custom `<Select>` component

New file `src/lib/components/Select.svelte`. Svelte 5 runes, no native `<select>`, ARIA `listbox`/`combobox` pattern (keyboard: ↑/↓ moves highlight, Enter/Space selects, Esc closes, Home/End jump, typeahead by first character).

```ts
type Option = { value: string; label: string };
let {
	value = $bindable(''),
	options,
	placeholder = 'select…',
	'aria-label': ariaLabel
}: {
	value?: string;
	options: Option[];
	placeholder?: string;
	'aria-label'?: string;
} = $props();
```

Behavior contract (pinned by tests):

- Renders a `button[role=combobox][aria-haspopup=listbox][aria-expanded]` trigger showing the selected option's `label`, or `placeholder` when `value` doesn't match any option.
- Clicking the trigger toggles a `ul[role=listbox]` of `li[role=option][aria-selected]`.
- Clicking an option sets `value` to its `.value`, closes the list, returns focus to the trigger.
- `ArrowDown`/`ArrowUp` on the trigger (closed) opens the list and highlights the current value (or first option).
- Inside the open list: `ArrowDown`/`ArrowUp` move highlight (clamped, no wrap), `Enter`/`Space` commits highlighted → `value`, `Escape` closes without changing `value` and refocuses the trigger, `Home`/`End` jump to first/last option.
- Typing a character while open jumps the highlight to the next option whose label starts with that character (case-insensitive), cycling.
- Clicking outside the open list closes it without changing `value`.
- `aria-activedescendant` on the listbox tracks the highlighted option's id for screen readers.

### 1.3 Custom `<Radio>` component

New file `src/lib/components/Radio.svelte` — a single custom radio control (used inside `/app/random`'s existing `label.card` wrapper, replacing the native `<input type="radio">`), plus `src/lib/components/RadioGroup.svelte` for the group semantics `/app/random` needs (three options, one selected).

```ts
// Radio.svelte — one radio button
let {
	checked = false,
	name,
	value,
	onselect
}: {
	checked?: boolean;
	name: string;
	value: string;
	onselect?: (value: string) => void;
} = $props();
```

Renders `span[role=radio][aria-checked][tabindex]` (roving tabindex: `0` when checked or when it's the group's first item and nothing is checked yet, else `-1`), a visual dot that fills when checked, driven entirely by CSS/attributes (no native `<input>` in the DOM — the user asked for "custom radio boxes," and `/app/random` already wraps everything in a clickable `<label class="card">`, so click-to-select must be wired via `onclick`/`onkeydown` since there's no native input to carry click-through semantics anymore).

```ts
// RadioGroup.svelte
let {
	value = $bindable(''),
	options
}: { value?: string; options: { value: string; label: string }[] } = $props();
```

Keyboard: ArrowDown/ArrowRight moves to next option and selects it (roving tabindex + selection are the same action, matching native radio-group behavior); ArrowUp/ArrowLeft moves to previous; Home/End jump to first/last; clicking any option selects it directly.

`/app/random/+page.svelte` swaps its three `label.card > input[type=radio]` blocks for one `<RadioGroup bind:value={mode} options={[...]} />`.

### 1.4 Send icon button

`/app/chat/[id]/+page.svelte`'s submit button (`{busy ? 'sending' : 'send'}`) becomes an icon-only button: inline SVG paper-plane, `aria-label="send message"`, `title="send"`, disabled state shows a spinner (reuse the same SVG with a CSS animation class, or a second small inline SVG spinner) instead of text. No new icon dependency — hand-written SVG path, consistent with the rest of the app (which has zero icon library dependencies today).

### 1.5 Responsive pass

Audit target: every `max-w-[NNNpx]`/fixed-`w-[NNNpx]` in `src/routes/**/*.svelte` and `src/lib/**/*.svelte` that lacks a smaller-viewport override, plus horizontal-scroll risk from `whitespace-nowrap` buttons in narrow flex rows (`/app`, `/app/groups` search rows), plus the chat/groups `h-[calc(100dvh-150px)]` headers which assume a fixed header height that shifts once InstallBanner/NotifyPrompt banners are visible (they're `fixed`, so they don't affect layout height — no fix needed there, confirmed by inspection, not assumed).

Concrete changes:

- `/app/+page.svelte` and `/app/groups/+page.svelte`: the search-button `whitespace-nowrap` next to a `flex-1` input already stacks via `flex-col sm:flex-row` — verified fine; the _filter row_ (`gender select + age inputs + LocationPicker`) needs `flex-wrap` (already present) confirmed sufficient down to 320px width once selects are the new custom component (native selects and the age number inputs have a browser-enforced minimum intrinsic width that can force horizontal scroll at ≤360px; the custom `<Select>` has no such floor and is given `min-w-0`).
- `PhoneInput.svelte` and `LocationPicker.svelte`: add `min-w-0` to flex children that don't already have it, so they can shrink inside a `flex-wrap` row instead of forcing overflow.
- Root layout bottom tab bar and header: already responsive (verified — `grid-cols-4`, `sm:hidden`/`hidden sm:flex` split, `env(safe-area-inset-bottom)` already applied). No change.
- Global rule: audit for any element wider than `100vw` at 320px, 375px, 768px, 1024px via Playwright viewport screenshots as part of the manual verification pass (not an automated test — see §1.7).

---

### 1.6 Test plan for Step 1

All new logic that's pure/testable goes in `.ts` files with real unit tests; component interaction tests use the `component` vitest project (jsdom + `@testing-library/svelte`) already set up in `vite.config.ts`.

**`ws/src/__tests__/hub-do.test.ts`** (extend existing file) — new cases:

- "does not announce offline while a second socket for the same uid is still open" — two `FakeSocket`s tagged `['alice']`, close one, assert the _other_ socket never receives a `presence offline` message and `notify_watchers`'s underlying `stub.fetch` (via `CHAT_HUB.get`) is not called for `alice`'s watchers.
- "announces offline once the last socket for a uid closes" — one socket tagged `['alice']`, close it, assert presence-offline is broadcast (existing behavior, re-asserted after the fix to lock in no regression).

**`src/lib/components/__tests__/Select.test.ts`** (jsdom, `@testing-library/svelte`):

- renders the placeholder when `value` matches no option.
- renders the matching option's label when `value` is set.
- opens the listbox on trigger click; `aria-expanded` flips true.
- clicking an option sets `value` (assert via a wrapper component's exposed state or an `onchange`-style callback prop — component takes `value=$bindable`, so test a thin host component that reads the bound value back) and closes the listbox.
- `ArrowDown` on the closed trigger opens it and highlights first option (when nothing selected) or the current value's option.
- `ArrowDown`/`ArrowUp` inside the open list move `aria-activedescendant` without changing `value` until committed.
- `Enter` commits the highlighted option to `value` and closes.
- `Escape` closes without changing `value` and returns focus to the trigger.
- `Home`/`End` jump highlight to first/last option.
- typing a letter jumps highlight to the next option starting with that letter, cycling back to the first match after the last.
- clicking outside the open listbox closes it without changing `value`.
- `aria-label` passthrough renders on the trigger.

**`src/lib/components/__tests__/RadioGroup.test.ts`**:

- renders one `role=radio` per option, exactly one with `aria-checked="true"` matching `value`.
- clicking an unselected option sets `value` to it.
- `ArrowDown`/`ArrowRight` from the checked option selects the next option; wraps or clamps — **decide and pin**: clamp at the last option (no wrap), matching `/app/random`'s fixed 3-item list where wrap-around isn't expected UX. Same for `ArrowUp`/`ArrowLeft` clamping at the first.
- `Home` selects the first option, `End` selects the last, from any starting selection.
- roving tabindex: only the checked option (or the first, if none checked) has `tabindex="0"`; the rest have `tabindex="-1"`.

**`src/routes/app/random/__tests__/page.test.ts`** (component test, jsdom) — smoke test only (this page has no server logic to unit test beyond what RadioGroup already covers):

- renders three radio options with labels "text only" / "voice + text" / "video + text".
- defaults to "video + text" selected (matches current `mode = $state<Mode>('video')`).
- clicking "text only" updates the selected option.

**`src/routes/app/chat/[id]/__tests__/send-button.test.ts`** — if the chat page's existing test coverage is nil (confirmed: no test file exists for this route today), add a narrow component test scoped only to the button:

- extract the icon button markup isn't practical to unit-test in isolation without duplicating page state; instead assert via a Playwright/manual check (see §1.7) that the button has `aria-label="send message"` and no visible text, since testing-library jsdom tests for this page would require mocking `ws_on`/`RTCPeerConnection`/`getUserMedia`/media APIs disproportionate to what's being changed (a label swap). **Explicit ponytail-style skip, stated plainly**: full page-level render test skipped as disproportionate; covered by manual Playwright check instead.

**Manual verification (not automated, run once before calling Step 1 done):**

- Playwright screenshots of `/app`, `/app/random`, `/app/profile`, `/app/chat/[id]` at 320×640, 375×667, 768×1024, 1280×800 — confirm no horizontal scrollbar, no overlapping elements, custom select/radio render correctly and are usable via touch tap.
- Two real browser tabs signed in as the same user, confirm closing one tab leaves the other showing "online" for a peer watching that uid.

---

## §2 — message scheduling, file sending, chat folders, message embedding + search (spec only, not implemented this turn)

### 2.1 Message scheduling (Cloudflare Cron)

New Qdrant record type:

```ts
interface ScheduledMessage {
	s: 'sm';
	id: string;
	f: string; // sender uid
	to?: string; // recipient uid (1:1)
	group?: string; // group id (group send)
	text: string;
	image?: string;
	at: number; // unix ms when it should send
	sent?: boolean; // set true once dispatched (idempotency guard)
}
```

- `POST /api/send` gains an optional `at?: number` (future ms timestamp) — when present and `> Date.now() + 60_000` (must be at least 1 minute out, otherwise just send now), stores a `ScheduledMessage` instead of calling `send_msg`/`send_group_msg`, returns `{ ok: true, scheduled: true, id }`.
- New `GET/DELETE /api/scheduled` — list/cancel a user's own pending scheduled messages (`sent` unset, `f === locals.user.id`).
- `wrangler.jsonc` gains `"triggers": { "crons": ["*/1 * * * *"] }` and the SvelteKit Cloudflare adapter's `scheduled(event, env, ctx)` export (via `src/hooks.server.ts` or a dedicated `src/scheduled.ts` merged into the worker entry — SvelteKit's Cloudflare adapter supports exporting additional handlers from `src/worker/index.ts` in recent adapter versions; confirm exact wiring against the installed `@sveltejs/adapter-cloudflare` version before implementing, since this differs across adapter releases).
- The cron handler: scroll `ScheduledMessage`s where `at <= now` and `!sent`, for each: call `send_msg`/`send_group_msg`, relay over the socket the same way `/api/send` does, mark `sent:true` (idempotent — a message already marked `sent` is skipped even if picked up twice due to a slow previous run overlapping).
- Test plan: `send_scheduled_batch(env, now)` pure function pulled out of the cron handler so it's unit-testable without a real CF cron trigger; tests cover "sends everything due," "skips future," "does not resend already-sent," "marks sent even if the socket relay throws" (matches existing `/api/send` never-lose-the-message philosophy).

### 2.2 File sending (beyond images)

Extend `src/lib/server/media.ts`'s `TYPES` map to a generic `ALLOWED_TYPES` covering common documents (`application/pdf`, `application/zip`, `text/plain`, `application/msword`, etc. — exact allow-list to be decided with the user, since arbitrary file upload is a real abuse-surface decision, not a technical one). `Message` gains `fl?: { key: string; name: string; size: number; type: string }` (distinct from `im` — images stay inline-rendered, other files render as a download chip with name+size). Client: `attach.ts` gains `upload_file(file: File)` alongside `upload_image`, and the chat page's paperclip/attach control accepts any file when not an image, showing a filename chip instead of an inline preview.

### 2.3 Chat folders

New Qdrant record:

```ts
interface Folder {
	s: 'fo';
	id: string;
	owner: string;
	name: string;
	convs: string[]; // conversation ids (peer uid or `g:<gid>`) assigned to this folder
	d: number;
}
```

`save_folder`, `list_folders(env, uid)`, `assign_conv(env, folder_id, conv_id)`, `unassign_conv`, `delete_folder` in a new `src/lib/server/folders.ts`. `/app/+page.svelte`'s "recent threads" list gains a folder-tab strip (built from the new custom `<Select>`-adjacent tab component, or plain buttons — a tab strip isn't a `<select>`, no native-control replacement needed) filtering `convs` by the active folder; "all" is always the default first tab.

### 2.4 Message embedding + search

Currently only `User` and `Group` records get embedded (`src/lib/server/or.ts` → `embed()`, called from `user.ts`/`group.ts`); `Message` records are stored with `vector: new Array(4096).fill(0)` (zero vector, never searched). To add message search: embed message text at send time (`send_msg`/`send_group_msg` call `embed(env, text)` instead of the zero vector — cost/latency tradeoff: every message send now makes an embedding API call; likely want to skip embedding for very short messages, e.g. `text.trim().length < 3`, to avoid wasting embedding calls on "ok"/"lol"). New `search_messages(env, uid, q, conv?)` in `chat.ts`: `search(env, await embed(env,q), f(eq('s','m'), eq(conv?'c':'f_or_t', conv ?? uid)), limit)` — needs a combined "sent by me or to me" filter, which Qdrant's `must`/`should` structure supports via an OR'd pair of `eq('f',uid)`/`eq('t',uid)` conditions (the existing `f()` helper only does AND — needs a `some()`/`should` helper added to `qdrant.ts`). New route `GET /api/search/messages?q=&conv=`.

---

## §3 — groups in common (spec only)

`/app/user/[id]/+page.server.ts` gains: fetch `list_groups(env, viewedUid)` and `list_groups(env, viewerUid)` in parallel, intersect by `id`, pass `{ shared: GroupView[] }` to the page. Page renders a "N groups in common" line plus an expandable list of all of them (name + link to `/app/groups/[id]`), matching the existing `card` visual language. Edge case: if `viewedUid === viewerUid` (viewing your own profile via a stray link), skip the section entirely rather than showing "all your groups in common with yourself."

Function signature: `shared_groups(env: QEnv, a: string, b: string): Promise<GroupView[]>` in `group.ts`, unit-tested directly (two users, overlapping and non-overlapping membership sets, empty-intersection case, same-user case returns that user's full group list — but the _route_ is what suppresses rendering it, not the function, since the function is a generic set-intersection utility with a legitimate a===b answer).

---

## §4 — Credits system (spec only; ported from `../e4`, fixing its known bugs)

### 4.1 What we're taking from e4, and what we're fixing

Taking: kobo-denominated integer balance, daily free grant, per-model token pricing table, Paystack purchase flow shape.

Fixing (per the user's "5400 free credits per day" instruction and this being a from-scratch port, not a copy-paste):

- **Atomicity**: e4's read-then-write balance has no CAS and is a real race under concurrent requests. x2 already has a natural single-threaded-per-key primitive available — a Cloudflare Durable Object. New DO `CreditAccount` (one instance per uid, `idFromName(uid)`), all balance mutations (`grant`, `deduct`, `credit`) happen inside the DO's single-threaded `fetch` handler, serializing concurrent calls for the same user automatically. Balance is persisted in the DO's own transactional `storage` (`state.storage.get/put`), not Qdrant — Qdrant stays vector/search-only, matching x2's existing design philosophy ("Qdrant is the only datastore" reinterpreted as "the only _searchable_ datastore"; a DO is not a competing datastore, it's per-entity durable state, same category as the existing `ChatHub`/`MatchLobby` DOs).
- **Insufficient-balance gate**: e4 never blocks usage. x2's Groq-similarity feature (§6) is exactly the kind of call that should be gated — `deduct` returns a discriminated result `{ ok: true, balance: number } | { ok: false, reason: 'insufficient_credits'; balance: number }` instead of e4's silent clamp-to-zero, and the caller must check before making the paid LLM call, not after.
- **Real ledger**: new `CreditEvent` record type persisted to Qdrant (searchable/listable, unlike the DO's own opaque storage) for user-facing history: `{ s: 'ce', id, uid, kind: 'daily_grant'|'purchase'|'deduct'|'referral_bonus', amount, balance_after, ts, ref? }`. Written by the DO after each mutation via a fire-and-forget `ctx.waitUntil` call back out to Qdrant (the DO is the source of truth for balance; Qdrant ledger is for display/audit only — if the two ever disagree, the DO wins).
- **Paystack double-credit bug**: e4 credits from webhook, redirect-callback, AND a client-called verify-payment endpoint, with no dedup. x2's port implements exactly one authoritative credit path (webhook `charge.success`), guarded by a "have we processed this Paystack reference" check — a Qdrant point keyed by `uuid_from('paystack:'+reference)` written atomically as part of crediting; a second delivery for the same reference finds the point already exists and no-ops. The redirect-callback page becomes purely a "thanks, check your balance" UI with no crediting side-effect of its own.

### 4.2 Types and signatures

```ts
// src/lib/server/credits.ts (Qdrant side: ledger only)
interface CreditEvent {
	s: 'ce';
	id: string;
	uid: string;
	kind: 'daily_grant' | 'purchase' | 'deduct' | 'referral_bonus';
	amount: number; // signed: positive for grants/purchases/bonus, negative for deduct
	balance_after: number;
	ts: number;
	ref?: string; // paystack reference, for purchase events
}
export async function record_event(env: QEnv, e: Omit<CreditEvent, 's' | 'id'>): Promise<void>;
export async function credit_history(
	env: QEnv,
	uid: string,
	limit?: number
): Promise<CreditEvent[]>;
export async function mark_paystack_ref_processed(env: QEnv, ref: string): Promise<boolean>; // false if already processed
```

```ts
// ws/src/credit_account.ts (new Durable Object)
export const DAILY_GRANT = 5400; // kobo, per user's explicit instruction
export class CreditAccount implements DurableObject {
	// POST /balance -> { balance: number, granted_today: boolean }
	// POST /deduct  body:{amount:number} -> { ok:true, balance } | { ok:false, reason:'insufficient_credits', balance }
	// POST /credit  body:{amount:number, kind, ref?} -> { balance }
	async fetch(request: Request): Promise<Response>;
}
```

```ts
// src/lib/server/pricing.ts — per-model USD/1M-token rates, ported table from e4, same shape
export function calc_cost_usd(model: string, input_tokens: number, output_tokens: number): number;
export function usd_to_kobo(usd: number, rate?: number): number; // rate default from env NGN_USD
```

### 4.3 Test plan (high level — full test file list to be written when this step starts)

- `CreditAccount` DO unit tests (via the same `hub-do.test.ts`-style fake `DurableObjectState`): daily grant idempotent within 24h window, grants exactly once per rolling day, `deduct` below balance succeeds and returns correct new balance, `deduct` above balance returns `insufficient_credits` and balance is unchanged (no clamping), concurrent `deduct` calls (simulated as sequential awaits against the same in-memory state, since DOs are single-threaded — this is what makes the test meaningful: no interleaving is possible by construction, unlike e4's Qdrant race).
- `pricing.ts`: `calc_cost_usd` matches known rate-table entries, unknown model returns 0, `usd_to_kobo` rounds correctly.
- Paystack webhook route: valid signature + `charge.success` + first delivery credits once; replayed delivery of the same reference credits zero additional times; invalid signature 401; missing signature 401.
- `credit_history`/`record_event`: ledger entries append-only, `balance_after` matches what was written.

---

## §5 — Partner/referral program (spec only; ported from `../beee`, Paystack, 54% commission)

### 5.1 What we're taking from beee, and what we're deciding differently

Taking: `ac` partner-code field on `User`, sqids-based code generation, `localStorage`-based referral-link capture (`?c=` param + `/i/<code>` redirect), self-referral block, deterministic-point-id idempotency pattern for the payout ledger, webhook-driven (not partner-triggered) payout, Paystack transfer/recipient flow, cron-based retry of failed/stuck payouts, "duplicate transfer reference = already succeeded" idempotency backstop.

Deciding differently per the user's explicit instruction ("54% equivalent of the credits they bought"):

- **Commission is in credits, not currency.** Unlike beee (real bank transfer via Paystack Transfer API), x2's commission is `Math.round(purchased_kobo_equivalent_in_credits * 0.54)` credited directly to the inviter's `CreditAccount` DO (§4) via its `/credit` endpoint with `kind:'referral_bonus'` — no Paystack transfer, no bank-account collection, no `run_payout`/`retry_failed_payouts`/cron-retry machinery needed, because there's no external money movement to retry. This is a meaningfully simpler port than beee's actual mechanism, and should be called out to the user as a deliberate simplification once this step starts (ponytail: beee's transfer/retry machinery exists to handle real bank transfers failing; a credits-ledger credit inside an already-atomic DO call cannot fail the way a bank transfer can, so that whole subsystem doesn't need porting — flag this trade-off explicitly rather than silently dropping "transfers and all" from the request).
- **Same Paystack keys**: reuses whatever `PAYSTACK_SECRET_KEY_TEST`/`PAYSTACK_SECRET_KEY_LIVE`/`PAYSTACK_TEST` secrets already exist for credit _purchases_ (§4) — there is no separate transfer-side key needed since there's no transfer.

### 5.2 Types and signatures

```ts
// User gains:
interface User {
	/* ...existing... */ ac?: string;
	invited_by?: string;
}
// src/lib/partner_code.ts (client-safe, ported near-verbatim from beee)
export function gen_partner_code(): string; // sqids([Date.now()/1000, random 1000-9999])
// src/lib/server/partner.ts
export async function ensure_partner_code(env: QEnv, uid: string): Promise<string>;
export async function attribute_referral(
	env: QEnv,
	new_uid: string,
	code: string
): Promise<{ ok: boolean; inviter?: string }>;
// called from registration/signup flow; self-referral impossible by construction here since
// code is looked up to a different, already-existing uid before the new account is created
export async function pay_referral_bonus(
	env: QEnv,
	purchase_kobo: number,
	inviter_uid: string,
	purchase_ref: string
): Promise<void>;
// idempotency: same pattern as §4's paystack-ref dedup — a `ref` already paid a bonus is skipped
```

Routes: `GET /i/[code]` → redirect to `/login?c=<code>` (x2 has no separate `/register` — signup is Google OAuth + `/api/auth/login` per existing code, so the capture point is wherever local/Google signup finalizes account creation, not a dedicated registration form like beee's).

### 5.3 Test plan (high level)

- `gen_partner_code` produces 6+ char URL-safe strings, uniqueness relies on caller-side DB check (function itself is pure, tested for shape only).
- `ensure_partner_code`: assigns a code to a user missing one, is a no-op (returns existing code) for a user who already has one.
- `attribute_referral`: valid code attributes correctly, invalid/unknown code returns `{ok:false}`, code belonging to the same uid being attributed (shouldn't be reachable pre-account-creation, but tested anyway) returns `{ok:false}`.
- `pay_referral_bonus`: 54% math exact for several purchase amounts, same `purchase_ref` paid twice results in exactly one bonus credit (ledger event count check via `credit_history`), inviter's `CreditAccount` balance increases by the right amount.

---

## §6 — Groq llama3-8b "what you have in common" (spec only)

```ts
// src/lib/server/groq.ts
export const GROQ_MODEL = 'llama3-8b-8192';
export async function whats_in_common(
	env: QEnv,
	a: User,
	b: User
): Promise<
	| { ok: true; text: string; cost_kobo: number }
	| { ok: false; reason: 'insufficient_credits' | 'llm_error' }
>;
```

Flow: build a compact prompt from both users' `a`/`i`/`ag`/`co`/`st`/`ci` fields (never send email/password/whatsapp), call Groq's OpenAI-compatible `/openai/v1/chat/completions` with `GROQ` secret, compute cost via §4's `pricing.ts` (Groq's llama3-8b rate needs adding to the rate table — check Groq's published per-token price at implementation time, don't guess a number now), **check-then-deduct** against the viewer's `CreditAccount` (deduct the viewer, not the profile owner — the viewer is the one spending credits to learn the commonality) via the gate from §4.2, before making the paid call — insufficient balance returns `insufficient_credits` without calling Groq at all. Route: `GET /api/user/[id]/common` (viewer-authenticated, `params.id` is the other user). UI: a "what we have in common" button on `/app/user/[id]/+page.svelte`, loading state, renders `text` on success, an upsell message ("out of credits, back tomorrow" or a link to buy) on `insufficient_credits`.

Test plan: `whats_in_common` unit tests mock the Groq fetch and the credit-deduct call; cases — sufficient balance + successful Groq call deducts and returns text; insufficient balance short-circuits without calling `fetch`; Groq API error after a successful deduct triggers a refund credit (mirroring §4's "never lose the user's money on our own failure" principle, which is stricter than e4's original "no refund" behavior — explicitly better than the reference implementation here, matching the instruction to implement in "the best way possible").

---

## §7 — Robust PWA push (reboot-survivable) (spec only)

The existing push implementation (this repo, already shipped) is correct Web Push per RFC 8291/8292/8188 and does not need reboot-specific code — **push delivery surviving a phone reboot is an OS/browser guarantee, not something the app implements**: once a push subscription is registered, Android/iOS wake the browser's push service worker on an incoming push regardless of reboot state, _provided_:

1. The PWA is actually installed (standalone) on iOS — already required and implemented (`ios_hint_needed`/install flow).
2. The subscription hasn't silently expired — already handled (`sync_subscription` re-registers on every app load; §4/§6 additions don't change this).
3. Battery-optimization "kill this app's background activity" settings on some Android OEMs (Xiaomi/Huawei/Samsung aggressive battery managers) can prevent Chrome itself from processing pushes even though the OS-level guarantee exists — this is user-device-setting territory, not app code; the only thing the app can do is document it (an in-app help note, non-technical) — no function/signature to write here, flagged as a real limitation rather than silently promised-and-unbuilt.

If gaps are found once this step is actually picked up (e.g., a missing `Content-Encoding`/TTL edge case, or Android Chrome-specific `Urgency` handling), they'll be specified precisely then, against real device testing — speculative "robustness" code without a reproduced failure would violate the no-speculative-abstraction rule already governing this codebase.

---

## Execution order for future turns

1. **This turn**: §1 (done below).
2. §1.1 presence fix + UI components should ship together since RadioGroup/Select need to exist before other pages are touched.
3. Credits (§4) before partner program (§5), since §5 pays into §4's ledger.
4. Groq common-ground (§6) after credits, since it's gated by credits.
5. Scheduling/files/folders/message-search (§2) and groups-in-common (§3) are independent of 3–4 and can be done in any order relative to them.
6. PWA robustness (§7) is a documentation/verification pass, not a coding step, pending real-device findings.

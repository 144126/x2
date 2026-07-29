# x2 Batch Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix folder persistence and call teardown/audio bugs, replace `/random` with room-wide mesh calls, and land a batch of UI/settings/dev-env improvements across the x2 SvelteKit-on-Cloudflare app.

**Architecture:** SvelteKit 2 + Svelte 5 (runes) on Cloudflare Workers, with a second worker (`ws/`) holding Durable Objects for presence, relay and credits. All persistence is Qdrant (single collection `x2`, discriminated by an `s` payload key). Calls are peer-to-peer WebRTC signalled over the existing `signal` message type in `ChatHub`; a new shared `CallMesh` class makes a 1:1 call a mesh of size 1, so both the DM page and the room page run one implementation.

**Tech Stack:** SvelteKit 2.70, Svelte 5.56 (runes), Tailwind v4 (CSS-first `@theme`), Vitest 4 (two projects: `node` + `component`/jsdom), Wrangler 4, Qdrant, Cloudflare Durable Objects + R2.

## Global Constraints

- **Package manager:** `pnpm`. Tests: `pnpm test` (all), `pnpm vitest run <path>` (one file).
- **Svelte 5 runes only.** Any variable bound with `bind:this` that an `$effect` reads MUST be declared `$state()`, or the effect will not re-run when the element mounts. This is the root cause of the call-audio bug; do not reintroduce it.
- **Qdrant strict mode rejects filtering on unindexed payload keys.** Every key used in `eq()`/`range()` must appear in the index list in `src/lib/server/qdrant.ts:84-88`. Currently indexed keywords: `s, t, r, c, f, co, st, u, ow, mb, gr, uid, ac`; integers: `ag, at, sent`.
- **Payload keys are short codes** (`ow` = owner, `nm` = name, `mb` = members). A payload written with one key and filtered with another silently returns nothing — see Task 1.
- **Route rename scope is UI only.** `/api/groups/*`, `$lib/server/group.ts`, `GroupView`, and the Qdrant payload `s: 'g'` all keep the word "group". Only `/app/groups` → `/app/rooms` and user-facing copy change.
- **Interests setting is display-only.** The new flag hides interests on the public profile; it must NOT change the search embedding in `save_profile`.
- **Group calls are mesh WebRTC**, capped in practice at ~4-6 participants. No SFU, no new Cloudflare products, no changes to `ws/src/hub.ts` signal routing.
- **Never edit an existing Durable Object migration tag.** Removing a DO class requires a new `deleted_classes` migration.
- **Conventional commits** (`fix:`, `feat:`, `chore:`), matching existing history.
- **Never `git add -A` / `git add .`** — the working tree carries unrelated in-progress changes (`static/logo.svg`, `.log`, `.dev-logs/*`, `ws/.svelte-kit/`) that must stay uncommitted. Stage only the explicit paths your task touched.
- **Step 1 of every task is already done and committed** by the controller before you are dispatched. Start at Step 2. Do not rewrite Step 1's test or edit — it is the contract you implement against.

---

### Task 1: Fix folder persistence (`owner` vs `ow` payload-key mismatch)

Folders are written to Qdrant with a payload key `owner`, but every read filters on `eq('ow', uid)`. `ow` is the indexed key; `owner` is not in the payload's filterable set. Result: `list_folders` always returns `[]`, `owned_folder` never finds anything, so `assign_conv`/`unassign_conv`/`delete_folder` all 404. Folders appear to work only because the UI optimistically appends the object the POST returns; they vanish on reload. The existing tests mock `scroll` wholesale, so the filter argument is never asserted — that is why this shipped.

**Files:**
- Modify: `src/lib/server/folders.ts:3-17` (interface + `save_folder`)
- Test: `src/lib/server/__tests__/folders.test.ts`

**Interfaces:**
- Consumes: `ensure`, `upsert`, `scroll`, `remove`, `new_id`, `f`, `eq`, `ZV`, `QEnv` from `./qdrant`
- Produces: `Folder` with field `ow: string` (renamed from `owner`); `save_folder(env, owner, name) => Promise<Folder>`, `list_folders(env, uid) => Promise<Folder[]>`, `assign_conv(env, uid, folder_id, conv) => Promise<boolean>`, `unassign_conv(...) => Promise<boolean>`, `delete_folder(env, uid, folder_id) => Promise<boolean>` — signatures unchanged.

- [ ] **Step 1: Write the failing coherence test**

Add to `src/lib/server/__tests__/folders.test.ts`, after the existing `save_folder` describe block:

```ts
describe('payload/filter coherence', () => {
	it('writes every payload key that list_folders later filters on', async () => {
		await save_folder(ENV, 'ada', 'close friends');
		const payload = upsertMock.mock.calls[0][1][0].payload;

		scrollMock.mockResolvedValue([]);
		await list_folders(ENV, 'ada');
		const filter = scrollMock.mock.calls[0][1] as { must: { key: string; match: { value: string } }[] };

		// a filter key absent from the written payload matches nothing in Qdrant — silent data loss
		for (const cond of filter.must) {
			expect(payload).toHaveProperty(cond.key, cond.match.value);
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/server/__tests__/folders.test.ts -t 'payload/filter coherence'`
Expected: FAIL — `expected { s: 'fo', owner: 'ada', ... } to have property "ow"`

- [ ] **Step 3: Rename the payload field to the indexed key**

In `src/lib/server/folders.ts`, change the interface (line 3-10) and `save_folder` (line 12-17):

```ts
import { ensure, upsert, scroll, remove, new_id, f, eq, ZV, type QEnv } from './qdrant';

export interface Folder {
	s: 'fo';
	id: string;
	ow: string; // owner uid — short key, matches the indexed field the filters use
	name: string;
	convs: string[]; // conversation ids (peer uid or `g:<gid>`) assigned to this folder
	d: number;
}

export async function save_folder(env: QEnv, owner: string, name: string): Promise<Folder> {
	await ensure(env);
	const fo: Folder = { s: 'fo', id: new_id(), ow: owner, name, convs: [], d: Date.now() };
	await upsert(env, [{ id: fo.id, vector: ZV, payload: fo as unknown as Record<string, unknown> }]);
	return fo;
}
```

Also replace the two other `new Array(4096).fill(0)` literals with `ZV` in `save()` (line 32).

- [ ] **Step 4: Update the existing fixtures to the new key**

In `src/lib/server/__tests__/folders.test.ts`, replace every `owner: 'ada'` with `ow: 'ada'` — lines 30, 36, 44, 50, 56, 70. For example line 30 becomes:

```ts
expect(fo).toMatchObject({ s: 'fo', ow: 'ada', name: 'close friends', convs: [] });
```

- [ ] **Step 5: Run the full folders suite**

Run: `pnpm vitest run src/lib/server/__tests__/folders.test.ts`
Expected: PASS (all tests, including the new coherence test)

- [ ] **Step 6: Run the folder route suites**

Run: `pnpm vitest run src/routes/api/folders`
Expected: PASS — these mock the server module, so they should be unaffected; confirm no fixture references `owner`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/server/folders.ts src/lib/server/__tests__/folders.test.ts
git commit -m "fix: folders were never readable — payload wrote 'owner' but filters use the indexed 'ow'"
```

---

### Task 2: Modal component

No modal/dialog component exists. Two features need one (folder editor, create-room). Use the native `<dialog>` element: `showModal()` gives focus trapping, Esc-to-close, inert background and a `::backdrop` for free — no library, no focus-trap code.

**Files:**
- Create: `src/lib/components/Modal.svelte`
- Create: `src/lib/components/__tests__/ModalHost.test.svelte`
- Create: `src/lib/components/__tests__/Modal.test.ts`

**Interfaces:**
- Produces: `Modal` — props `{ open: boolean (bindable), title?: string, children: Snippet }`. Setting `open = true` shows it; Esc, backdrop click, and the close button all set `open = false`.

- [ ] **Step 1: Write the failing test host**

Create `src/lib/components/__tests__/ModalHost.test.svelte`:

```svelte
<script lang="ts">
	import Modal from '../Modal.svelte';
	let { open = $bindable(false) }: { open?: boolean } = $props();
</script>

<Modal bind:open title="edit folder">
	<p>modal body</p>
</Modal>
```

- [ ] **Step 2: Write the failing test**

Create `src/lib/components/__tests__/Modal.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ModalHost from './ModalHost.test.svelte';

// jsdom implements <dialog>, but guard so the suite fails loudly rather than mysteriously
beforeAll(() => {
	if (typeof HTMLDialogElement === 'undefined') throw new Error('jsdom lacks <dialog> support');
});

describe('Modal', () => {
	it('stays closed until `open` is set', () => {
		render(ModalHost, { props: { open: false } });
		expect((screen.getByRole('dialog', { hidden: true }) as HTMLDialogElement).open).toBe(false);
	});

	it('opens as a modal dialog and renders its title and children', async () => {
		render(ModalHost, { props: { open: true } });
		const dialog = screen.getByRole('dialog') as HTMLDialogElement;
		expect(dialog.open).toBe(true);
		expect(screen.getByText('edit folder')).toBeInTheDocument();
		expect(screen.getByText('modal body')).toBeInTheDocument();
	});

	it('closes when the close button is pressed', async () => {
		const { component } = render(ModalHost, { props: { open: true } });
		const dialog = screen.getByRole('dialog') as HTMLDialogElement;
		screen.getByRole('button', { name: 'close' }).click();
		await new Promise((r) => setTimeout(r, 0));
		expect(dialog.open).toBe(false);
		expect(component.open).toBe(false);
	});
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run src/lib/components/__tests__/Modal.test.ts`
Expected: FAIL — `Failed to resolve import "../Modal.svelte"`

- [ ] **Step 4: Write the component**

Create `src/lib/components/Modal.svelte`:

```svelte
<script lang="ts">
	import { X } from '@lucide/svelte';
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title = '',
		children
	}: { open?: boolean; title?: string; children: Snippet } = $props();

	// must be $state: bind:this on a plain `let` never re-runs the effect that opens the dialog
	let el: HTMLDialogElement | undefined = $state();

	$effect(() => {
		if (!el) return;
		if (open && !el.open) el.showModal();
		else if (!open && el.open) el.close();
	});
</script>

<dialog
	bind:this={el}
	class="max-h-[85dvh] w-[min(560px,92vw)] rounded-[18px] border border-line bg-panel-solid p-0 text-ink backdrop:bg-black/70 backdrop:backdrop-blur-sm"
	onclose={() => (open = false)}
	onclick={(e) => {
		// a click landing on the dialog itself (not its content box) is a backdrop click
		if (e.target === el) open = false;
	}}
>
	<div class="flex max-h-[85dvh] flex-col">
		<header class="flex items-center justify-between gap-4 border-b border-line px-5 py-4">
			<h2 class="font-display text-[19px] font-medium tracking-[-0.01em]">{title}</h2>
			<button
				class="bg-none leading-none text-ink-soft transition-colors duration-300 hover:text-accent"
				onclick={() => (open = false)}
				aria-label="close"
			>
				<X size={18} />
			</button>
		</header>
		<div class="min-h-0 flex-1 overflow-y-auto px-5 py-4">
			{@render children()}
		</div>
	</div>
</dialog>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run src/lib/components/__tests__/Modal.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/Modal.svelte src/lib/components/__tests__/Modal.test.ts src/lib/components/__tests__/ModalHost.test.svelte
git commit -m "feat: add Modal component built on native <dialog>"
```

---

### Task 3: Folder editor on the active pill

Replace the per-conversation `<select>` (a control repeated on every thread card) with a single edit button on the **active** folder pill. It opens a modal listing every conversation with a `+`/`−` toggle that adds/removes it from the active folder.

**Files:**
- Modify: `src/routes/app/+page.svelte:1-46` (script), `:189-249` (threads section)

**Interfaces:**
- Consumes: `Modal` from Task 2; `POST /api/folders/[id]` `{conv}` to assign; `DELETE /api/folders/[id]?conv=<id>` to unassign (both already exist).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the unassign helper and editor state**

In `src/routes/app/+page.svelte`, add the `Modal` and `Pencil` imports, and replace `assignToFolder` (lines 36-46) with a toggle pair:

```ts
	import Modal from '$lib/components/Modal.svelte';
	import { Search, FolderPlus, MessageCircle, Pencil, Plus, Minus } from '@lucide/svelte';
```

```ts
	let editingFolder = $state(false);
	let activeFolderObj = $derived(folders.find((fo) => fo.id === activeFolder) ?? null);
	const inFolder = (peer: string) => !!activeFolderObj?.convs.includes(peer);

	async function toggleInFolder(peer: string) {
		const folderId = activeFolder;
		if (!folderId) return;
		const adding = !inFolder(peer);
		// optimistic — the pill list and the filtered thread list both read from `folders`
		folders = folders.map((fo) =>
			fo.id !== folderId
				? fo
				: { ...fo, convs: adding ? [...fo.convs, peer] : fo.convs.filter((c) => c !== peer) }
		);
		const res = adding
			? await fetch(`/api/folders/${folderId}`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ conv: peer })
				})
			: await fetch(`/api/folders/${folderId}?conv=${encodeURIComponent(peer)}`, { method: 'DELETE' });
		if (!res.ok) {
			// roll back so the UI never claims a membership the server rejected
			folders = folders.map((fo) =>
				fo.id !== folderId
					? fo
					: { ...fo, convs: adding ? fo.convs.filter((c) => c !== peer) : [...fo.convs, peer] }
			);
		}
	}
```

- [ ] **Step 2: Put the edit button inside the active pill**

Replace the folder pill loop (lines 200-208) with:

```svelte
		{#each folders as fo (fo.id)}
			<div class="flex items-center">
				<button
					class="btn text-[12px] py-1.5 px-3"
					class:btn-amber={activeFolder === fo.id}
					class:!rounded-r-none={activeFolder === fo.id}
					onclick={() => (activeFolder = fo.id)}
				>
					{fo.name}
				</button>
				{#if activeFolder === fo.id}
					<button
						class="btn btn-amber !rounded-l-none border-l border-l-accent-ink/20 py-1.5 px-2.5 text-[12px]"
						onclick={() => (editingFolder = true)}
						aria-label="edit {fo.name}"
						title="add or remove chats"
					>
						<Pencil size={13} />
					</button>
				{/if}
			</div>
		{/each}
```

- [ ] **Step 3: Add the editor modal and delete the per-card select**

Add just before the closing `</section>` of the threads section (after the `{#if visibleConvs.length}` block, line 248):

```svelte
	<Modal bind:open={editingFolder} title="chats in “{activeFolderObj?.name ?? ''}”">
		{#if convs.length}
			<ul class="flex flex-col gap-2">
				{#each convs as c (c.peer)}
					{@const on = inFolder(c.peer)}
					<li class="flex items-center gap-3 rounded-[12px] border border-line bg-panel px-3 py-2">
						<span class="min-w-0 flex-1 truncate text-[14.5px] text-ink">{c.name}</span>
						<button
							class="btn shrink-0 px-3 py-1.5 text-[12px]"
							class:btn-amber={on}
							onclick={() => toggleInFolder(c.peer)}
							aria-label={on ? `remove ${c.name} from folder` : `add ${c.name} to folder`}
						>
							{#if on}<Minus size={13} />{:else}<Plus size={13} />{/if}
						</button>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-[14px] text-faint">no conversations to file yet.</p>
		{/if}
	</Modal>
```

Then delete the whole `{#if folders.length}` block containing the `<select>` (lines 232-242), leaving the thread card as just its clickable div.

- [ ] **Step 4: Verify by type-check**

Run: `pnpm check`
Expected: no new errors referencing `src/routes/app/+page.svelte`

- [ ] **Step 5: Verify no raw `<select>` remains**

Run: `grep -rn '<select' src/ --include='*.svelte'`
Expected: no output — `Select.svelte` is now the only select UI in the app (Task 4 depends on this).

- [ ] **Step 6: Commit**

```bash
git add src/routes/app/+page.svelte
git commit -m "feat: edit folder membership from the active pill instead of a select on every thread"
```

---

### Task 4: Themed scrollbars, and drop the now-dead `select` CSS

One global rule themes every scrollbar — the page and the `Select` listbox (`overflow-auto` on its `<ul>`) both inherit it, so no component change is needed. Task 3 removed the last native `<select>`, so its styling is dead code.

**Files:**
- Modify: `src/app.css:99-104` (delete), `:140` (selector), `:114` onward (add scrollbar block)

- [ ] **Step 1: Delete the dead `select` rules**

In `src/app.css`, remove these six lines from the `@layer components` block (lines 99-104):

```css
		select {
			@apply w-full rounded-[12px] border border-line bg-panel-solid px-4 py-3.5 text-[14px] text-ink outline-none transition-colors duration-300;
		}
		select:focus {
			@apply border-accent;
		}
```

And in the `@media (max-width: 640px)` block, change line 140 from `input, select, textarea {` to:

```css
		input, textarea {
```

- [ ] **Step 2: Add the scrollbar theme**

Insert after the `::selection` rule (currently lines 128-131), before the first `@media` block:

```css
/* ===== scrollbars: theme-colored thumb, no track background ===== */
* {
	scrollbar-width: thin;
	scrollbar-color: var(--color-line-2) transparent;
}
*::-webkit-scrollbar {
	width: 10px;
	height: 10px;
}
*::-webkit-scrollbar-track,
*::-webkit-scrollbar-corner {
	background: transparent;
}
/* transparent border + content-box clip inset the thumb without painting a track */
*::-webkit-scrollbar-thumb {
	background-color: var(--color-line-2);
	border: 3px solid transparent;
	background-clip: content-box;
	border-radius: 99px;
}
*::-webkit-scrollbar-thumb:hover {
	background-color: var(--color-accent);
}
```

- [ ] **Step 3: Verify the build compiles the CSS**

Run: `pnpm build`
Expected: build succeeds with no Tailwind/PostCSS error.

- [ ] **Step 4: Commit**

```bash
git add src/app.css
git commit -m "feat: theme scrollbars with a transparent track; drop dead native-select styling"
```

---

### Task 5: Remove `/random` completely

Deletes the discover route, its matchmaking Durable Object, the nav entry, the PWA shortcut, and the `auto=` call-autostart branch in the DM page. `MatchLobby` must be retired with a `deleted_classes` migration or the next `wrangler deploy` fails.

**Files:**
- Delete: `src/routes/app/random/+page.svelte`, `ws/src/lobby.ts`, `ws/src/__tests__/lobby.test.ts`, `src/lib/components/RadioGroup.svelte`, `src/lib/components/Radio.svelte`, `src/lib/components/__tests__/RadioGroup.test.ts`, `src/lib/components/__tests__/RadioGroupHost.test.svelte`
- Modify: `src/routes/+layout.svelte:10,36-41`; `ws/src/index.ts:6,20-24,85`; `ws/wrangler.jsonc:7-18`; `src/routes/api/wstoken/+server.ts:33`; `src/lib/server/chat.ts:121-125`; `src/lib/server/__tests__/chat.test.ts:33,167-176`; `static/manifest.webmanifest:43-47`; `src/lib/__tests__/pwa-assets.test.ts:135`; `src/routes/app/chat/[id]/+page.svelte:66-69,173-206,334-336`

- [ ] **Step 1: Update the PWA manifest and its test first**

In `static/manifest.webmanifest`, replace the shortcuts array:

```json
	"shortcuts": [
		{ "name": "Chats", "url": "/app" },
		{ "name": "Groups", "url": "/app/groups" }
	],
```

In `src/lib/__tests__/pwa-assets.test.ts:135`, change the expectation to:

```ts
			expect.arrayContaining(['/app', '/app/groups'])
```

- [ ] **Step 2: Run the PWA test to verify it passes**

Run: `pnpm vitest run src/lib/__tests__/pwa-assets.test.ts`
Expected: PASS

- [ ] **Step 3: Delete the route, the lobby DO, and the now-unused radio components**

```bash
rm -rf src/routes/app/random
rm ws/src/lobby.ts ws/src/__tests__/lobby.test.ts
rm src/lib/components/RadioGroup.svelte src/lib/components/Radio.svelte
rm src/lib/components/__tests__/RadioGroup.test.ts src/lib/components/__tests__/RadioGroupHost.test.svelte
```

`RadioGroup`/`Radio` had exactly one consumer (the deleted page); confirm with `grep -rn 'RadioGroup\|Radio\b' src/ --include='*.svelte' --include='*.ts'` returning nothing.

- [ ] **Step 4: Remove the nav entry**

In `src/routes/+layout.svelte`, drop `Shuffle` from the icon import (line 10) and delete the discover nav entry (line 39):

```ts
	import { Users, DoorOpen, UserRound, LogOut } from '@lucide/svelte';
```

```ts
	const nav = [
		{ href: '/app', label: 'people', icon: Users },
		{ href: '/app/groups', label: 'rooms', icon: DoorOpen },
		{ href: '/app/profile', label: 'profile', icon: UserRound }
	];
```

- [ ] **Step 5: Remove the lobby from the ws worker**

In `ws/src/index.ts`: delete the `MATCH_LOBBY` field from `interface Env` (line 6), delete the `/match` route block (lines 20-24), and delete the `export { MatchLobby } from './lobby';` line (85).

In `ws/wrangler.jsonc`, remove the `MATCH_LOBBY` binding and add a retirement migration:

```jsonc
	"durable_objects": {
		"bindings": [
			{ "name": "CHAT_HUB", "class_name": "ChatHub" },
			{ "name": "CREDIT_ACCOUNT", "class_name": "CreditAccount" }
		]
	},
	"migrations": [
		{ "tag": "v1", "new_sqlite_classes": ["ChatHub"] },
		{ "tag": "v2", "new_sqlite_classes": ["MatchLobby"] },
		{ "tag": "v3", "new_sqlite_classes": ["CreditAccount"] },
		// dropping a DO class without a deleted_classes migration fails the deploy
		{ "tag": "v4", "deleted_classes": ["MatchLobby"] }
	],
```

- [ ] **Step 6: Stop issuing the match URL**

In `src/routes/api/wstoken/+server.ts:33`, drop the `match` field:

```ts
	return json({ t, ws: `${ws_origin}/ws?${qs}` });
```

- [ ] **Step 7: Remove `record_match` and its test**

In `src/lib/server/chat.ts`, delete the `record_match` function (lines 121-125). Keep the `Match` type and the two `eq('s', 'x')` scrolls in `list_conversations` — historical match records still exist in Qdrant and should keep surfacing as threads.

In `src/lib/server/__tests__/chat.test.ts`, remove `record_match` from the import list (line 33) and delete the entire `describe('record_match', ...)` block (lines 167-176).

- [ ] **Step 8: Strip the auto-call branch from the DM page**

In `src/routes/app/chat/[id]/+page.svelte`:
- Delete the `auto` / `auto_tried` declarations and their comment (lines 66-69).
- Delete the auto-answer branch inside `handleSignal`'s `offer` case, leaving:

```ts
		} else if (m.signal.type === 'offer') {
			pendingOffer = m.signal.sdp!;
			callState = 'ringing';
		} else if (m.signal.type === 'answer' && pc) {
```

- Delete the `$effect` that auto-starts a call (lines 187-200) and the `findNew()` function (lines 202-206).
- Delete the `{#if auto}` block with the "find someone new" button (lines 334-336).

- [ ] **Step 9: Run the full suite and type-check**

Run: `pnpm test && pnpm check`
Expected: PASS — no test references `lobby`, `MatchLobby`, `record_match`, or `/app/random`.

- [ ] **Step 10: Commit**

```bash
git add src/routes/app/random ws/src/lobby.ts ws/src/__tests__/lobby.test.ts \
  src/lib/components/RadioGroup.svelte src/lib/components/Radio.svelte \
  src/lib/components/__tests__/RadioGroup.test.ts src/lib/components/__tests__/RadioGroupHost.test.svelte \
  src/routes/+layout.svelte ws/src/index.ts ws/wrangler.jsonc \
  src/routes/api/wstoken/+server.ts src/lib/server/chat.ts src/lib/server/__tests__/chat.test.ts \
  static/manifest.webmanifest src/lib/__tests__/pwa-assets.test.ts \
  src/routes/app/chat/\[id\]/+page.svelte
git commit -m "feat: remove /random discover flow, its match lobby DO, and the auto-call branch"
```

---

### Task 6: Fix call teardown + audio, via a shared `CallMesh`

Two real bugs, one shared fix:

1. **Peer keeps showing an active call after the other end hangs up.** `endCall()` only tears down locally — nothing is ever signalled to the peer. Declining also leaves the caller stuck on "calling…".
2. **No audio.** `remoteVideo`/`localVideo` are plain `let`s, not `$state()`. The `$effect` assigning `srcObject` tracks `remoteStream` but not the element ref, and the `<video>` only mounts once `callState === 'connected'` — which happens *after* `ontrack` fires. The effect therefore runs while the ref is still `undefined` and never re-runs, so `srcObject` is never set and nothing plays.

Both are fixed once, in shared code: a `CallMesh` (a 1:1 call is a mesh of one peer) and a `RemoteVideo` component that owns the `srcObject` wiring. Task 9 builds room calls on the same `CallMesh`.

**Files:**
- Create: `src/lib/call.ts`, `src/lib/__tests__/call.test.ts`, `src/lib/components/RemoteVideo.svelte`
- Modify: `src/routes/app/chat/[id]/+page.svelte:71-80,127-276,339-350`

**Interfaces:**
- Produces (consumed by Task 9):
  - `type CallSignal = {type:'join'} | {type:'here'} | {type:'offer'; sdp: RTCSessionDescriptionInit} | {type:'answer'; sdp: RTCSessionDescriptionInit} | {type:'ice'; candidate: RTCIceCandidateInit} | {type:'bye'}`
  - `class CallMesh` with constructor `(opts: MeshOpts)` and methods `open(video: boolean): Promise<MediaStream>`, `announce(members: string[]): void`, `invite(uid: string): Promise<void>`, `accept(uid: string): Promise<void>`, `handle(from: string, s: CallSignal): Promise<void>`, `setMic(on: boolean): void`, `setVideo(on: boolean): Promise<void>`, `hangup(silent?: boolean): void`, getters `peers: string[]` and `active: boolean`
  - `MeshOpts = { me: string; send(to: string, s: CallSignal): void; onremote(uid: string, stream: MediaStream | null): void; onincoming?(uid: string, sdp: RTCSessionDescriptionInit): void; makePC?(): RTCPeerConnection; getMedia?(c: MediaStreamConstraints): Promise<MediaStream> }`
  - `RemoteVideo` — props `{ stream: MediaStream | null; muted?: boolean; class?: string }`

- [ ] **Step 1: Write the failing CallMesh test**

Create `src/lib/__tests__/call.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { CallMesh, type CallSignal, type MeshOpts } from '../call';

class FakePC {
	localDescription: unknown = null;
	remoteDescription: unknown = null;
	ice: unknown[] = [];
	senders: { track: unknown }[] = [];
	closed = false;
	onicecandidate: ((e: { candidate: unknown }) => void) | null = null;
	ontrack: ((e: { streams: unknown[] }) => void) | null = null;
	onconnectionstatechange: (() => void) | null = null;
	connectionState = 'new';
	async createOffer() { return { type: 'offer', sdp: 'OFFER' }; }
	async createAnswer() { return { type: 'answer', sdp: 'ANSWER' }; }
	async setLocalDescription(d: unknown) { this.localDescription = d; }
	async setRemoteDescription(d: unknown) { this.remoteDescription = d; }
	async addIceCandidate(c: unknown) { this.ice.push(c); }
	addTrack(t: unknown) { this.senders.push({ track: t }); return { track: t }; }
	getSenders() { return this.senders; }
	close() { this.closed = true; }
}

type FakeTrack = { kind: string; enabled: boolean; stop: ReturnType<typeof vi.fn> };

const track = (kind: string): FakeTrack => ({ kind, enabled: true, stop: vi.fn() });

/** returns the MediaStream-shaped fake plus its track array, so tests can assert on stop() */
function fakeStream(): { stream: MediaStream; tracks: FakeTrack[] } {
	const tracks: FakeTrack[] = [track('audio')];
	const stream = {
		getTracks: () => tracks,
		getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
		getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
		addTrack: (t: FakeTrack) => tracks.push(t),
		removeTrack: (t: FakeTrack) => tracks.splice(tracks.indexOf(t), 1)
	} as unknown as MediaStream;
	return { stream, tracks };
}

function harness(me: string, opts: Partial<MeshOpts> = {}) {
	const sent: { to: string; signal: CallSignal }[] = [];
	const remotes: { uid: string; stream: MediaStream | null }[] = [];
	const pcs: FakePC[] = [];
	const made: FakeTrack[][] = [];
	const mesh = new CallMesh({
		me,
		send: (to, signal) => sent.push({ to, signal }),
		onremote: (uid, stream) => remotes.push({ uid, stream }),
		makePC: () => { const pc = new FakePC(); pcs.push(pc); return pc as unknown as RTCPeerConnection; },
		getMedia: async () => { const { stream, tracks } = fakeStream(); made.push(tracks); return stream; },
		...opts
	});
	return { mesh, sent, remotes, pcs, made };
}

describe('CallMesh glare avoidance', () => {
	it('offers to a joiner whose uid sorts above mine', async () => {
		const { mesh, sent } = harness('alice');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'join' });
		expect(sent).toEqual([{ to: 'bob', signal: { type: 'offer', sdp: { type: 'offer', sdp: 'OFFER' } } }]);
	});

	it('replies "here" instead of offering when the joiner sorts below me', async () => {
		const { mesh, sent } = harness('zoe');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'join' });
		expect(sent).toEqual([{ to: 'bob', signal: { type: 'here' } }]);
	});

	it('offers on "here" from a peer that sorts above me', async () => {
		const { mesh, sent } = harness('alice');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'here' });
		expect(sent[0].signal.type).toBe('offer');
	});

	it('ignores a join while not in a call', async () => {
		const { mesh, sent } = harness('alice');
		await mesh.handle('bob', { type: 'join' });
		expect(sent).toEqual([]);
	});
});

describe('CallMesh teardown', () => {
	it('closes the peer connection on bye and reports the peer gone, without echoing bye', async () => {
		const { mesh, sent, remotes, pcs } = harness('alice');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'join' });
		sent.length = 0;

		await mesh.handle('bob', { type: 'bye' });

		expect(pcs[0].closed).toBe(true);
		expect(remotes.at(-1)).toEqual({ uid: 'bob', stream: null });
		expect(sent).toEqual([]);
		expect(mesh.peers).toEqual([]);
	});

	it('sends bye to every peer and stops local tracks on hangup', async () => {
		const { mesh, sent, made } = harness('alice');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'join' });
		await mesh.handle('carol', { type: 'join' });
		sent.length = 0;

		mesh.hangup();

		expect(sent.map((s) => s.to).sort()).toEqual(['bob', 'carol']);
		expect(sent.every((s) => s.signal.type === 'bye')).toBe(true);
		expect(made[0][0].stop).toHaveBeenCalled();
		expect(mesh.active).toBe(false);
	});

	it('sends no bye when hanging up silently (socket already down)', async () => {
		const { mesh, sent } = harness('alice');
		await mesh.open(false);
		await mesh.handle('bob', { type: 'join' });
		sent.length = 0;
		mesh.hangup(true);
		expect(sent).toEqual([]);
	});
});

describe('CallMesh 1:1 ring flow', () => {
	it('invite() offers regardless of uid ordering', async () => {
		const { mesh, sent } = harness('zoe');
		await mesh.open(false);
		await mesh.invite('bob');
		expect(sent[0]).toMatchObject({ to: 'bob', signal: { type: 'offer' } });
	});

	it('rings instead of auto-answering when onincoming is supplied', async () => {
		const incoming: string[] = [];
		const { mesh, sent } = harness('alice', { onincoming: (uid: string) => incoming.push(uid) });
		await mesh.handle('bob', { type: 'offer', sdp: { type: 'offer', sdp: 'REMOTE' } });

		expect(incoming).toEqual(['bob']);
		expect(sent).toEqual([]);

		await mesh.open(false);
		await mesh.accept('bob');
		expect(sent[0]).toMatchObject({ to: 'bob', signal: { type: 'answer' } });
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/__tests__/call.test.ts`
Expected: FAIL — `Failed to resolve import "../call"`

- [ ] **Step 3: Write `src/lib/call.ts`**

```ts
// Shared WebRTC mesh. A 1:1 call is a mesh of one peer, so the DM page and the room page
// run the same connection, teardown and glare logic.
//
// Pairing rule: a joiner broadcasts `join`. A member already in the call either offers
// (when its own uid sorts lower) or answers with `here`, which prompts the lower-sorting
// joiner to offer. Exactly one offer per pair, from the lexicographically-lower uid.
//
// ponytail: full mesh — N*(N-1)/2 connections and N-1 uplinks per participant. Fine to
// ~4-6 people; move to an SFU (Cloudflare Calls) if rooms need to get bigger.

export type CallSignal =
	| { type: 'join' }
	| { type: 'here' }
	| { type: 'offer'; sdp: RTCSessionDescriptionInit }
	| { type: 'answer'; sdp: RTCSessionDescriptionInit }
	| { type: 'ice'; candidate: RTCIceCandidateInit }
	| { type: 'bye' };

export type MeshOpts = {
	me: string;
	send: (to: string, signal: CallSignal) => void;
	onremote: (uid: string, stream: MediaStream | null) => void;
	/** supplied by 1:1 callers that want a ring UI; omitted = auto-answer (rooms) */
	onincoming?: (uid: string, sdp: RTCSessionDescriptionInit) => void;
	makePC?: () => RTCPeerConnection;
	getMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
};

// ponytail: free Google STUN only — add TURN for symmetric NATs in prod
const STUN: RTCIceServer = { urls: 'stun:stun.l.google.com:19302' };

export class CallMesh {
	private o: MeshOpts;
	private pcs = new Map<string, RTCPeerConnection>();
	private pending = new Map<string, RTCSessionDescriptionInit>();
	private local: MediaStream | null = null;

	constructor(opts: MeshOpts) {
		this.o = opts;
	}

	get peers(): string[] {
		return [...this.pcs.keys()];
	}

	/** true once local media is open — i.e. we are actually in the call */
	get active(): boolean {
		return this.local !== null;
	}

	get stream(): MediaStream | null {
		return this.local;
	}

	async open(video: boolean): Promise<MediaStream> {
		if (this.local) return this.local;
		const get = this.o.getMedia ?? ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c));
		this.local = await get({ audio: true, video });
		return this.local;
	}

	/** tell every member we've joined; those already in the call will connect to us */
	announce(members: string[]): void {
		for (const uid of members) if (uid !== this.o.me) this.o.send(uid, { type: 'join' });
	}

	/** 1:1 caller — force an offer without waiting for the join/here handshake */
	async invite(uid: string): Promise<void> {
		await this.offer(uid);
	}

	/** 1:1 callee — answer an offer that was surfaced through onincoming */
	async accept(uid: string): Promise<void> {
		const sdp = this.pending.get(uid);
		if (!sdp) return;
		this.pending.delete(uid);
		await this.answer(uid, sdp);
	}

	async handle(from: string, s: CallSignal): Promise<void> {
		switch (s.type) {
			case 'join':
				if (!this.active) return;
				if (this.o.me < from) await this.offer(from);
				else this.o.send(from, { type: 'here' });
				return;
			case 'here':
				if (!this.active) return;
				if (this.o.me < from) await this.offer(from);
				return;
			case 'offer':
				if (this.o.onincoming && !this.active) {
					this.pending.set(from, s.sdp);
					this.o.onincoming(from, s.sdp);
					return;
				}
				if (!this.active) return; // room member who hasn't joined the call
				await this.answer(from, s.sdp);
				return;
			case 'answer':
				await this.pcs.get(from)?.setRemoteDescription(s.sdp).catch(() => {});
				return;
			case 'ice':
				await this.pcs.get(from)?.addIceCandidate(s.candidate).catch(() => {});
				return;
			case 'bye':
				this.drop(from);
				return;
		}
	}

	setMic(on: boolean): void {
		for (const t of this.local?.getAudioTracks() ?? []) t.enabled = on;
	}

	async setVideo(on: boolean): Promise<void> {
		if (!this.local) return;
		if (on) {
			const get = this.o.getMedia ?? ((c: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(c));
			const s = await get({ video: true });
			for (const t of s.getVideoTracks()) this.local.addTrack(t);
		} else {
			for (const t of this.local.getVideoTracks()) {
				t.stop();
				this.local.removeTrack(t);
			}
		}
		// re-point every existing sender at the current track set
		for (const pc of this.pcs.values()) {
			for (const t of this.local.getTracks()) {
				const sender = pc.getSenders().find((x) => x.track?.kind === t.kind);
				if (sender) await sender.replaceTrack(t).catch(() => {});
			}
		}
	}

	/** leave the call. `silent` skips the bye signals (socket already down). */
	hangup(silent = false): void {
		for (const uid of [...this.pcs.keys()]) {
			if (!silent) this.o.send(uid, { type: 'bye' });
			this.pcs.get(uid)?.close();
			this.pcs.delete(uid);
		}
		this.pending.clear();
		for (const t of this.local?.getTracks() ?? []) t.stop();
		this.local = null;
	}

	private drop(uid: string): void {
		this.pcs.get(uid)?.close();
		this.pcs.delete(uid);
		this.pending.delete(uid);
		this.o.onremote(uid, null);
	}

	private pc(uid: string): RTCPeerConnection {
		const existing = this.pcs.get(uid);
		if (existing) return existing;
		const pc = (this.o.makePC ?? (() => new RTCPeerConnection({ iceServers: [STUN] })))();
		pc.onicecandidate = (e) => {
			if (e.candidate) this.o.send(uid, { type: 'ice', candidate: e.candidate.toJSON() });
		};
		pc.ontrack = (e) => this.o.onremote(uid, e.streams[0]);
		pc.onconnectionstatechange = () => {
			// covers the peer vanishing without a bye (tab killed, network dropped)
			if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) this.drop(uid);
		};
		for (const t of this.local?.getTracks() ?? []) pc.addTrack(t, this.local!);
		this.pcs.set(uid, pc);
		return pc;
	}

	private async offer(uid: string): Promise<void> {
		const pc = this.pc(uid);
		const o = await pc.createOffer();
		await pc.setLocalDescription(o);
		this.o.send(uid, { type: 'offer', sdp: o });
	}

	private async answer(uid: string, sdp: RTCSessionDescriptionInit): Promise<void> {
		const pc = this.pc(uid);
		await pc.setRemoteDescription(sdp);
		const a = await pc.createAnswer();
		await pc.setLocalDescription(a);
		this.o.send(uid, { type: 'answer', sdp: a });
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/__tests__/call.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Write the `RemoteVideo` component**

Create `src/lib/components/RemoteVideo.svelte`. This is the audio fix: `el` is `$state()`, so the effect re-runs when `bind:this` populates it after the element mounts.

```svelte
<script lang="ts">
	let {
		stream,
		muted = false,
		class: cls = ''
	}: { stream: MediaStream | null; muted?: boolean; class?: string } = $props();

	// MUST be $state — a plain `let` never re-triggers the effect when bind:this lands,
	// which is exactly how remote audio silently never played before.
	let el: HTMLVideoElement | undefined = $state();

	$effect(() => {
		if (!el) return;
		el.srcObject = stream;
		// autoplay with audio is gesture-gated; the call button is that gesture, but a
		// rejected play() must never throw into the effect
		if (stream) el.play().catch(() => {});
	});
</script>

<!-- svelte-ignore a11y_media_has_caption -->
<video bind:this={el} autoplay playsinline {muted} class={cls}></video>
```

- [ ] **Step 6: Rewrite the DM page's call layer onto CallMesh**

In `src/routes/app/chat/[id]/+page.svelte`, add imports:

```ts
	import { CallMesh, type CallSignal } from '$lib/call';
	import RemoteVideo from '$lib/components/RemoteVideo.svelte';
```

Replace the WebRTC block (lines 71-80: `pc`, `localStream`, `remoteStream`, `callState`, `videoOn`, `micOn`, `pendingOffer`, `stun`) with:

```ts
	let mesh: CallMesh | null = null;
	let localStream = $state<MediaStream | null>(null);
	let remoteStream = $state<MediaStream | null>(null);
	let callState = $state<'idle' | 'calling' | 'ringing' | 'connected'>('idle');
	let videoOn = $state(false);
	let micOn = $state(true);

	function resetCall() {
		mesh = null;
		localStream = null;
		remoteStream = null;
		callState = 'idle';
		micOn = true;
	}

	function makeMesh(): CallMesh {
		return new CallMesh({
			me: me!,
			send: (to, signal) => ws_send({ type: 'signal', to, signal }),
			onremote: (uid, stream) => {
				if (uid !== data.peer) return;
				if (!stream) return resetCall(); // peer hung up or dropped
				remoteStream = stream;
				callState = 'connected';
			},
			onincoming: () => (callState = 'ringing')
		});
	}
```

Replace `createPC`, `handleSignal`, `startCall`, `answerCall`, `toggleVideo`, `toggleMic`, `endCall` and the two `$effect`s wiring `srcObject` (lines 157-266) with:

```ts
	async function startCall() {
		mesh = makeMesh();
		localStream = await mesh.open(videoOn);
		await mesh.invite(data.peer);
		callState = 'calling';
	}

	async function answerCall() {
		if (!mesh) return;
		localStream = await mesh.open(videoOn);
		await mesh.accept(data.peer);
		callState = 'connected';
	}

	async function toggleVideo() {
		videoOn = !videoOn;
		await mesh?.setVideo(videoOn);
	}

	function toggleMic() {
		micOn = !micOn;
		mesh?.setMic(micOn);
	}

	/** hangs up locally AND tells the peer, so their UI leaves the call too */
	function endCall(silent = false) {
		mesh?.hangup(silent);
		resetCall();
	}
```

In `connect()` (lines 129-152), change the `ws_down` branch and the `signal` branch:

```ts
			if (m.type === 'ws_down') {
				console.warn('[CHAT-CLIENT] ws_down — marking peer offline');
				online = false;
				endCall(true); // socket is gone; a bye would never arrive
			} else if (m.type === 'presence' && m.uid === data.peer) {
```

```ts
			} else if (m.type === 'signal' && m.from === data.peer) {
				// lazily create the mesh so an inbound offer can ring before we've called
				mesh ??= makeMesh();
				mesh.handle(m.from as string, m.signal as CallSignal);
			}
```

- [ ] **Step 7: Swap the video markup to `RemoteVideo`**

Replace the `{#if callState === 'connected'}` video block (lines 339-350) with:

```svelte
	{#if callState === 'connected'}
		<div class="relative mb-4 overflow-hidden rounded-lg border border-line bg-black">
			<RemoteVideo stream={remoteStream} class="w-full max-h-[300px] object-contain" />
			{#if localStream}
				<RemoteVideo
					stream={localStream}
					muted
					class="absolute bottom-3 right-3 h-24 w-32 rounded-lg border border-line bg-black object-cover"
				/>
			{/if}
		</div>
	{/if}
```

- [ ] **Step 8: Type-check and run the suite**

Run: `pnpm check && pnpm test`
Expected: PASS, no errors in `chat/[id]/+page.svelte` or `call.ts`

- [ ] **Step 9: Manual verification (two browser profiles, `pnpm dev:full`)**

1. Sign in as two users, open the same DM thread in each.
2. A calls, B answers → **both** hear audio (this is the regression that was broken).
3. A presses hang up → **B's UI returns to idle**, no lingering call bar.
4. A calls, B declines → A's UI leaves "calling…" immediately.

- [ ] **Step 10: Commit**

```bash
git add src/lib/call.ts src/lib/__tests__/call.test.ts src/lib/components/RemoteVideo.svelte src/routes/app/chat/\[id\]/+page.svelte
git commit -m "fix: signal hang-up to the peer and bind srcObject via \$state so call audio actually plays"
```

---

### Task 7: Rename `/app/groups` → `/app/rooms`

UI route only. `/api/groups/*`, `$lib/server/group.ts` and the Qdrant payload `s: 'g'` are deliberately untouched.

**Files:**
- Move: `src/routes/app/groups/` → `src/routes/app/rooms/`
- Modify: `src/routes/+layout.svelte:38`; `src/routes/app/rooms/+page.svelte:40,51`; `src/routes/app/rooms/[id]/+page.svelte:86,123`; `src/routes/app/user/[id]/+page.svelte:98`; `src/routes/api/send/+server.ts:105`; `src/lib/server/scheduled.ts:107`; `static/manifest.webmanifest`; `src/lib/__tests__/pwa-assets.test.ts:135`

- [ ] **Step 1: Move the directory**

```bash
git mv src/routes/app/groups src/routes/app/rooms
```

- [ ] **Step 2: Update every UI route reference**

- `src/routes/+layout.svelte:38` → `{ href: '/app/rooms', label: 'rooms', icon: DoorOpen },`
- `src/routes/app/rooms/+page.svelte:40` → `goto(\`/app/rooms/${g.id}\`);`
- `src/routes/app/rooms/+page.svelte:51` → `goto(\`/app/rooms/${g.id}\`);`
- `src/routes/app/rooms/+page.svelte:84` → `href="/app/rooms/{g.id}"`
- `src/routes/app/rooms/+page.svelte:101` → `onclick={() => (joined ? goto(\`/app/rooms/${g.id}\`) : join(g))}`
- `src/routes/app/rooms/[id]/+page.svelte:86` → `if (res.ok) goto('/app/rooms');`
- `src/routes/app/rooms/[id]/+page.svelte:123` → `onclick={() => goto('/app/rooms')}`
- `src/routes/app/user/[id]/+page.svelte:98` → `href="/app/rooms/{g.id}"`

- [ ] **Step 3: Update the two notification deep-links**

These are UI URLs opened by a notification tap — leaving them at `/app/groups` would 404.

`src/routes/api/send/+server.ts:105`:

```ts
					url: `/app/rooms/${group}`,
```

`src/lib/server/scheduled.ts:107`:

```ts
						url: `/app/rooms/${sm.group}`,
```

- [ ] **Step 4: Update the manifest shortcut and its test**

`static/manifest.webmanifest`:

```json
	"shortcuts": [
		{ "name": "Chats", "url": "/app" },
		{ "name": "Rooms", "url": "/app/rooms" }
	],
```

`src/lib/__tests__/pwa-assets.test.ts:135`:

```ts
			expect.arrayContaining(['/app', '/app/rooms'])
```

- [ ] **Step 5: Verify no UI route reference survives**

Run: `grep -rn '/app/groups' src/ static/ --include='*.svelte' --include='*.ts' --include='*.webmanifest'`
Expected: no output. (`/api/groups` hits are expected and must remain — verify with `grep -rn "'/api/groups" src/` returning the fetch calls in `rooms/+page.svelte` and `rooms/[id]/+page.svelte`.)

- [ ] **Step 6: Run the suite and type-check**

Run: `pnpm test && pnpm check`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/routes/app/groups src/routes/app/rooms src/routes/+layout.svelte \
  src/routes/app/user/\[id\]/+page.svelte src/routes/api/send/+server.ts \
  src/lib/server/scheduled.ts static/manifest.webmanifest src/lib/__tests__/pwa-assets.test.ts
git commit -m "refactor: rename the /app/groups route to /app/rooms"
```

---

### Task 8: Create-room modal + one-line description in search results

**Files:**
- Modify: `src/routes/app/rooms/+page.svelte:1-16` (imports/state), `:77-111` (search results), `:113-127` (create form)

- [ ] **Step 1: Truncate the description in search results**

In `src/routes/app/rooms/+page.svelte`, change the search-result description (line 95) to clamp to one line. Leave the "your rooms" list (line 137) at full length.

```svelte
					{#if g.description}
						<p class="mt-1.5 max-w-[60ch] truncate text-[14.5px] leading-[1.5] text-ink-soft">{g.description}</p>
					{/if}
```

- [ ] **Step 2: Import Modal and add the open flag**

```ts
	import Modal from '$lib/components/Modal.svelte';
	import { Search, Plus, Users } from '@lucide/svelte';
```

```ts
	let creatingOpen = $state(false);
```

- [ ] **Step 3: Close the modal on successful create**

In `create()`, the `goto` already navigates away, but the flag must be cleared so a back-navigation doesn't reopen it. Change the tail of `create()`:

```ts
		const { g } = await res.json();
		creatingOpen = false;
		goto(`/app/rooms/${g.id}`);
```

- [ ] **Step 4: Replace the inline form section with a trigger + modal**

Replace the whole `start a room` section (lines 113-127) with:

```svelte
<section class="mb-[64px]">
	<button class="btn btn-amber flex items-center gap-1.5" onclick={() => (creatingOpen = true)}>
		<Plus size={15} /> start a room
	</button>
</section>

<Modal bind:open={creatingOpen} title="start a room">
	<form class="flex flex-col gap-3" onsubmit={(e) => (e.preventDefault(), create())}>
		<input bind:value={name} placeholder="room name" maxlength="60" />
		<textarea
			bind:value={description}
			rows="3"
			placeholder="what is this room about? this is what people search against."
		></textarea>
		<button class="btn btn-amber flex items-center gap-1.5 self-start" type="submit" disabled={creating}>
			<Plus size={15} /> {creating ? 'creating' : 'create room'}
		</button>
		{#if err}<p class="text-[13px] text-red-400">{err}</p>{/if}
	</form>
</Modal>
```

Also update the empty-search copy on line 109, which referred to the form being "below":

```svelte
	{:else if searching === false && q}
		<p class="mt-6 text-[14.5px] text-faint">nothing matched. start the room yourself.</p>
```

- [ ] **Step 5: Type-check**

Run: `pnpm check`
Expected: no errors in `rooms/+page.svelte`

- [ ] **Step 6: Commit**

```bash
git add src/routes/app/rooms/+page.svelte
git commit -m "feat: move room creation into a modal, clamp search-result descriptions to one line"
```

---

### Task 9: Room calls (mesh) on `/app/rooms/[id]`

Builds directly on `CallMesh` from Task 6. Signalling reuses the existing `signal` message type in `ChatHub` unchanged — each offer/answer/ice is already addressed to a single `to` uid, and `join` fan-out happens client-side over `g.members`.

**Files:**
- Modify: `src/routes/app/rooms/[id]/+page.svelte:1-33` (imports/state), `:94-116` (ws handler), `:134-143` (header controls), and the thread area for the call strip

**Interfaces:**
- Consumes: `CallMesh`, `CallSignal` from `$lib/call`; `RemoteVideo` from `$lib/components/RemoteVideo.svelte`; `ws_send` from `$lib/ws`

- [ ] **Step 1: Add call state and the mesh**

In `src/routes/app/rooms/[id]/+page.svelte`, extend the imports:

```ts
	import { ws_on, ws_send } from '$lib/ws';
	import { CallMesh, type CallSignal } from '$lib/call';
	import RemoteVideo from '$lib/components/RemoteVideo.svelte';
	import { ArrowLeft, Image, Send as SendIcon, Phone, PhoneOff, Mic, MicOff, Video, VideoOff } from '@lucide/svelte';
```

Add after the `owner` derivation (line 22):

```ts
	// ponytail: full mesh — every participant connects to every other. Comfortable to ~4-6
	// people; an SFU is the upgrade path if rooms need to be bigger.
	let mesh: CallMesh | null = null;
	let inCall = $state(false);
	let localStream = $state<MediaStream | null>(null);
	let remotes = $state<{ uid: string; stream: MediaStream }[]>([]);
	let micOn = $state(true);
	let videoOn = $state(false);

	function makeMesh(): CallMesh {
		return new CallMesh({
			me: me!,
			send: (to, signal) => ws_send({ type: 'signal', to, signal }),
			onremote: (uid, stream) => {
				remotes = stream
					? [...remotes.filter((r) => r.uid !== uid), { uid, stream }]
					: remotes.filter((r) => r.uid !== uid);
			}
			// no onincoming: room calls auto-answer once you've joined
		});
	}

	async function joinCall() {
		mesh ??= makeMesh();
		localStream = await mesh.open(videoOn);
		inCall = true;
		mesh.announce(g.members);
	}

	function leaveCall(silent = false) {
		mesh?.hangup(silent);
		mesh = null;
		inCall = false;
		localStream = null;
		remotes = [];
		micOn = true;
		videoOn = false;
	}

	function toggleMic() {
		micOn = !micOn;
		mesh?.setMic(micOn);
	}

	async function toggleVideo() {
		videoOn = !videoOn;
		await mesh?.setVideo(videoOn);
	}
```

- [ ] **Step 2: Route `signal` messages into the mesh**

In `onMount`, the current handler returns early on anything that isn't a room message. Replace the body of the `ws_on` callback (lines 95-113) so signals are handled first:

```ts
		unsub = ws_on((m) => {
			if (m.type === 'ws_down') return leaveCall(true);
			if (m.type === 'signal') {
				// a `join` from someone else is ignored by the mesh until we've joined too
				mesh ??= makeMesh();
				mesh.handle(m.from as string, m.signal as CallSignal);
				return;
			}
			if (m.type !== 'msg' || m.group !== g.id) return;
			names = { ...names, [m.from as string]: (m.from_name as string) ?? (m.from as string) };
			messages = [
				...messages,
				{
					s: 'm',
					id: (m.id as string) ?? String(m.ts),
					c: '',
					f: m.from as string,
					t: '',
					gr: g.id,
					x: (m.text as string) ?? '',
					im: m.image as string | undefined,
					d: m.ts as number
				}
			];
			scroll_down();
		});
```

And extend `onDestroy` (line 116) so navigating away leaves the call:

```ts
	onDestroy(() => {
		leaveCall();
		unsub?.();
	});
```

- [ ] **Step 3: Add the call controls to the header**

In the header's control cluster (lines 134-142), add call buttons before the membership button, gated on membership:

```svelte
		<div class="ml-auto flex flex-wrap items-center gap-2">
			{#if mine && !inCall}
				<button class="btn btn-ghost flex items-center gap-1.5 px-4 py-2 text-[12px]" onclick={joinCall}>
					<Phone size={14} /> join call
				</button>
			{/if}
			{#if inCall}
				<button class="btn btn-ghost flex items-center gap-1.5 px-3 py-2 text-[12px]" onclick={toggleMic}>
					{#if micOn}<Mic size={14} />{:else}<MicOff size={14} />{/if}
				</button>
				<button class="btn btn-ghost flex items-center gap-1.5 px-3 py-2 text-[12px]" onclick={toggleVideo}>
					{#if videoOn}<Video size={14} />{:else}<VideoOff size={14} />{/if}
				</button>
				<button
					class="btn btn-ghost flex items-center gap-1.5 px-4 py-2 text-[12px] text-red-500"
					onclick={() => leaveCall()}
				>
					<PhoneOff size={14} /> leave
				</button>
			{/if}
			{#if owner}
				<button class="btn px-4 py-2 text-[12px]" onclick={() => (editing = !editing)}>{editing ? 'close' : 'edit'}</button>
			{:else if mine}
				<button class="btn px-4 py-2 text-[12px]" onclick={() => membership('leave')}>leave room</button>
			{:else}
				<button class="btn btn-amber px-4 py-2 text-[12px]" onclick={() => membership('join')}>join</button>
			{/if}
		</div>
```

- [ ] **Step 4: Add the participant strip**

Insert directly after the header's closing `</header>` (before the `{#if editing}` block on line 145):

```svelte
	{#if inCall}
		<div class="flex flex-wrap items-center gap-2 border-b border-line py-3">
			<span class="eyebrow mr-2">in call · {remotes.length + 1}</span>
			{#if localStream}
				<RemoteVideo
					stream={localStream}
					muted
					class="h-20 w-28 rounded-[10px] border border-accent bg-black object-cover"
				/>
			{/if}
			{#each remotes as r (r.uid)}
				<div class="flex flex-col items-center gap-1">
					<RemoteVideo
						stream={r.stream}
						class="h-20 w-28 rounded-[10px] border border-line bg-black object-cover"
					/>
					<span class="max-w-[112px] truncate text-[10.5px] text-mute">{names[r.uid] ?? 'someone'}</span>
				</div>
			{/each}
		</div>
	{/if}
```

- [ ] **Step 5: Type-check**

Run: `pnpm check`
Expected: no errors in `rooms/[id]/+page.svelte`

- [ ] **Step 6: Manual verification (three browser profiles, `pnpm dev:full`)**

1. Three signed-in users all join the same room and press "join call".
2. Each sees two remote tiles and hears both others (mesh is fully connected).
3. One presses "leave" → their tile disappears from the other two within a second.
4. One closes the tab without leaving → `onconnectionstatechange` drops them from the other two.

- [ ] **Step 7: Commit**

```bash
git add src/routes/app/rooms/\[id\]/+page.svelte
git commit -m "feat: mesh audio/video calls in rooms, reusing the 1:1 CallMesh and signal routing"
```

---

### Task 10: Search — plain button label + filter by online

Presence lives per-uid in `ChatHub` (`/check` returns whether that uid has an open socket). There is no bulk online index, so the filter fans out one DO check per candidate. Capped at 100 uids to bound subrequests. The check fails open — if the ws worker is unreachable we return unfiltered results plus `filtered: false`, so the UI can say so rather than silently lying about who is online.

**Files:**
- Create: `ws/src/online.ts`, `ws/src/__tests__/online.test.ts`
- Modify: `ws/src/index.ts` (route), `src/routes/api/search/+server.ts`, `src/routes/app/+page.svelte:69-114,116-146`

**Interfaces:**
- Produces: `online(body: unknown, ns: HubNs) => Promise<string[] | null>` in `ws/src/online.ts`; `POST /online {uids: string[]} => {online: string[]}` on the ws worker; `GET /api/search?online=1` returning `{ r: [...], filtered: boolean }`

- [ ] **Step 1: Write the failing online-fanout test**

Create `ws/src/__tests__/online.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { online } from '../online';

function ns(states: Record<string, boolean>, throwFor: string[] = []) {
	return {
		idFromName: (n: string) => n,
		get: (id: unknown) => ({
			fetch: async () => {
				const uid = id as string;
				if (throwFor.includes(uid)) throw new Error('DO unreachable');
				return new Response(JSON.stringify({ online: states[uid] ?? false }));
			}
		})
	};
}

describe('online', () => {
	it('returns only the uids with a live socket', async () => {
		const r = await online({ uids: ['ada', 'bob', 'cy'] }, ns({ ada: true, bob: false, cy: true }));
		expect(r?.sort()).toEqual(['ada', 'cy']);
	});

	it('treats an unreachable hub as offline rather than failing the batch', async () => {
		const r = await online({ uids: ['ada', 'bob'] }, ns({ ada: true, bob: true }, ['bob']));
		expect(r).toEqual(['ada']);
	});

	it('rejects a malformed body', async () => {
		expect(await online(null, ns({}))).toBeNull();
		expect(await online({ uids: 'nope' }, ns({}))).toBeNull();
	});

	it('caps the fan-out so one request cannot blow the subrequest budget', async () => {
		const uids = Array.from({ length: 250 }, (_, i) => `u${i}`);
		const states = Object.fromEntries(uids.map((u) => [u, true]));
		const r = await online({ uids }, ns(states));
		expect(r).toHaveLength(100);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run ws/src/__tests__/online.test.ts`
Expected: FAIL — `Failed to resolve import "../online"`

- [ ] **Step 3: Write `ws/src/online.ts`**

```ts
import type { HubNs } from './relay';

/** how many presence checks one request may fan out to — bounds the subrequest budget */
export const MAX_CHECKS = 100;

/** uids from `body.uids` that currently have at least one open socket on their ChatHub */
export async function online(body: unknown, ns: HubNs): Promise<string[] | null> {
	if (!body || typeof body !== 'object') return null;
	const uids = (body as { uids?: unknown }).uids;
	if (!Array.isArray(uids)) return null;

	const checked = await Promise.all(
		(uids as string[]).slice(0, MAX_CHECKS).map(async (uid) => {
			try {
				const stub = ns.get(ns.idFromName(uid));
				const res = await stub.fetch(new Request('https://dummy/check'));
				const data = (await res.json()) as { online?: boolean };
				return data?.online ? uid : null;
			} catch {
				// an unreachable hub means we cannot prove they're online — treat as offline
				return null;
			}
		})
	);
	return checked.filter((u): u is string => u !== null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run ws/src/__tests__/online.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Route it in the ws worker**

In `ws/src/index.ts`, add the import alongside `relay`:

```ts
import { relay } from './relay';
import { online } from './online';
```

And add the route just after the `/relay` block:

```ts
		if (url.pathname === '/online' && request.method === 'POST') {
			const body = await request.json().catch(() => null);
			const uids = await online(body, env.CHAT_HUB);
			if (!uids) return new Response('bad body', { status: 400 });
			return Response.json({ online: uids });
		}
```

- [ ] **Step 6: Add the filter to the search endpoint**

In `src/routes/api/search/+server.ts`, change the handler signature to take `locals` (already present) and replace the tail of the function (lines 25-48):

```ts
	const only_online = url.searchParams.get('online') === '1';
	// over-fetch when filtering, since most candidates will be offline at any moment
	const hits = await search(env, vec, f(...conds), only_online ? 60 : 20);
	const { Country } = await import('country-state-city');
	let r = hits
		.map((h) => {
			const u = h.payload as unknown as User;
			const wu = u.w && u.co
				? `https://wa.me/${Country.getCountryByCode(u.co)?.phonecode ?? ''}${u.w}`
				: undefined;
			return {
				id: String(h.id),
				n: u.u ?? u.n,
				a: u.a,
				g: u.ag,
				r: u.r,
				co: u.co,
				st: u.st,
				ci: u.ci,
				w: u.w,
				wu,
				s: h.score
			};
		})
		.filter((x) => x.id !== locals.user!.id);

	// presence is per-uid in ChatHub with no bulk index, so this fans out one check per
	// candidate. Fails open: an unreachable ws worker returns everyone, flagged, rather
	// than an empty page that would read as "nobody is online".
	let filtered = true;
	if (only_online) {
		try {
			const res = await locals.x2_ws.fetch('https://x2-ws/online', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ uids: r.map((x) => x.id) })
			});
			const data = (await res.json()) as { online?: unknown };
			if (!Array.isArray(data?.online)) throw new Error('bad presence response');
			const live = new Set(data.online as string[]);
			r = r.filter((x) => live.has(x.id));
		} catch {
			filtered = false;
		}
	}

	return json({ r: r.slice(0, 20), filtered });
};
```

- [ ] **Step 7: Change the search button label and add the online toggle**

In `src/routes/app/+page.svelte`, change the button label (line 112) — dropping "find my people":

```svelte
		<button class="btn btn-amber flex items-center justify-center gap-2 whitespace-nowrap" onclick={search} disabled={searching}>
			{#if !searching}<Search size={15} />{/if} {searching ? 'searching' : 'search'}
		</button>
```

Add the state (near `let country = $state('');`):

```ts
	let onlineOnly = $state(false);
	let presenceUnavailable = $state(false);
```

Update `search()` to send the flag and read the response:

```ts
	async function search() {
		if (!q.trim()) return;
		searching = true;
		const p = new URLSearchParams({ q });
		if (gender) p.set('gender', gender);
		if (age_min) p.set('age_min', age_min);
		if (age_max) p.set('age_max', age_max);
		if (country) p.set('country', country);
		if (region) p.set('state', region);
		if (onlineOnly) p.set('online', '1');
		const res = await fetch(`/api/search?${p}`);
		const body = await res.json();
		results = body.r ?? [];
		presenceUnavailable = onlineOnly && body.filtered === false;
		searching = false;
	}
```

Add the checkbox at the end of the `.filters` row (after `<LocationPicker … />`, line 145):

```svelte
		<label class="flex cursor-pointer items-center gap-2 text-[13px] text-ink-soft">
			<input
				type="checkbox"
				class="!w-auto accent-accent"
				bind:checked={onlineOnly}
			/>
			online now
		</label>
```

And surface the fail-open case just above the results list (before `{#if results.length}`, line 148):

```svelte
	{#if presenceUnavailable}
		<p class="mt-4 text-[13px] text-mute">couldn't check who's online — showing everyone.</p>
	{/if}
```

- [ ] **Step 8: Run the suite and type-check**

Run: `pnpm test && pnpm check`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add ws/src/online.ts ws/src/__tests__/online.test.ts ws/src/index.ts src/routes/api/search/+server.ts src/routes/app/+page.svelte
git commit -m "feat: filter people search by who is online; drop the 'find my people' button label"
```

---

### Task 11: "show interests in profile" setting (default off)

A new `si` flag on the user record gates the interests card on the **public** profile only. It deliberately does not touch `save_profile`'s embedding text — interests keep powering search either way, so turning the flag off costs the user nothing in match quality.

**Files:**
- Modify: `src/lib/types.ts:13`, `src/lib/server/profile.ts:8-51`, `src/routes/api/profile/+server.ts:17-38`, `src/routes/app/profile/+page.svelte`, `src/routes/app/user/[id]/+page.svelte:74`
- Test: `src/lib/server/__tests__/profile.test.ts`

**Interfaces:**
- Produces: `User.si?: boolean`; `save_profile(env, uid, { …, show_interests?: boolean })`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/server/__tests__/profile.test.ts`:

```ts
describe('show_interests flag', () => {
	it('persists the flag when explicitly turned on', async () => {
		getUserMock.mockResolvedValue({ ...BASE_USER, u: 'ada' });
		await save_profile(ENV, 'uid', { show_interests: true });
		expect(upsertMock.mock.calls[0][1][0].payload.si).toBe(true);
	});

	it('persists an explicit false rather than falling back to the stored value', async () => {
		getUserMock.mockResolvedValue({ ...BASE_USER, u: 'ada', si: true });
		await save_profile(ENV, 'uid', { show_interests: false });
		expect(upsertMock.mock.calls[0][1][0].payload.si).toBe(false);
	});

	it('leaves the stored flag alone when the field is omitted', async () => {
		getUserMock.mockResolvedValue({ ...BASE_USER, u: 'ada', si: true });
		await save_profile(ENV, 'uid', { about: 'hello' });
		expect(upsertMock.mock.calls[0][1][0].payload.si).toBe(true);
	});

	it('keeps interests in the search embedding even when the flag is off', async () => {
		getUserMock.mockResolvedValue({ ...BASE_USER, u: 'ada', i: ['jazz'] });
		await save_profile(ENV, 'uid', { show_interests: false });
		expect(embedMock).toHaveBeenCalledWith(ENV, expect.stringContaining('user_interests: jazz'));
	});
});
```

`getUserMock`, `upsertMock`, `embedMock` and `BASE_USER` all already exist at the top of this file (lines 3-9, 22) — reuse them, do not redeclare.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/server/__tests__/profile.test.ts -t 'show_interests'`
Expected: FAIL — `expected undefined to be true`

- [ ] **Step 3: Add the field to the User type**

In `src/lib/types.ts`, after the interests line (13):

```ts
	i?: string[]; // interests (tokens)
	si?: boolean; // show interests on your public profile (default false)
```

- [ ] **Step 4: Thread it through `save_profile`**

In `src/lib/server/profile.ts`, add to the `data` parameter type and the merge. Note `??` (not `||`) so an explicit `false` is preserved:

```ts
		whatsapp?: string;
		show_interests?: boolean;
	}
```

```ts
		ci: data.city ?? cur.ci,
		si: data.show_interests ?? cur.si,
```

- [ ] **Step 5: Accept it at the API boundary**

In `src/routes/api/profile/+server.ts`, add to the body type and the call:

```ts
			whatsapp?: string;
			show_interests?: boolean;
		};
```

```ts
			whatsapp: b.whatsapp,
			show_interests: typeof b.show_interests === 'boolean' ? b.show_interests : undefined
		});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run src/lib/server/__tests__/profile.test.ts`
Expected: PASS

- [ ] **Step 7: Add the toggle to the profile editor**

In `src/routes/app/profile/+page.svelte`, add the state (after `let interests = …`, line 37):

```ts
	let showInterests = $state(p.si ?? false);
```

Include it in the save body (after `interests,` on line 65):

```ts
				interests,
				show_interests: showInterests,
```

And add the control directly under the interests field (after the closing `</div>` of the interests box, line 110):

```svelte
		<label class="mt-3 flex cursor-pointer items-center gap-2.5 text-[13.5px] text-ink-soft">
			<input type="checkbox" class="!w-auto accent-accent" bind:checked={showInterests} />
			show interests on my public profile
		</label>
```

- [ ] **Step 8: Gate the public profile card**

In `src/routes/app/user/[id]/+page.svelte`, change line 74:

```svelte
	{#if u.si && u.i?.length}
```

- [ ] **Step 9: Type-check and run the suite**

Run: `pnpm check && pnpm test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/lib/types.ts src/lib/server/profile.ts src/lib/server/__tests__/profile.test.ts src/routes/api/profile/+server.ts src/routes/app/profile/+page.svelte src/routes/app/user/\[id\]/+page.svelte
git commit -m "feat: add 'show interests in profile' setting, off by default"
```

---

### Task 12: Point local dev at the live R2 bucket

Local dev currently gets a Miniflare-emulated R2, so uploads land on disk and never appear in `x2-media`. Wrangler 4 supports per-binding remote mode, which keeps the Worker local while proxying that one binding to the real bucket. This is the "if easily possible" path — it is a config flag plus a verification gate, with a documented fallback if the SvelteKit dev proxy does not honour it.

**Files:**
- Modify: `wrangler.jsonc:32`, `package.json:13-26`

- [ ] **Step 1: Confirm you are authenticated and the bucket exists**

Run: `pnpm wrangler r2 bucket list`
Expected: the list includes `x2-media`. If this errors with an auth message, run `wrangler login` first (ask the user to run it — it is interactive).

- [ ] **Step 2: Mark the MEDIA binding remote**

In `wrangler.jsonc`, replace line 32:

```jsonc
	// chat image uploads; create once with: wrangler r2 bucket create x2-media
	// experimental_remote keeps the Worker local in dev while proxying this binding to the
	// real bucket — otherwise dev writes into Miniflare's on-disk emulation and nothing
	// ever reaches x2-media.
	"r2_buckets": [{ "binding": "MEDIA", "bucket_name": "x2-media", "experimental_remote": true }],
```

- [ ] **Step 3: Add a remote-bindings dev script**

In `package.json`, add after the `dev:full` line:

```json
		"dev:full": "vite build && wrangler dev -c wrangler.jsonc -c ws/wrangler.jsonc --port 4173",
		"dev:remote": "vite build && wrangler dev -c wrangler.jsonc -c ws/wrangler.jsonc --port 4173 --x-remote-bindings",
```

- [ ] **Step 4: Verify against the real bucket**

1. Start `pnpm dev` and sign in.
2. Send a chat message with an image attached; note the returned media key from the network tab (`POST /api/upload` → `{ key }`).
3. Run: `pnpm wrangler r2 object get x2-media/<key> --file /tmp/claude-1000/-home-ed-i-x2/*/scratchpad/r2check.bin`

Expected: the object downloads. **If it 404s**, `vite dev`'s platform proxy is not forwarding the remote flag — in that case use `pnpm dev:remote` for any media work and re-run this same check, which should succeed since wrangler honours `experimental_remote` natively.

- [ ] **Step 5: Record the outcome**

If `vite dev` did not honour the flag, add a line to the `r2_buckets` comment in `wrangler.jsonc` saying so, and note that media work needs `pnpm dev:remote`. Do not claim `vite dev` works remotely unless Step 4 proved it.

- [ ] **Step 6: Commit**

```bash
git add wrangler.jsonc package.json
git commit -m "chore: point the MEDIA R2 binding at the live bucket in local dev"
```

---

## Self-Review

**Spec coverage** — each ask maps to a task:

| Ask | Task |
|---|---|
| Folder edit button on active pill with +/- per chat, not per entry | 3 |
| Are folders persisted to DB? | 1 — they were not; `owner`/`ow` key mismatch fixed |
| Peer still shows the call after the other end hangs up | 6 — `bye` signal + `onconnectionstatechange` |
| Audio doesn't work in call | 6 — `$state()` element refs via `RemoteVideo` |
| Remove `/random` completely | 5 |
| Search filter by online | 10 |
| Select + site scrollbar themed, no track background | 4 |
| Same Select component everywhere | 3 (removes the last raw `<select>`) + 4 (deletes its dead CSS) |
| Implement group call | 9, on the Task 6 `CallMesh` |
| Remove "find my people" | 10 |
| Rename `/app/groups` → `/app/rooms` | 7 |
| Create-room dialog → modal | 8, on the Task 2 `Modal` |
| "show interests in profile", default false | 11 |
| Local dev on live R2 | 12 |
| Truncate room description to one line in search results | 8 |

**Known ordering constraints:** Task 3 before 4 (4 deletes CSS only dead once 3 lands). Task 5 before 6 (both edit the DM page's call block). Task 7 before 8 and 9 (both edit files under the renamed directory). Task 2 before 3 and 8. Task 6 before 9.

**Deliberately not done** (flag to the user if they want them):
- No delete-folder UI, though `DELETE /api/folders/[id]` exists.
- Room calls have no ring/notification for members not on the page — you must be viewing the room to see "join call".
- No TURN server; symmetric NATs will still fail to connect. The `ponytail:` comment in `call.ts` marks the upgrade path.

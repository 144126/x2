# x2 Batch Improvements — Remaining Work Workflow

**Branch:** `x2-batch-improvements` (off `master`)
**Full spec:** `docs/superpowers/plans/2026-07-29-x2-batch-improvements.md` — every task below has complete code there. This file is the resume point, not a replacement.
**Ledger:** `.superpowers/sdd/2026-07-29-x2-batch-improvements/progress.md`

---

## Status snapshot

| Task | State |
|---|---|
| 1. Fix folder persistence (`owner`→`ow`) | ✅ **complete** — commits `8b1b245..854c62a`, full suite 564/564 green |
| 2. Modal component | 🟡 **step 1 committed, red** — `52fd8fc`. Tests exist and fail with `Failed to resolve import "../Modal.svelte"`. Steps 2+ remain. |
| 3-12 | ⬜ not started |

**The branch is currently red.** `pnpm vitest run src/lib/components/__tests__/Modal.test.ts` fails by design — Task 2's component is not written yet. Everything else passes.

---

## Execution protocol

Established with the user, carry it forward:

1. **Controller writes Step 1 of each task** (the failing test / first move), runs it, confirms it fails *for the right reason*, and commits it as `test: … (currently red)`.
2. **A sonnet-medium subagent does Steps 2+** of that task, then commits.
3. Record BASE (`git rev-parse HEAD`) before dispatching so review packages cover the whole task.
4. Append a completion line to the ledger per task.

Do Step 1 per-task, **not** all twelve upfront: Task 7 `git mv`s the directory Tasks 8-9 edit, and twelve half-done tasks would put every other task's work into each review diff.

Helper scripts (in `superpowers/skills/subagent-driven-development/scripts/`):
- `task-brief PLAN_FILE N` → extracts one task to a brief file
- `review-package PLAN_FILE BASE HEAD` → diff bundle for a reviewer

---

## Hard constraints

- **Never `git add -A` / `git add .`.** The working tree carries unrelated in-progress changes that must stay uncommitted: `static/logo.svg`, `.log`, `.dev-logs/*`, `ws/.svelte-kit/`. Stage explicit paths only.
- **Svelte 5 runes:** any `bind:this` variable an `$effect` reads MUST be `$state()`. This is the root cause of the call-audio bug (Task 6) — do not reintroduce it.
- **Qdrant strict mode** rejects filters on unindexed payload keys. Indexed keywords live in `src/lib/server/qdrant.ts:84-88`. This is what Task 1 fixed.
- **Rename scope is UI only** (Task 7): `/api/groups/*`, `$lib/server/group.ts`, `GroupView`, and payload `s:'g'` all keep "group".
- **Interests flag is display-only** (Task 11) — must not change the search embedding.
- **Group calls are mesh** (Task 9), ~4-6 participants. No SFU, no `ws/src/hub.ts` signal-routing changes.
- **Never edit an existing DO migration tag.** Task 5 needs a new `deleted_classes` migration for `MatchLobby` or the deploy fails.
- Conventional commits. `pnpm test` = all; `pnpm vitest run <path>` = one file.

---

## Remaining tasks, in dependency order

Order matters. Task 3 before 4; 5 before 6; 7 before 8 and 9; 2 before 3 and 8; 6 before 9.

### 2. Modal component — *step 1 done, finish it*
Write `src/lib/components/Modal.svelte` on native `<dialog>` (`showModal()` gives focus trap, Esc, `::backdrop` free). Full component code in plan Task 2 Step 4. Make the committed tests green.

### 3. Folder editor on the active pill
Drop the `<select>` repeated on every thread card; put a `Pencil` button in the active pill that opens the Modal listing all chats with `+`/`−`. Optimistic toggle with rollback on failure. **After this, `grep -rn '<select' src/ --include='*.svelte'` must return nothing** — Task 4 depends on that.

### 4. Themed scrollbars + drop dead `select` CSS
One global rule themes page and `Select` listbox alike: thin, `--color-line-2` thumb → `--color-accent` on hover, transparent track via `border: 3px solid transparent` + `background-clip: content-box`. Delete `select` rules at `src/app.css:99-104` and from the mobile selector at `:140`.

### 5. Remove `/random` completely
Route, `ws/src/lobby.ts` + its test, `MatchLobby` binding **plus a `v4 deleted_classes` migration**, nav entry + `Shuffle` import, `match:` from `/api/wstoken`, `record_match` from `chat.ts` and its test block, PWA shortcut + `pwa-assets.test.ts:135`, and the `auto=` autostart branch in the DM page. `RadioGroup`/`Radio` become dead — delete with their tests.
Keep the `Match` type and the `s:'x'` reads in `list_conversations`: historical records still surface as threads.

### 6. Fix call teardown + audio via `CallMesh`
**Two real bugs, one shared fix.** `endCall()` never signals the peer, so the far end stays "in call" (and declining leaves the caller ringing forever). And `remoteVideo`/`localVideo` are plain `let`s — the `$effect` setting `srcObject` never re-runs once the element mounts, so nothing ever plays.
Create `src/lib/call.ts` (`CallMesh` — a 1:1 call is a mesh of one peer), `src/lib/components/RemoteVideo.svelte` (owns `srcObject`, `el` is `$state()`), refactor the DM page onto both. Pairing rule: joiner broadcasts `join`; the lexicographically-lower uid offers, the higher replies `here`. Exactly one offer per pair.
Full `call.ts` and the 9-test suite are in the plan. Manual check: two profiles — both hear audio, hang-up clears *both* UIs, decline releases the caller.

### 7. Rename `/app/groups` → `/app/rooms`
`git mv`, then nav href, four internal `goto`/`href`s, `/app/user/[id]:98`, and **two notification deep-links** that would otherwise 404: `api/send/+server.ts:105` and `lib/server/scheduled.ts:107`. Manifest shortcut + its test.
Verify: `grep -rn '/app/groups' src/ static/` returns nothing; `/api/groups` fetches remain.

### 8. Create-room modal + one-line description
Wrap the "start a room" form in the Modal behind a trigger button; clear the flag before `goto`. Add `truncate` to the **search-result** description only (`rooms/+page.svelte:95`), not "your rooms".

### 9. Room mesh calls
Build on `CallMesh` — signalling reuses the existing per-uid `signal` routing unchanged; `join` fan-out is client-side over `g.members`. Create the mesh in `onMount` (inert until you join, so `join`/`offer` are ignored while inactive). Participant strip with `RemoteVideo` tiles, mic/video toggles, leave. `onDestroy` must leave the call; `ws_down` leaves silently.

### 10. Search online filter + button label
`ws/src/online.ts` (`online(body, ns)`, cap 100, mirrors `relay.ts`'s testable shape) + `/online` route; `/api/search?online=1` over-fetches 60 then filters via `locals.x2_ws`. **Fails open** — unreachable ws returns everyone with `filtered:false` and the UI says "couldn't check who's online", rather than an empty page reading as "nobody's online". Button label `find my people` → `search`.

### 11. "show interests in profile" setting
`User.si?: boolean`, default false. Thread `show_interests` through `save_profile` (use `??`, not `||`, so explicit `false` survives) and `/api/profile`. Checkbox on the profile editor; gate `{#if u.si && u.i?.length}` on the public profile. Must **not** touch the embedding — a test asserts interests still reach `embed()` when the flag is off. `getUserMock`/`upsertMock`/`embedMock`/`BASE_USER` already exist in `profile.test.ts`.

### 12. Local dev on live R2
Add `"experimental_remote": true` to the MEDIA `r2_buckets` entry; add a `dev:remote` script. **Verify before claiming it works:** upload in dev, then `wrangler r2 object get x2-media/<key>`. If `vite dev`'s platform proxy doesn't forward the flag, document that media work needs `pnpm dev:remote` — do not assert `vite dev` is remote unless the check passed.

---

## Known deviations & deferrals

- **Task 1 had no separate task-reviewer.** 5-line mechanical rename, controller-authored test, full suite green. Final whole-branch review covers it. Recorded in the ledger.
- Task 1's implementer subagent was stopped mid-flight; its edits matched the plan exactly and were verified and committed by the controller.
- **Not built** (flag if wanted): delete-folder UI though the endpoint exists; no ring/notification for room calls unless you're viewing the room; no TURN server, so symmetric NATs still fail (marked with a `ponytail:` comment in `call.ts`).

## Finish

After Task 12: whole-branch review on the most capable model over `git merge-base master HEAD`..HEAD, pointing it at the ledger's deferred/parked lines. Then `rm -rf .superpowers/sdd/2026-07-29-x2-batch-improvements/` and use `superpowers:finishing-a-development-branch`.

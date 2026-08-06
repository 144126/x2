# lean_scale blocked at user_empty_vector

when: 2026-08-05T11:48:29.474Z
head: 0d26dd9
why: staged test plan/tests/src/lib/server/__tests__/user_vector.test.ts.txt can never pass against this implementation, independent of the vector change:

1. It calls save_user(env, {id,s,n}) and create_pw_user(env, {..}, 'pw') passing an OBJECT as the string 'sub'/'email' arg -> crashes in normalize_username (value.toLowerCase). The existing user.test.ts calls them with plain strings (save_user(ENV,'google-sub-1',...)), which pnpm test also runs, so there is no implementation that satisfies both call shapes.
2. last_point() reads upsertMock.mock.calls.at(-1)![2] (3rd arg) but upsert(env, points) is called with two args; existing tests read calls[0][1][0]. Index [2] is always undefined so 'last_point().vector' throws TypeError on every case.
3. The save_profile cases throw 'no_user' because get_user/retrieve_one is NOT mocked (the fake qdrant mocks only upsert and ensure), so get_user hits the real network and returns null.

All six assertions fail on setup bugs, never on the vector value. Planner: rewrite the staged test to (a) pass a real username/email string to save_user/create_pw_user, (b) read the point from calls.at(-1)![1][0] (the second arg, first point), and (c) mock get_user/retrieve_one so the save_profile cases resolve an existing user. The implementation change itself (vector:{} at user.ts:54/102/124 and profile.ts drop-stale-vector) is small and unambiguous.

## the step


STOP STORING 16 KB OF ZEROS PER USER. `ZV` is `new Array(4096).fill(0)` (src/lib/server/qdrant.ts). Qdrant holds vectors in RAM — the live collection config shows `"hnsw_config":{...,"on_disk":false}` — so every user with no profile text costs 16 KB of RAM to store nothing. The named_vector_migration already made this free to fix: a point may omit its vector entirely with `vector: {}` at zero storage and zero index cost, which is exactly what messages already do in send_msg().
FOUR SITES, all currently writing a full zero vector:
  src/lib/server/user.ts:54 in save_user() — `{ id, vector: { [V]: ZV }, payload: u as unknown as Record<string, unknown> }`
  src/lib/server/user.ts:102 in patch_user() — `vector: pt!.vector ?? { [V]: ZV },`
  src/lib/server/user.ts:124 in create_pw_user() — `{ id, vector: { [V]: ZV }, payload: u as unknown as Record<string, unknown> }`
  src/lib/server/profile.ts:66 in save_profile() — `{ id: uid, vector: { [V]: vec }, payload: merged ... }` where the line above it is `const vec = text ? await embed_text(env, text) : ZV;`
REPLACEMENT: at user.ts:54 and user.ts:124 write `vector: {}`. At user.ts:102 write `vector: pt!.vector ?? {}`. At profile.ts, restructure to `const vec = text ? await embed_text(env, text) : null;` and then `vector: vec ? { [V]: vec } : {}` — a user who clears their about/interests should DROP their vector, not keep a stale one, so do not just guard the write.
WHY `{}` and not a bare array or a smaller vector: this collection uses NAMED vectors (`V = 't'`), so a bare unnamed array is rejected 400 'Not existing vector name', and the vector size is fixed at 4096 by the collection config so a shorter array is also rejected. `{}` is the only zero-cost option and it is the documented purpose of the migration.
CONSEQUENCE TO CHECK: src/routes/api/search/+server.ts calls `search(env, vec, ...)` over `eq('s','u')`. Points with NO vector are invisible to vector search but still visible to `scroll()`. That endpoint already branches on `has_real_vec` and falls back to `scroll()` when the query is empty, so browsing still lists everyone; only semantic ranking skips profileless users — which is correct, they have no semantic content to rank on. Write a test that asserts exactly this so nobody 'fixes' it back later.
GATE: extend src/lib/server/__tests__/user.test.ts and profile.test.ts to assert the upsert payload's `vector` is `{}` in the no-profile case and `{ t: [...] }` in the with-profile case. `pnpm test` green, no new check/lint errors.

TEST — already written, staged, and byte-compared by the gate. Copy it into place BEFORE implementing:
```
cp plan/tests/src/lib/server/__tests__/user_vector.test.ts.txt src/lib/server/__tests__/user_vector.test.ts
```
Run `pnpm test` and watch it FAIL for the stated reason, then implement until it passes. Never edit it.

When the step is done: `git add . && git commit` scoped to it, then `git push`. Do not run the gate yourself; `plan` runs it on mark.

## v

```
grep -qF 'vector: { [V]: ZV }' src/lib/server/user.ts
```

## t

```
! grep -q "ZV" src/lib/server/user.ts && ! grep -q "ZV" src/lib/server/profile.ts && bash plan/verify_tests.sh && pnpm test && bash plan/check_baseline.sh
```

## next

planner: amend plan/lean_scale.plan.json, then delete this file.
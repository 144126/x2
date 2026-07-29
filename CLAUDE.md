# x2

SvelteKit 5 + Cloudflare Workers. Qdrant is the primary datastore — there is no SQL database.
Realtime lives in a second worker under `ws/`.

## Commands

```bash
pnpm test        # vitest run
pnpm check       # svelte-kit sync && svelte-check
pnpm lint        # prettier --check . && eslint .
pnpm dev:ws      # realtime worker (wrangler, port 8787)
pnpm dev:full    # both, built, on 4173
```

Never start the dev server — one is already running. Read `.dev-logs/server.log` before diagnosing
anything server-related, and after every change.

`pnpm-workspace.yaml` must keep `packages: ['.']` next to its `allowBuilds` block. Without it
`pnpm install` aborts and `pnpm test` fails with `ERR_PNPM_IGNORED_BUILDS`. Do not delete the file
to work around that — commit `fedfe48` did, and it is not the fix.

## Plans

This repo's work is tracked in `plan.json`, driven by the global `plan.ts` tool — see
`~/.agents/AGENTS.md` § Plans.

```bash
plan.ts plan              # print the step to do now
plan.ts plan <step_name>  # mark it done, print the next one
```

Each step is self-contained and test-first, in four phases: write the tests → watch them fail for the
right reason → implement → watch them pass. All four happen within the one step, before it is marked
done.

## Things that bite

- **Every Qdrant call swallows its own errors** (`.catch(() => {})` in `src/lib/server/qdrant.ts`).
  A rejected write looks exactly like "nothing matched".
- **Filtering on an unindexed payload key is rejected** — the collection runs `strict_mode`. Every
  key used in `eq()`/`range()` must appear in `ensure()`'s index list.
- **Qdrant point ids must be an unsigned int or a UUID.** Use `uuid_from(...)` for deterministic ids.
- "Room" is the product word; **`group` is the code word**. Don't rename.
- Svelte 5 runes only. Tabs, single quotes, lowercase copy, `@lucide/svelte` named imports.

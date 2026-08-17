# chat2 blocked at verify.browser_pass

when: 2026-08-17T16:27:44.899Z
head: 366cf03
why: no dev server on :7227 and this step must not start one. everything else is done and green: 1278 tests pass, build is clean. needs 'pnpm dev:all' running, then the agent-browser walk.

## the step

- verify: prove the whole thing, by machine and by eye

Look at it. The user runs the dev server — never start one. Ask them to run `pnpm dev:all`, then use the agent-browser skill to walk: send a photo and watch the percentage climb; kill the network mid-send and confirm the row stays dimmed and retries from the menu; open a view-once photo, then reload and confirm it says opened and cannot reopen; delete for me and confirm only your side changes; delete for everyone and confirm the tombstone. If the dev server is not running, BLOCK this step rather than starting one.

## t

```
-
```

## next

planner: amend plan/chat2.plan.json, then delete this file.

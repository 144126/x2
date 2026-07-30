# x2

Global conventions live in `~/.agents/AGENTS.md`. This file holds only what is specific to this repo.

## Qdrant

- Multi-tenancy: single collection `i`; tenant-id on payload field `s`.
- Point IDs MUST be a valid UUID or unsigned integer — never a string with letters/prefixes (`po_<id>` is rejected with 400 "not a valid point ID"). Derive a deterministic UUID from a business key (e.g. SHA-1 of `payout:<reg_id>`) so idempotency still holds.
- Collections run `strict_mode`: filtering on an unindexed payload key is rejected outright. Add the index in the same change that adds the filter, or the query silently returns nothing.
- `src/lib/server/qdrant.ts` swallows its own errors on every call (`.catch(() => {})` / `.catch(() => [])`), so a rejected write is indistinguishable from "nothing matched". Never conclude "no data" from an empty result without checking the write path.

## Status values

- reg `st`: `r`=pending, `i`=paid.
- payout `st`: `r`=pending, `s`=success, `f`=failed, `p`=processing, `b`=blocked_self, `v`=reversed.

## Secrets

- `get_secret(v)` for the `SecretVal` abstraction lives in `$lib/server/qdrant`; `ws` has its own shared helper.
- `ws/.dev.vars` exists and should be `.env` instead.

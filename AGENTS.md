# x2

Global conventions live in `~/.agents/AGENTS.md`. This file holds only what is specific to this repo.

## Qdrant

- Multi-tenancy: single collection `i`; tenant-id on payload field `s`.
- Point IDs MUST be a valid UUID or unsigned integer — never a string with letters/prefixes (`po_<id>` is rejected with 400 "not a valid point ID"). Derive a deterministic UUID from a business key (e.g. SHA-1 of `payout:<reg_id>`) so idempotency still holds.
- Collections run `strict_mode`: filtering on an unindexed payload key is rejected outright. Add the index in the same change that adds the filter, or the query silently returns nothing.
- `src/lib/server/qdrant.ts` swallows errors on reads (`scroll`/`search`/`retrieve_one` — `.catch(() => [])`), so an empty result never distinguishes "no data" from "Qdrant unreachable" — never conclude "no data" without checking the write path. Writes (`upsert`/`remove`/`update_vectors`/`set_payload`) reject on failure since `surface_write_failures`; callers must handle that (`/api/send` turns it into a 503).
- Vectors are named (`V = 't'` in qdrant.ts) since `named_vector_migration`: a point may omit its vector entirely (`vector: {}`) at zero storage/index cost. Never write a bare unnamed array — Qdrant 400s "Not existing vector name" against this collection.

## Status values

- reg `st`: `r`=pending, `i`=paid.
- payout `st`: `r`=pending, `s`=success, `f`=failed, `p`=processing, `b`=blocked_self, `v`=reversed.

## Secrets

- `get_secret(v)` for the `SecretVal` abstraction lives in `$lib/server/qdrant`; `ws` has its own shared helper.

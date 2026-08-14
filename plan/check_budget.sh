#!/usr/bin/env bash
# svelte-check carries 14 pre-existing errors on a clean tree, so `pnpm check` always exits
# non-zero and cannot be a gate on its own. Gate on the count not growing instead.
set -uo pipefail
BUDGET=14
out=$(pnpm check 2>&1)
line=$(printf '%s\n' "$out" | grep ' COMPLETED ' | tail -1)
if [ -z "$line" ]; then
	printf '%s\n' "$out" | tail -25
	echo "check_budget: svelte-check printed no COMPLETED line"
	exit 1
fi
n=$(printf '%s\n' "$line" | awk '{print $5}')
echo "check_budget: $n errors (budget $BUDGET)"
if [ "$n" -gt "$BUDGET" ]; then
	printf '%s\n' "$out" | grep ' ERROR ' | tail -25
	exit 1
fi

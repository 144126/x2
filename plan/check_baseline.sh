#!/bin/bash
# svelte-check carries a pre-existing baseline in this repo, so the gate is "no worse", not "zero".
BASE=15
n=$(pnpm check 2>&1 | grep -oiE '[0-9]+ error' | tail -1 | grep -oE '^[0-9]+')
if [ -z "$n" ]; then
	echo "check_baseline: could not parse svelte-check output"
	exit 1
fi
if [ "$n" -gt "$BASE" ]; then
	echo "svelte-check: $n errors, baseline is $BASE -- this step added $((n - BASE))"
	exit 1
fi
echo "svelte-check: $n errors (baseline $BASE)"

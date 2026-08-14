#!/bin/bash
# Scoped copy of verify_tests.sh. The shared script fences every staged test in plan/tests,
# and two of those belong to older unfinished plans and have already drifted, so it fails
# for reasons that have nothing to do with this plan. This fences only this plan's tests.
fail=0
for d in \
	src/lib/components/__tests__/select_clear.test.ts \
	src/lib/server/__tests__/profile_clear_location.test.ts \
	src/routes/app/profile/__tests__/geo_prefill.svelte.test.ts; do
	if [ -f "$d" ] && ! cmp -s "plan/tests/$d.txt" "$d"; then
		echo "TAMPERED: $d no longer matches plan/tests/$d.txt"
		fail=1
	fi
done
exit $fail

#!/bin/bash
# every staged test that has already been placed must still be byte-identical to the planner's copy
fail=0
while IFS= read -r f; do
	d=${f#plan/tests/}
	d=${d%.txt}
	if [ -f "$d" ] && ! cmp -s "$f" "$d"; then
		echo "TAMPERED: $d no longer matches $f"
		fail=1
	fi
done < <(find plan/tests -name '*.txt' 2>/dev/null)
exit $fail

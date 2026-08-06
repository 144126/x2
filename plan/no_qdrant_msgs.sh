#!/bin/bash
# the message store starts afresh: no `s:'m'` point may remain in the live collection.
set -a
. ./.env
set +a
if [ -z "$QDRANT_URL" ] || [ -z "$QDRANT_KEY" ]; then
	echo "no_qdrant_msgs: QDRANT_URL/QDRANT_KEY missing from .env"
	exit 1
fi
body='{"filter":{"must":[{"key":"s","match":{"value":"m"}}]},"exact":true}'
n=$(curl -sf -X POST "$QDRANT_URL/collections/x2live/points/count" \
	-H "api-key: $QDRANT_KEY" -H 'content-type: application/json' -d "$body" |
	sed -n 's/.*"count":[[:space:]]*\([0-9]*\).*/\1/p')
if [ -z "$n" ]; then
	echo "no_qdrant_msgs: count request failed"
	exit 1
fi
if [ "$n" -ne 0 ]; then
	echo "no_qdrant_msgs: $n message points still in x2live"
	exit 1
fi
echo "no_qdrant_msgs: 0 message points"

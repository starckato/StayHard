#!/bin/bash
# sb-sql.sh — run SQL against Supabase via Management API
# Requires: ~/.stayhard-sb-pat (Personal Access Token, chmod 600)
#
# Usage:
#   ./scripts/sb-sql.sh path/to/file.sql
#   echo "SELECT 1" | ./scripts/sb-sql.sh
#   ./scripts/sb-sql.sh -c "SELECT count(*) FROM profiles"
#
# Returns JSON response from the API (result rows + status).

set -euo pipefail

PAT_FILE="${HOME}/.stayhard-sb-pat"
PROJECT_REF="uvaosxhsjscigheyymus"

if [ ! -f "$PAT_FILE" ]; then
  echo "ERROR: $PAT_FILE missing. Create it with your Supabase Personal Access Token (chmod 600)." >&2
  exit 1
fi
PAT="$(tr -d '\n' < "$PAT_FILE")"
if [ -z "$PAT" ]; then
  echo "ERROR: $PAT_FILE is empty." >&2
  exit 1
fi

# Read SQL from arg, -c flag, or stdin
SQL=""
if [ "${1:-}" = "-c" ] && [ -n "${2:-}" ]; then
  SQL="$2"
elif [ -n "${1:-}" ] && [ -f "$1" ]; then
  SQL="$(cat "$1")"
elif [ ! -t 0 ]; then
  SQL="$(cat)"
else
  echo "Usage: $0 <file.sql>  OR  $0 -c \"SQL\"  OR  cat file.sql | $0" >&2
  exit 2
fi

if [ -z "${SQL// /}" ]; then
  echo "ERROR: empty SQL" >&2
  exit 3
fi

# JSON-escape via python (avoid jq dependency)
PAYLOAD="$(SQL="$SQL" python3 -c '
import os, json
print(json.dumps({"query": os.environ["SQL"]}))
')"

HTTP_CODE=$(curl -sS -o /tmp/sb-sql.out -w "%{http_code}" \
  -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${PAT}" \
  -H "Content-Type: application/json" \
  --data-binary "$PAYLOAD")

cat /tmp/sb-sql.out
echo ""
echo "HTTP ${HTTP_CODE}" >&2

# Exit non-zero on 4xx/5xx
case "$HTTP_CODE" in
  2*) exit 0;;
  *) exit 4;;
esac

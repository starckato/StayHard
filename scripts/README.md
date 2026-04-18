# scripts

## sb-sql.sh

Run SQL against Supabase via Management API. Used by Claude Code to apply
migrations and ops queries without pasting into the Dashboard SQL Editor.

### Setup (one-time)

1. Generate a Personal Access Token at
   https://supabase.com/dashboard/account/tokens
2. Save to `~/.stayhard-sb-pat` with restricted permissions:
   ```bash
   echo 'sbp_XXXXXXXXXXXX' > ~/.stayhard-sb-pat
   chmod 600 ~/.stayhard-sb-pat
   ```
3. The PAT file is outside the repo and `.stayhard-sb-pat` is gitignored
   defensively.

### Usage

```bash
# From a file
./scripts/sb-sql.sh migrations/008_show_last_login_not_last_log.sql

# Inline SQL
./scripts/sb-sql.sh -c "SELECT count(*) FROM profiles"

# Via stdin
echo "SELECT current_database()" | ./scripts/sb-sql.sh
```

Returns the Management API's JSON response (rows array or empty array
for statements that don't return data). Exits non-zero on HTTP 4xx/5xx.

### Security

- PAT has account-level write access — revoke from the Supabase Dashboard
  if you suspect compromise.
- Prefer this over exposing the `service_role` key, which would have to be
  shipped in environment variables.

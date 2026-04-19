# Code Review — Session 2026-04-19 (148db9b..HEAD)

**Reviewed:** 2026-04-19
**Scope:** 35 commits, 11 files, +2778 / −238 lines
**Decision:** **REQUEST CHANGES** — 3 HIGH issues, 0 CRITICAL

## Summary

Session shipped Ships 1–9 (onboarding rebuild, first-week card, empty-state previews, viral loop, nudges, milestone reveals, weekly feature ribbon, frequency picker) + muscle map UX + admin bonus panel + DB infra (migrations 005–010). Breadth is solid and telemetry is firing correctly. Three HIGH findings need fixing before the next bulk user invite — all are pre-existing patterns compounded by this session's feature growth, not new architectural mistakes.

## Findings

### CRITICAL
None.

### HIGH

**H1 — Stored XSS: `display_name` in competition activity feed** (`index.html:~10552`)
User's `display_name` (DB-sourced, user-controlled at signup) is injected into `innerHTML` without escaping. An attacker setting `display_name='<img src=x onerror=alert(1)>'` triggers XSS in any other user's browser viewing the shared competition room. Also affects `e.label` / `e.type` in the activity feed and the legend at `10624–10630`, plus exercise names at `~3330`. **Fix:** Add an `esc()` helper and apply to every user-sourced string before `innerHTML` injection.

**H2 — Self-XSS: todo target text** (`index.html:5005`, `9841`)
`t.text` (free-form user input stored in `daily_logs.targets`) injected into `innerHTML` via carry-over ribbon and target list. Current blast radius is self-only, but any future feature that shares targets between users escalates this to stored XSS. **Fix:** Same `esc()` helper.

**H3 — Share fallback blob URL memory leak** (`index.html:~6688`, `~7004`, `~11170`)
`shareBonusGrant` / `shareInvite` / `shareMuscleMap` all create blob URLs via `URL.createObjectURL(blob)` but never call `URL.revokeObjectURL`. Each PNG download leaks an object URL for the page lifetime. `shareSummary` at `~7409` does revoke correctly — the new copies missed it. **Fix:** `setTimeout(()=>URL.revokeObjectURL(a.href), 30000)` after `a.click()` in all three new share paths.

**H4 — `is_user_excluded` over-granted** (`migrations/006:26`)
`GRANT EXECUTE ON FUNCTION public.is_user_excluded(uuid) TO authenticated` — any authenticated user can enumerate which user UUIDs are flagged as internal/test accounts. `is_user_excluded` is only called from within `admin_dashboard()` (SECURITY DEFINER) so it needs no external grant. **Fix:** `REVOKE EXECUTE ON FUNCTION public.is_user_excluded(uuid) FROM authenticated;` in a migration 011.

### MEDIUM

**M1 — `body.overflow` state machine has no reference count**
(`index.html` — bonus modal / day1 nudge / tierup ribbon / friend-welcome modal)
Multiple modals can stack. Each writes `document.body.style.overflow='hidden'` unconditionally and restores `''` on dismiss. Tier-up flow particularly risky: confetti → showWin → openRoomOverlay → showTierUpShareCTA → optional bonus modal all interacting. Latent scroll-lock-release-too-early bug.

**M2 — URL params used as localStorage keys without length/character validation** (`index.html:~6708`)
`?celebrate=foo` and `?invite=bar` both become `localStorage` key suffixes (`friend_welcome_foo`, `friend_invite_bar`) with no sanitization. Long values can hit quota; prototype-pollution-like strings (`__proto__`) are stored verbatim. **Fix:** `sanitizeUrlParam(v, maxLen=128)` allowing only `[a-zA-Z0-9_\-]`.

**M3 — `/tmp/sb-sql.out` is world-readable** (`scripts/sb-sql.sh:51`)
`curl -o /tmp/sb-sql.out` creates the file with default umask (`-rw-r--r--`). If the query pulls `auth.users` or `profiles` rows (emails, names, scores), any local user on this machine can read. **Fix:** `mktemp` + `chmod 600`, or stream to stdout without a temp file.

**M4 — Incomplete HTML escape on bonus grant message** (`index.html:~6581`)
`(g.message||'').replace(/</g,'&lt;')` escapes only `<`, not `&`/`>`/`"`/`'`. Not currently exploitable (body div context) but incomplete. Apply the shared `esc()` helper then `.replace(/\n/g,'<br>')`.

**M5 — `revokeBonus` non-atomic score mutation** (`admin.html:662–668`)
Read → compute → update pattern on `profiles.total_score`. Two concurrent revokes lose one subtraction. Low real-world risk for admin-only tooling but correct fix is a `decrement_score_by(user, amount)` RPC.

**M6 — Three share functions structurally identical** (`index.html:6631–6696`, `6950–7013`, `11039–11175`)
`shareBonusGrant`, `shareInvite`, `shareMuscleMap` all run the same html2canvas → Web Share API → PNG download fallback. Extract `shareCardAsPng(cardEl, fileName, shareText, trackKey)`. ~120 LOC duplication drives bug-count (see H3).

**M7 — `renderRoutine` silent-catch on 4 card renderers** (`index.html:~7422`)
`try{renderFirstWeekCard();}catch(e){console.warn(…)}` for fw/invite/day3/weekly-feature. `console.warn` is better than bare catch, but production-visible failures would be invisible. **Fix:** `track('render_error',{card,msg})` so failures surface in the events table.

**M8 — `WEEKLY_FEATURES` rotation uses calendar-year-day / 7, not ISO week** (`index.html:~6767`)
`floor(dayOfYear / 7)` resets to 0 on Jan 1 regardless of week boundaries. Rotation jumps at year rollover. Harmless in short term.

**M9 — `obSelectWfreq` mutates objects already pushed to `obSelectedRoutines`** (`index.html:~5913`)
In-place `r.days = newDays.slice()`. Consistent with rest of codebase's mutation style but worth flagging for the planned immutable refactor.

**M10 — `admin_dashboard()` grant is authenticated-wide; exceptions leak admin-check existence** (migrations 006–009)
Any logged-in user can call it and get `Unauthorized: admin only`. Standard Supabase pattern; acceptable, but a dedicated `admin` DB role would be tighter.

### LOW

- **L1** — `day1_nudge_${TODAY}_${userId}` localStorage key grows one per calendar day (only 2 max with current guard).
- **L2** — Share buttons lack `aria-label` (only the muscle map FAB has one). Korean text is readable; directional-arrow-only buttons less so.
- **L3** — `tier.icon`/`tier.name` unescaped in `showTierUpShareRibbon`. Currently app-controlled constants so no user-input path; defensive concern only.
- **L4** — `?fw=1` override param: flagged for completeness, not exploitable.
- **L5** — PROJECT_REF + anon key committed: intentional (anon key is public by design). Documented in code.

## Validation Results

| Check | Result |
|---|---|
| `node --check` on all `<script>` blocks | **Pass** (verified at every commit) |
| Production HTTP 200 on `/`, `/admin.html`, `?invite=`, `?celebrate=`, `?fw=1` | **Pass** |
| DB infra intact (bonus_grants, events, profiles cols, 6 RPCs) | **Pass** |
| Telemetry firing in prod (47 events / 24h) | **Pass** |
| Build | N/A (no build step; static HTML) |

## Files Reviewed

| File | Status | LOC delta |
|---|---|---|
| `.gitignore` | Added | +6 |
| `admin.html` | Modified | +332 |
| `index.html` | Modified | +1361 |
| `migrations/005_bonus_grants.sql` | Added | +180 |
| `migrations/006_exclude_users_from_dashboard.sql` | Added | +295 |
| `migrations/007_cap_future_logs_in_dashboard.sql` | Added | +258 |
| `migrations/008_show_last_login_not_last_log.sql` | Added | +233 |
| `migrations/009_last_activity_timestamp.sql` | Added | +234 |
| `migrations/010_profiles_goal_column.sql` | Added | +11 |
| `scripts/README.md` | Added | +41 |
| `scripts/sb-sql.sh` | Added | +65 |

## Next Steps

1. **Immediate (this session):** Ship a fix commit that
   - Adds a global `esc(s)` helper used in activity feed + target list + bonus message (H1, H2, M4)
   - Adds `URL.revokeObjectURL` after `a.click()` in the three share fallbacks (H3)
   - Writes migration 011 to `REVOKE EXECUTE ON public.is_user_excluded FROM authenticated` (H4)
   - Adds `sanitizeUrlParam()` for `?celebrate` / `?invite` (M2)
   - Sets restrictive permissions on `/tmp/sb-sql.out` (M3)

2. **Next session:**
   - Extract `shareCardAsPng()` helper (M6) — fixes the class of bugs where copy-paste divergence bites us
   - Reference-count `body.overflow` (M1)
   - Audit all remaining `innerHTML` injection sites for user-sourced strings

3. **Backlog:**
   - Decrement-score RPC for atomic revoke (M5)
   - ISO week rotation for `WEEKLY_FEATURES` (M8)
   - `track('render_error',…)` in the four silent render catches (M7)

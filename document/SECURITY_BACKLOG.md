# StayHard — Security Backlog
> Last Updated: 2026-04-18
> Scope: Authentication, data access (Supabase RLS), credential hygiene, client-side exposure

---

## Severity Legend
| | Meaning |
|---|---|
| 🔴 CRITICAL | Active exploit path or leaked production credential |
| 🟠 HIGH | Known vulnerability, exploit plausible |
| 🟡 MEDIUM | Hardening gap, exploit requires specific conditions |
| 🟢 LOW | Hygiene concern, best-practice deviation |
| ✅ RESOLVED | Verified closed |

---

## 🟢 OPEN — Local credential hygiene

### GH-01: GitHub PAT stored in plaintext in local `.git/config`
- **Severity**: 🟢 LOW (local-only, not committed to repo)
- **Discovered**: 2026-04-18 (visible in `git remote -v` output)
- **Evidence**: Remote URL for `origin` embeds the PAT: `https://ghp_*@github.com/starckato/StayHard.git`
- **Repo scan result (2026-04-18)**:
  - `git grep -E 'ghp_|gho_|ghs_|ghr_|github_pat_'` across all tracked files: **0 hits**
  - Same patterns across entire `git log -p --all`: **0 hits**
  - Token was never committed. Only lives in `.git/config` locally.
- **Exposure risk**:
  - Screen share
  - Accidental paste of `git remote -v` output
  - Backup of home directory that isn't encrypted
- **Recommended action**:
  1. Revoke the current PAT at https://github.com/settings/tokens
  2. Switch to SSH: `git remote set-url origin git@github.com:starckato/StayHard.git`
  3. Verify: `git fetch` (should work without prompting for credentials)
- **Status**: Pending user action

---

## 🟡 OPEN — Data access posture to audit

### DA-01: `profiles` table — SELECT is permissive across users
- **Severity**: 🟡 MEDIUM
- **Discovered**: 2026-04-18 (during RLS audit for Sprint G)
- **Evidence**: Authenticated user can read any other user's profile row (`display_name`, `total_score`, potentially more). Verified via direct query that returned another user's row.
- **Is this intentional?** Partially — competitions leaderboard needs cross-user profile reads to show names. But exposing *all* profile fields to *all* authenticated users is broader than necessary.
- **Recommended audit**:
  - Review what columns exist on `profiles` and which are genuinely intended to be public
  - Consider limiting `SELECT` to: only users who share a competition with the caller, OR only specific "public" columns
  - If anonymous/unauthenticated access is possible, that's more concerning
- **Status**: Not addressed — needs product decision on what should be cross-user visible

### DA-02: Supabase Storage bucket policies not audited
- **Severity**: 🟡 MEDIUM (depends on current bucket config)
- **Known buckets** (from PRODUCT_SPEC):
  - `meal-photos/{user_id}/{timestamp}.jpg`
  - `workout-videos/{user_id}/{timestamp}.webm`
  - `game-assets` (tier character/room images)
- **Questions to answer**:
  - Are the upload policies scoped to `auth.uid() = owner`?
  - Are the read policies public or authenticated-only?
  - Can user A enumerate / download user B's meal photos or workout videos?
- **Recommended audit**: Review `storage.objects` RLS policies for each bucket via Supabase Dashboard > Storage > Policies
- **Status**: Not audited

### DA-03: `user_routines` RLS not verified
- **Severity**: 🟡 MEDIUM
- **Known**: Table stores per-user saved workout routines (name, exercises with sets)
- **Required**: `SELECT/UPDATE/DELETE` should be scoped to `user_id = auth.uid()`; `INSERT` should enforce `user_id = auth.uid()`
- **Status**: Not audited today — low priority (saved routines are not highly sensitive)

### DA-04: `daily_logs` RLS — VERIFIED SAFE
- **Severity**: ✅ (verified, no action)
- **Evidence (2026-04-18)**: Cross-user `SELECT` on `daily_logs` with another user's `user_id` returned 0 rows silently. RLS blocks cross-user reads. Confirmed.
- **Status**: ✅ RESOLVED — behavior is correct

---

## 🟢 OPEN — Content integrity

### CI-01: Client-side cheat-quota enforcement
- **Severity**: 🟢 LOW
- **Description**: Cheat quota, streak, and tier progression are calculated client-side. A malicious user could edit `localStorage`, tamper with `CP.total_score`, or rewrite `logCache[TODAY]` in DevTools before the next save flushes.
- **Reality check**: Self-discipline tracker — the only person hurt by tampering is the user themselves. Low practical risk.
- **Mitigation if ever needed**: Add server-side score recalculation on save (Postgres function that reads `points_log` and sets `profiles.total_score`).
- **Status**: Accepted risk — flag only if competitive integrity becomes a monetization-blocking concern

### CI-02: Competition leaderboard shows client-reported scores
- **Severity**: 🟡 MEDIUM (for real competitions where users care)
- **Description**: `profiles.total_score` is written client-side via `_flushScoreUpdate`. A member of a competition can inflate their own score by tampering with client state, then the update persists to profiles, then the leaderboard ranks them unfairly.
- **Mitigation**: Server-side validation of score increments (e.g., a trigger or RPC that only permits known-valid score events).
- **Status**: Not addressed — reasonable for a discipline app, problematic for prize-based competitions

---

## ✅ RESOLVED — closed today (2026-04-18)

### RLS-01: `competitions` UPDATE was permissive to any authenticated user
- **Severity (at discovery)**: 🟠 HIGH
- **Closed by**: Sprint H (`migrations/002_tighten_competitions_rls.sql`)
- **Fix applied**:
  - `join_competition_by_code()` SECURITY DEFINER RPC for atomic joins
  - UPDATE policy scoped to `creator_id = auth.uid()` OR membership
  - DELETE policy scoped to creator
  - INSERT policy enforces `creator_id = auth.uid()`
- **Verified (2026-04-18)**: Non-member tamper attempt returned 0 rows; actual data unchanged; RPC responds to invalid codes with `Competition not found`.
- **Status**: ✅ RESOLVED

### AUTH-01: `initMiniChar` console warnings (not security)
- Not a security issue — included here only to note it was cleaned up today as part of general hygiene.
- **Status**: ✅ RESOLVED

---

## Prioritized next actions (when you want to address)

1. **GH-01** — rotate PAT + switch to SSH (2 min, user-side only)
2. **DA-02** — storage bucket policy audit (15 min, manual Supabase Dashboard review)
3. **DA-01** — profiles SELECT scoping review (30 min, needs product decision first)
4. **DA-03** — user_routines RLS verification (10 min)
5. **CI-02** — server-side score validation (several hours — only if competitive integrity matters)

---

## Conventions for this doc
- Every new finding gets its own subsection with: ID, severity, discovery date, evidence, recommendation, status
- Move items to the RESOLVED section after verification (don't delete — audit trail)
- Link to commit hash or migration file when fixes ship
- Review quarterly; outdated items stay but get a "reviewed" timestamp

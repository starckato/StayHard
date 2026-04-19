# Stay Hard — Product Specification
> Last Updated: 2026-04-19 (evening)
> Version: 2.4 (+ Onboarding Rebuild · Viral Loop · Milestone Reveals · Security Hardening)
> Files: `/Users/KWAN/StayHard/index.html` (15,101 lines), `/Users/KWAN/StayHard/admin.html` (695 lines)
> Migrations:
> - `migrations/001_competition_recent_activity.sql`
> - `migrations/002_tighten_competitions_rls.sql`
> - `migrations/003_analytics_events.sql` — events table + is_admin() + profiles.is_admin
> - `migrations/004_admin_dashboard_full_data.sql` — admin_dashboard() RPC with full KPIs + row data
> - `migrations/005_bonus_grants.sql` — admin-issued celebrations + claim_bonus_grant / grant_bonus_by_email RPCs
> - `migrations/006_exclude_users_from_dashboard.sql` — profiles.is_excluded + is_user_excluded + set_user_excluded
> - `migrations/007_cap_future_logs_in_dashboard.sql` — log_date <= current_date caps in every admin agg
> - `migrations/008_show_last_login_not_last_log.sql` — all_users returns last_sign_in_at
> - `migrations/009_last_activity_timestamp.sql` — all_users returns MAX(daily_logs.updated_at) as last_activity
> - `migrations/010_profiles_goal_column.sql` — profiles.goal (diet/muscle/habit) persistence
> - `migrations/011_revoke_is_user_excluded.sql` — security: REVOKE EXECUTE from authenticated/anon/public
>
> Tooling:
> - `scripts/sb-sql.sh` — run SQL against Supabase via Management API (Personal Access Token in `~/.stayhard-sb-pat`)
>
> Deployment (Vercel): all aliases below point to the same project
> - Primary: `https://stay-hard-rouge.vercel.app` ← use this
> - Admin dashboard: `https://stay-hard-rouge.vercel.app/admin.html`
> - Alternates: `stay-hard-starckato-3038s-projects.vercel.app`, `stay-hard-git-main-...`
> - (Domain `stayhard.app` is NOT owned by this project — belongs to a different company)

---

## Overview

Stay Hard is a Korean-language **Goggins-inspired self-discipline tracking SPA** that gamifies daily routines, workouts, nutrition, and personal challenges. Single-file architecture deployed via Vercel, backed by Supabase.

**Core Loop:** Daily logging → Points → Tier progression → Competitive challenges

---

## 1. Information Architecture

```
Stay Hard
├── Auth Screen (auth-screen)
│   ├── Login Tab
│   └── Signup Tab
│
├── App Screen (app-screen)
│   ├── Header (minimal: title + avatar + motto)
│   │   ├── "Stay Hard" title
│   │   ├── Avatar → Profile Modal
│   │   └── Daily Motto
│   │
│   ├── [Tab 0] 기록 — Daily Routine (view-routine)
│   │   ├── Yesterday Ribbon (carry-over + reminder unified)
│   │   │   ├── Undone targets → checkable list + 이월/건너뜀
│   │   │   └── Missing routines → Goggins voice reminder
│   │   ├── Status Band (hero — tinted gradient card)
│   │   │   ├── Mini char canvas → Room Overlay
│   │   │   ├── Tier pill / streak / today Δ
│   │   │   ├── Archivo Black score + tier quote
│   │   │   ├── Next-tier progress bar
│   │   │   └── "오늘 기록 요약" primary CTA → Summary Modal
│   │   ├── Day Slider (week strip + month nav)
│   │   ├── Weight Card (SVG scale icon) → Weight Modal
│   │   ├── Meals Card (SVG leaf icon)
│   │   │   ├── 아침/점심/저녁 slots → Meal Slot Modal
│   │   │   └── 간식/야식/음료/술/안주 → Snack Modal
│   │   ├── Water Card (SVG drop icon — split from meals)
│   │   │   └── Cups + goal panel (0.5L–6L)
│   │   ├── Workout Card (SVG dumbbell icon)
│   │   │   ├── Session rows → Session Summary
│   │   │   ├── "운동 추가" → Workout Start Screen
│   │   │   └── "자극 부위" → Muscle Map Overlay
│   │   └── Today Tasks Card (SVG check-square — 필수 루틴 + 오늘의 할일 merged)
│   │       ├── 필수 루틴 section (badge, checklist, + 루틴 추가)
│   │       └── 오늘의 할일 section (badge, checklist, inline add input)
│   │
│   ├── [Tab 1] 주간 — Weekly View (view-weekly)
│   │   └── 7-column grid (weight, meals, workouts, routines)
│   │
│   ├── [Tab 2] 통계 — Statistics (view-stats)
│   │   ├── Hero Banner (streak, today pts, tier + progress)
│   │   ├── Period selector (1주 | 1달 | 3달 | 전체)
│   │   ├── 📊 종합 (Overview)
│   │   │   ├── KPI Grid (routine%, target%, clean%, workout count, water)
│   │   │   ├── Today's Score Sources
│   │   │   ├── Report Card (A-F grades)
│   │   │   ├── Insights Engine (5 contextual text insights)
│   │   │   ├── Score Trend Chart
│   │   │   └── Points Breakdown by Category
│   │   ├── 💪 훈련 (Training)
│   │   │   ├── Volume Chart (weekly bars)
│   │   │   ├── Muscle Group Distribution
│   │   │   ├── PR Dashboard (all-time bests)
│   │   │   └── Exercise List → Exercise Detail Modal
│   │   ├── 🥗 식단 (Nutrition)
│   │   │   ├── Meal Quality Heatmap
│   │   │   └── Meal Quality Trend Line
│   │   └── ✅ 습관 (Habits)
│   │       ├── Weight Trend Chart
│   │       ├── Body Composition Chart (muscle + fat)
│   │       ├── Routine Completion Chart
│   │       └── Per-Routine Item Breakdown + Streaks
│   │
│   ├── [Tab 3] 챌린지 — Competition (view-competition)
│   │   ├── Pushup Challenge Card → CV Overlay
│   │   ├── Active Challenge → Challenge Room
│   │   ├── Create Challenge → Create Overlay
│   │   └── Join Challenge → Join Overlay
│   │
│   └── Bottom Navigation (4 tabs)
│
└── Overlays & Modals (24 total)
```

---

## 2. User Journey Map

### 2.1 First-Time User

```
App Load → Auth Screen → Signup → Email Verify → Login
  → Onboarding (3 steps):
    1. Welcome ("Stay Hard")
    2. Goal Selection (다이어트 / 근성장 / 습관)
    3. Recommended Routines + Goal Weight
  → Main App (기록 tab)
```

### 2.2 Daily Loop (Returning User)

```
Open App → Check Yesterday Reminder → Carry-over tasks
  → Log Weight (tap card or quick-entry)
  → Log Meals (quick-entry buttons or full modal)
  → Tap Water Cups
  → Start Workout Session (from routine or empty)
  → Check Off Mandatory Routines
  → Add/Complete Targets
  → View Summary → Share
```

### 2.3 Weekly Review

```
Tap 주간 Tab → Scroll week grid → Check patterns
  → Tap 통계 Tab → Review KPIs + Report Card
  → Check Score Trend → Insights
  → Training: Volume, PRs, Muscle Distribution
  → Nutrition: Heatmap, Quality Trend
  → Habits: Weight Trend, Body Comp, Routine Breakdown
```

### 2.4 Competition Flow

```
Create: 챌린지 Tab → 새 챌린지 → Name + Duration + Goals → Get Code
Join: 챌린지 Tab → 참여하기 → Enter Code → Set Goals
Active: Daily logging → Check Leaderboard → View Room
Complete: Final scores → Winner declared
```

---

## 3. User Scenarios

### Scenario 1: Morning Routine (2 min)
Soyeon opens app → logs weight 63.2kg → quick-taps 아침 "클린" → checks 찬물 샤워 + 새벽 기상 → adds target "영어 50단어" → sees +23pts toast

### Scenario 2: Gym Session (45 min logging)
Jihoon taps 운동 추가 → selects saved routine "상체" → logs bench press 3x100kg → adds bicep curl mid-session → finishes → sees confetti + 20pts → shares card

### Scenario 3: Cheat Day (evening)
Minjun records dinner "일반" → adds 술 category → toggles cheat quota → sees rage overlay → dismisses → next morning checks score impact

### Scenario 4: Weekly Stats Review (5 min)
User opens Stats → sees Report Card grade B → checks routine breakdown → finds "독서" at 30% → commits to improving → views PR dashboard → notices bench press PR approaching

### Scenario 5: Group Challenge (ongoing)
Creates 30-day weight loss challenge → shares code → 4 friends join → daily leaderboard updates → week 2: user sees they're #2 → pushes harder

---

## 4. Data Model

### daily_logs (per user per day)
```
user_id       uuid        FK → profiles
log_date      date        YYYY-MM-DD (composite PK)
weight        float       Current weight (kg)
muscle_mass   float       InBody skeletal muscle (kg)
body_fat_pct  float       InBody body fat (%)
water_cups    int         Glasses consumed (0-12)
meals         jsonb       [{time, name, type, photo, category}]
workouts      jsonb       [{type, exercises, totalVolume, status}]
mandatory     jsonb       [{name, done, days}]
targets       jsonb       [{text, st}]
points_log    jsonb       [{type, pts, label, icon, ts, note}]
```

### profiles
```
id              uuid      Auth user ID (PK)
username        text      Auto-generated
display_name    text      User nickname
weight_goal     float     Target weight (kg)
water_goal      int       Daily cups target (default: 6)
total_score     int       Cumulative Goggins score
onboarded       bool      Completed first-time setup
cheat_used      int       Cheats used this week
cheat_reset_week int      ISO week of last reset
system_notice   text      Admin message
```

### user_routines
```
id          uuid      PK
user_id     uuid      FK → profiles
name        text      Routine name
exercises   jsonb     [{name, icon, muscle, equip, sets}]
```

### competitions
```
id              uuid      PK
code            text      Join code (unique)
name            text      Challenge name
creator_id      uuid      FK → profiles
members         jsonb     [user_id,...]
start_date      date      Start
duration_days   int       Length
measure_type    text      weight | inbody | workout
member_wgoals   jsonb     {user_id: target,...}
member_inbody_goals jsonb {user_id: {muscle, fatPct},...}
status          text      waiting | active | completed | failed
```

### Storage Buckets
- `meal-photos/{user_id}/{timestamp}.jpg`
- `workout-videos/{user_id}/{timestamp}.webm`

---

## 5. Scoring System

> **v2.4 Rebalance (2026-04-19):** Workouts split into 근력 / 유산소 with 30pt each (cap 60/day). Diet penalty moved from 0 to −30 (with sentence-completion recovery path). Routine/target success shrunk from 2 to 1 and 2. Welcome bonus +10 added on onboarding finish.

### Earning Points
| Action | Points | Type |
|--------|--------|------|
| Strength workout (gym) — 1×/day | +30 | workout_done |
| Cardio workout (activity) — 1×/day | +30 | workout_cardio_done |
| Clean meal | +10 | diet_clean |
| Cold shower | +10 | cold_shower |
| Early rise (6am) | +10 | early_rise |
| Weight loss vs previous | +5 | weight_loss |
| Goal weight achieved | +30 | weight_goal |
| Routine item done | +1 | routine_done |
| Target done | +2 | target_done |
| Meal logged | +1 | diet_log |
| Weight recorded | +1 | weight_record |
| Cheat restraint bonus | +20 | cheat_bonus |
| Pushup challenge | dynamic | pushup_challenge |
| 4x4x48 challenge | +100 | goggins_4x4x48 |
| Onboarding complete (one-time) | +10 | onboarding_bonus |
| Admin-issued celebration | varies | (via `bonus_grants` table) |

**Pushup challenge step function (today's cumulative reps):**
- First 30 reps: 1pt per rep (30pt max for first 30)
- After 30: 1pt per 5 additional reps (100 reps → 44pt)

### Penalties (negative values counted, not flat 0)
| Action | Points | Type |
|--------|--------|------|
| Forbidden meal | **−30** | diet_junk |
| Routine skipped (unchecked at end of day) | −1 | routine_skip (auto-applied on next-day reminder) |
| Routine failed (manual) | −1 | routine_fail |
| Target failed (manual) | −2 | target_fail |
| Alcohol | 0 | diet_alcohol_register |

### Diet sentence flow (new in v2.4)
Red meal penalty of −30 is recoverable via the 형량 system:
- **Log red meal** → −30 applied immediately, 채찍피티 overlay shows exercise sentence
- **형량 수락** → cardio activity auto-added to workout list with `_isChaek:true` + `status:'planned'`
- **형량 완료** (mark activity done) → +30 recovery (net 0) — guarded by `_canRefundJunk()` against double-refund
- **도망 (reject sentence)** → keeps the original −30 (no additional penalty; prior double-penalty bug fixed)

### Cancellations (negative, ledger correction)
| Action | Points | Type |
|--------|--------|------|
| Strength workout cancelled | −30 | workout_done_cancel |
| Cardio workout cancelled | −30 | workout_cardio_done_cancel |
| Clean meal deleted | −10 | diet_clean_delete |
| Routine undone | −1 | routine_done_cancel |
| Target undone | −2 | target_done_cancel |
| Meal unlogged | −1 | diet_log_cancel |
| Diet junk recovered (via sentence complete or meal edit) | +30 | diet_junk_cancel |
| Routine skip undone | +1 | routine_skip_cancel |
| Routine fail undone | +1 | routine_fail_cancel |
| Target fail undone | +2 | target_fail_cancel |

### Milestone Celebrations
- Every 100 points → popup celebration
- Tier-up → confetti + win modal + room overlay + **tier-up share ribbon (v2.4)**
- Perfect day (all sections complete) → special confetti
- **First workout (v2.4)** → pulse badge dot on 통계 bottom-nav item, cleared on tab visit

---

## 6. Tier System

| Score | Icon | Name | Description | Color |
|-------|------|------|-------------|-------|
| 0-199 | 😴 | 방관자 | 자기 삶을 구경만 하는 자 | #888 |
| 200-599 | 👁️ | 각성자 | 뭔가 달라져야 함을 느낀 자 | #38bdf8 |
| 600-1499 | ⚔️ | 저항자 | 나태함에 맞서 싸우기 시작한 자 | #f59e0b |
| 1500-3499 | 🔥 | 수련자 | 고통을 선택하며 단련되는 자 | #34d399 |
| 3500-6999 | 💎 | 지배자 | 자신의 삶을 완전히 통제하는 자 | #ff4d4d |
| 7000+ | 💀 | Goggins | 타협 없음. 한계란 없음 | #a855f7 |

---

## 7. Meal Quality System

| Type | Label | Icon | Score | Examples |
|------|-------|------|-------|----------|
| green | 클린 | ✅ | +10 | Salad, chicken breast, brown rice |
| normal | 일반 | 🍚 | +1 | Korean food, rice, stew |
| cheat | 치팅 | 🎉 | quota | Cheat meal (weekly limit) |
| red | 금지 | 🚫 | 0 | Junk food, binge eating |
| alcohol | 음주 | 🍺 | 0 | Drinks (tracked separately) |

**Cheat Quota:** Default 3/week, resets Monday. Unused cheats = +20pt bonus each.

**Snack Categories:** 간식, 야식, 음료, 술, 안주

---

## 8. Workout System

### Gym Session Flow
```
Workout Start Screen
  → Select saved routine OR start empty session
  → Exercise Library (search by muscle/equipment)
  → Log sets: kg × reps → check done
  → Rest timer between sets (default 90s)
  → Next Exercise sheet → Finish sheet
  → Session Summary (volume, sets, time)
  → Optional: Save as new routine
  → Optional: Share card
```

### Exercise Library
- 150+ exercises across 9 muscle groups
- Groups: 가슴, 등, 어깨, 삼두, 이두, 복근, 하체, 전신, 유산소
- Equipment: 바벨, 덤벨, 케이블, 맨몸, 머신, 저항밴드

### Activity Types (Non-Gym)
- Cardio: 달리기, 사이클, 수영, 걷기, 줄넘기
- Sports: 테니스, 골프, 농구, 축구, 배드민턴, 복싱
- Mindfulness: 요가, 스트레칭, 명상

### Computer Vision (7 exercises)
- Pushup, Squat, Pullup, Lunge, Situp, Burpee, Bicep Curl
- MediaPipe pose detection, angle-based rep counting
- Auto-recording with upload to Supabase Storage

---

## 9. Modals & Overlays (23 total — carry-over modal absorbed into inline Yesterday Ribbon in v2.1)

### Inline Ribbons (in-flow, not modal)
| ID | Trigger | Purpose |
|----|---------|---------|
| yesterday-ribbon | Morning load if prev-day incomplete | Unified carry-over + reminder (replaces reminder-banner + carryover-modal) |

### Bottom-Sheet Modals (z:800)
| ID | Trigger | Purpose |
|----|---------|---------|
| meal-modal-slot | Meal slot tap | Log breakfast/lunch/dinner |
| meal-modal-snack | Snack button | Log snack/drink/alcohol |
| weight-modal | Weight card | Enter weight + goal |
| activity-modal | Activity tile | Log non-gym workout |
| cheat-modal | Cheat badge | Cheat quota management |
| profile-modal | Avatar button | User settings, sign out |
| mand-modal | Routine add button | Add mandatory routine |
| promote-modal | Promote button | Copy task to future dates |
| summary-modal | Summary button | Daily overview |

### Full-Screen Overlays
| ID | z-index | Purpose |
|----|---------|---------|
| workout-start-screen | 490 | Routine picker + start session |
| workout-session-overlay | 500 | Active gym session |
| session-summary-modal | 550 | Post-workout summary |
| cv-overlay | 550 | Camera pose detection |
| exercise-detail-modal | 560 | Exercise history + PRs |
| ex-library-overlay | 700 | Exercise picker |
| routine-modal-overlay | 600 | Routine editor |
| challenge-room | 700 | Competition leaderboard |
| ch-create-overlay | 700 | Create competition |
| ch-join-overlay | 700 | Join competition |
| onboarding-modal | 800 | First-time setup |
| muscle-map-overlay | 750 | Muscle activation heatmap |
| room-overlay | 900 | Character room scene |
| score-guide-modal | 800 | Score rules + tier ladder |

---

## 10. Design System

### Colors
```
Background:  #0a0a0c → #141418 → #1c1c22 → #24242c
Text:        #eaeaea (primary) | #6b6b78 (secondary) | #3a3a46 (tertiary)
Accent:      #ff4d4d (red-orange, Goggins brand)
Gradient:    #ff4d4d → #ff6b35
Green:       #34d399 (success, clean, completed)
Amber:       #f59e0b (warning, cheat, in-progress)
Blue:        #38bdf8 (info, water, weight)
Red:         #ff4d4d (error, forbidden, penalty)
```

### Typography
- Body: DM Sans (300-700)
- Numbers: DM Mono (monospace, data display)
- Display: Archivo Black (large numerals)

### Spacing
- Border radius: 12px (cards), 10px (buttons/inputs)
- Card margin: 14px horizontal
- Section gap: 8px

### Interactions
- Swipe-to-dismiss on bottom-sheet modals
- Day slider swipe navigation
- Pull-down elastic snap-back
- Confetti particles on achievements
- Rage overlay on forbidden actions
- Win popup queue system

---

## 11. UX Features

### First-Use Tooltips (one-time, localStorage)
- Meal quality guide (food examples per type)
- Workout session usage guide
- Water tracking interaction guide
- Workout guided mode (4-step overlay for first session)

### Offline Support
- logCache (in-memory) + localStorage backup
- Offline banner with retry button
- Pending save tracking via `_dirtyKeys`
- Score backup in localStorage
- Loading retry after 15s timeout

### Gamification Elements
- 6-tier progression system
- 100-point milestone celebrations
- Daily streak tracking
- Goggins rage overlay (motivational punishment)
- Win popup queue (stacked celebrations)
- Character pixel art evolving with tier
- Report card grades (A-F)
- Cheat quota strategy (unused = bonus)

---

## 12. Technical Architecture

### Stack
- **Frontend:** Single HTML file, vanilla JS, CSS
- **Backend:** Supabase (Auth + Database + Storage)
- **Charts:** Chart.js 4.4.0
- **CV:** MediaPipe PoseLandmarker
- **Deploy:** Vercel (auto-deploy on main push)
- **PWA:** manifest.json + service worker capable

### Data Flow
```
User Action → logCache[key] update → renderRoutine()
  → queueSave() → _dirtyKeys.add(key)
  → [500ms debounce] → _flushSave()
  → saveLog(key) → Supabase upsert
  → localStorage backup on success
```

### Save Safety
- Debounced saves (500ms) to batch rapid changes
- Dirty key tracking prevents wrong-day saves
- Background revalidation skips dirty keys
- beforeunload backs up to localStorage
- visibilitychange triggers immediate flush
- 3-retry with exponential backoff on failure

---

## 13. Development Changelog (2026-04-19 — v2.4 Onboarding Rebuild · Viral Loop · Milestone Reveals · Security Hardening)

### Ship 1 — Onboarding Body Rebuild
- **Step 1 redesigned** (`index.html:1921–1964`): 환영한다 + STAY HARD wordmark + "매일 작은 체크, 꾸준한 성장" tagline + philosophy line ("고긴스의 광기가 아니라 너의 매일이 너를 만든다") + 2×2 pillar grid (⚖️ 공복 체중 · 🥗 클린 식단 · 💪 운동 기록 · ✅ 루틴·할일) + closing consistency copy. Replaces the bare name+quote previous welcome.
- **Step 4 quick-win**: After routine selection, new `ob-s4` slide shows scoring rules preview + "+10pt 환영 보너스" CTA. `obFinish()` calls `addScore('onboarding_bonus')` so the user lands on the app at 10pt instead of 0 — kills the cold-start dopamine dead zone.
- **`OB_GOAL_ROUTINES` realistic bodyweight rewrite**:
  - diet: 물 2L · 30분 걷기 · 공복 체중 · 저녁 9시 금식 · 팔굽혀펴기 10개
  - muscle: 팔굽혀펴기 10개 · 맨몸 스쿼트 50개 · 🔥 헬스 (주 4회, days [1,2,4,5]) · 단백질 1g/체중 · 물 2L
  - habit: 팔굽혀펴기 10개 · 30분 걷기 · 물 2L · 🔥 운동 (주 3회, days [1,3,5]) · 11시 전 취침
  Dropped 찬물 샤워 / 새벽 6시 기상 / 독서 / 책상 정리 / 폰 덜 보기 (too high-friction or unmeasurable).
- **Goal persistence** (`migrations/010_profiles_goal_column.sql`): `profiles.goal text CHECK IN ('diet','muscle','habit')`. `obSelectGoal()` writes immediately; `obFinish()` writes again as safety.
- **Activation funnel instrumentation**: `onboard_step_view{step}`, `onboard_goal_select{goal}`, `first_point_earned{type,pts}` (localStorage-guarded `first_pt_<userId>` fires once per user across onboarding bonus + organic first earn).

### Ship 2 — First-Week Mission Card
- New `#first-week-card` on 기록 tab between Status Band and day slider (`index.html:948–958`).
- 3 missions (reduced from 4 after user feedback):
  1. 이번 주 몸무게 기록 → `openWeightModal`
  2. 필수 루틴 세팅 → `openAddMandatoryModal`
  3. 이번 주 첫 운동 → `openWorkoutModal`
- Bonus: when today's custom mandatory routines are all done, appends "💪 오늘 할 일 다 끝냈네. 보너스 미션. 🔥 팔굽혀펴기 챌린지 →" row wired to `cvOpenPushupChallenge`.
- State: `logCache` scan for current ISO week; no new DB columns. Refresh hooked into `addScore` + `renderWorkouts` + `renderWeight` so missions flip to ✓ in the same frame as the user's action.
- Visibility: "first-seen" timestamp via localStorage (`fw_seen_at_<userId>`) + 7-day window. Existing users retroactively get 7 days from first post-deploy login. Override via `?fw=1` URL param bypasses both dismiss and window. sessionStorage dismiss — reappears after tab close.
- Analytics: `first_week_card_shown`, `first_week_card_dismissed`, `fw_mission_click{mission}`.

### Ship 3 — Smart Empty States with Score Previews
Empty states on routine / target / workout cards now carry inline `[+Npt / -Npt]` pills so new users learn the scoring through usage, not through a tutorial:
- **Routines** (`check-rows` empty): `[+1pt 체크 · -1pt 실패/스킵]` + updated examples (팔굽혀펴기 / 걷기 / 물 2L) replacing 고양이 밥 / 양치 / 청소.
- **Targets** (`tgt-rows` empty): `[+2pt 완료 · -2pt 실패]`.
- **Workouts** (`workout-rows` empty): `[+30pt 근력 · +30pt 유산소 (하루 1회씩)]` + 💪 "아직 오늘 운동 기록이 없어요" copy.
- Water untouched (no direct score). Meals untouched (per-slot UI already surfaces per-meal score via `qualityScore` inside logged rows).

### Ship 4 — Viral Loop (Friend Invite Card + Tier-Up Share + URL Landing)
- **`#invite-card`** on home (`index.html:935–946`): 🙌 row with 초대 → CTA + ✕ dismiss. Persistent (localStorage dismiss per user). Renders via `renderInviteCard()` hooked into `renderRoutine`.
- **`shareInvite()`**: html2canvas-rendered 430px card with user display_name + tier pill + score chip + "같이 Stay Hard 하자" pitch + footer URL. Web Share API (native sheet — KakaoTalk / Instagram / 메시지) first, PNG download fallback (with `URL.revokeObjectURL` cleanup — fixed in security round).
- **`maybeShowFriendWelcome()` extended**: dual-mode now — `?celebrate=<event_key>` (bonus grant) and `?invite=<userId>` (invite link). Shows modal with "친구가 Stay Hard 로 초대했어요" + pitch + 나도 시작/로그인/나중에 CTAs. Once-dismissed guard per storage key. URL params validated via `sanitizeUrlParam()` (added in security round).
- **Tier-up share ribbon**: `showTierUpShareCTA(tier)` fires inside `addScore` tier-change branch, bottom-anchored sticky ribbon (`#tierup-share-ribbon`) with tier icon + "친구한테 보여주자" + ↗ 자랑하기 button. Per-tier sessionStorage guard, 10s auto-dismiss, slides up via `tierShareSlide` keyframe.
- Analytics: `invite_card_dismissed`, `invite_share_start`, `invite_share{channel}`, `tierup_share_cta_shown{tier}`, `friend_welcome_seen/cta{mode,key}`.

### Ship 5 — Tip Registry + Goggins Explainer + Changelog
- **`showTip()` expansion** (`index.html:~12096`): new entries `tipStatusBand`, `tipDaySlider`, `tipMuscleMap`, `tipInvite`. localStorage-gated (1-shot per key), 8s auto-dismiss. `tipMuscleMap` fires 500ms into `openMuscleMap`; `tipInvite` fires 1.5s after `renderInviteCard` first shows.
- **Score Guide Goggins banner** (`index.html:1505+`): top of scroll area, `"점수는 일회성 이벤트 아냐. 매일 체크, 매일 쌓아. 꾸준함이 너를 만든다."` Reinforces philosophy at peak-comprehension moment (user explicitly opened scoring ladder).
- **Profile Modal changelog** (`index.html:2998+`): 3-line rolling log under profile row with date prefix + emoji + one-liner. Quiet discovery channel for power users.

### Ship 6 — Day-1 Evening Goggins Nudge + Day-3 Challenge Nudge
- **P2.3 Day-1 nudge** (`checkDay1EveningNudge` at `index.html:~6837`): fires 3s after `onLogin` if `firstSeen` is today + no point events today + local hour ≥ 17 + once-per-day localStorage guard (`day1_nudge_<date>_<userId>`). Shows `_showDay1NudgeModal` with 🌱 icon + one of 3 Goggins-voice messages + single "알았어, 간다" CTA.
- **P3.2 Day-3 nudge** (`renderDay3ChallengeNudge`): new `#day3-nudge-card` between Status Band and invite card. Renders when `logCache` contains ≥3 distinct active days (weight / workout done / meals / points_log present). Cyan+green gradient (differentiates from red onboarding / invite). Dismissible per session.
- Analytics: `day1_nudge_shown / cta`, `day3_nudge_dismissed / cta`.

### Ship 7 — Milestone Reveal (첫 운동 → 통계 nav badge)
- **`.nav-badge-dot`** CSS: 8px orange pulsing dot on bottom-nav items (`.bni`). Uses `navBadgePulse` keyframe; respects `prefers-reduced-motion`.
- **`unlockNavBadge(tab)` / `consumeNavBadge(tab)`** generic pair (`index.html:~6962`). localStorage guard `milestone_seen_<tab>_<userId>`.
- **First workout trigger**: `maybeUnlockStatsOnWorkout(type)` called from `addScore` when type matches `workout_done` or `workout_cardio_done`. Dot clears on `switchTab('stats')`.
- Analytics: `milestone_badge_shown{tab}`.

### Ship 8 — Weekly Feature Ribbon (hardcoded rotation)
- **`#weekly-feature-card`** between Status Band and day-3 nudge. Purple gradient to distinguish from red onboarding / invite / green day-3.
- **`WEEKLY_FEATURES`** hardcoded array of 4 items:
  - 💥 자극 부위 맵 → `openMuscleMap`
  - 🏆 챌린지로 경쟁 → `gotoChallengeTab`
  - 📊 통계로 돌아보기 → `gotoStatsTab`
  - 💪 푸쉬업 챌린지 → `cvOpenPushupChallenge`
- Week index = `floor(dayOfYear / 7)` (client-side deterministic). Dismiss is per-user-per-week via sessionStorage. Admin curation UI deferred to follow-up ship.
- Analytics: `wf_cta_click{title}`, `wf_dismissed`, `wf_goto{to}`.

### Ship 9 — 주 운동 횟수 Picker (Step 3)
- **`#ob-wfreq-section`** above routine chips, visible only for muscle/habit goals (`index.html:2076–2086`). Four options 2/3/4/5회.
- **`WFREQ_DAYS`** mapping count → weekday indices: 2회→[월,목], 3회→[월,수,금], 4회→[월,화,목,금], 5회→[월~금].
- **`obSelectWfreq(n)`** updates any already-selected 운동/헬스 routine's `days` array + styles the picker. `obToggleRoutine` checks `_obWorkoutFreq` and applies the custom days when adding a workout chip.
- Muscle defaults to 4회, habit to 3회. Progressive routine auto-increment (10→15→20) deferred (needs UX trigger design).
- Analytics: `onboard_wfreq_select{freq,goal}`.

### Security hardening (post-review, same day)
Code review flagged 4 HIGH + 10 MEDIUM issues; HIGH + M2/M3/M4 fixed immediately:
- **esc() / escMultiline() helpers** (`index.html:~6547`): HTML-entity escape any DB/user-sourced string before `innerHTML` injection. Applied to competition activity feed (`display_name`/`label`/`type`), carry-over ribbon and renderTargets (`t.text`), bonus grant modal + share card (`icon`/`title`/`message`).
- **Blob URL leak fix** (`index.html:6711, 7030`): `shareBonusGrant` + `shareInvite` PNG download paths now `setTimeout(() => URL.revokeObjectURL(url), 1500)` after `a.click()`.
- **`migrations/011_revoke_is_user_excluded.sql`**: REVOKE EXECUTE on `is_user_excluded(uuid)` from authenticated/anon/public. Function still runs inside `admin_dashboard()` SECURITY DEFINER context; direct external calls blocked.
- **`sanitizeUrlParam(v, maxLen=128)`**: whitelist `[a-zA-Z0-9_-]`, length-clamp. Applied to `?celebrate` / `?invite` before use as localStorage keys or analytics meta.
- **`scripts/sb-sql.sh` temp file hardening**: `mktemp` + `chmod 600` + `trap 'rm -f "$TMPOUT"' EXIT`. Prior world-readable `/tmp/sb-sql.out` could leak emails/PII to other local users.

Open items deferred to follow-up ship: `body.overflow` reference counting for nested modals (M1); extracting `shareCardAsPng()` helper to deduplicate three share fns (M6); `render_error` tracking on the 4 silent render catches (M7); atomic decrement RPC for `revokeBonus` (M5); ISO-week rotation for `WEEKLY_FEATURES` (M8); aria-label audit on share buttons (L2). Review artifact at `document/reviews/session-2026-04-19-review.md`.

### Tooling
- **`scripts/sb-sql.sh`** + `scripts/README.md`: run any SQL against Supabase via Management API. Requires a Personal Access Token at `~/.stayhard-sb-pat` (chmod 600). Supports file / stdin / `-c "inline SQL"`. Stores token in home dir outside repo; `.gitignore` defensively blocks `.stayhard-sb-pat`, `*.pat`, `scripts/.env`.

---

## 14. Development Changelog (2026-04-18 evening — v2.3 Sprint I: Share + PM Admin Dashboard)

### Sprint I-A — Muscle Map Share Feature
- **↗ Share button** in `#muscle-map-overlay` header (next to ✕). Universal 3-node share SVG icon (Android-style, 15×15 stroke 2.2), 40×40 tap target, accent gradient background.
- **`shareMuscleMap()`** composes an offscreen share card (430px wide) and captures via html2canvas:
  - Header: STAY HARD logo + "자극 부위 · {mode} · {view}" + date
  - Body: Rasterized SVG of current muscle map (serialized to Blob URL → Image preload → canvas.drawImage to PNG data URL → `<img>` in composition). This avoids iOS Safari's inline-SVG rendering bug in html2canvas.
  - TOP 3 타격 부위 (mode-aware): today/week show muscle + sets + volume; all-mode shows grouped % distribution.
  - Footer: mode + muscle-group-aware gym meme copy + "stayhard.app · {tease}" + STAY HARD badge.
- **Muscle-group-specific meme copy** (professional Korean fitness tone):
  - chest → "대흉근 만드는 중 💪" · tease "너도 대흉근 증명해봐 →"
  - shoulder → "어깨뽕 세팅 중 🔥" · "너도 어깨각 자랑해봐 →"
  - back → "등판 넓히는 중 📐" · "등은 거울에 안 보임 👀"
  - arm → "팔뚝 펌핑 중 💪" · "너도 팔뚝 자랑해봐 →"
  - leg → "레그데이 안 빼먹음 🦵" · "하체 빼먹지 마라 👀"
  - abs → "복근 새기는 중 🎯" · "너도 복근 새겨봐 →"
  - week (generic) → "이번 주 쇠질 완료 🔥" · "너도 일주일 찍어봐 →"
  - all (generic) → "내 훈련 분포 📊" · "너도 루틴 공개해봐 →"
- **Share transport:** Web Share API first (`navigator.share({files})`), auto-surfaces native share sheet (KakaoTalk, Instagram, 메시지). Falls back to PNG download with toast. Body overflow temporarily restored before `navigator.share` call (iOS Safari otherwise fails to animate the share sheet while scroll is locked).
- **iOS mobile tap fix** (after multiple iterations):
  - Converted share button from `<button>` → `<div role="button" tabindex="0">`. Reason: known WebKit bug where `<button>` with only SVG children inside flex containers drops tap events.
  - Event listeners attached programmatically via `addEventListener('click')` + `addEventListener('touchend', ..., {passive:false})` in `openMuscleMap()` rather than inline HTML attributes.
  - `_mmShareBusy` debounce flag prevents touchend+click double-fire.
- **Empty state encouragement** in `renderMuscleMap()` when `activeList.length === 0`:
  - Accent-gradient bordered card with 💪 icon
  - Mode-aware copy:
    - today: "오늘 훈련 전이에요" · "운동을 시작하면 타격 부위가 근육맵에 기록돼요 🔥"
    - week: "이번 주 기록이 없어요" · "한 번의 세션부터 주간 근육맵이 채워져요 💪"
    - all: "아직 훈련 기록이 없어요" · "첫 세션부터 모든 기록이 근육맵에 누적돼요 📊"
  - CTA "🔥 {운동 시작하기|지금 시작하기|첫 세션 시작하기}" → `closeMuscleMap()` → `setTimeout(openWorkoutModal, 50)` for clean sequence
- **Terminology consistency:** switched "지도" → "근육맵" throughout empty state copy. Dropped metaphors that read awkwardly in Korean (차올라요 / 달아올라요 / 불타올라요) in favor of neutral verbs (기록돼요 / 쌓여요 / 누적돼요).

### Sprint I-B — Analytics Events & Client-Side Tracking
- **`migrations/003_analytics_events.sql`**:
  - `profiles.is_admin boolean NOT NULL DEFAULT false` column
  - `is_admin()` SECURITY DEFINER helper — reads current user's profile flag
  - `events` table: `id bigserial`, `user_id uuid` (FK auth.users ON DELETE CASCADE), `event_name text`, `meta jsonb DEFAULT '{}'`, `created_at timestamptz DEFAULT now()`
  - Indexes on `user_id`, `event_name`, `created_at DESC`, `(event_name, created_at DESC)`
  - RLS: `events_insert_self` (INSERT with `user_id = auth.uid()`), `events_select_self_or_admin` (SELECT own or admin)
- **`track(eventName, meta)`** client helper in `index.html`: fire-and-forget INSERT to events. No-op if `CU.id` is not set. Silent on failure (e.g., migration not yet run, offline).
- **Events instrumented:**
  - `signup` (after `sb.auth.signUp`) with `email_domain`
  - `onboard_complete` (both `obDismissForever` and full flow) with `path`, `goal`, `routines` count
  - `share_muscle_map` (start of `shareMuscleMap`) with `mode`, `view`
  - `workout_complete` (end of `finishSession`, non-edit case) with `exercises`, `volume`, `status`
  - `competition_create` (after createComp success) with `measure_type`, `duration`
  - `competition_join` (after `_doJoinComp` success) with `comp_id`, `measure_type`

### Sprint I-C — PM Admin Dashboard (standalone admin.html)
- **Architecture decision:** admin lives outside consumer app to avoid bundling admin logic into user-facing code, and to keep consumer styling separate from ops tooling.
- **`admin.html`** (390 lines, standalone at `/admin.html`):
  - Supabase auth — reuses existing session from main app (same origin). If no session, shows inline login form. If not admin, shows self-fixing SQL snippet.
  - **KPI row** (38px big numbers, tabular):
    - WAE (north star) + Δ vs prev week
    - DAU + Δ vs 7 days ago
    - WAU + Δ vs prev 7d window
    - MAU + Δ vs prev 30d window
    - Stickiness (DAU/MAU %)
    - Signups 7d/30d/total with 7d Δ
  - **Activation funnel** (5 steps): signup → onboarded → first_log → 3+ days week 1 → activated (100pt+). Each step shows count, % of signups, and step-over-step conversion %. Conversion color-coded: ≥60% green / 30-60% yellow / <30% red.
  - **14-day DAU line chart** (Chart.js, cyan line on dark background)
  - **Feature adoption bars** (today's DAU): meals / workouts / water / weight / mandatory / targets
  - **D7 retention cohort table** (last 8 weeks): cohort_week | signups | retained | rate, rate color-coded ≥40%/20-40%/<20%
  - **Tables:** users (all), events (last 100), daily_logs (last 50), event counts 7d, competitions by status
- **Design principles** (corrected after iteration — earlier attempts veered into marketing territory):
  - Monospace everywhere (SF Mono / ui-monospace)
  - Black #0c0c0c background, 3-color threshold coding (green/yellow/red), cyan accent for charts
  - No emojis, no gradients, no hero layouts, no marketing copy
  - Data density prioritized; tables dense, deltas explicit
  - Feels like Metabase/Amplitude, not like a product landing page
- **`migrations/004_admin_dashboard_full_data.sql`** — extends `admin_dashboard()` RPC (SECURITY DEFINER, gated by `is_admin()`). Single call returns:
  - Current KPIs: dau, wau, mau, wae, signups_{7d,30d,total}
  - Previous period: dau_7d_ago, wau_prev, mau_prev, wae_prev, signups_prev_7d (all for delta computation)
  - Activation funnel counts
  - feature_adoption_today
  - trend_14d (14 daily DAU values)
  - cohorts (D7 retention, last 8 weeks)
  - event_counts_7d (aggregated)
  - competitions by status
  - all_users (full profiles × auth.users with email + log_days + last_log)
  - recent_events (100)
  - recent_logs (50)

### Access
- **App:** `https://stay-hard-rouge.vercel.app`
- **Admin dashboard:** `https://stay-hard-rouge.vercel.app/admin.html`
- **Admin provisioning (one-time, Supabase SQL Editor):**
  ```sql
  UPDATE profiles SET is_admin = true
  WHERE id = (SELECT id FROM auth.users WHERE email = 'starckato@gmail.com');
  ```

---

## 15. Development Changelog (2026-04-18 — v2.2 UX-Evaluation Follow-up + RLS Hardening)

Built on top of v2.1 after a structured UX evaluation (4 personas × 6 use cases × 18 UX values). Each sprint targets a specific under-delivered value.

### Sprint D — Action-oriented Review (UC4)
- **#st-hero-focus banner** under stats hero. `_stFocusSentence(g, rows)` picks the lowest-scoring category from `stCalcOverallGrade` output and returns one Goggins-voice next-week directive. 4 category templates (훈련/식단/루틴/할일) × 3 variants; stable within a week via `rows[0]._key` seed. All-A grades get a congratulation + maintain message with green border.
- **Period-over-period delta insights** (`_stPeriodDeltaInsights`). Compares current filtered window against same-length window before it, pulled from `_stData`. Surfaces clean%, routine%, volume, and workout-count changes above the ±8/10/15/2 thresholds. Gated by `prev.length >= max(3, stPeriod/4)` — silently skipped when comparison data insufficient.

### Sprint E — Returner Mode (UC6)
- **`_daysSinceLastActivity()`** walks `logCache` back 21 days; falls back to a 90-day Supabase fetch if cache is empty. Returns 999 for users with no recorded activity.
- **`showReturnerRibbon(gapDays)`** replaces the rage-voice carry-over ribbon when gap ≥ 3 days: 🌱 icon, 3-tier severity copy (3-6d / 7-13d / 14+d), a single "오늘 이것만" spotlight card with the user's shortest-named applicable mandatory routine (or "물 2잔 마시기" fallback), and a single "다시 시작 →" CTA.
- **`_consumeReturnerFirstAction()`** consumes a `sessionStorage` flag so the first mandatory/target completion after returning triggers a "돌아왔어 🌱" toast in addition to the score-gain chip. Goggins rage voice resumes day 2+.

### Sprint F — Workout Session Prefill (UC2)
- `addExerciseToSession` now flags set 1 with `_prefill: true` and stores `prefillRef` on the exercise when `findPrevSets` returns data.
- **Set input rendering** differentiates prefilled state: amber border (`rgba(245,158,11,.35)`), subtle `color: var(--text2)`, `onfocus="this.select()"` for one-tap overwrite.
- **"↻ 지난 기록 자동 입력 · 그대로 OK, 수정도 가능"** 9px amber label above the first set.
- Flag clears automatically in `wsUpdateKg` / `updateSet` once the user edits — style snaps back to normal.

### Sprint G — Challenge Activity Feed (UC5)
- **Migration `001_competition_recent_activity.sql`**: `ALTER TABLE competitions ADD COLUMN IF NOT EXISTS recent_activity jsonb DEFAULT '[]'::jsonb`. Rides existing competitions RLS.
- **`_appendCompActivity(type, pts)`** hooked into `addScore` (fire-and-forget for `pts > 0` when an active competition exists). Read-modify-write pattern with client-side cap at 20 most recent entries.
- **Polling loop**: `_startActivityPoll` / `_stopActivityPoll` run on 60s interval bound to `openChallengeRoom` / `closeChallengeRoom`.
- **`#room-activity-section` UI** between D-Day progress and 그룹 통계. Green pulsing dot + metadata + scrollable list (max 220px, 15 entries). Self-entries highlighted with accent red border. `_formatActivityTime` produces 방금 / N분 전 / N시간 전 / N일 전.
- **Graceful degradation**: If column missing (pre-migration deploy), `sessionStorage` flag disables the feature for the session; section auto-hides. No crashes.

### Sprint H — Competitions RLS Hardening (Security)
- **Problem**: Pre-existing RLS on `competitions` allowed any authenticated user to UPDATE any row — members could be booted, weight goals rewritten, activity feed spammed. Sprint G's write surface made this more exploitable.
- **Migration `002_tighten_competitions_rls.sql`**:
  - `join_competition_by_code(code, weight_goal, inbody_goals)` — SECURITY DEFINER PL/pgSQL RPC. Validates code, checks membership/capacity, performs atomic member append under `FOR UPDATE` lock. Grants execute to `authenticated`.
  - Drops existing policies via a `DO` block, then creates four strict replacements:
    - SELECT: any authenticated (needed for code lookup; codes are 8-char secrets)
    - INSERT: `creator_id = auth.uid()` enforced
    - UPDATE: creator or current member of THIS row only (`members::jsonb ? auth.uid()::text`)
    - DELETE: creator only
  - Rollback snippet included (commented) for emergency revert.
- **Client patch**: `_doJoinComp` now calls `sb.rpc('join_competition_by_code', {...})` first and falls back to direct UPDATE only if the RPC is not yet deployed (pre-migration environments).
- **Verified post-migration**: Non-member UPDATE attempts on competitions silently return 0 rows; actual data unchanged. RPC responds correctly to invalid/missing codes. Existing member flows (leaderboard, activity append, weight goal updates, leave) unaffected.

---

## 16. Development Changelog (2026-04-18 — v2.1 Info-Hierarchy Redesign)

### Sprint A — 기록 탭 정보 계층 재편
- **Status Band hero**: header의 압축 goggins-badge + tiny summary pill + character card를 단일 tinted-gradient 히어로 카드로 통합. Archivo Black 대형 점수, 티어 pill, 스트릭, 오늘 Δ, 인용구, 다음 티어 진행 바, '오늘 기록 요약' 일차 CTA가 한 zone에 수직으로 배치됨.
- **Yesterday Ribbon**: reminder-banner(인라인)와 carryover-modal(풀스크린 시트)를 단일 접이식 ribbon으로 통합. morning load 시 한 번만 노출되며 undone targets가 있으면 checkable list + 이월/건너뜀 버튼, missing routines만 있으면 Goggins-voice reminder + "어제 기록 보기" 단일 CTA.
- **Water card split**: 식단 카드에서 물 섹션을 독립 s-card로 분리. renderWater가 `X.X / Y.YL` 포맷으로 항상 상태 표시.
- **Todo card merge**: '필수 루틴'과 '오늘의 할일'을 하나의 `.todo-card`로 통합. 각 섹션은 `.tasks-sec-label` + s-badge로 구분되며 기존 render 핸들러(renderMandatory / renderTargets / togMand / togTgt / addTarget)는 동일 ID로 작동.

### Sprint B — 비주얼 시스템 업그레이드
- **커스텀 SVG 아이콘셋**: 24px viewBox, 1.8px stroke, round caps, currentColor — bottom nav 톤과 통일.
  - 9개 아이콘: scale / drop / leaf / dumbbell / target / checkSq / checkCircle / chart / repeat
  - `ICO_PATHS` 전역 + `ico(name,size)` 헬퍼 제공
- **하단 네비 4종**: 이모지 교체 — 📋→clipboard+check, 📅→calendar+dot, 📊→bar chart, 🏆→trophy.
- **Status Band reveal sequence**: 로그인 후 첫 렌더 1회 800ms 오케스트레이션. 점수 0→N easeOutCubic 카운트업, 티어 pill 스탬프 인(scale 0.6→1.08→1), 스트릭/오늘Δ/인용구/진행바/CTA 순차 페이드. `_statusBandRevealed` 가드로 리렌더 시 재생 방지. `prefers-reduced-motion` 존중.

### Sprint C — 폴리싱
- **챌린지 탭 빈 상태**: 카피 수정("아직 도전 중인 챌린지가 없어" + 푸쉬업은 항상 함께 달린다는 안내), 기존 별도 "다음 챌린지 예고" 카드를 빈 상태 푸터로 접어 single card. `ch-rec-section`은 가입한 챌린지가 있을 때만 표시.
- **통계 히어로**: 3번째 셀을 '티어(중복 정보)' → '성적 A-F grade'로 교체. Archivo Black 34px, 등급별 색상(A green / B blue / C amber / D-F red). 공통 계산 `stCalcOverallGrade(rows)` 헬퍼 추가. 티어 진행 바는 하단에 유지(from 라벨에 티어 아이콘+이름 표기).

### 추가 아이콘 교체
기록 탭 카드 제목(체중/식단/물/운동/오늘 할 일), 통계 섹션 핀(종합/훈련/식단/습관), KPI 라벨(루틴/할일/클린식/운동 횟수/수분), 주간 행 라벨(체중/식단/운동/루틴/할일), 통계 주요 카드 제목 모두 SVG로 교체.

### 버그 수정
- **어제 리마인더 false-positive**: `checkYesterdayReminder`가 매일 노출되던 세 가지 버그:
  1. 필수 루틴 카운트가 요일 필터를 무시(월-금 루틴이 토/일에도 missing으로 카운트됨) → yDow 필터 적용
  2. 운동 체크가 `w.type==='session'`만 매칭(실 데이터는 'gym'|'activity') → 타입 호환
  3. 식단 체크가 `.length`만 확인(품질 태그 없는 빈 끼니도 OK 처리) → `some(m=>m.type)` 전환
  4. 최종적으로 workout/meals 검사는 개인 편차가 커 기본 missing에서 제외. 사용자가 루틴에 등록한 '운동' 루틴이 있으면 자동으로 잡힘 — 명시적 커밋만 배너에 반영.
- **initMiniChar 초기 페인트 경고**: `_paintInitialUI` 경로에서 renderCharCard가 폴백 선언 전 호출돼 콘솔 경고 2회. `typeof initMiniChar==='function'` 가드로 silent no-op.
- **운동 세션 볼륨 델타 오표시**: 모든 종목이 "지난 기록 16.1t" 표시 문제. 원인은 `_wsPrevSession`이 세션 총합을 리턴해 무관한 비교 발생. `_wsPrevExerciseVol(exName)` + `_wsEstimatedVolForExercise(ex)` 도입해 현재 활성 종목 기준 per-exercise 비교로 전환.
- **운동 세션 상단 종목 pill GIF 제거**: ws-ex-chip에서 22px GIF 썸네일 삭제(텍스트만). 하단 라이브러리 GIF는 유지.

### 신규 기능 — Score-gain Chip
- 루틴/할일 완료 시 탭 지점에서 Status Band 점수로 +N pt chip이 비행하는 900ms 애니메이션.
- `.score-chip` CSS: accent gradient pill, Archivo Black 숫자, 글로우 + 3중 shadow. 크기는 `fly` 상태에서 scale(.7)로 축소.
- `showScoreGain(pts, originEl)`: 클릭 좌표 → #hdr-score 중심 interpolate. 타겟이 뷰포트 밖이면 viewport edge(8px 여백)로 clamp.
- 도착 시 #hdr-score에 `.score-pulse` 클래스 450ms(scale 1.16 + 텍스트 글로우).
- `togMand`, `togTgt`에 wiring — 토글 전 origin rect 캡처(렌더 후 DOM 재생성 대응).
- `prefers-reduced-motion` 존중.

---

## 17. Development Changelog (2026-04-17)

### Bug Fixes
- Meal save race condition (dirty key tracking)
- Points persistence (addScore now triggers queueSave)
- Summary meal counter key mismatch (clean→green, junk→red)
- Workout session X button now saves completed sets
- Modal backdrop click now properly unlocks scroll
- Stats tier uses CP.total_score (not period-filtered)
- Meal heatmap respects period selector
- Exercise detail uses _stData (not logCache)
- Score guide synced with actual SCORE_EVENTS values

### Design
- Full palette migration: purple → red-orange (#ff4d4d)
- 56+ hardcoded color values migrated to new palette
- Industrial fitness aesthetic: deeper blacks, glow effects
- Tighter spacing, sharper radii, bolder typography
- Blurred glass on header/nav/toast/modal backdrop

### Stats Overhaul (4 Sprints)
- Sprint 1: 5 P0 fixes + water KPI card
- Sprint 2: Body composition chart + routine breakdown + habit streaks
- Sprint 3: PR dashboard + muscle group distribution
- Sprint 4: Report card + points breakdown + meal quality trend

### UX Improvements (3 Rounds)
- Mid-tier milestones (100pt celebrations)
- First-use contextual tooltips (meal, workout, water)
- Offline indicator + retry button
- Day slider swipe gesture
- Better auth error messages (Korean)
- Loading retry after 15s timeout
- Swipe-to-dismiss bottom-sheet modals
- Today's score sources card
- Workout guided mode (first session tutorial)

### New Features
- 야식 (late night snack) category
- Empty workout session centered add button
- 💥 자극 부위 (Muscle Activation Heatmap)
  - Full-screen overlay with anatomical SVG body model (front + back)
  - Flutter Body Atlas assets (CC BY 4.0, Ryan Graves)
  - ~120 individual muscle paths mapped to 18 muscle IDs
  - MUSCLE_MAP: 158 exercises → specific muscle contributions (%)
  - computeMuscleActivation(): volume × contribution, normalized 0-1
  - Single-hue red ember color system (dark maroon → blood crimson)
  - High-intensity muscles get dark glow effect
  - Toggle: 오늘 (today) vs 이번 주 (week cumulative)
  - Toggle: 전면 (front) vs 후면 (back) body view
  - Tooltip: muscle name + tier label + sets + volume
  - Summary pills with colored intensity bars
  - Tier labels: 워밍업 → 자극됨 → 집중 타격 → 폭발
  - Attribution footer for CC BY 4.0 license

### Defaults & Content
- Default mandatory routines updated to universal examples:
  📖 독서 30분 (everyday), 🗂️ 책상 정리 (everyday),
  💪 운동 (Mon-Fri), 🏃 러닝 (Mon/Wed/Fri/Sun), 👕 빨래 (Sunday)
- Removed inline quick-entry meal buttons from empty slots
  (reverted to clean single-tap design)

### Exercise GIFs & Library
- Animated GIF thumbnails for all 158 exercises (from exercises-dataset)
- EX_GIF constant maps Korean exercise names → GitHub CDN GIF URLs
- exIcon(name, size) helper renders GIF thumbnail with fallback to emoji
- GIF sizes by context: library 64px, session 48px, stats 48px, chips 22px
- Exercise library redesigned:
  - Stacked header: search input + muscle filter chips + equipment filter chips
  - Equipment secondary filter: 전체/바벨/덤벨/머신/케이블/맨몸
  - Exercise rows: 64px GIF, equipment badge, muscle tag, chevron
  - Active press feedback on rows
- Exercise strip chips in workout session now include 22px GIF thumbnails
- Empty workout session hides exercise strip (only center button visible)
- 24 new exercises added (134→158): 디클라인 머신 프레스, 시티드 로우 머신,
  스트레이트 암 풀다운, 덤벨 풀오버, 덤벨 카프 레이즈, 바벨 런지,
  싱글 레그 프레스, 레그 프레스 (와이드), 덤벨 Y레이즈, 케이블 프론트 레이즈,
  머신 숄더 프레스, 인클라인 덤벨 컬, 오버헤드 케이블 컬, 리버스 그립 푸쉬다운,
  EZ바 컬, 리스트 컬, 앱 롤아웃, 토 터치, 데드 버그, 힐 터치,
  터키시 겟업, 파머스 워크, 박스 점프, 로잉 머신

### Muscle Map UX (자극 부위)
- 3-mode toggle: 오늘 | 이번 주 | 전체 (cumulative proportions)
- 전체 mode shows grouped categories (가슴/등/하체/어깨/팔/복근) with %
- Interactive muscle pills: tapping highlights SVG paths with triple-layer glow
- Auto-selects highest-intensity muscle on render
- Tooltip floats next to the actual muscle with arrow pointing at it
- Muscles not on current view show "후면에서 확인하세요" message
- Front/back toggle maintains selected muscle (continuous UX)
- SVG underlayer hidden (no anatomical details showing through)
- Legend area capped at 140px with scroll to preserve body space
- Single-hue red ember color system (no fill change on highlight, glow only)

### Character Card & Room
- Character card redesigned: tier quote replaces duplicate score/tier info
- TIER_QUOTES: 4 quotes per tier, randomly selected per render
  - 😴 방관자: "일어나... 아직 늦지 않았어."
  - 👁️ 각성자: "눈을 떴구나. 이제 시작이야."
  - ⚔️ 저항자: "고통이 느껴지지? 그게 성장이야."
  - 🔥 수련자: "멈추지 마. 넌 이미 다른 사람이야."
  - 💎 지배자: "네 삶은 네가 통제한다. 계속해."
  - 💀 Goggins: "They don't know me, son."
- Quote color matches tier color
- Progress bar shows "다음 Npt" (forward-looking, no score repeat)
- Room overlay: close button moved to top-right with glass blur
- Dumbbell hint "💪 탭!" positioned near actual dumbbells in scene
- Dumbbell click zone adjusted to match visual position

### Code Quality
- Dead code removal (10 items, ~25 lines)
- Zero old palette values remaining

---

## 18. Muscle Activation System (자극 부위)

### Architecture
```
User logs workout → finishSession() → queueSave()
  → User taps 💥 자극 부위 button
  → openMuscleMap() → fetch SVG assets (cached after first load)
  → computeMuscleActivation(workouts, mode)
  → renderMuscleMap() → color SVG paths by intensity
```

### MUSCLE_MAP (158 exercises → 18 muscle IDs)
Maps each exercise name (Korean) to percentage-based muscle contributions:
```javascript
'벤치프레스': { chest: 70, front_delt: 15, triceps: 15 }
'스쿼트': { quads: 45, glutes: 30, hamstrings: 15, lower_back: 10 }
```

### 18 Muscle IDs
chest, upper_back, lats, traps, front_delt, mid_delt, rear_delt,
biceps, triceps, forearms, glutes, quads, hamstrings, calves,
abs, obliques, lower_back, hip_flexors

### MUSCLE_SVG_MAP (18 IDs → ~120 SVG path IDs)
Bridges fitness-level muscle groups to anatomical SVG element IDs:
```javascript
chest → ['pectoralis_major_l', 'pectoralis_major_r']
quads → ['rectus_femoris_l', 'vastus_lateralis_l', 'vastus_medialis_l', ...]
```

### Color System (Single-Hue Red Ember)
```
Inactive: #1a1a20 (blends with background)
Low:      dark maroon — barely visible warm tint
Mid:      visible dark red — clearly worked
High:     deep saturated red — heavily used
Max:      blood crimson + dark glow — destroyed
```

### Highlight System
- Tapping muscle pills highlights SVG paths with triple-layer glow
  (6px bright + 12px medium + 20px ambient drop-shadows)
- No fill change — original heat color preserved
- Previous highlight auto-clears when new muscle selected
- Muscles not visible on current view show centered "후면/전면에서 확인하세요"
- Tooltip floats next to muscle with diamond arrow (left/right auto-positioned)

### Modes
| Mode | Subtitle | Data Source | Summary Format |
|------|----------|-------------|----------------|
| 오늘 | 오늘 어디를 때렸나 | Today's workouts | Individual muscle pills |
| 이번 주 | 이번 주 훈련 분포 | This week | Individual muscle pills |
| 전체 | 누적 근육 비율 | logCache + _stData | Grouped categories with % |

### 전체 Mode Categories
Groups 18 muscle IDs into 6 categories with volume percentages:
- 가슴: chest
- 등: upper_back, lats, traps, lower_back
- 하체: quads, hamstrings, glutes, calves, hip_flexors
- 어깨: front_delt, mid_delt, rear_delt
- 팔: biceps, triceps, forearms
- 복근: abs, obliques

### SVG Assets
- `/assets/body_front.svg` (186KB, 126 paths, 587×1137)
- `/assets/body_back.svg` (133KB, 80 paths, 596×1133)
- Source: Flutter Body Atlas by Ryan Graves (CC BY 4.0)

### Korean Labels (MUSCLE_LABELS)
```
chest: 가슴, upper_back: 상부 등, lats: 광배근, traps: 승모근,
front_delt: 전면 삼각근, mid_delt: 측면 삼각근, rear_delt: 후면 삼각근,
biceps: 이두근, triceps: 삼두근, forearms: 전완근, glutes: 둔근,
quads: 대퇴사두, hamstrings: 햄스트링, calves: 종아리, abs: 복근,
obliques: 복사근, lower_back: 하부 등, hip_flexors: 고관절 굴곡근
```

---

## 19. Exercise GIF Licensing & Commercial Readiness

### Current State (Beta)
- GIFs sourced from `hasaneyldrm/exercises-dataset` (GitHub CDN)
- License: **Educational/non-commercial only**
- Acceptable for development, testing, and personal/free beta
- **NOT safe for commercial release**

### Commercial Migration Plan
**ExerciseDB.io** — one-time purchase, perpetual license

| Plan | Price | Sizes | Recommended |
|------|-------|-------|-------------|
| Mobile | $149 | 180px + 360px | ✅ Best for StayHard (430px mobile app) |
| Desktop | $159 | 720px + 1080px | Web/desktop apps |
| Cross-Platform | $179 | All 4 sizes | Future-proof |

**License terms (from exercisedb.io FAQ):**
- One-time purchase, perpetual license — use indefinitely
- Commercial use allowed — display GIFs in your app
- Self-hosting allowed — host on Supabase/your own servers
- Can modify data — edit names, instructions, grouping
- 1300+ exercises, every one has a GIF
- Cannot resell/redistribute raw dataset as standalone library

**Migration steps (30 min):**
1. Purchase Mobile plan ($149) at exercisedb.io
2. Upload GIFs to Supabase Storage `game-assets` bucket
3. Update `EX_GIF` constant URLs → Supabase paths
4. Done — fully licensed, self-hosted, zero external dependencies

---

## 20. Wearable Integration Roadmap

### Phase 1: Strava API (Web — No Native App)
**Status:** Backlog
**Why Strava first:** Universal bridge — Garmin, Apple Watch, Samsung, Polar all sync to Strava. One integration covers all wearable users.

**Integration plan:**
1. Register StayHard as Strava API app (free, OAuth 2.0)
2. User connects Strava account via OAuth web flow
3. Pull workout data: activity type, duration, distance, heart rate, calories
4. Map Strava activities → StayHard workout entries (auto-log)
5. Store Strava access/refresh tokens in `profiles` table
6. Webhook subscription for real-time activity push (no polling)

**Data available from Strava:**
- Activities: run, ride, swim, walk, workout, etc.
- Duration, distance, elevation, calories
- Heart rate zones (if watch provides)
- GPS route (optional)
- Splits and laps

**What it enables:**
- Auto-log cardio workouts from watch (달리기, 사이클, 수영, 걷기)
- Heart rate data for workout intensity
- Calories burned for daily tracking
- No manual entry for outdoor activities

**Limitations:**
- Gym workouts (sets/reps/kg) not available from Strava — still manual
- 15-min delay on free Strava API tier
- Rate limit: 100 req/15min, 1000 req/day

### Phase 2: Direct Wearable SDKs (Native App Required)
**Status:** Future — requires native app (Capacitor/React Native/Flutter)

| Platform | SDK | Data |
|----------|-----|------|
| **Apple Watch** | HealthKit | HR, workouts, steps, sleep, body metrics |
| **Garmin** | Garmin Connect IQ / Health API | HR, workouts, body battery, stress, sleep |
| **Samsung** | Samsung Health SDK | HR, workouts, steps, body composition |

**Trigger:** When StayHard wraps as native app via Capacitor or rebuilds in Flutter/RN.

### Other Assets Requiring License Check
- Body SVG: Flutter Body Atlas — CC BY 4.0 (commercial OK with attribution ✅)
- Chart.js — MIT (commercial OK ✅)
- Supabase JS — MIT (commercial OK ✅)

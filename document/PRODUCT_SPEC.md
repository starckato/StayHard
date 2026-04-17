# Stay Hard — Product Specification
> Last Updated: 2026-04-17
> Version: 2.0 (Post-Redesign)
> File: `/Users/KWAN/StayHard/index.html` (12,877 lines | 706.5KB)

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
│   ├── Header
│   │   ├── "Stay Hard" title
│   │   ├── Goggins Badge (streak, score, tier) → Score Guide
│   │   ├── Avatar → Profile Modal
│   │   └── Daily Motto
│   │
│   ├── [Tab 0] 기록 — Daily Routine (view-routine)
│   │   ├── Yesterday Reminder Banner
│   │   ├── Character Card → Room Overlay
│   │   ├── Day Slider (week strip + month nav)
│   │   ├── Summary Button → Summary Modal
│   │   ├── ⚖️ Weight Card → Weight Modal
│   │   ├── 🥗 Meals Card
│   │   │   ├── 아침/점심/저녁 slots → Meal Slot Modal
│   │   │   ├── Quick-entry buttons (클린/일반/치팅/금지)
│   │   │   ├── 간식/야식/음료/술/안주 → Snack Modal
│   │   │   └── 💧 Water cups + goal
│   │   ├── 💪 Workout Card
│   │   │   ├── Session rows → Session Summary
│   │   │   ├── "운동 추가" → Workout Start Screen
│   │   │   └── "💥 자극 부위" → Muscle Map Overlay
│   │   ├── ✅ 필수 루틴 Card → Mandatory Modal
│   │   └── 🎯 오늘의 할일 Card → Inline input
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

### Earning Points
| Action | Points | Type |
|--------|--------|------|
| Workout completed | +20 | workout_done |
| Clean meal | +10 | diet_clean |
| Cold shower | +10 | cold_shower |
| Early rise (6am) | +10 | early_rise |
| Weight loss vs previous | +5 | weight_loss |
| Goal weight achieved | +30 | weight_goal |
| Routine item done | +2 | routine_done |
| Target done | +2 | target_done |
| Meal logged | +1 | diet_log |
| Weight recorded | +1 | weight_record |
| Cheat restraint bonus | +20 | cheat_bonus |
| 4x4x48 challenge | +100 | goggins_4x4x48 |

### Penalties (0 points, tracked for records)
| Action | Type |
|--------|------|
| Forbidden meal | diet_junk |
| Alcohol | diet_alcohol_register |
| Routine failed | routine_fail |
| Target failed | target_fail |

### Cancellations (negative, ledger correction)
| Action | Points | Type |
|--------|--------|------|
| Workout cancelled | -20 | workout_done_cancel |
| Clean meal deleted | -10 | diet_clean_delete |
| Routine undone | -2 | routine_done_cancel |
| Target undone | -2 | target_done_cancel |
| Meal unlogged | -1 | diet_log_cancel |

### Milestone Celebrations
- Every 100 points → popup celebration
- Tier-up → confetti + win modal + room overlay
- Perfect day (all sections complete) → special confetti

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

## 9. Modals & Overlays (24 total)

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

## 13. Development Changelog (2026-04-17)

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

### Code Quality
- Dead code removal (10 items, ~25 lines)
- Zero old palette values remaining

---

## 14. Muscle Activation System (자극 부위)

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

## 15. Exercise GIF Licensing & Commercial Readiness

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

### Other Assets Requiring License Check
- Body SVG: Flutter Body Atlas — CC BY 4.0 (commercial OK with attribution ✅)
- Chart.js — MIT (commercial OK ✅)
- Supabase JS — MIT (commercial OK ✅)

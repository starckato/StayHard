// QROK · modular bundle entry point
// Migration phase: 3 complete · Phase 5 (Capacitor) in progress

import * as date from './lib/date.js';
import * as tier from './lib/tier.js';
import * as icons from './lib/icons.js';
import * as env from './lib/env.js';
import { sb } from './lib/supabase.js';
import * as analytics from './lib/analytics.js';
import * as mealPhoto from './lib/meal-photo.js';
import * as cheat from './lib/cheat.js';

import * as toast from './ui/toast.js';

import * as scoreEvents from './data/score-events.js';
import * as mottos from './data/mottos.js';
import * as exercises from './data/exercises.js';
import * as muscle from './data/muscle.js';
import * as rewardMessages from './data/reward-messages.js';
import * as pushupCV from './data/pushup-cv.js';
import * as pushupChallenge from './data/pushup-challenge.js';
import * as pushupCounter from './features/pushup/counter-modal.js';

import * as stats from './features/stats/index.js';
import * as onboarding from './features/onboarding/index.js';
import * as weight from './features/weight/index.js';
import * as rewards from './features/rewards/index.js';
import * as dateHeatmap from './features/date-heatmap/index.js';
import * as cubes from './features/cubes/index.js';
// 2026-06-07: tests 는 dev 전용 — production 번들에서 제외 (아래 conditional dynamic import).

// Platform abstractions (web/iOS/Android unified APIs)
import * as platform from './platform/platform.js';
import * as pCamera from './platform/camera.js';
import * as pHaptics from './platform/haptics.js';
import * as pNotifications from './platform/notifications.js';
import * as pLocalNotifications from './platform/local-notifications.js';

// Friends feature (phase 1: MVP) — 친구 코드 + nudge inbox.
import * as friends from './features/friends/index.js';
import * as mountain from './features/mountain/index.js';

// Retention Phase 2 infra — feature flags + metric events (SERVICE_EVALUATION §6).
import * as flags from './features/flags/index.js';
import * as metrics from './features/metrics/index.js';
import * as firstCube from './features/activation/first-cube.js';
import * as returnerGrace from './features/returner/grace.js';
import * as exempt from './features/exempt/index.js';
import * as deeplink from './features/deeplink/index.js';
import * as notifOptIn from './features/notif/opt-in-scheduler.js';
import * as volumeDelta from './features/volume-delta/index.js';
import * as targets from './features/targets/index.js';
import * as mandatoryMerge from './features/mandatory/merge.js';

// ─── Tests — dev 전용 (build-time dead-code 제거) ───────
// __DEV__ 는 esbuild define 으로 production 빌드시 false. `if (false) {...}` 안의
// import 들은 죽은 코드로 제거되어 production 번들에서 완전 제외.
// node CI 는 별도 node-runner.mjs 가 직접 import 하므로 영향 없음.
if (__DEV__) {
  import('./features/cubes/tests.js');
  import('./features/returner/tests.js');
  import('./features/exempt/tests.js');
  import('./features/targets/tests.js');
  import('./data/score-events.tests.js');
  import('./lib/cheat.tests.js');
  import('./lib/tier.tests.js');
  import('./lib/date.tests.js');
  import('./features/activation/first-cube.tests.js');
  import('./features/notif/opt-in-scheduler.tests.js');
  import('./features/volume-delta/tests.js');
  import('./features/metrics/tests.js');
  import('./features/mandatory/tests.js');
  import('./features/status-band/tests.js');
  import('./tests/run-all.js');
}
import * as cubesUiEvents from './features/cubes/ui-events.js';
import * as water from './features/water/index.js';
import * as stickyHeader from './features/sticky-header/index.js';
import * as statusBand from './features/status-band/index.js';
// status-band/tests.js 는 위 dev-only 동적 import block 으로 이동.
// Dev inspector — self-activates on ?dev=1 (production 빌드에선 early-return).
import './features/dev-inspector/index.js';

Object.assign(
  window,
  date, tier, icons, env, analytics, mealPhoto, cheat, toast,
  scoreEvents, mottos, exercises, muscle, rewardMessages, pushupCV,
  stats, onboarding, weight, rewards, dateHeatmap,
  targets, cubesUiEvents, water, stickyHeader, statusBand
);
// Status Band — DOMContentLoaded 후 quote 클릭 wiring.
// Sticky Header — IntersectionObserver 로 stuck 감지 (확장 효과).
if (typeof window !== 'undefined') {
  const _initBands = () => {
    statusBand.setupStatusBand();
    if (typeof stickyHeader.setupStickyHeader === 'function') stickyHeader.setupStickyHeader();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _initBands);
  } else {
    setTimeout(_initBands, 0);
  }
}
// Targets feature — DOMContentLoaded 후 키 바인딩
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => targets.initTargetsModule());
  } else {
    targets.initTargetsModule();
  }
}
window.PushupChallenge = pushupChallenge;
window.openPushupCounter = pushupCounter.openPushupCounter;
window.sb = sb;
// Will Cube 모듈 — 네임스페이스로 노출. 기존 전역과 이름 충돌 방지.
window.Cubes = cubes;

// Namespace platform APIs under window.sh — inline code uses e.g.
// window.sh.camera.pickImage() to reach unified web/native camera.
window.sh = window.sh || {};
window.sh.platform = platform;
window.sh.camera = pCamera;
window.sh.haptics = pHaptics;
window.sh.notifications = pNotifications;
window.sh.localNotifications = pLocalNotifications;
window.sh.friends = friends;
window.sh.mountain = mountain;
window.renderMountain = mountain.renderMountain;
window.sh.flags = flags;
window.sh.metrics = metrics;
window.sh.firstCube = firstCube;
window.sh.returnerGrace = returnerGrace;
window.sh.exempt = exempt;
window.sh.deeplink = deeplink;
window.sh.notifOptIn = notifOptIn;
window.sh.volumeDelta = volumeDelta;
window.sh.mandatory = mandatoryMerge;
// Shortcut globals for inline use
window.FF = flags;
window.logEvent = metrics.logEvent;
window.EVT = metrics.EVT;

// Start unread-badge poller once DOM is ready. Polls every 60s; live-replaced
// by realtime subscription in Phase 2.
if (typeof window !== 'undefined') {
  const startPoll = () => {
    const badgeEl = document.getElementById('fr-unread-badge');
    if (badgeEl && typeof friends.startUnreadBadgePoll === 'function') {
      friends.startUnreadBadgePoll(badgeEl, 60000);
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startPoll);
  } else {
    setTimeout(startPoll, 0);
  }
}

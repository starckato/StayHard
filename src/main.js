// Stay Hard · modular bundle entry point
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

import * as stats from './features/stats/index.js';
import * as onboarding from './features/onboarding/index.js';
import * as weight from './features/weight/index.js';
import * as rewards from './features/rewards/index.js';
import * as dateHeatmap from './features/date-heatmap/index.js';

// Platform abstractions (web/iOS/Android unified APIs)
import * as platform from './platform/platform.js';
import * as pCamera from './platform/camera.js';
import * as pHaptics from './platform/haptics.js';
import * as pNotifications from './platform/notifications.js';

Object.assign(
  window,
  date, tier, icons, env, analytics, mealPhoto, cheat, toast,
  scoreEvents, mottos, exercises, muscle, rewardMessages, pushupCV,
  stats, onboarding, weight, rewards, dateHeatmap
);
window.sb = sb;

// Namespace platform APIs under window.sh — inline code uses e.g.
// window.sh.camera.pickImage() to reach unified web/native camera.
window.sh = window.sh || {};
window.sh.platform = platform;
window.sh.camera = pCamera;
window.sh.haptics = pHaptics;
window.sh.notifications = pNotifications;

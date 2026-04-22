// Stay Hard · modular bundle entry point
// Migration phase: 3

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
import * as weeklyView from './features/weekly-view/index.js';

Object.assign(
  window,
  date, tier, icons, env, analytics, mealPhoto, cheat, toast,
  scoreEvents, mottos, exercises, muscle, rewardMessages, pushupCV,
  stats, onboarding, weight, rewards, weeklyView
);
window.sb = sb;

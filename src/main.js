// Stay Hard · modular bundle entry point
//
// Migration phase: 3 (feature modules — stats, onboarding)
// See: document-private/MIGRATION_PLAN.md

// Lib (pure utilities + infrastructure)
import * as date from './lib/date.js';
import * as tier from './lib/tier.js';
import * as icons from './lib/icons.js';
import * as env from './lib/env.js';
import { sb } from './lib/supabase.js';
import * as analytics from './lib/analytics.js';

// UI (shared dumb components)
import * as toast from './ui/toast.js';

// Data (static tables)
import * as scoreEvents from './data/score-events.js';
import * as mottos from './data/mottos.js';
import * as exercises from './data/exercises.js';

// Features
import * as stats from './features/stats/index.js';
import * as onboarding from './features/onboarding/index.js';

// Window adapter — exposes module exports as globals for inline-handler compat.
Object.assign(
  window,
  date, tier, icons, env, analytics, toast,
  scoreEvents, mottos, exercises,
  stats, onboarding
);
window.sb = sb;

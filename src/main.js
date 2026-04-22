// Stay Hard · modular bundle entry point
//
// Migration phase: 3 (feature modules starting — stats extracted)
// See: document-private/MIGRATION_PLAN.md
//
// During Phase 1~3, modules extracted from index.html are re-exposed on `window`
// so inline `onclick="stSetPeriod(7,this)"` etc. keep working. After Phase 4+,
// inline handlers are gradually replaced by event delegation.

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

// Window adapter — exposes module exports as globals for inline-handler compat.
// Each Object.assign mirrors a duplicate that has been DELETED from index.html.
// Safe to combine because module exports have disjoint keys (verified).
Object.assign(window, date, tier, icons, env, analytics, toast, scoreEvents, mottos, exercises, stats);
window.sb = sb;

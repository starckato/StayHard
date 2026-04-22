// Stay Hard · modular bundle entry point
//
// Migration phase: 1 (extracting pure utilities; window adapter for inline-onclick compatibility)
// See: document-private/MIGRATION_PLAN.md
//
// During Phase 1~3, modules extracted from index.html are re-exposed on `window`
// so inline `onclick="dkey(...)"` etc. keep working. After Phase 4+, inline
// handlers are gradually replaced by event delegation and this adapter shrinks.

import * as date from './lib/date.js';
import * as tier from './lib/tier.js';
import * as icons from './lib/icons.js';

// Window adapter — exposes module exports as globals for inline-handler compat.
// Each Object.assign here mirrors a duplicate definition that has been DELETED
// from index.html. Order matters only if modules have cross-references (they
// don't here — each module is self-contained and uses ESM imports internally).
Object.assign(window, date, tier, icons);

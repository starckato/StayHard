// Stay Hard · modular bundle entry point
//
// Migration phase: 0 (setup only — no behavior change)
// See: document-private/MIGRATION_PLAN.md
//
// This file is the ONLY ESM entry point. esbuild bundles this + its imports
// into dist/app.js, which index.html loads via <script type="module">.
//
// During migration (Phase 1~3), modules are extracted from index.html into
// src/ and re-exposed on `window` here for inline-onclick compatibility.
// After migration completes (Phase 4+), inline handlers are gradually replaced
// by event delegation and the window adapter shrinks toward zero.

console.log('[stayhard] modular bundle loaded · phase 0');

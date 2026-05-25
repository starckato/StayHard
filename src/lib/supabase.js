// QROK · Supabase client
//
// 2026-05-25 perf: UMD CDN sync script → npm ESM 로 전환.
// 이제 esbuild 가 supabase-js 를 dist/app.js 번들에 포함 (tree-shaken).
// 효과: HTTP 요청 1개 절감 + 외부 CDN 의존성 제거.

import { createClient } from '@supabase/supabase-js';
import { SB_URL, SB_KEY } from './env.js';

/** Shared Supabase client (auth + postgrest + storage). */
export const sb = createClient(SB_URL, SB_KEY);

// Legacy compat: 일부 inline 코드가 `window.supabase.createClient(...)` 를 직접 호출할 수 있어
// 글로벌도 노출. 점진적으로 제거.
if (typeof window !== 'undefined' && !window.supabase) {
  window.supabase = { createClient };
}

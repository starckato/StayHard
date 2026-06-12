// 큐록 · feature flags (FF)
//
// profiles.feature_flags JSONB 로드 후 런타임 평가. 모든 Phase 1-3 신규 기능은
// 이 flag 뒤에서 점진 롤아웃. 로드 실패 / 네트워크 오류 시 defaultValue 로 폴백.
//
// Usage (inline):
//   if (window.FF.get('first_cube_card', false)) { ... }
//   await window.FF.set('first_cube_card', true);

import { sb } from '../../lib/supabase.js';

let _flags = {};
let _loaded = false;

/** Load current user's feature_flags from profiles. Called at app bootstrap. */
export async function loadFlags() {
  try {
    const CU = typeof window !== 'undefined' ? window.CU : null;
    if (!CU || !CU.id) { _loaded = true; return {}; }
    const { data, error } = await sb
      .from('profiles')
      .select('feature_flags')
      .eq('id', CU.id)
      .single();
    if (error) {
      console.warn('[FF] load failed', error);
      _loaded = true;
      return {};
    }
    _flags = data?.feature_flags || {};
    _loaded = true;
    // Cache to localStorage for offline / next-session instant read.
    try { localStorage.setItem(`qrok_ff_${CU.id}`, JSON.stringify(_flags)); } catch {}
    return _flags;
  } catch (e) {
    console.warn('[FF] loadFlags threw', e);
    _loaded = true;
    return {};
  }
}

/** Synchronous read. Falls back to defaultValue if flag not set. */
export function get(key, defaultValue = false) {
  if (!_loaded) {
    // Try localStorage cache for synchronous boot-time reads.
    try {
      const CU = typeof window !== 'undefined' ? window.CU : null;
      if (CU && CU.id) {
        const cached = localStorage.getItem(`qrok_ff_${CU.id}`);
        if (cached) _flags = JSON.parse(cached) || {};
      }
    } catch {}
  }
  return key in _flags ? _flags[key] : defaultValue;
}

/** Set a flag and persist. Returns { ok, error? }. */
export async function set(key, value) {
  try {
    const CU = typeof window !== 'undefined' ? window.CU : null;
    if (!CU || !CU.id) return { ok: false, error: 'not_authenticated' };
    const next = { ..._flags, [key]: value };
    const { error } = await sb
      .from('profiles')
      .update({ feature_flags: next })
      .eq('id', CU.id);
    if (error) return { ok: false, error: error.message };
    _flags = next;
    try { localStorage.setItem(`qrok_ff_${CU.id}`, JSON.stringify(next)); } catch {}
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/** Return a snapshot of all flags (for debug). */
export function snapshot() {
  return { ..._flags };
}

// Default flag values — Phase 1/2/3 기능 기본 off.
// 내 계정에서 true 로 켜서 테스트 후 전원 롤아웃.
export const DEFAULT_FLAGS = {
  // 2026-06-13: 사용자 결정으로 안정성 우선 — 미점검·반복 에러 발생 기능 일괄 OFF.
  // 향후 v1 boundary 확정 후 개별 검증하며 재오픈.
  first_cube_card:  false,  // OFF — 첫 큐브 추천 카드 (반복 에러)
  returner_grace:   false,  // OFF — 복귀자 보호 (반복 에러)
  exempt_tap:       true,   // KEEP — 면제 1-tap (안정, 사용자 요구 기능)
  layout_v2:        false,  // Phase 2B (Status Band 축소) — index.html .sb 인라인 룰로 대체됨
  deeplink:         false,  // Phase 2C
  opt_in_d3:        false,  // OFF — D3 알림 opt-in 프롬프트 전체 비활성
  volume_delta_card: false, // Phase 3A
  accent_picker:    false,  // Phase 3B
};

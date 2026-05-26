// 큐록 · src/features/mandatory/tests.js
// mergeMandatoryAdditive — 5/9 starckato 데이터 손실 사태 재발 방지 로직 테스트.

import { mergeMandatoryAdditive } from './merge.js';

const _cases = [];
function t(name, fn) { _cases.push({ name, fn }); }

// ───── 기본 동작 ─────────────────────────────────────
t('merge · null/undefined 입력 → 빈 배열',
  () => mergeMandatoryAdditive(null, null).length === 0);
t('merge · 빈 입력 → 빈 결과',
  () => mergeMandatoryAdditive([], []).length === 0);
t('merge · 빈 existing + 신규 def → def 만',
  () => {
    const r = mergeMandatoryAdditive([], [{ type: 'custom', name: 'A' }]);
    return r.length === 1 && r[0].name === 'A' && r[0].done === false;
  });

// ───── 5/9 사태 시나리오 (핵심) ──────────────────────
t('merge · 5/9 시나리오 · DB 14개 customs vs 메모리 1개 → 14개 전부 보존',
  () => {
    const dbExisting = Array.from({ length: 14 }, (_, i) => ({
      type: 'custom',
      name: 'routine_' + i,
      done: false,
      fail: false,
      days: [0, 1, 2, 3, 4, 5, 6],
    }));
    const memoryDef = [{ type: 'custom', name: '고양이 화장실' }];
    const r = mergeMandatoryAdditive(dbExisting, memoryDef);
    // 14 existing + 1 new = 15 total
    return r.length === 15
      && r.some(m => m.name === '고양이 화장실')
      && r.filter(m => m.name.startsWith('routine_')).length === 14;
  });

t('merge · 같은 이름 def → state preserve + 신규 days 사용',
  () => {
    const existing = [{ type: 'custom', name: 'A', done: true, fail: false, days: [0, 1] }];
    const def = [{ type: 'custom', name: 'A', days: [3, 4, 5] }];
    const r = mergeMandatoryAdditive(existing, def);
    return r.length === 1 && r[0].done === true && JSON.stringify(r[0].days) === '[3,4,5]';
  });

// ───── derived (diet/workout) 보존 ───────────────────
t('merge · derived type 보존 (diet/workout)',
  () => {
    const existing = [
      { type: 'diet', name: '식단', done: true },
      { type: 'workout', name: '운동' },
      { type: 'custom', name: 'A' },
    ];
    const def = [{ type: 'custom', name: 'B' }];
    const r = mergeMandatoryAdditive(existing, def);
    return r.length === 4 // derived 2 + custom A 보존 + custom B 신규
      && r.some(m => m.type === 'diet')
      && r.some(m => m.type === 'workout')
      && r.some(m => m.name === 'A')
      && r.some(m => m.name === 'B');
  });

t('merge · derived 가 항상 mergedCustoms 보다 앞 (출력 순서)',
  () => {
    const existing = [{ type: 'custom', name: 'A' }];
    const def = [{ type: 'workout', name: 'derived' }, { type: 'custom', name: 'B' }];
    const r = mergeMandatoryAdditive(existing, def);
    // derived 는 existing 에서만 옴 (newDefs 에서는 무시)
    // 이 케이스 → A 보존, derived 없음, B 추가
    return r.length === 2 && r.every(m => m.type === 'custom');
  });

// ───── 이름 정규화 / 데이터 형식 ──────────────────────
t('merge · custom 이지만 name 없음 → 무시',
  () => {
    const existing = [];
    const def = [{ type: 'custom' }];
    const r = mergeMandatoryAdditive(existing, def);
    return r.length === 0;
  });

t('merge · existing 에 type 없는 entry → 무시',
  () => {
    const existing = [{ name: 'noType' }, { type: 'custom', name: 'A' }];
    const def = [];
    const r = mergeMandatoryAdditive(existing, def);
    // noType 은 derived 도 아니고 custom 도 아니라 누락
    return r.length === 1 && r[0].name === 'A';
  });

t('merge · days 미지정 → 매일 (default)',
  () => {
    const r = mergeMandatoryAdditive([], [{ type: 'custom', name: 'A' }]);
    return JSON.stringify(r[0].days) === '[0,1,2,3,4,5,6]';
  });

t('merge · _scoreType / end_date 전달',
  () => {
    const r = mergeMandatoryAdditive([], [{
      type: 'custom', name: 'A',
      _scoreType: 'routine_done', end_date: '2026-12-31'
    }]);
    return r[0]._scoreType === 'routine_done' && r[0].end_date === '2026-12-31';
  });

// ───── 멱등성 / mutation 방어 ────────────────────────
t('merge · 같은 입력 두 번 실행 = 같은 결과',
  () => {
    const ex = [{ type: 'custom', name: 'A', done: false, fail: false, days: [0,1,2,3,4,5,6] }];
    const df = [{ type: 'custom', name: 'B' }];
    const r1 = mergeMandatoryAdditive(ex, df);
    const r2 = mergeMandatoryAdditive(ex, df);
    return JSON.stringify(r1) === JSON.stringify(r2);
  });

t('merge · existing 원본 mutate 안 함',
  () => {
    const ex = [{ type: 'custom', name: 'A', done: true }];
    mergeMandatoryAdditive(ex, [{ type: 'custom', name: 'A' }]);
    return ex.length === 1 && ex[0].done === true;
  });

t('merge · newDefs 원본 mutate 안 함',
  () => {
    const df = [{ type: 'custom', name: 'A', days: [3] }];
    mergeMandatoryAdditive([], df);
    return df.length === 1 && JSON.stringify(df[0].days) === '[3]';
  });

// ───── 대규모 일관성 ─────────────────────────────────
t('merge · 50 existing + 30 new (10 겹침) → 50 + 20 = 70',
  () => {
    const existing = Array.from({ length: 50 }, (_, i) => ({
      type: 'custom', name: 'old_' + i, done: false, fail: false, days: [0,1,2,3,4,5,6]
    }));
    const newDefs = [
      ...Array.from({ length: 10 }, (_, i) => ({ type: 'custom', name: 'old_' + i })),
      ...Array.from({ length: 20 }, (_, i) => ({ type: 'custom', name: 'new_' + i })),
    ];
    const r = mergeMandatoryAdditive(existing, newDefs);
    return r.length === 70;
  });

// ───── Runner ────────────────────────────────────────
export function runMandatoryTests() {
  let pass = 0, fail = 0;
  const fails = [];
  for (const c of _cases) {
    try {
      const ok = c.fn();
      if (ok) pass++;
      else { fail++; fails.push(c.name); }
    } catch (e) {
      fail++;
      fails.push(c.name + ' [THROW: ' + (e && e.message) + ']');
    }
  }
  console.log('[mandatory-tests] pass=%d fail=%d total=%d', pass, fail, _cases.length);
  if (fails.length) console.warn('FAILS:\n  ' + fails.join('\n  '));
  return { pass, fail, total: _cases.length, fails };
}

if (typeof window !== 'undefined') {
  window.runMandatoryTests = runMandatoryTests;
}

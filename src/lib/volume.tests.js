// 큐록 · src/lib/volume.tests.js
// 볼륨 단일 정의 테스트 — Σ(done 세트 kg×reps), 세션 status 무시 (DASHBOARD_SPEC_v1).
// 2026-10-30 F2 결정: 하다 만 트레이너 숙제의 체크한 세트도 볼륨이다.

import { sessionVolume, dayVolume } from './volume.js';

const _cases = [];
function t(name, fn) { _cases.push({ name, fn }); }

const set = (kg, reps, done = true) => ({ kg, reps, done });

// ───── sessionVolume ─────────────────────────────────
t('sessionVolume · null/비객체 → 0',
  () => sessionVolume(null) === 0 && sessionVolume(undefined) === 0 && sessionVolume('x') === 0);

t('sessionVolume · exercises 배열 아님 → 0',
  () => sessionVolume({ type: 'gym', status: 'done' }) === 0
     && sessionVolume({ type: 'gym', status: 'done', exercises: 'oops' }) === 0);

t('sessionVolume · gym 아닌 타입(activity) → 0',
  () => sessionVolume({ type: 'activity', status: 'done',
    exercises: [{ name: '러닝', sets: [set(60, 10)] }] }) === 0);

t('sessionVolume · done 세션 · 60×10 + 80×5 = 1000',
  () => sessionVolume({ type: 'gym', status: 'done',
    exercises: [{ name: '벤치', sets: [set(60, 10), set(80, 5)] }] }) === 1000);

t('sessionVolume · 문자열 kg/reps 파싱 ("60","10")',
  () => sessionVolume({ type: 'gym', status: 'done',
    exercises: [{ name: '벤치', sets: [set('60', '10')] }] }) === 600);

t('sessionVolume · set.done=false 는 제외',
  () => sessionVolume({ type: 'gym', status: 'done',
    exercises: [{ name: '벤치', sets: [set(60, 10, true), set(100, 10, false)] }] }) === 600);

t('sessionVolume · F2 핵심 — in_progress 숙제, 4세트 중 2세트 체크 → 체크한 만큼 포함',
  () => sessionVolume({ type: 'gym', status: 'in_progress', _trainerAssignmentId: 'a1',
    exercises: [{ name: '스쿼트', sets: [set(100, 5), set(100, 5), set(100, 5, false), set(100, 5, false)] }] }) === 1000);

t('sessionVolume · planned 세션(체크 0) → 0',
  () => sessionVolume({ type: 'gym', status: 'planned',
    exercises: [{ name: '스쿼트', sets: [set(100, 5, false)] }] }) === 0);

t('sessionVolume · 비근력 세트(kg/reps 빈 문자열, dist/time) → 0',
  () => sessionVolume({ type: 'gym', status: 'done',
    exercises: [{ name: '로잉머신', isStrength: false, sets: [{ kg: '', reps: '', dist: 2000, time: 600, done: true }] }] }) === 0);

t('sessionVolume · 저장된 totalVolume 은 무시하고 세트에서 live 계산',
  () => sessionVolume({ type: 'gym', status: 'done', totalVolume: 99999,
    exercises: [{ name: '벤치', sets: [set(60, 10)] }] }) === 600);

t('sessionVolume · sets 누락 운동은 건너뜀',
  () => sessionVolume({ type: 'gym', status: 'done',
    exercises: [{ name: '벤치' }, { name: '데드', sets: [set(120, 3)] }] }) === 360);

// ───── dayVolume ─────────────────────────────────────
t('dayVolume · null/빈 log → 0',
  () => dayVolume(null) === 0 && dayVolume({}) === 0 && dayVolume({ workouts: [] }) === 0);

t('dayVolume · workouts 배열 아님 → 0',
  () => dayVolume({ workouts: 'nope' }) === 0);

t('dayVolume · 여러 세션 합산 (done 1000 + in_progress 숙제 500 + activity 무시) = 1500',
  () => dayVolume({ workouts: [
    { type: 'gym', status: 'done', exercises: [{ name: '벤치', sets: [set(100, 10)] }] },
    { type: 'gym', status: 'in_progress', exercises: [{ name: '스쿼트', sets: [set(100, 5), set(100, 5, false)] }] },
    { type: 'activity', status: 'done', cat: 'running', km: 5 },
    null,
  ] }) === 1500);

// ───── Runner ────────────────────────────────────────
export function runVolumeTests() {
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
  console.log('[volume-tests] pass=%d fail=%d total=%d', pass, fail, _cases.length);
  if (fails.length) console.warn('FAILS:\n  ' + fails.join('\n  '));
  return { pass, fail, total: _cases.length, fails };
}

if (typeof window !== 'undefined') {
  window.runVolumeTests = runVolumeTests;
}

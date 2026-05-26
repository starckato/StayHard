// 큐록 · src/data/score-events.tests.js
// SCORE_EVENTS 데이터 정합성 + _pushupPtsFor 곡선 검증.
// 브라우저 콘솔: window.runScoreEventsTests()

import { SCORE_EVENTS, _pushupPtsFor } from './score-events.js';

const _cases = [];
function t(name, fn) { _cases.push({ name, fn }); }

// ───── _pushupPtsFor 곡선 ─────────────────────────────
// 1~30개: 1pt/개, 그 이후: 5개당 1pt
t('pushup · 0개 → 0점',
  () => _pushupPtsFor(0) === 0);
t('pushup · 1개 → 1점',
  () => _pushupPtsFor(1) === 1);
t('pushup · 15개 → 15점',
  () => _pushupPtsFor(15) === 15);
t('pushup · 30개 → 30점 (구간 경계)',
  () => _pushupPtsFor(30) === 30);
t('pushup · 31개 → 30점 (구간 진입 직후, 5개 미만 보너스 X)',
  () => _pushupPtsFor(31) === 30);
t('pushup · 34개 → 30점 (아직 +1 안 됨)',
  () => _pushupPtsFor(34) === 30);
t('pushup · 35개 → 31점 (첫 +5)',
  () => _pushupPtsFor(35) === 31);
t('pushup · 40개 → 32점',
  () => _pushupPtsFor(40) === 32);
t('pushup · 55개 → 35점 (30 + (55-30)/5 = 35)',
  () => _pushupPtsFor(55) === 35);
t('pushup · 100개 → 44점 (30 + 14)',
  () => _pushupPtsFor(100) === 44);

// 방어 코드
t('pushup · 음수 → 0',
  () => _pushupPtsFor(-5) === 0);
t('pushup · NaN → 0',
  () => _pushupPtsFor(NaN) === 0);
t('pushup · 문자열 숫자 → coerce',
  () => _pushupPtsFor('20') === 20);
t('pushup · 문자열 (숫자 아님) → 0',
  () => _pushupPtsFor('abc') === 0);
t('pushup · null → 0',
  () => _pushupPtsFor(null) === 0);
t('pushup · undefined → 0',
  () => _pushupPtsFor(undefined) === 0);

// ───── SCORE_EVENTS 데이터 정합성 ────────────────────
t('SCORE_EVENTS · 모든 entry 에 pts (number) + label (string)',
  () => Object.entries(SCORE_EVENTS).every(([k, v]) =>
    typeof v.pts === 'number' && typeof v.label === 'string' && v.label.length > 0));

t('SCORE_EVENTS · pts 정수만 (소수점 없음)',
  () => Object.values(SCORE_EVENTS).every(v => Number.isInteger(v.pts)));

t('SCORE_EVENTS · icon 필드 전부 빈 문자열 (2026-05-26 이모지 제거)',
  () => Object.values(SCORE_EVENTS).every(v => v.icon === ''));

t('SCORE_EVENTS · workout_done = +30',
  () => SCORE_EVENTS.workout_done.pts === 30);
t('SCORE_EVENTS · workout_cardio_done = +30',
  () => SCORE_EVENTS.workout_cardio_done.pts === 30);
t('SCORE_EVENTS · diet_junk = -30',
  () => SCORE_EVENTS.diet_junk.pts === -30);
t('SCORE_EVENTS · diet_clean = +10',
  () => SCORE_EVENTS.diet_clean.pts === 10);
t('SCORE_EVENTS · goggins_4x4x48 = +100',
  () => SCORE_EVENTS.goggins_4x4x48.pts === 100);
t('SCORE_EVENTS · routine_done = +1',
  () => SCORE_EVENTS.routine_done.pts === 1);
t('SCORE_EVENTS · target_done = +2',
  () => SCORE_EVENTS.target_done.pts === 2);

// 취소 액션 = 원래 점수의 negate
t('cancel pair · workout_done +30 ↔ workout_done_cancel -30',
  () => SCORE_EVENTS.workout_done.pts === -SCORE_EVENTS.workout_done_cancel.pts);
t('cancel pair · workout_cardio_done +30 ↔ workout_cardio_done_cancel -30',
  () => SCORE_EVENTS.workout_cardio_done.pts === -SCORE_EVENTS.workout_cardio_done_cancel.pts);
t('cancel pair · routine_done +1 ↔ routine_done_cancel -1',
  () => SCORE_EVENTS.routine_done.pts === -SCORE_EVENTS.routine_done_cancel.pts);
t('cancel pair · target_done +2 ↔ target_done_cancel -2',
  () => SCORE_EVENTS.target_done.pts === -SCORE_EVENTS.target_done_cancel.pts);
t('cancel pair · diet_clean +10 ↔ diet_clean_cancel -10',
  () => SCORE_EVENTS.diet_clean.pts === -SCORE_EVENTS.diet_clean_cancel.pts);
t('cancel pair · diet_clean_delete -10 (삭제 = 취소와 동일)',
  () => SCORE_EVENTS.diet_clean_delete.pts === -10);

// 패널티 취소 (만회)
t('penalty cancel · diet_junk -30 ↔ diet_junk_cancel +30 (완전 회복)',
  () => SCORE_EVENTS.diet_junk.pts + SCORE_EVENTS.diet_junk_cancel.pts === 0);
t('penalty cancel · routine_fail -1 ↔ routine_fail_cancel +1',
  () => SCORE_EVENTS.routine_fail.pts + SCORE_EVENTS.routine_fail_cancel.pts === 0);
t('penalty cancel · routine_skip -1 ↔ routine_skip_cancel +1',
  () => SCORE_EVENTS.routine_skip.pts + SCORE_EVENTS.routine_skip_cancel.pts === 0);
t('penalty cancel · target_fail -2 ↔ target_fail_cancel +2',
  () => SCORE_EVENTS.target_fail.pts + SCORE_EVENTS.target_fail_cancel.pts === 0);

// alcohol — 점수 0 (장부만 기록)
t('alcohol · register pts 0',
  () => SCORE_EVENTS.diet_alcohol_register.pts === 0);
t('alcohol · cancel pts 0',
  () => SCORE_EVENTS.diet_alcohol_cancel.pts === 0);

// workout_delete / workout_deleted — pts 0 (장부만)
t('workout 삭제 류 · pts 0',
  () => SCORE_EVENTS.workout_delete.pts === 0 && SCORE_EVENTS.workout_deleted.pts === 0);

// ───── label 정합성 (이모지 없음) ────────────────────
t('SCORE_EVENTS · label 에 이모지 없음 (2026-05-26 cleanup)',
  () => {
    const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{FE0F}]/u;
    return Object.values(SCORE_EVENTS).every(v => !emojiRe.test(v.label));
  });

// ───── Runner ────────────────────────────────────────
export function runScoreEventsTests() {
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
  console.log('[score-events-tests] pass=%d fail=%d total=%d', pass, fail, _cases.length);
  if (fails.length) console.warn('FAILS:\n  ' + fails.join('\n  '));
  return { pass, fail, total: _cases.length, fails };
}

if (typeof window !== 'undefined') {
  window.runScoreEventsTests = runScoreEventsTests;
}

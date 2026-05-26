// 큐록 · src/features/volume-delta/tests.js
// 부위별 볼륨 계산 + 주간 delta 테스트.

import {
  computeDayVolume,
  computeWeekVolume,
  computeDelta,
  BUCKET_LABELS,
} from './index.js';

const _cases = [];
function t(name, fn) { _cases.push({ name, fn }); }

// ───── computeDayVolume ──────────────────────────────
t('computeDayVolume · null log → all zeros',
  () => {
    const v = computeDayVolume(null);
    return v.chest === 0 && v.back === 0 && v.total === 0;
  });
t('computeDayVolume · 빈 log → all zeros',
  () => computeDayVolume({}).total === 0);

t('computeDayVolume · workout 1개 · 벤치 · 1 set → chest 60*10=600',
  () => {
    const v = computeDayVolume({
      workouts: [{
        status: 'done',
        exercises: [{ name: '벤치프레스', sets: [{ kg: 60, reps: 10, done: true }] }],
      }]
    });
    return v.chest === 600 && v.total === 600 && v.back === 0;
  });

t('computeDayVolume · 미완료 (status !== done) → 0',
  () => {
    const v = computeDayVolume({
      workouts: [{
        status: 'planned',
        exercises: [{ name: '벤치', sets: [{ kg: 60, reps: 10, done: true }] }],
      }]
    });
    return v.total === 0;
  });

t('computeDayVolume · set.done=false → 제외',
  () => {
    const v = computeDayVolume({
      workouts: [{
        status: 'done',
        exercises: [{ name: '벤치', sets: [{ kg: 60, reps: 10, done: false }] }],
      }]
    });
    return v.total === 0;
  });

t('computeDayVolume · 여러 set 합산',
  () => {
    const v = computeDayVolume({
      workouts: [{
        status: 'done',
        exercises: [{
          name: '데드리프트',
          sets: [
            { kg: 100, reps: 5, done: true },
            { kg: 110, reps: 3, done: true },
          ]
        }],
      }]
    });
    return v.back === 500 + 330 && v.total === 830;
  });

t('computeDayVolume · 가슴+등 분리',
  () => {
    const v = computeDayVolume({
      workouts: [{
        status: 'done',
        exercises: [
          { name: '벤치프레스', sets: [{ kg: 60, reps: 10, done: true }] },  // chest 600
          { name: '풀업',     sets: [{ kg: 0, reps: 8, done: true }] },      // back 0
          { name: '바벨 로우', sets: [{ kg: 50, reps: 8, done: true }] },     // back 400
        ],
      }]
    });
    return v.chest === 600 && v.back === 400 && v.total === 1000;
  });

t('computeDayVolume · 어깨 식별 (overhead press)',
  () => {
    const v = computeDayVolume({
      workouts: [{
        status: 'done',
        exercises: [{ name: '오버헤드 프레스', sets: [{ kg: 40, reps: 8, done: true }] }],
      }]
    });
    return v.shoulder === 320;
  });

t('computeDayVolume · 하체 식별 (squat)',
  () => {
    const v = computeDayVolume({
      workouts: [{
        status: 'done',
        exercises: [{ name: '스쿼트', sets: [{ kg: 100, reps: 5, done: true }] }],
      }]
    });
    return v.leg === 500;
  });

t('computeDayVolume · 팔 식별 (바벨 컬)',
  () => {
    const v = computeDayVolume({
      workouts: [{
        status: 'done',
        exercises: [{ name: '바벨 컬', sets: [{ kg: 20, reps: 10, done: true }] }],
      }]
    });
    return v.arm === 200;
  });

t('computeDayVolume · 알 수 없는 운동 → other',
  () => {
    const v = computeDayVolume({
      workouts: [{
        status: 'done',
        exercises: [{ name: '명상', sets: [{ kg: 0, reps: 1, done: true }] }],
      }]
    });
    return v.other === 0 && v.total === 0; // 0kg * 1 = 0
  });

t('computeDayVolume · kg/reps 문자열 → coerce',
  () => {
    const v = computeDayVolume({
      workouts: [{
        status: 'done',
        exercises: [{ name: '벤치', sets: [{ kg: '60', reps: '10', done: true }] }],
      }]
    });
    return v.chest === 600;
  });

// ───── computeDelta ──────────────────────────────────
t('computeDelta · 빈 cache → 모든 bucket 0',
  () => {
    const d = computeDelta({});
    return d.chest.curr === 0 && d.chest.prev === 0 && d.chest.dir === 'flat';
  });

t('computeDelta · 이번주만 데이터 → up + 100% (prev 0)',
  () => {
    const today = new Date();
    const key = today.toISOString().slice(0, 10);
    const cache = {
      [key]: {
        workouts: [{
          status: 'done',
          exercises: [{ name: '벤치', sets: [{ kg: 60, reps: 10, done: true }] }],
        }]
      }
    };
    const d = computeDelta(cache, today);
    return d.chest.curr === 600 && d.chest.prev === 0 && d.chest.dir === 'up';
  });

t('computeDelta · 결과에 chest/back/shoulder/leg/arm/total 포함',
  () => {
    const d = computeDelta({});
    return d.chest && d.back && d.shoulder && d.leg && d.arm && d.total;
  });

t('computeDelta · dir 값 ∈ {up,down,flat}',
  () => {
    const d = computeDelta({});
    return ['up', 'down', 'flat'].includes(d.chest.dir);
  });

// ───── BUCKET_LABELS ─────────────────────────────────
t('BUCKET_LABELS · 5종 (chest/back/shoulder/leg/arm)',
  () => Object.keys(BUCKET_LABELS).length === 5);
t('BUCKET_LABELS · 한국어 매핑',
  () => BUCKET_LABELS.chest === '가슴' && BUCKET_LABELS.leg === '하체');

// ───── Runner ────────────────────────────────────────
export function runVolumeDeltaTests() {
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
  console.log('[volume-delta-tests] pass=%d fail=%d total=%d', pass, fail, _cases.length);
  if (fails.length) console.warn('FAILS:\n  ' + fails.join('\n  '));
  return { pass, fail, total: _cases.length, fails };
}

if (typeof window !== 'undefined') {
  window.runVolumeDeltaTests = runVolumeDeltaTests;
}

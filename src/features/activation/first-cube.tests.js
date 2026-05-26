// 큐록 · src/features/activation/first-cube.tests.js
// 첫 큐브 체험 카드 (활성화 funnel) — pure helpers 테스트.

import {
  FIRST_CUBE_TASKS,
  pickTask,
  checkCompletion,
  hasEarned,
  shouldShow,
  checkAnyCompletion,
} from './first-cube.js';

const _cases = [];
function t(name, fn) { _cases.push({ name, fn }); }

// ───── FIRST_CUBE_TASKS 데이터 ───────────────────────
t('FIRST_CUBE_TASKS · 4개',
  () => FIRST_CUBE_TASKS.length === 4);
t('FIRST_CUBE_TASKS · 모든 항목 id+title+hint+category',
  () => FIRST_CUBE_TASKS.every(t => t.id && t.title && t.hint && t.category));
t('FIRST_CUBE_TASKS · id 모두 unique',
  () => new Set(FIRST_CUBE_TASKS.map(t => t.id)).size === FIRST_CUBE_TASKS.length);
t('FIRST_CUBE_TASKS · category enum 일치',
  () => FIRST_CUBE_TASKS.every(t => ['routine', 'task', 'water', 'exercise'].includes(t.category)));

// ───── pickTask ──────────────────────────────────────
t('pickTask · null/undefined userId → 첫 task',
  () => pickTask(null).id === FIRST_CUBE_TASKS[0].id);
t('pickTask · 빈 문자열 → 첫 task',
  () => pickTask('').id === FIRST_CUBE_TASKS[0].id);
t('pickTask · 같은 userId = 같은 task (deterministic)',
  () => pickTask('user-abc-123').id === pickTask('user-abc-123').id);
t('pickTask · 다른 userId → 분산 (4 개 task 모두 hit 되어야)',
  () => {
    const counts = { water_2: 0, walk_5: 0, task_1: 0, routine_1: 0 };
    for (let i = 0; i < 200; i++) {
      const id = pickTask('user_' + i).id;
      counts[id] = (counts[id] || 0) + 1;
    }
    return Object.values(counts).every(c => c > 0);
  });

// ───── checkCompletion ───────────────────────────────
t('checkCompletion · log null → false',
  () => checkCompletion(null, 'water_2').done === false);

// water_2
t('checkCompletion · water_2 · 1 잔 → false',
  () => checkCompletion({ water_cups: 1 }, 'water_2').done === false);
t('checkCompletion · water_2 · 2 잔 → true',
  () => checkCompletion({ water_cups: 2 }, 'water_2').done === true);
t('checkCompletion · water_2 · 5 잔 → true (이상)',
  () => checkCompletion({ water_cups: 5 }, 'water_2').done === true);
t('checkCompletion · water_2 · evidence 텍스트',
  () => checkCompletion({ water_cups: 2 }, 'water_2').evidence.includes('2잔'));

// walk_5
t('checkCompletion · walk_5 · cardio done → true',
  () => checkCompletion({ workouts: [{ type: 'cardio', status: 'done' }] }, 'walk_5').done === true);
t('checkCompletion · walk_5 · activity planned → true',
  () => checkCompletion({ workouts: [{ type: 'activity', status: 'planned' }] }, 'walk_5').done === true);
t('checkCompletion · walk_5 · 걷기 meta → true',
  () => checkCompletion({ workouts: [{ type: 'gym', status: 'done', meta: '걷기 30분' }] }, 'walk_5').done === true);
t('checkCompletion · walk_5 · gym only → false',
  () => checkCompletion({ workouts: [{ type: 'gym', status: 'done' }] }, 'walk_5').done === false);
t('checkCompletion · walk_5 · 빈 workouts → false',
  () => checkCompletion({ workouts: [] }, 'walk_5').done === false);

// task_1
t('checkCompletion · task_1 · 1 done → true',
  () => checkCompletion({ targets: [{ st: 'done' }] }, 'task_1').done === true);
t('checkCompletion · task_1 · 0 done → false',
  () => checkCompletion({ targets: [{ st: 'fail' }] }, 'task_1').done === false);
t('checkCompletion · task_1 · 빈 targets → false',
  () => checkCompletion({ targets: [] }, 'task_1').done === false);

// routine_1
t('checkCompletion · routine_1 · 1 done → true',
  () => checkCompletion({ mandatory: [{ done: true }] }, 'routine_1').done === true);
t('checkCompletion · routine_1 · 0 done → false',
  () => checkCompletion({ mandatory: [{ done: false }] }, 'routine_1').done === false);
t('checkCompletion · routine_1 · 빈 mandatory → false',
  () => checkCompletion({ mandatory: [] }, 'routine_1').done === false);

// unknown taskId
t('checkCompletion · unknown id → false',
  () => checkCompletion({ water_cups: 5 }, 'unknown_task').done === false);

// ───── hasEarned ─────────────────────────────────────
t('hasEarned · null profile → false',
  () => hasEarned(null) === false);
t('hasEarned · 빈 profile → false',
  () => hasEarned({}) === false);
t('hasEarned · onboarding_state 없음 → false',
  () => hasEarned({ id: 'abc' }) === false);
t('hasEarned · first_cube_earned_at null → false',
  () => hasEarned({ onboarding_state: { first_cube_earned_at: null } }) === false);
t('hasEarned · first_cube_earned_at ISO → true',
  () => hasEarned({ onboarding_state: { first_cube_earned_at: '2026-05-26T10:00:00Z' } }) === true);

// ───── shouldShow ────────────────────────────────────
t('shouldShow · null profile → false',
  () => shouldShow(null) === false);
t('shouldShow · FF off → false',
  () => shouldShow({}, () => false) === false);
t('shouldShow · FF on + 미획득 → true',
  () => shouldShow({}, () => true) === true);
t('shouldShow · FF on + 이미 획득 → false',
  () => shouldShow(
    { onboarding_state: { first_cube_earned_at: '2026-05-26T10:00:00Z' } },
    () => true
  ) === false);
t('shouldShow · flagsGet 없음 → 일단 통과 (try/catch 무시)',
  () => shouldShow({}) === true);

// ───── checkAnyCompletion ────────────────────────────
t('checkAnyCompletion · 모두 미완료 → null',
  () => checkAnyCompletion({}) === null);
t('checkAnyCompletion · water_2 만족 → water_2 task 반환',
  () => {
    const r = checkAnyCompletion({ water_cups: 3 });
    return r && r.task.id === 'water_2';
  });
t('checkAnyCompletion · task_1 만족 → task_1 반환',
  () => {
    const r = checkAnyCompletion({ targets: [{ st: 'done' }] });
    return r && r.task.id === 'task_1';
  });
t('checkAnyCompletion · 여러 만족 → 첫 hit 반환 (순서: water,walk,task,routine)',
  () => {
    const r = checkAnyCompletion({
      water_cups: 5,
      targets: [{ st: 'done' }],
      mandatory: [{ done: true }],
    });
    return r && r.task.id === 'water_2';
  });

// ───── Runner ────────────────────────────────────────
export function runFirstCubeTests() {
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
  console.log('[first-cube-tests] pass=%d fail=%d total=%d', pass, fail, _cases.length);
  if (fails.length) console.warn('FAILS:\n  ' + fails.join('\n  '));
  return { pass, fail, total: _cases.length, fails };
}

if (typeof window !== 'undefined') {
  window.runFirstCubeTests = runFirstCubeTests;
}

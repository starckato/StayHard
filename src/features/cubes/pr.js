// PR 감지 — 순수 함수.
// 운동 세션 저장 시 호출. 하루 최대 3개까지 보너스 큐브로 인정.
//
// prHistory: profiles.pr_records JSONB
//   {
//     byExercise: {
//       [exerciseName]: {
//         one_rm: { kg: number, date: 'YYYY-MM-DD' },
//         volume: { kg: number, date: 'YYYY-MM-DD' },     // 단일 세션 볼륨
//         repMax: { [reps]: { kg: number, date: 'YYYY-MM-DD' } }  // rep별 무게
//       }
//     }
//   }

// Epley 1RM 추정. 세트 내 최대값 반환.
export function estimate1RM(sets) {
  if (!Array.isArray(sets)) return 0;
  let best = 0;
  for (const s of sets) {
    if (!s || !s.done) continue;
    const kg = parseFloat(s.kg);
    const reps = parseInt(s.reps, 10);
    if (!Number.isFinite(kg) || !Number.isFinite(reps) || kg <= 0 || reps <= 0) continue;
    const est = reps === 1 ? kg : kg * (1 + reps / 30);
    if (est > best) best = est;
  }
  return best;
}

// 세션 볼륨 (done set 만)
export function sessionVolume(sets) {
  if (!Array.isArray(sets)) return 0;
  let v = 0;
  for (const s of sets) {
    if (!s || !s.done) continue;
    const kg = parseFloat(s.kg) || 0;
    const reps = parseInt(s.reps, 10) || 0;
    v += kg * reps;
  }
  return v;
}

// rep 수 → 해당 rep 이상 해낸 최대 무게
export function repMaxMap(sets) {
  const map = {};
  if (!Array.isArray(sets)) return map;
  for (const s of sets) {
    if (!s || !s.done) continue;
    const kg = parseFloat(s.kg);
    const reps = parseInt(s.reps, 10);
    if (!Number.isFinite(kg) || !Number.isFinite(reps) || kg <= 0 || reps <= 0) continue;
    if (map[reps] == null || kg > map[reps]) map[reps] = kg;
  }
  return map;
}

// PR 감지 — 세션 entry 배열 + 기존 prHistory
// 반환: { newPRs: [{exerciseName, kind, kg, reps?, prev, date}], nextHistory }
export function detectPRs(exercises, prHistory, dateKey) {
  const history = prHistory && typeof prHistory === 'object' ? prHistory : { byExercise: {} };
  const byEx = history.byExercise && typeof history.byExercise === 'object'
    ? { ...history.byExercise }
    : {};
  const newPRs = [];

  if (!Array.isArray(exercises)) {
    return { newPRs: [], nextHistory: { byExercise: byEx } };
  }

  for (const ex of exercises) {
    if (!ex || !ex.isStrength || !ex.name) continue;
    const prev = byEx[ex.name] || { one_rm: null, volume: null, repMax: {} };
    const nextEntry = {
      one_rm: prev.one_rm ? { ...prev.one_rm } : null,
      volume: prev.volume ? { ...prev.volume } : null,
      repMax: prev.repMax && typeof prev.repMax === 'object' ? { ...prev.repMax } : {},
    };

    // 1RM
    const est = estimate1RM(ex.sets);
    const prevOneRm = nextEntry.one_rm ? nextEntry.one_rm.kg : 0;
    if (est > prevOneRm && est > 0) {
      newPRs.push({
        exerciseName: ex.name,
        kind: 'one_rm',
        kg: Math.round(est * 10) / 10,
        prev: prevOneRm || 0,
        date: dateKey,
      });
      nextEntry.one_rm = { kg: Math.round(est * 10) / 10, date: dateKey };
    }

    // 볼륨 (세션 단위)
    const vol = sessionVolume(ex.sets);
    const prevVol = nextEntry.volume ? nextEntry.volume.kg : 0;
    if (vol > prevVol && vol > 0) {
      newPRs.push({
        exerciseName: ex.name,
        kind: 'volume',
        kg: vol,
        prev: prevVol || 0,
        date: dateKey,
      });
      nextEntry.volume = { kg: vol, date: dateKey };
    }

    // rep별 무게
    const repMap = repMaxMap(ex.sets);
    for (const repsStr of Object.keys(repMap)) {
      const reps = parseInt(repsStr, 10);
      const kg = repMap[repsStr];
      const prevMax = nextEntry.repMax[reps] ? nextEntry.repMax[reps].kg : 0;
      if (kg > prevMax && kg > 0) {
        newPRs.push({
          exerciseName: ex.name,
          kind: 'rep_max',
          reps,
          kg,
          prev: prevMax || 0,
          date: dateKey,
        });
        nextEntry.repMax[reps] = { kg, date: dateKey };
      }
    }

    byEx[ex.name] = nextEntry;
  }

  // 하루 최대 3개까지만 보너스 큐브로 인정 — 넘치면 기록은 남지만 cube 에는 제외.
  const capped = newPRs.slice(0, 3);
  return { newPRs: capped, nextHistory: { byExercise: byEx }, overflow: newPRs.length > 3 };
}

// PR 배열 → 보너스 큐브 항목 배열
export function prsToBonusCubes(prs) {
  if (!Array.isArray(prs)) return [];
  return prs.map((pr) => ({
    type: 'pr',
    color: 'gold',
    count: 2,
    exerciseName: pr.exerciseName,
    kind: pr.kind,
    kg: pr.kg,
    reps: pr.reps,
    prev: pr.prev,
    date: pr.date,
  }));
}

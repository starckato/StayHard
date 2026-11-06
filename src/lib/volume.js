// 큐록 · src/lib/volume.js
// 볼륨(들어올린 무게 합계)의 단일 정의 — DASHBOARD_SPEC_v1: Σ(done 세트 kg×reps).
//
// 2026-10-30 F2 결정(창업자): 세션 status 는 보지 않는다. 하다 만 트레이너 숙제라도
// 체크(done)한 세트는 그 즉시 볼륨이다. 대시보드(src/features/dashboards)·홈 세션 카드와
// 같은 공식이며, 저장된 w.totalVolume 은 쓰지 않고 세트에서 live 로 계산한다.
// (저장값은 isStrength 필터·완료 시점 스냅샷이라 어긋날 수 있음.)
//
// window 의존 없는 pure 함수 — node-runner 단위 테스트 가능.

/** 한 세션(workout entry)의 볼륨. gym 타입 + exercises 배열일 때만 계산. */
export function sessionVolume(w) {
  if (!w || typeof w !== 'object') return 0;
  if (w.type !== 'gym' || !Array.isArray(w.exercises)) return 0;
  let v = 0;
  for (const ex of w.exercises) {
    const sets = ex && Array.isArray(ex.sets) ? ex.sets : [];
    for (const st of sets) {
      if (!st || !st.done) continue;
      v += (parseFloat(st.kg) || 0) * (parseInt(st.reps) || 0);
    }
  }
  return v;
}

/** 하루(daily_log row)의 볼륨 — 모든 gym 세션 합산. */
export function dayVolume(log) {
  if (!log || !Array.isArray(log.workouts)) return 0;
  return log.workouts.reduce((a, w) => a + sessionVolume(w), 0);
}

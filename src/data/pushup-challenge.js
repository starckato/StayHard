// QROK · pushup challenge rule engine
//
// Pure functions for 푸쉬업 챌린지 룸. 데이터 모델:
//   competitions.measure_type = 'pushup_count'
//   competitions.daily_goal int
//   competitions.duration_days int (기존)
//   daily_logs.cubes.pushup = { count: N, lastAt: ISO, sessions: [{at, reps, videoUrl?}] }
//
// 멤버 상태: 'active' (모든 일자 성공) / 'partial' (방관자 — 일부 실패) / 'completed' (duration 끝까지)
// 룰 (사용자 결정 2026-04-25):
//   - 일일 판정: count >= daily_goal → 그날 성공
//   - 실패 처리: 방관자 뱃지 + 계속 참여 (룸에 남음, 카운트 가능)
//   - 중도 합류 가능 (합류 전 일자는 N/A)
//   - 매일 완료 시 보너스 골드 큐브
//   - 재도전 / 목표 변경 가능 (현 시점부터 적용)

/** @typedef {{at:string,reps:number,videoUrl?:string}} PushupSession */
/** @typedef {{count:number,lastAt?:string,sessions:PushupSession[]}} PushupCube */

/**
 * 챌린지 시작일 기준 day index (0-based).
 * @param {string} startDate ISO date 'YYYY-MM-DD' (KST 기준)
 * @param {Date|string} today
 * @returns {number} 0..duration_days-1, -1 if before start
 */
export function dayIndex(startDate, today) {
  if (!startDate) return -1;
  const start = new Date(startDate + 'T00:00:00+09:00');
  const t = today instanceof Date ? today : new Date(today);
  const diffMs = t - start;
  return Math.floor(diffMs / (24 * 60 * 60 * 1000));
}

/**
 * 일일 판정.
 * @param {number} count
 * @param {number} dailyGoal
 * @returns {boolean}
 */
export function daySuccess(count, dailyGoal) {
  return Number.isFinite(count) && Number.isFinite(dailyGoal) && dailyGoal > 0 && count >= dailyGoal;
}

/**
 * daily_logs.cubes.pushup 에서 오늘 카운트 추출.
 * @param {*} pushupCube
 * @returns {number}
 */
export function todayCount(pushupCube) {
  if (!pushupCube) return 0;
  return Math.max(0, +pushupCube.count || 0);
}

/**
 * 새 세션을 cube 에 append. 기존 cube immutable 반환 (새 객체).
 * @param {PushupCube|null} prev
 * @param {number} reps
 * @param {string|null} videoUrl
 * @returns {PushupCube}
 */
export function appendSession(prev, reps, videoUrl) {
  const r = Math.max(0, +reps || 0);
  const at = new Date().toISOString();
  const sessions = Array.isArray(prev?.sessions) ? prev.sessions.slice() : [];
  sessions.push({ at, reps: r, ...(videoUrl ? { videoUrl } : {}) });
  return {
    count: (prev?.count || 0) + r,
    lastAt: at,
    sessions,
  };
}

/**
 * 멤버의 일별 성공/실패 series.
 * @param {Array<{log_date:string, cubes?:any}>} logs (해당 멤버의 daily_logs)
 * @param {string} startDate
 * @param {number} durationDays
 * @param {number} dailyGoal
 * @returns {Array<'success'|'fail'|'pending'|'future'>}
 */
export function memberDaySeries(logs, startDate, durationDays, dailyGoal) {
  const today = new Date();
  const todayIdx = dayIndex(startDate, today);
  const out = [];
  const logMap = {};
  (logs || []).forEach(l => {
    const dk = (l.log_date || '').slice(0, 10);
    if (dk) logMap[dk] = l;
  });
  const start = new Date(startDate + 'T00:00:00+09:00');
  for (let i = 0; i < durationDays; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const dk = d.toISOString().slice(0, 10);
    const log = logMap[dk];
    const cnt = todayCount(log?.cubes?.pushup);
    if (i > todayIdx) {
      out.push('future');
    } else if (i === todayIdx && cnt < dailyGoal) {
      out.push('pending'); // 오늘은 아직 안 끝남
    } else if (daySuccess(cnt, dailyGoal)) {
      out.push('success');
    } else {
      out.push('fail');
    }
  }
  return out;
}

/**
 * 멤버 상태 분류.
 * @param {Array<'success'|'fail'|'pending'|'future'>} series
 * @returns {'active'|'partial'|'completed'}
 */
export function memberStatusFromSeries(series) {
  if (!series || series.length === 0) return 'active';
  const hasFail = series.includes('fail');
  const hasFuture = series.includes('future');
  if (!hasFuture) {
    return hasFail ? 'partial' : 'completed';
  }
  return hasFail ? 'partial' : 'active';
}

/**
 * 룸 집계.
 * @param {Array<{memberId:string, series:Array}>} memberSeries
 * @returns {{totalReps:number, totalDays:number, todaySucceeded:number, perfectMembers:number, partialMembers:number}}
 */
export function roomAggregate(memberSeries, memberLogsMap, dailyGoal) {
  let totalReps = 0;
  let totalDays = 0;
  let todaySucceeded = 0;
  let perfectMembers = 0;
  let partialMembers = 0;
  (memberSeries || []).forEach(({ memberId, series }) => {
    const logs = memberLogsMap[memberId] || [];
    logs.forEach(l => {
      totalReps += todayCount(l.cubes?.pushup);
    });
    series.forEach(s => { if (s === 'success') totalDays++; });
    const todayState = series.find((s, i) => s !== 'future' && i === series.length - 1 - series.slice().reverse().findIndex(x => x !== 'future'));
    // simpler: last non-future state
    const lastNonFuture = [...series].reverse().find(s => s !== 'future');
    if (lastNonFuture === 'success') todaySucceeded++;
    const status = memberStatusFromSeries(series);
    if (status === 'completed') perfectMembers++;
    else if (status === 'partial') partialMembers++;
  });
  return { totalReps, totalDays, todaySucceeded, perfectMembers, partialMembers };
}

/** 챌린지 duration 템플릿 — 사용자 결정 (1주 / 30일 / 100일). 단 커스텀도 허용. */
export const PUSHUP_DURATION_PRESETS = [
  { days: 7,   label: '1주' },
  { days: 30,  label: '30일' },
  { days: 100, label: '100일' },
];

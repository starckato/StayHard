// QROK · local notifications (on-device scheduling)
//
// Capacitor @capacitor/local-notifications 래퍼. 서버/APNs/FCM 불필요.
// OS 가 지정 시간에 직접 알림을 띄움. 앱 꺼져 있어도 동작.
//
// 웹: no-op (브라우저 Notification API 는 탭 열려 있어야 동작 — 본 기능의 가치와 맞지 않음).
//
// 카테고리 4개 (NOTIFICATION_POLICY.md §2):
//   morning_routine / meal_dinner / evening_wrap / streak_risk

import { isNative } from './platform.js';

/** @typedef {'diet_check'|'workout_check'|'routine_check'|'task_check'} NotifCategory */

/**
 * @typedef {Object} NotifPref
 * @property {boolean} on
 * @property {number} hour   0..23
 * @property {number} min    0|30
 */

/** 각 카테고리 고정 id 오프셋 — OS 에 같은 id 로 schedule 하면 덮어씀 (idempotent).
 *  Will Cube 4 카테고리 (diet/workout/routine/tasks) 와 1:1 매칭. */
const CATEGORY_IDS = {
  diet_check:    1001,
  workout_check: 1002,
  routine_check: 1003,
  task_check:    1004,
};

const COPY = {
  diet_check: [
    '점심. 식단 기록했나.',
    '한 끼 남겼나.',
    '오늘 뭐 먹었는지 기록해.',
  ],
  workout_check: [
    '운동 했나.',
    '땀 흘렸나.',
    '오늘 몸 썼나.',
  ],
  routine_check: [
    '루틴 체크했나.',
    '오늘 정한 것들, 다 밀었나.',
    '루틴 남았다. 확인해.',
  ],
  task_check: [
    '할일 정리했나.',
    '오늘 리스트 비웠나.',
    '끝내야 할 것 남아있다.',
  ],
};

const TITLE = '큐록';

async function _load() {
  return import('@capacitor/local-notifications');
}

/** Request permission. Returns granted boolean. Web: false (no-op). */
export async function requestPermission() {
  if (!isNative()) return false;
  try {
    const { LocalNotifications } = await _load();
    const { display } = await LocalNotifications.requestPermissions();
    return display === 'granted';
  } catch (e) {
    console.warn('[local-notif] permission', e);
    return false;
  }
}

/** Check current permission status without prompting. */
export async function checkPermission() {
  if (!isNative()) return 'unsupported';
  try {
    const { LocalNotifications } = await _load();
    const { display } = await LocalNotifications.checkPermissions();
    return display; // 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'
  } catch {
    return 'error';
  }
}

/**
 * Apply the full preferences object. Cancels everything, then schedules only
 * the categories that are on + valid time. Idempotent.
 *
 * @param {{enabled: boolean} & Record<NotifCategory, NotifPref>} prefs
 * @returns {Promise<{scheduled: string[], skipped: string[]}>}
 */
export async function applyPrefs(prefs) {
  const result = { scheduled: [], skipped: [] };
  if (!isNative()) return result;
  try {
    const { LocalNotifications } = await _load();
    // Cancel all managed categories first.
    const ids = Object.values(CATEGORY_IDS).map((id) => ({ id }));
    await LocalNotifications.cancel({ notifications: ids });

    if (!prefs || prefs.enabled === false) return result;

    /** @type {any[]} */
    const toSchedule = [];
    for (const cat of /** @type {NotifCategory[]} */ (Object.keys(CATEGORY_IDS))) {
      const p = prefs[cat];
      if (!p || !p.on) { result.skipped.push(cat); continue; }
      if (typeof p.hour !== 'number' || p.hour < 6 || p.hour > 23) { result.skipped.push(cat); continue; }
      const body = COPY[cat][Math.floor(Math.random() * COPY[cat].length)];
      toSchedule.push({
        id: CATEGORY_IDS[cat],
        title: TITLE,
        body,
        schedule: { on: { hour: p.hour, minute: p.min | 0 }, allowWhileIdle: true },
        sound: undefined,
        extra: { category: cat },
      });
      result.scheduled.push(cat);
    }

    if (toSchedule.length > 0) {
      await LocalNotifications.schedule({ notifications: toSchedule });
    }
  } catch (e) {
    console.warn('[local-notif] applyPrefs', e);
  }
  return result;
}

/** Cancel all managed notifications. */
export async function cancelAll() {
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await _load();
    const ids = Object.values(CATEGORY_IDS).map((id) => ({ id }));
    await LocalNotifications.cancel({ notifications: ids });
  } catch (e) {
    console.warn('[local-notif] cancelAll', e);
  }
}

/** Listen for notification tap (foreground/background). Returns unsubscribe. */
export async function onActionPerformed(cb) {
  if (!isNative()) return () => {};
  try {
    const { LocalNotifications } = await _load();
    const handle = await LocalNotifications.addListener('localNotificationActionPerformed', cb);
    return () => { try { handle.remove(); } catch {} };
  } catch {
    return () => {};
  }
}

/** Default prefs used on first-time opt-in. Will Cube 4 카테고리 매칭. */
export const DEFAULT_PREFS = {
  enabled: false, // master off by default (opt-in via onboarding card)
  diet_check:    { on: true, hour: 13, min: 0 },  // 점심 끝나고
  workout_check: { on: true, hour: 20, min: 0 },  // 저녁 8시
  routine_check: { on: true, hour: 18, min: 0 },  // 6시 이후
  task_check:    { on: true, hour: 18, min: 30 }, // 루틴과 stagger (6시 반)
  lastSyncedAt: null,
  backoff: {},
};

export const CATEGORY_META = {
  diet_check:    { label: '식단',  sub: '점심 이후 기록 확인' },
  workout_check: { label: '운동',  sub: '저녁 운동 체크' },
  routine_check: { label: '루틴',  sub: '저녁 루틴 점검' },
  task_check:    { label: '할일',  sub: '오늘 리스트 마무리' },
};

// Legacy key 정리 — v1 카테고리명 (morning_routine/meal_dinner/evening_wrap/streak_risk)
// 으로 저장된 localStorage prefs 는 새 키로 마이그레이션. 동일 CATEGORY_IDS 재사용이라
// OS 에 남은 스케줄은 cancel → 새 예약으로 자연 교체됨.
const LEGACY_KEY_MAP = {
  morning_routine: null,          // 대응 없음 — 폐기
  meal_dinner:     null,          // 폐기
  evening_wrap:    null,          // 폐기
  streak_risk:     null,          // 폐기
};

/** Read prefs from localStorage with user-scoped key. Returns DEFAULT_PREFS if missing.
 *  Also strips legacy v1 keys so they don't pollute the merged object. */
export function loadPrefs(userId) {
  try {
    const raw = localStorage.getItem(`notif_prefs_${userId || 'anon'}`);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    // Drop legacy keys.
    for (const legacy of Object.keys(LEGACY_KEY_MAP)) {
      delete parsed[legacy];
    }
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/** Persist prefs + apply to OS scheduler. */
export async function savePrefs(userId, prefs) {
  try {
    localStorage.setItem(`notif_prefs_${userId || 'anon'}`, JSON.stringify({
      ...prefs, lastSyncedAt: new Date().toISOString(),
    }));
  } catch (e) {
    console.warn('[local-notif] savePrefs persist', e);
  }
  return applyPrefs(prefs);
}

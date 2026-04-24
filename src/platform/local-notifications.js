// Stay Hard · local notifications (on-device scheduling)
//
// Capacitor @capacitor/local-notifications 래퍼. 서버/APNs/FCM 불필요.
// OS 가 지정 시간에 직접 알림을 띄움. 앱 꺼져 있어도 동작.
//
// 웹: no-op (브라우저 Notification API 는 탭 열려 있어야 동작 — 본 기능의 가치와 맞지 않음).
//
// 카테고리 4개 (NOTIFICATION_POLICY.md §2):
//   morning_routine / meal_dinner / evening_wrap / streak_risk

import { isNative } from './platform.js';

/** @typedef {'morning_routine'|'meal_dinner'|'evening_wrap'|'streak_risk'} NotifCategory */

/**
 * @typedef {Object} NotifPref
 * @property {boolean} on
 * @property {number} hour   0..23
 * @property {number} min    0|30
 */

/** 각 카테고리 고정 id 오프셋 — OS 에 같은 id 로 schedule 하면 덮어씀 (idempotent). */
const CATEGORY_IDS = {
  morning_routine: 1001,
  meal_dinner:     1002,
  evening_wrap:    1003,
  streak_risk:     1004,
};

const COPY = {
  morning_routine: [
    '일어났나. 오늘 첫 줄을 그어라.',
    '어제 잠든 너는 버려. 지금 시작해.',
    '하루가 시작됐다.',
  ],
  meal_dinner: [
    '저녁. 기록했나.',
    '밥은 먹었지.',
    '오늘 몸에 들어간 걸 남겨.',
  ],
  evening_wrap: [
    '하루가 끝난다. 남은 걸 채워라.',
    '빈칸 남았다. 확인해.',
    '잠들기 전에 한 줄.',
  ],
  streak_risk: [
    '지금 아니면 끊긴다.',
    '쌓은 걸 놓치지 마.',
    '10초면 충분하다.',
  ],
};

const TITLE = 'Stay Hard';

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

/** Default prefs used on first-time opt-in. */
export const DEFAULT_PREFS = {
  enabled: false, // master off by default (opt-in via onboarding card)
  morning_routine: { on: true,  hour: 8,  min: 0 },
  meal_dinner:     { on: true,  hour: 20, min: 30 },
  evening_wrap:    { on: false, hour: 22, min: 0 },
  streak_risk:     { on: true,  hour: 23, min: 30 },
  lastSyncedAt: null,
  backoff: {},
};

export const CATEGORY_META = {
  morning_routine: { label: '아침 루틴',  sub: '하루의 첫 줄' },
  meal_dinner:     { label: '저녁 기록',  sub: '하루 식단 정리' },
  evening_wrap:    { label: '하루 마감',  sub: '남은 빈칸 확인' },
  streak_risk:     { label: '스트릭 리스크', sub: '끊기기 직전' },
};

/** Read prefs from localStorage with user-scoped key. Returns DEFAULT_PREFS if missing. */
export function loadPrefs(userId) {
  try {
    const raw = localStorage.getItem(`notif_prefs_${userId || 'anon'}`);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw);
    // Shallow merge to pick up new fields added in later versions.
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

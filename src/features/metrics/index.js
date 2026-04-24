// 큐록 · metrics event logger
//
// Append-only event logging to Supabase `metric_events`. 전송 실패 시 localStorage
// queue 에 stash 했다가 다음 호출에서 재시도. UX 영향 없음 (silent).
//
// Usage:
//   import { logEvent } from './features/metrics/index.js';
//   import { EVT } from './features/metrics/events.js';
//   logEvent(EVT.FIRST_CUBE_EARNED, { cube_color: 'silver', category: 'diet' });

import { sb } from '../../lib/supabase.js';
import { EVT } from './events.js';

const QUEUE_KEY = 'qrok_metric_queue';
const MAX_QUEUE = 200;

/** Fire-and-forget event log. Never throws. */
export async function logEvent(eventKey, meta = {}) {
  if (!eventKey) return;
  const CU = typeof window !== 'undefined' ? window.CU : null;
  if (!CU || !CU.id) {
    // 유저 미로그인 상태에서도 queue 에 쌓아두고 로그인 시 flush
    _enqueue({ user_id: null, event_key: eventKey, meta, created_at: new Date().toISOString() });
    return;
  }

  try {
    const { error } = await sb.from('metric_events').insert({
      user_id: CU.id,
      event_key: eventKey,
      meta,
    });
    if (error) {
      _enqueue({ user_id: CU.id, event_key: eventKey, meta });
    } else {
      // 성공 시 stash 된 queue flush 시도
      _flushQueue();
    }
  } catch (e) {
    _enqueue({ user_id: CU.id, event_key: eventKey, meta });
  }
}

function _enqueue(row) {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const q = raw ? JSON.parse(raw) : [];
    q.push(row);
    // cap size
    const trimmed = q.slice(-MAX_QUEUE);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(trimmed));
  } catch {}
}

async function _flushQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return;
    const q = JSON.parse(raw) || [];
    if (q.length === 0) return;
    const CU = typeof window !== 'undefined' ? window.CU : null;
    if (!CU || !CU.id) return;

    // 본인 것만 flush (유저 전환 시 타인 이벤트 방지)
    const mine = q.filter(r => !r.user_id || r.user_id === CU.id)
                  .map(r => ({ user_id: CU.id, event_key: r.event_key, meta: r.meta || {} }));
    if (mine.length === 0) return;

    const { error } = await sb.from('metric_events').insert(mine);
    if (!error) {
      // 성공: 남은 queue = 내 것 제외
      const remaining = q.filter(r => r.user_id && r.user_id !== CU.id);
      localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    }
  } catch {}
}

/** Re-export EVT for convenience */
export { EVT };

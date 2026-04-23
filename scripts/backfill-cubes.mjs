#!/usr/bin/env node
// Will Cube Phase 1 — 과거 daily_logs 소급 큐브 계산 스크립트.
// ⚠️ 실행 전 반드시 스테이징 DB 에서 dry-run 확인.
// ⚠️ 프로덕션 실행 전 백업 필수.
//
// 사용법:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/backfill-cubes.mjs [--dry] [--user=<uuid>] [--limit=N]
//
// 옵션:
//   --dry           쓰기 없이 계산 결과만 출력
//   --user=<uuid>   특정 유저만
//   --limit=N       최대 N 개 로그만 처리 (테스트용)
//
// idempotent: cubes 가 이미 있는 로그는 bonus 배열만 보존하고 판정 재계산.
// 마일스톤/PR 감지는 실행하지 않음 — Phase 1 은 실시간 플로우에서만 잡음.
// 백필은 순수하게 diet/exercise/routine/tasks 판정만 채우는 목적.

import { createClient } from '@supabase/supabase-js';
import {
  judgeCubes,
  scoreFromCubes,
} from '../src/features/cubes/index.js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const USER = (args.find((a) => a.startsWith('--user=')) || '').split('=')[1] || null;
const LIMIT = parseInt((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1], 10) || null;

const sb = createClient(URL, KEY, { auth: { persistSession: false } });

function weekdayFromKey(logDate) {
  // Monday-based — renderMandatory / judgeRoutine 과 동일 인코딩 (Mon=0 ... Sun=6).
  return (new Date(logDate + 'T00:00:00').getDay() + 6) % 7;
}

async function fetchLogs() {
  let q = sb
    .from('daily_logs')
    .select('user_id, log_date, meals, workouts, mandatory, targets, cubes')
    .order('log_date', { ascending: true });
  if (USER) q = q.eq('user_id', USER);
  if (LIMIT) q = q.limit(LIMIT);
  const { data, error } = await q;
  if (error) throw new Error('fetch failed: ' + error.message);
  return data || [];
}

async function run() {
  console.log('[backfill] start dry=%s user=%s limit=%s', DRY, USER || 'all', LIMIT || 'all');
  const logs = await fetchLogs();
  console.log('[backfill] fetched %d logs', logs.length);

  let updated = 0;
  let skipped = 0;
  let totalDayScore = 0;
  const byUser = new Map(); // uuid → running score for logging

  for (const row of logs) {
    const ctx = { weekday: weekdayFromKey(row.log_date) };
    const base = judgeCubes(row, ctx);

    // bonus 보존 — 실시간 플로우에서 채운 것 유지.
    const existingBonus = row.cubes && Array.isArray(row.cubes.bonus) ? row.cubes.bonus : [];
    const next = { ...base, bonus: existingBonus };

    const same =
      row.cubes &&
      row.cubes.diet === next.diet &&
      row.cubes.exercise === next.exercise &&
      row.cubes.exercise_bonus === next.exercise_bonus &&
      row.cubes.routine === next.routine &&
      row.cubes.tasks === next.tasks;
    if (same) {
      skipped++;
      continue;
    }

    const dayScore = scoreFromCubes(next);
    totalDayScore += dayScore;
    byUser.set(row.user_id, (byUser.get(row.user_id) || 0) + dayScore);

    if (DRY) {
      console.log('[dry] %s %s  cubes=%j  score=%d', row.user_id.slice(0, 8), row.log_date, {
        d: next.diet, e: next.exercise, eb: next.exercise_bonus, r: next.routine, t: next.tasks, b: next.bonus.length,
      }, dayScore);
    } else {
      const { error } = await sb
        .from('daily_logs')
        .update({ cubes: next })
        .eq('user_id', row.user_id)
        .eq('log_date', row.log_date);
      if (error) console.warn('[backfill] update failed', row.user_id, row.log_date, error.message);
      else updated++;
    }
  }

  console.log('[backfill] done. updated=%d skipped=%d total_day_score=%d', updated, skipped, totalDayScore);
  console.log('[backfill] per-user score totals:');
  for (const [uid, s] of byUser.entries()) console.log('  ', uid.slice(0, 8), s);
  if (DRY) console.log('[backfill] DRY RUN — no DB writes.');
}

run().catch((e) => {
  console.error('[backfill] fatal:', e);
  process.exit(1);
});

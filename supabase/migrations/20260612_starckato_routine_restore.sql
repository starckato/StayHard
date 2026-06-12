-- 큐록 · starckato (333b7fec-0058-47b6-8650-bc6aa52b2bd7) routine 복구
--
-- 배경:
--   - 5/9 destructive propagate → 14일 mandatory 가 1 routine 로 덮어쓰기
--   - 그 후 cache 의 longest mandatory 자가 복제로 ghost spread
--   - 6/9 부터는 cache 의 DEFAULT_MAND 가 user 실제 routines 를 완전 대체
--   - migration 20260608 의 backfill 이 6/10 (DEFAULT_MAND only) 을 routine_defs 로 사용 → 또 잘못됨
--
-- 의도된 routines (6/8 의 customs minus 🐱 고양이 화장실 ghost):
--   🦷 양치 · 🧹 집 청소 · 💊 영양제 · 📖 독서 30분 · 🧊 냉수 샤워 · 😴 11시 취침
--
-- 복구 절차 (단일 트랜잭션):
--   1) profile.routine_defs → 의도된 6 routines (canonical source 정정)
--   2) 5/26 ~ 6/8: ghost "🐱 고양이 화장실" 만 제거 (나머지 customs 보존)
--   3) 6/9 ~ : DEFAULT_MAND 패턴 감지 시 의도된 6 routines 로 교체
--
-- DEFAULT_MAND 시그너처: '🗂️ 책상 정리' 가 mandatory 에 있음 (사용자 진짜 routine 아님).

BEGIN;

-- 1) profile.routine_defs canonical 정정
UPDATE profiles
SET routine_defs = '[
  {"name":"🦷 양치","days":[0,1,2,3,4,5,6],"_scoreType":null,"end_date":null},
  {"name":"🧹 집 청소","days":[0,1,2,3,4,5,6],"_scoreType":null,"end_date":null},
  {"name":"💊 영양제","days":[0,1,2,3,4,5,6],"_scoreType":null,"end_date":null},
  {"name":"📖 독서 30분","days":[0,1,2,3,4,5,6],"_scoreType":null,"end_date":null},
  {"name":"🧊 냉수 샤워","days":[0,1,2,3,4,5,6],"_scoreType":null,"end_date":null},
  {"name":"😴 11시 취침","days":[0,1,2,3,4,5,6],"_scoreType":null,"end_date":null}
]'::jsonb
WHERE id = '333b7fec-0058-47b6-8650-bc6aa52b2bd7';

-- 2) ghost 제거 — 5/26 ~ 6/8 (mandatory 에서 name='🐱 고양이 화장실' 만 필터링)
UPDATE daily_logs
SET mandatory = COALESCE(
  (SELECT jsonb_agg(m)
   FROM jsonb_array_elements(mandatory) m
   WHERE m->>'name' != '🐱 고양이 화장실'),
  '[]'::jsonb
)
WHERE user_id = '333b7fec-0058-47b6-8650-bc6aa52b2bd7'
  AND log_date BETWEEN '2026-05-26' AND '2026-06-08'
  AND mandatory IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(mandatory) m
    WHERE m->>'name' = '🐱 고양이 화장실'
  );

-- 3) DEFAULT_MAND 패턴 (6/9 이후) → 의도된 6 routines 로 교체
--    시그너처: mandatory 에 '🗂️ 책상 정리' 존재 (DEFAULT_MAND 고유)
UPDATE daily_logs
SET mandatory = '[
  {"days":[0,1,2,3,4,5,6],"done":false,"name":"🦷 양치","type":"custom"},
  {"days":[0,1,2,3,4,5,6],"done":false,"name":"🧹 집 청소","type":"custom"},
  {"days":[0,1,2,3,4,5,6],"done":false,"name":"💊 영양제","type":"custom"},
  {"days":[0,1,2,3,4,5,6],"done":false,"name":"📖 독서 30분","type":"custom"},
  {"days":[0,1,2,3,4,5,6],"done":false,"name":"🧊 냉수 샤워","type":"custom"},
  {"days":[0,1,2,3,4,5,6],"done":false,"name":"😴 11시 취침","type":"custom"}
]'::jsonb
WHERE user_id = '333b7fec-0058-47b6-8650-bc6aa52b2bd7'
  AND log_date >= '2026-06-09'
  AND mandatory IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(mandatory) m
    WHERE m->>'name' = '🗂️ 책상 정리'
  );

-- 영향 받은 row 개수 리포트
SELECT 'profile updated' AS step,
       (SELECT COUNT(*) FROM profiles
        WHERE id = '333b7fec-0058-47b6-8650-bc6aa52b2bd7' AND routine_defs IS NOT NULL) AS n
UNION ALL
SELECT 'ghost removed (5/26~6/8)',
       (SELECT COUNT(*) FROM daily_logs
        WHERE user_id = '333b7fec-0058-47b6-8650-bc6aa52b2bd7'
          AND log_date BETWEEN '2026-05-26' AND '2026-06-08'
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(mandatory) m
                          WHERE m->>'name' = '🐱 고양이 화장실'))
UNION ALL
SELECT 'DEFAULT_MAND replaced (6/9~)',
       (SELECT COUNT(*) FROM daily_logs
        WHERE user_id = '333b7fec-0058-47b6-8650-bc6aa52b2bd7'
          AND log_date >= '2026-06-09'
          AND EXISTS (SELECT 1 FROM jsonb_array_elements(mandatory) m
                      WHERE m->>'name' = '🦷 양치'));

COMMIT;

-- 053 · 외부 러닝 앱 자동 동기화 기반 (2026-09-14)
--
-- 사용자 결정: "가민런이랑 스트라바는 등록되면 qrok 앱 실행될 때 자동으로 긁어오게.
--              strava/가민런 데이터 스키마·테이블이 qrok 에 없으면 파악해서 만들어."
--
-- (1) activities — 종목 중립 활동 테이블 (피벗 확정 ⑶의 첫 실체).
--     Strava activity + Garmin Connect activity 의 공통분모 필드 + raw 전문 보존.
--     기존 daily_logs.workouts JSONB(세트·무게 중심)로는 페이스·HR·케이던스·고도를
--     담을 수 없어 신설. 파생 규칙: avg_pace 는 DB generated column (원본=거리·시간).
-- (2) external_connections — provider OAuth 토큰. 토큰 컬럼은 클라이언트 SELECT 불가
--     (048 컬럼 권한 패턴). 동기화는 Edge Function(service_role)만 수행.
-- (3) append_external_activities — append-only 임포트 RPC (service_role 전용).
--     activities 에 upsert(중복은 무시) + daily_logs.workouts 에 표시용 엔트리 append.
--     REPLACE 금지 원칙 준수: 기존 유저 데이터는 절대 수정·삭제하지 않는다.
--     표시 엔트리는 '임포트 시 1회 생성되는 프로젝션'이며 원본은 activities 행이다.

-- ─────────────────────────────────────────────────────
-- (1) activities
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source        text NOT NULL CHECK (source IN ('strava','garmin','manual','agent')),
  source_id     text,                          -- provider 활동 id (dedupe 키)
  sport         text NOT NULL,                 -- run · ride · swim · walk · hike · workout · other
  name          text,
  started_at    timestamptz NOT NULL,
  local_date    date NOT NULL,                 -- 앱 일일 로그 매칭 키 (start_date_local 기준)
  timezone      text,
  distance_m    numeric,
  duration_s    integer,                       -- elapsed
  moving_s      integer,
  elev_gain_m   numeric,
  avg_hr        integer,
  max_hr        integer,
  avg_cadence   numeric,                       -- 러닝: spm (Strava 는 편측값 ×2 해서 저장)
  calories      integer,
  -- 파생 규칙 (DERIVATION_RULES.md 등재): 원본 = moving_s·distance_m.
  -- 저장하지 않고 DB 가 항상 계산 → 수정 시 재계산 누락이 구조적으로 불가능.
  avg_pace_s_km numeric GENERATED ALWAYS AS (
    CASE WHEN distance_m > 0 AND moving_s > 0
         THEN moving_s / (distance_m / 1000.0) END
  ) STORED,
  raw           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- provider 원문 (스키마 진화 대비)
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS activities_dedupe
  ON public.activities (user_id, source, source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS activities_user_date ON public.activities (user_id, local_date DESC);
CREATE INDEX IF NOT EXISTS activities_user_started ON public.activities (user_id, started_at DESC);

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS activities_owner_select ON public.activities;
CREATE POLICY activities_owner_select ON public.activities
  FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS activities_owner_insert ON public.activities;
CREATE POLICY activities_owner_insert ON public.activities
  FOR INSERT WITH CHECK (user_id = auth.uid() AND source IN ('manual'));
DROP POLICY IF EXISTS activities_owner_delete ON public.activities;
CREATE POLICY activities_owner_delete ON public.activities
  FOR DELETE USING (user_id = auth.uid());
-- UPDATE 정책 없음 — 임포트 데이터는 불변. 수정은 삭제 후 재임포트/재기록.

-- ─────────────────────────────────────────────────────
-- (2) external_connections
-- ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.external_connections (
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider      text NOT NULL CHECK (provider IN ('strava')),
  athlete_id    text,
  access_token  text NOT NULL,
  refresh_token text NOT NULL,
  expires_at    timestamptz NOT NULL,
  scope         text,
  last_sync_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

ALTER TABLE public.external_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS extconn_owner_select ON public.external_connections;
CREATE POLICY extconn_owner_select ON public.external_connections
  FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS extconn_owner_delete ON public.external_connections;
CREATE POLICY extconn_owner_delete ON public.external_connections
  FOR DELETE USING (user_id = auth.uid());
-- INSERT/UPDATE 는 Edge Function(service_role)만.

-- 토큰 평문은 클라이언트가 읽을 수 없다 (048 컬럼 권한 패턴)
REVOKE ALL ON public.external_connections FROM authenticated;
GRANT SELECT (user_id, provider, athlete_id, scope, last_sync_at, created_at)
  ON public.external_connections TO authenticated;
GRANT DELETE ON public.external_connections TO authenticated;

-- ─────────────────────────────────────────────────────
-- (3) append_external_activities — append-only 임포트
-- ─────────────────────────────────────────────────────
-- p_entries: [{source, source_id, sport, name, started_at, local_date, timezone,
--              distance_m, duration_s, moving_s, elev_gain_m, avg_hr, max_hr,
--              avg_cadence, calories, raw, display:{...daily_logs 표시 엔트리}}]
CREATE OR REPLACE FUNCTION public.append_external_activities(
  p_user_id uuid,
  p_entries jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  e jsonb;
  v_inserted int := 0;
  v_skipped int := 0;
  v_date date;
  v_src_id text;
  v_display jsonb;
  v_existing jsonb;
  v_row_id uuid;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user required'; END IF;

  FOR e IN SELECT * FROM jsonb_array_elements(COALESCE(p_entries,'[]'::jsonb)) LOOP
    v_src_id := e->>'source_id';
    v_date := (e->>'local_date')::date;

    INSERT INTO activities (user_id, source, source_id, sport, name, started_at, local_date,
                            timezone, distance_m, duration_s, moving_s, elev_gain_m,
                            avg_hr, max_hr, avg_cadence, calories, raw)
    VALUES (p_user_id, e->>'source', v_src_id, COALESCE(e->>'sport','other'),
            e->>'name', (e->>'started_at')::timestamptz, v_date, e->>'timezone',
            (e->>'distance_m')::numeric, (e->>'duration_s')::int, (e->>'moving_s')::int,
            (e->>'elev_gain_m')::numeric, (e->>'avg_hr')::int, (e->>'max_hr')::int,
            (e->>'avg_cadence')::numeric, (e->>'calories')::int,
            COALESCE(e->'raw','{}'::jsonb))
    ON CONFLICT (user_id, source, source_id) WHERE source_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_row_id;

    IF v_row_id IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;  -- 이미 임포트됨 — 표시 엔트리도 이미 있음
    END IF;
    v_inserted := v_inserted + 1;

    -- daily_logs 표시 프로젝션 append (append-only, _srcId 중복 방지)
    v_display := e->'display';
    IF v_display IS NOT NULL AND v_date IS NOT NULL THEN
      SELECT workouts INTO v_existing FROM daily_logs
        WHERE user_id = p_user_id AND log_date = v_date;
      IF v_existing IS NULL THEN
        INSERT INTO daily_logs (user_id, log_date, workouts)
        VALUES (p_user_id, v_date, jsonb_build_array(v_display))
        ON CONFLICT (user_id, log_date) DO UPDATE
          SET workouts = COALESCE(daily_logs.workouts,'[]'::jsonb) || jsonb_build_array(v_display),
              updated_at = now();
      ELSIF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_existing,'[]'::jsonb)) w
        WHERE w->>'_srcId' = (v_display->>'_srcId')
      ) THEN
        UPDATE daily_logs
          SET workouts = COALESCE(workouts,'[]'::jsonb) || jsonb_build_array(v_display),
              updated_at = now()
          WHERE user_id = p_user_id AND log_date = v_date;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', v_inserted, 'skipped', v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.append_external_activities(uuid, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.append_external_activities(uuid, jsonb) TO service_role;

COMMENT ON TABLE public.activities IS
  '종목 중립 활동 원본 (Strava/Garmin 임포트 + 향후 수동 기록). daily_logs 표시 엔트리는 프로젝션.';

-- dev_test_clients.sql (NOT a production migration — manual run only)
-- test trainer (f8a8632a-e787-4df1-9485-7e37325e05e6) 에 가상 회원 3명 + 7일 daily_logs.
-- 멱등 — 중복 실행 시 ON CONFLICT 로 안전.
--
-- 회원 프로필:
--   test1: 우등생 (클린 식단·운동 매일)
--   test2: 보통 (일반식·운동 가끔)
--   test3: 위험 (금지식단·운동 자주 빠짐·어제 식단 미기록)
--
-- 비밀번호: test1234 (모두 동일)

DO $$
DECLARE
  v_trainer_id uuid := 'f8a8632a-e787-4df1-9485-7e37325e05e6';
  v_today date := (now() AT TIME ZONE 'Asia/Seoul')::date;
  v_id1 uuid := '11111111-1111-1111-1111-111111111111';
  v_id2 uuid := '22222222-2222-2222-2222-222222222222';
  v_id3 uuid := '33333333-3333-3333-3333-333333333333';
  v_pw text := crypt('test1234', gen_salt('bf'));
BEGIN
  -- auth.users (bcrypt password 'test1234')
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_sso_user)
  VALUES
    (v_id1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test1@example.com', v_pw, now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
    (v_id2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test2@example.com', v_pw, now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
    (v_id3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'test3@example.com', v_pw, now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false)
  ON CONFLICT (id) DO NOTHING;

  -- profiles
  INSERT INTO profiles (id, username, display_name, friend_code, created_at, total_score, weight_goal, water_goal)
  VALUES
    (v_id1, 'qrok_test1', '우등생 회원', 'TEST0001', now() - INTERVAL '20 days', 1200, 65.0, 8),
    (v_id2, 'qrok_test2', '보통 회원',   'TEST0002', now() - INTERVAL '15 days', 400,  72.0, 6),
    (v_id3, 'qrok_test3', '위험 회원',   'TEST0003', now() - INTERVAL '10 days', 80,   80.0, 6)
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

  -- trainer_clients
  INSERT INTO trainer_clients (trainer_id, client_id, status, connected_at, nickname)
  VALUES
    (v_trainer_id, v_id1, 'active', now() - INTERVAL '18 days', '잘하는 김'),
    (v_trainer_id, v_id2, 'active', now() - INTERVAL '14 days', '보통 박'),
    (v_trainer_id, v_id3, 'active', now() - INTERVAL '8 days',  '꾸준해야 이')
  ON CONFLICT (trainer_id, client_id) DO UPDATE SET status = 'active';

  -- daily_logs — 7 일치 (오늘 - 6일 ~ 오늘) 생성. 멱등.
  -- test1 (우등생): 매일 아침/점심/저녁 클린, 헬스 1회 done, 체중 점진 감소
  FOR i IN 0..6 LOOP
    INSERT INTO daily_logs (user_id, log_date, weight, water_cups, meals, workouts, mandatory, targets, updated_at)
    VALUES (
      v_id1,
      v_today - (i || ' days')::INTERVAL,
      66.5 - (6-i)*0.15,  -- 65.6 → 66.5 점진 감소
      8,
      jsonb_build_array(
        jsonb_build_object('name','오트밀 + 계란','type','green','time','아침','category','meal'),
        jsonb_build_object('name','닭가슴살 샐러드','type','green','time','점심','category','meal'),
        jsonb_build_object('name','연어구이 + 야채','type','green','time','저녁','category','meal')
      ),
      jsonb_build_array(
        jsonb_build_object('type','gym','sessionName','헬스 세션','status','done','totalVolume', 4500 + i*200,
          'exercises', jsonb_build_array(
            jsonb_build_object('name','벤치프레스','sets',jsonb_build_array(
              jsonb_build_object('kg',60,'reps',8,'done',true),
              jsonb_build_object('kg',60,'reps',8,'done',true),
              jsonb_build_object('kg',60,'reps',8,'done',true)
            )),
            jsonb_build_object('name','데드리프트','sets',jsonb_build_array(
              jsonb_build_object('kg',80,'reps',5,'done',true),
              jsonb_build_object('kg',80,'reps',5,'done',true)
            ))
          )
        )
      ),
      '[]'::jsonb,
      '[]'::jsonb,
      now() - (i || ' days')::INTERVAL
    )
    ON CONFLICT (user_id, log_date) DO NOTHING;
  END LOOP;

  -- test2 (보통): 일반식 위주, 운동 격일, 체중 변동 없음
  FOR i IN 0..6 LOOP
    INSERT INTO daily_logs (user_id, log_date, weight, water_cups, meals, workouts, mandatory, targets, updated_at)
    VALUES (
      v_id2,
      v_today - (i || ' days')::INTERVAL,
      71.5 + (i % 2) * 0.2,
      4,
      CASE
        WHEN i % 2 = 0 THEN jsonb_build_array(
          jsonb_build_object('name','김밥','type','normal','time','아침','category','meal'),
          jsonb_build_object('name','제육덮밥','type','normal','time','점심','category','meal'),
          jsonb_build_object('name','된장찌개 + 밥','type','normal','time','저녁','category','meal')
        )
        ELSE jsonb_build_array(
          jsonb_build_object('name','샌드위치','type','normal','time','점심','category','meal'),
          jsonb_build_object('name','파스타','type','normal','time','저녁','category','meal')
        )
      END,
      CASE
        WHEN i % 2 = 0 THEN jsonb_build_array(
          jsonb_build_object('type','gym','sessionName','헬스 세션','status','done','totalVolume', 2800,
            'exercises', jsonb_build_array(
              jsonb_build_object('name','스쿼트','sets',jsonb_build_array(
                jsonb_build_object('kg',60,'reps',10,'done',true),
                jsonb_build_object('kg',60,'reps',10,'done',true)
              ))
            )
          )
        )
        ELSE '[]'::jsonb
      END,
      '[]'::jsonb, '[]'::jsonb,
      now() - (i || ' days')::INTERVAL
    )
    ON CONFLICT (user_id, log_date) DO NOTHING;
  END LOOP;

  -- test3 (위험): 금지식단 자주, 운동 거의 X, 어제 (i=1) 식단 0건
  FOR i IN 0..6 LOOP
    INSERT INTO daily_logs (user_id, log_date, weight, water_cups, meals, workouts, mandatory, targets, updated_at)
    VALUES (
      v_id3,
      v_today - (i || ' days')::INTERVAL,
      82.0 + i * 0.1,
      2,
      CASE
        WHEN i = 1 THEN '[]'::jsonb  -- 어제: 식단 미기록 (alert trigger)
        WHEN i = 0 THEN jsonb_build_array(  -- 오늘: 금지식단 발견 (alert)
          jsonb_build_object('name','치킨','type','red','time','점심','category','meal'),
          jsonb_build_object('name','피자','type','red','time','저녁','category','meal')
        )
        WHEN i = 2 THEN jsonb_build_array(
          jsonb_build_object('name','맥주 + 안주','type','red','time','저녁','category','alcohol')
        )
        ELSE jsonb_build_array(
          jsonb_build_object('name','라면','type','normal','time','점심','category','meal'),
          jsonb_build_object('name','삼겹살','type','red','time','저녁','category','meal')
        )
      END,
      CASE
        WHEN i = 3 THEN jsonb_build_array(
          jsonb_build_object('type','gym','sessionName','헬스 세션','status','done','totalVolume', 1200,
            'exercises', jsonb_build_array(
              jsonb_build_object('name','벤치프레스','sets',jsonb_build_array(
                jsonb_build_object('kg',40,'reps',6,'done',true)
              ))
            )
          )
        )
        ELSE '[]'::jsonb
      END,
      '[]'::jsonb, '[]'::jsonb,
      now() - (i || ' days')::INTERVAL
    )
    ON CONFLICT (user_id, log_date) DO NOTHING;
  END LOOP;

  -- 트레이너 운동 배정 — RPC 는 auth.uid() 기반이라 직접 INSERT 로 fake.
  DECLARE
    v_assignment_id uuid := gen_random_uuid();
    v_session_entry jsonb;
  BEGIN
    INSERT INTO workout_assignments (id, trainer_id, client_id, assigned_for_date, payload, status)
    VALUES (
      v_assignment_id, v_trainer_id, v_id1, v_today,
      jsonb_build_object(
        'workouts', jsonb_build_array(
          jsonb_build_object('name','벤치프레스','muscle','가슴','equipment','바벨','icon','🏋️',
            'sets', jsonb_build_array(
              jsonb_build_object('kg',60,'reps',8),
              jsonb_build_object('kg',60,'reps',8),
              jsonb_build_object('kg',60,'reps',8)
            )
          ),
          jsonb_build_object('name','데드리프트','muscle','등','equipment','바벨','icon','🏋️',
            'sets', jsonb_build_array(
              jsonb_build_object('kg',80,'reps',5),
              jsonb_build_object('kg',80,'reps',5)
            )
          )
        )
      ),
      'pending'
    )
    ON CONFLICT (id) DO NOTHING;

    v_session_entry := jsonb_build_object(
      'type','gym','sessionName','오늘의 운동 (트레이너)','status','planned',
      '_trainerAssignmentId', v_assignment_id::text,
      '_assignedBy', v_trainer_id::text,
      'exercises', jsonb_build_array(
        jsonb_build_object('name','벤치프레스','muscle','가슴','equipment','바벨','icon','🏋️',
          'sets', jsonb_build_array(
            jsonb_build_object('kg',60,'reps',8,'done',false),
            jsonb_build_object('kg',60,'reps',8,'done',false),
            jsonb_build_object('kg',60,'reps',8,'done',false)
          )
        ),
        jsonb_build_object('name','데드리프트','muscle','등','equipment','바벨','icon','🏋️',
          'sets', jsonb_build_array(
            jsonb_build_object('kg',80,'reps',5,'done',false),
            jsonb_build_object('kg',80,'reps',5,'done',false)
          )
        )
      )
    );
    -- test1 today 에 trainer assignment entry 추가 (이미 done gym 있어도 별개)
    UPDATE daily_logs
    SET workouts = COALESCE(workouts,'[]'::jsonb) || jsonb_build_array(v_session_entry),
        updated_at = now()
    WHERE user_id = v_id1 AND log_date = v_today;
  END;
END$$;

-- 결과 확인
SELECT
  p.display_name,
  tc.nickname,
  (SELECT count(*) FROM daily_logs WHERE user_id = p.id) AS log_count
FROM trainer_clients tc
JOIN profiles p ON p.id = tc.client_id
WHERE tc.trainer_id = 'f8a8632a-e787-4df1-9485-7e37325e05e6'
ORDER BY p.username;

# Staging · 테스트 환경 워크플로우

## 환경 구성

```
  feature branches (redesign/graphite, fix/*, feat/*)
          │
          ▼  merge (PR or direct)
        staging  ──→  stay-hard-git-staging-starckato-3038s-projects.vercel.app
          │           (테스트 · 프로덕션 동일 config)
          │
          ▼  merge (PR after staging sign-off)
         main   ──→  stay-hard-rouge.vercel.app
                     (프로덕션 · 실 운영)
```

## Branch 전략

| 브랜치 | 역할 | 배포 |
|---|---|---|
| `main` | 프로덕션. 실 유저가 접속. 안정적이어야 함. | `stay-hard-rouge.vercel.app` |
| `staging` | 프로덕션 직전 검증. 실제 유저 시나리오로 테스트. | 브랜치 preview URL |
| `feature/*`, `fix/*` | 개별 작업. preview URL 자동 생성. | 브랜치 preview URL |

## 작업 흐름

### 1. 기능 개발

```bash
git checkout staging
git pull origin staging
git checkout -b feature/my-new-thing
# ... 작업 ...
git commit -m "feat: new thing"
git push -u origin feature/my-new-thing
# → Vercel이 이 브랜치 preview URL 자동 생성
```

### 2. 스테이징 테스트

```bash
git checkout staging
git merge feature/my-new-thing
git push origin staging
# → Vercel이 staging preview URL 갱신 (~30-60초)
```

스테이징 URL 에서 실사용 시나리오로 테스트:
- 회원가입·로그인 플로우
- 하루 분 데이터 입력 (체중·식단·운동·루틴·목표)
- 보상 연출 실제 트리거
- 통계·차트 렌더링
- 여러 기기 (iOS Safari, Android Chrome, desktop) 확인

### 3. 프로덕션 배포

```bash
git checkout main
git merge staging
git push origin main
# → Vercel이 프로덕션 배포 (~30-60초)
```

## 롤백

### Git 레벨

```bash
# 방법 A: 최근 커밋 revert (권장)
git revert <bad-commit-hash>
git push origin main

# 방법 B: 특정 지점으로 강제 복구 (위험)
git checkout main
git reset --hard <good-commit-hash>
git push --force-with-lease origin main
```

### Vercel 대시보드

1. https://vercel.com/starckato-3038s-projects/stay-hard/deployments
2. 이전 안정 배포 선택
3. `...` 메뉴 → `Promote to Production` (1-click)

### 주요 롤백 앵커

| 태그 | 커밋 | 설명 |
|---|---|---|
| `v2.5-pre-graphite` | `8ebd9ce` | 그라파이트 리디자인 시작 직전 프로덕션 상태 |

## Supabase 데이터베이스 주의

**현 상태**: 스테이징·프로덕션이 동일 Supabase 프로젝트 공유 중 → 테스트 데이터가 실 데이터와 섞일 위험.

**안전 수칙 (임시)**:
- 스테이징 테스트는 전용 계정 (`staging_test_*@gmail.com`) 으로만
- 대량 데이터 생성 테스트 금지
- RLS 정책 변경 migration 은 반드시 staging 에서 먼저 돌린 뒤 main 에 반영

**정석 (후속)**:
- 별도 Supabase 프로젝트 생성 (stayhard-staging)
- Vercel 환경 변수를 environment-scoped 로 설정
  - Production: Prod Supabase URL + anon key
  - Preview (staging 포함): Staging Supabase URL + anon key
- staging 용 migration 별도 관리 또는 prod-to-staging 스키마 동기화 스크립트

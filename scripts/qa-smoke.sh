#!/bin/bash
# qa-smoke.sh — 자동 smoke test (2026-04-25 세션 변경 검증)
#
# Usage:
#   ./scripts/qa-smoke.sh           # production (stay-hard-rouge)
#   ./scripts/qa-smoke.sh prod      # 동일
#   ./scripts/qa-smoke.sh qrok      # qrok.app (DNS 적용 후)
#
# Required: ~/.qrok-sb-pat (Supabase Management PAT)

set -uo pipefail

ENV="${1:-prod}"
case "$ENV" in
  prod|production) BASE_URL="https://stay-hard-rouge.vercel.app";;
  qrok)            BASE_URL="https://qrok.app";;
  *)               BASE_URL="$ENV";;  # 직접 URL 전달 가능
esac

PASS_CNT=0
FAIL_CNT=0
TOTAL=0

ok()   { echo "PASS  $1"; PASS_CNT=$((PASS_CNT+1)); TOTAL=$((TOTAL+1)); }
fail() { echo "FAIL  $1 → $2"; FAIL_CNT=$((FAIL_CNT+1)); TOTAL=$((TOTAL+1)); }

echo "=================================================="
echo " QROK QA Smoke Test · 2026-04-25 session"
echo " Base URL: $BASE_URL"
echo "=================================================="
echo ""

# ── 1. URL HTTPS 200 ──────────────────────────────────
echo "[1] URL 응답 (HTTPS 200)"
for url in "$BASE_URL/" "$BASE_URL/manifest.json" "$BASE_URL/sw.js"; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 8 "$url" || echo "000")
  if [ "$code" = "200" ]; then ok "$url ($code)"; else fail "$url" "HTTP $code"; fi
done

# ── 2. manifest.json 검증 ─────────────────────────────
echo ""
echo "[2] manifest.json"
manifest=$(curl -sS --compressed --max-time 8 "$BASE_URL/manifest.json")
if grep -qE '"name": *"큐록"' <<<"$manifest"; then
  ok "name = '큐록'"
else
  fail "manifest.name" "no match"
fi
if grep -qF '전부 기록하고, 전부 책임진다' <<<"$manifest"; then
  ok "description = 락인 부제"
else
  fail "manifest.description" "missing locked copy"
fi
if grep -qE '"theme_color": *"#0f0f11"' <<<"$manifest"; then
  ok "theme_color = #0f0f11"
else
  fail "manifest.theme_color" "missing"
fi

# ── 3. sw.js CACHE_NAME ────────────────────────────────
echo ""
echo "[3] Service Worker"
sw=$(curl -sS --compressed --max-time 8 "$BASE_URL/sw.js")
if grep -qF "CACHE_NAME = 'qrok-v1'" <<<"$sw"; then
  ok "CACHE_NAME = 'qrok-v1' (자동 cache bust)"
else
  fail "sw.js CACHE_NAME" "no match"
fi

# ── 4. index.html 헤더 ────────────────────────────────
echo ""
echo "[4] index.html"
home=$(curl -sS --compressed --max-time 8 "$BASE_URL/")
# here-string 사용 — set -o pipefail + grep -q (SIGPIPE) 충돌 회피
if grep -qF "<title>큐록 QROK</title>" <<<"$home"; then
  ok "<title>큐록 QROK</title>"
else
  fail "index.html title" "missing 큐록 QROK"
fi
if grep -qF "qrok-splash" <<<"$home"; then
  ok "splash overlay (qrok-splash) 마크업 존재"
else
  fail "splash overlay" "missing"
fi
if grep -qF "qrok-splash-dot gold" <<<"$home"; then
  ok "글로우 dots (gold/silver/crimson/gray)"
else
  fail "glow dots" "missing"
fi
if grep -qE "stayhard|stay-hard-rouge\.vercel\.app|Stay Hard|StayHard" <<<"$home" ; then
  fail "stayhard 잔존" "found in index.html"
else
  ok "stayhard 잔존 0건"
fi

# ── 5. Vercel redirect (qrok.co.kr → qrok.app) ────────
# 단 qrok.co.kr DNS 가 전파된 경우만. fallback OK.
echo ""
echo "[5] Vercel Redirects"
redir=$(curl -sS -o /dev/null -w "%{http_code}|%{redirect_url}" --max-time 8 -H "Host: qrok.co.kr" "$BASE_URL/test-path" 2>&1 || echo "skip")
if echo "$redir" | grep -q "skip"; then
  echo "SKIP  qrok.co.kr Host header redirect (DNS 전파 대기)"
else
  echo "INFO  redirect probe: $redir"
fi

# ── 6. DNS qrok.app ───────────────────────────────────
echo ""
echo "[6] DNS qrok.app"
dns=$(dig +short qrok.app A @8.8.8.8 2>&1 || echo "")
if echo "$dns" | grep -qE "^[0-9]+\."; then
  ok "qrok.app A 레코드: $(echo "$dns" | head -1)"
else
  fail "qrok.app DNS" "no A record at 8.8.8.8"
fi
ns=$(dig +short qrok.app NS @8.8.8.8 2>&1 || echo "")
if echo "$ns" | grep -q "vercel-dns"; then
  ok "qrok.app nameserver = vercel-dns"
else
  fail "qrok.app NS" "expected vercel-dns, got: $ns"
fi

# ── 7. Supabase Auth config (PAT 필요) ────────────────
echo ""
echo "[7] Supabase Auth"
PAT_FILE="$HOME/.qrok-sb-pat"
if [ -f "$PAT_FILE" ]; then
  PAT=$(tr -d '\n' < "$PAT_FILE")
  cfg=$(curl -sS --max-time 8 -H "Authorization: Bearer $PAT" \
    "https://api.supabase.com/v1/projects/uvaosxhsjscigheyymus/config/auth" 2>/dev/null)
  if echo "$cfg" | grep -q '"site_url":"https://qrok.app"'; then
    ok "site_url = https://qrok.app"
  else
    fail "site_url" "$(echo "$cfg" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("site_url"))' 2>/dev/null || echo 'parse err')"
  fi
  if echo "$cfg" | grep -q "qrok.app/\*\*"; then
    ok "uri_allow_list 에 qrok.app/** 포함"
  else
    fail "uri_allow_list qrok.app/**" "missing"
  fi
  if echo "$cfg" | grep -q "stay-hard-rouge.vercel.app"; then
    ok "uri_allow_list 에 stay-hard-rouge 회귀 안전망"
  else
    fail "uri_allow_list stay-hard-rouge" "missing"
  fi
  # delete_my_account RPC 존재 확인
  rpc=$(echo "SELECT routine_name FROM information_schema.routines WHERE routine_schema='public' AND routine_name='delete_my_account';" \
    | "$(dirname "$0")/sb-sql.sh" 2>/dev/null)
  if echo "$rpc" | grep -q "delete_my_account"; then
    ok "RPC delete_my_account 존재 (계정삭제 P0)"
  else
    fail "RPC delete_my_account" "not found"
  fi
else
  echo "SKIP  ~/.qrok-sb-pat 없음 — Supabase 검증 건너뜀"
fi

# ── 8. Local files (sanity) ────────────────────────────
echo ""
echo "[8] 로컬 파일 sanity"
if [ -f "/Users/KWAN/StayHard/capacitor.config.json" ]; then
  if grep -q '"appId": *"com.qrok.app"' /Users/KWAN/StayHard/capacitor.config.json; then
    ok "capacitor.config.json appId = com.qrok.app"
  else
    fail "capacitor.config.json" "appId not com.qrok.app"
  fi
fi
if [ -f "/Users/KWAN/StayHard/package.json" ]; then
  if grep -q '"name": *"qrok"' /Users/KWAN/StayHard/package.json; then
    ok "package.json name = qrok"
  else
    fail "package.json name" "not 'qrok'"
  fi
fi

# ── 결과 ──────────────────────────────────────────────
echo ""
echo "=================================================="
echo " RESULT: $PASS_CNT/$TOTAL PASS · $FAIL_CNT FAIL"
echo "=================================================="
if [ "$FAIL_CNT" -gt 0 ]; then exit 1; else exit 0; fi

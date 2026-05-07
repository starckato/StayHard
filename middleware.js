// middleware.js — Vercel Edge Middleware
// (1) Supabase config 를 환경변수에서 HTML 응답에 주입
// (2) 보안 헤더 (CSP / HSTS / X-Frame-Options 등) 적용

export const config = { matcher: '/' };

// CSP 안의 외부 origin — 추가/수정 시 여기 한 곳만.
const CSP = [
  "default-src 'self'",
  // 'unsafe-inline' 은 임시 — index.html 의 16,000줄 inline script 가 외부로 빠지면 제거 가능.
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  // Supabase API + Realtime + Storage signed URLs.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.supabase.com",
  "media-src 'self' blob: https:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const SECURITY_HEADERS = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(self), microphone=(self), geolocation=()',
  'content-security-policy': CSP,
};

export default async function middleware(request) {
  const url = request.nextUrl || new URL(request.url);

  // Only inject on the main page
  if (url.pathname !== '/' && !url.pathname.endsWith('.html')) {
    return;
  }

  const response = await fetch(request);
  const html = await response.text();

  // env var 를 *JSON-escape* 후 주입 — ` " ` 나 `</script>` 가 들어와도 안전.
  // (이전: "${process.env.SB_KEY}" 직접 interpolation 시 XSS / script breakout 가능했음.)
  const sbUrl = JSON.stringify(process.env.SB_URL || '');
  const sbKey = JSON.stringify(process.env.SB_KEY || '');
  const configScript = `<script>
window.__SB_CONFIG = {
  url: ${sbUrl},
  key: ${sbKey}
};
</script>`;

  const modified = html.replace('</head>', configScript + '</head>');

  return new Response(modified, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...SECURITY_HEADERS,
    },
  });
}

// middleware.js — Vercel Edge Middleware
// Injects Supabase config from environment variables into the HTML response
// This way credentials NEVER appear in your source code or git history

export const config = { matcher: '/' };

export default async function middleware(request) {
  const url = request.nextUrl || new URL(request.url);

  // Only inject on the main page
  if (url.pathname !== '/' && !url.pathname.endsWith('.html')) {
    return;
  }

  const response = await fetch(request);
  const html = await response.text();

  // Inject the config script right before </head>
  const configScript = `<script>
window.__SB_CONFIG = {
  url: "${process.env.SB_URL || ''}",
  key: "${process.env.SB_KEY || ''}"
};
</script>`;

  const modified = html.replace('</head>', configScript + '</head>');

  return new Response(modified, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

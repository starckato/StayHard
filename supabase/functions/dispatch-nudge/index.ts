// QROK · dispatch-nudge Edge Function
//
// Invoked when a new row is inserted into `public.nudges` (via SQL trigger
// using pg_net, OR via Supabase Dashboard → Database Webhooks).
//
// Payload: { nudge_id, sender_id, recipient_id, preset_id }
//
// Behavior:
//   1. Fetch sender display_name + preset body (whitelist validated)
//   2. Fetch recipient push_tokens (native iOS/Android only)
//   3. Send FCM push for Android tokens
//   4. Send APNs push for iOS tokens
//   5. Prune stale tokens on 404/410 (InvalidToken)
//
// Secrets required (supabase secrets set):
//   SUPABASE_URL                — auto-injected
//   SUPABASE_SERVICE_ROLE_KEY   — auto-injected
//   FCM_SERVICE_ACCOUNT_JSON    — Firebase service account JSON (stringified)
//   APNS_TEAM_ID                — 10-char Apple team id
//   APNS_KEY_ID                 — 10-char APNs auth key id
//   APNS_AUTH_KEY               — .p8 contents (multi-line ok)
//   APNS_BUNDLE_ID              — e.g. com.qrok.app
//   APNS_ENV                    — "production" | "sandbox" (default: production)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// ── Preset bodies (must mirror migrations/017_nudges.sql whitelist +
//    src/features/friends/presets.js) ────────────────────────────
const PRESET_BODY: Record<string, string> = {
  move_today:   '오늘 움직였나.',
  streak_alive: '스트릭, 아직 살아있나.',
  routine_check:'루틴 체크했나.',
  sleep_check:  '어제 몇 시에 잤지.',
  back_up:      '쉬었으면 이제 일어나.',
  no_excuse:    '핑계 없음.',
  half_done:    '반만 해도 한 거다. 시작해.',
  one_rep:      '한 세트라도.',
  cold_shower:  '찬물. 지금.',
  step_out:     '밖으로 5분.',
  log_it:       '기록은 남겼나.',
  no_retreat:   '물러서지 마.',
};

interface NudgePayload {
  nudge_id: string;
  sender_id: string;
  recipient_id: string;
  preset_id: string;
}

// ── Handler ───────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 });

  let payload: NudgePayload;
  try {
    const raw = await req.json();
    // Database webhook wraps the row in {type:'INSERT', record:{...}}; also
    // accept direct {nudge_id, sender_id, recipient_id, preset_id}.
    if (raw?.record) {
      payload = {
        nudge_id:     raw.record.id,
        sender_id:    raw.record.sender_id,
        recipient_id: raw.record.recipient_id,
        preset_id:    raw.record.preset_id,
      };
    } else {
      payload = raw;
    }
  } catch {
    return new Response('bad_json', { status: 400 });
  }

  const body = PRESET_BODY[payload.preset_id];
  if (!body) return new Response('bad_preset', { status: 400 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Sender display_name (for notification title)
  const { data: sender } = await supabase
    .from('profiles')
    .select('display_name, username')
    .eq('id', payload.sender_id)
    .maybeSingle();
  const title = sender?.display_name || sender?.username || '친구';

  // Recipient tokens
  const { data: tokens } = await supabase
    .from('push_tokens')
    .select('token, platform')
    .eq('user_id', payload.recipient_id);

  if (!tokens || tokens.length === 0) {
    return new Response(JSON.stringify({ ok: true, delivered: 0, reason: 'no_tokens' }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const staleTokens: string[] = [];
  const deliveries = await Promise.allSettled(
    tokens.map(async (t: { token: string; platform: string }) => {
      try {
        if (t.platform === 'android') {
          return await sendFCM(t.token, title, body, payload, staleTokens);
        } else if (t.platform === 'ios') {
          return await sendAPNs(t.token, title, body, payload, staleTokens);
        }
        return { skipped: true };
      } catch (e) {
        console.warn('[dispatch-nudge]', t.platform, String(e));
        return { error: String(e) };
      }
    }),
  );

  // Prune stale tokens
  if (staleTokens.length > 0) {
    await supabase.from('push_tokens').delete().in('token', staleTokens);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      attempted: tokens.length,
      pruned: staleTokens.length,
      deliveries: deliveries.map((d) => (d.status === 'fulfilled' ? d.value : { error: d.reason })),
    }),
    { headers: { 'content-type': 'application/json' } },
  );
});

// ── FCM (Android) via HTTP v1 ──────────────────────────────────
// Uses service account JSON to sign a JWT → exchange for OAuth access token.
async function sendFCM(
  token: string,
  title: string,
  body: string,
  payload: NudgePayload,
  staleTokens: string[],
) {
  const saRaw = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON');
  if (!saRaw) return { skipped: 'fcm_not_configured' };

  const sa = JSON.parse(saRaw);
  const accessToken = await getFcmAccessToken(sa);

  const fcmUrl = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  const res = await fetch(fcmUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data: {
          nudge_id: payload.nudge_id,
          sender_id: payload.sender_id,
          preset_id: payload.preset_id,
          // Click action: deep-link to friends tab
          click_action: 'friends',
        },
        android: { priority: 'HIGH', notification: { channel_id: 'nudges' } },
      },
    }),
  });

  if (res.status === 404 || res.status === 410) {
    staleTokens.push(token);
    return { platform: 'android', status: res.status, stale: true };
  }
  const text = await res.text();
  return { platform: 'android', status: res.status, body: text.slice(0, 200) };
}

// Cache FCM access token across invocations (cold start re-fetches).
let _fcmTokenCache: { token: string; exp: number } | null = null;

async function getFcmAccessToken(sa: {
  client_email: string;
  private_key: string;
  token_uri?: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (_fcmTokenCache && _fcmTokenCache.exp > now + 60) return _fcmTokenCache.token;

  const jwtHeader = { alg: 'RS256', typ: 'JWT' };
  const jwtClaims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const b64url = (obj: unknown) =>
    btoa(typeof obj === 'string' ? obj : JSON.stringify(obj))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const signingInput = `${b64url(jwtHeader)}.${b64url(jwtClaims)}`;

  // Import PEM private key
  const pem = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binaryDer = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    binaryDer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signingInput}.${sigB64}`;

  const tokenRes = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenJson.access_token) {
    throw new Error('fcm_token_exchange_failed: ' + JSON.stringify(tokenJson));
  }
  _fcmTokenCache = {
    token: tokenJson.access_token,
    exp: now + (tokenJson.expires_in || 3600),
  };
  return tokenJson.access_token;
}

// ── APNs (iOS) via HTTP/2 + JWT auth ───────────────────────────
async function sendAPNs(
  token: string,
  title: string,
  body: string,
  payload: NudgePayload,
  staleTokens: string[],
) {
  const teamId   = Deno.env.get('APNS_TEAM_ID');
  const keyId    = Deno.env.get('APNS_KEY_ID');
  const authKey  = Deno.env.get('APNS_AUTH_KEY');
  const bundleId = Deno.env.get('APNS_BUNDLE_ID');
  const apnsEnv  = Deno.env.get('APNS_ENV') || 'production';

  if (!teamId || !keyId || !authKey || !bundleId) {
    return { skipped: 'apns_not_configured' };
  }

  const jwt = await buildApnsJwt(teamId, keyId, authKey);
  const host = apnsEnv === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
  const url  = `https://${host}/3/device/${token}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
    },
    body: JSON.stringify({
      aps: {
        alert: { title, body },
        sound: 'default',
        'thread-id': 'nudges',
      },
      nudge_id:  payload.nudge_id,
      sender_id: payload.sender_id,
      preset_id: payload.preset_id,
    }),
  });

  if (res.status === 400 || res.status === 410) {
    const txt = await res.text();
    if (txt.includes('BadDeviceToken') || txt.includes('Unregistered')) {
      staleTokens.push(token);
      return { platform: 'ios', status: res.status, stale: true };
    }
    return { platform: 'ios', status: res.status, body: txt.slice(0, 200) };
  }
  return { platform: 'ios', status: res.status };
}

let _apnsJwtCache: { token: string; exp: number } | null = null;

async function buildApnsJwt(teamId: string, keyId: string, authKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // APNs JWTs must be refreshed every 20–60 min. Cache ~45 min.
  if (_apnsJwtCache && _apnsJwtCache.exp > now + 60) return _apnsJwtCache.token;

  const header = { alg: 'ES256', kid: keyId };
  const claims = { iss: teamId, iat: now };
  const b64url = (obj: unknown) =>
    btoa(typeof obj === 'string' ? obj : JSON.stringify(obj))
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signingInput = `${b64url(header)}.${b64url(claims)}`;

  const pem = authKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binaryDer = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8', binaryDer, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'],
  );
  const sigBuf = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, key,
    new TextEncoder().encode(signingInput),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = `${signingInput}.${sigB64}`;
  _apnsJwtCache = { token: jwt, exp: now + 2700 }; // 45 min
  return jwt;
}

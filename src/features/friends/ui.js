// Stay Hard · friends/ui
//
// DOM rendering for the friends sub-tab. Uses vanilla DOM (no framework) to
// match the rest of index.html. All copy in Korean per VOICE_POLICY:
//   - Buttons / labels: Chrome register (명사).
//   - Error toasts: System register (해요체).
//   - Nudge bodies: Manifesto register (해라체, preset-driven).

import * as api from './api.js';
import * as nudgeApi from './nudge.js';
import { NUDGE_PRESETS, presetBody, presetSubtitle } from './presets.js';

let _rootEl = null;

/**
 * Initial mount into a container element. Safe to call multiple times — will
 * re-render in place.
 * @param {HTMLElement} root
 */
export async function mount(root) {
  _rootEl = root;
  root.innerHTML = _skeletonHTML();
  bindHeaderActions();
  await refresh();
}

/** Re-fetch + re-render. */
export async function refresh() {
  if (!_rootEl) return;
  const [code, incoming, friends, inbox] = await Promise.all([
    api.getMyFriendCode(),
    api.listIncomingRequests(),
    api.listFriends(),
    nudgeApi.listInbox({ limit: 30 }),
  ]);
  setMyCode(code);
  renderIncoming(incoming);
  renderInbox(inbox);
  renderFriendList(friends);
}

/**
 * Push a single new incoming nudge into the inbox without full re-fetch.
 * Called by realtime subscription in index.js.
 * @param {Object} nudge — { id, sender_id, sender_display_name?, sender_username?, preset_id, read_at, created_at }
 */
export async function injectNewNudge(nudge) {
  if (!_rootEl || !nudge) return;
  // Realtime event doesn't come with JOIN'd sender profile — re-fetch inbox
  // instead of trying to synthesize the row client-side.
  const inbox = await nudgeApi.listInbox({ limit: 30 });
  renderInbox(inbox);
}

function _skeletonHTML() {
  return `
    <div class="fr-wrap">
      <section class="fr-mycode" id="fr-mycode">
        <div class="fr-mycode-label">내 친구 코드</div>
        <div class="fr-mycode-row">
          <code class="fr-mycode-value" id="fr-code-value">········</code>
          <button class="fr-btn-ghost" id="fr-copy-btn" type="button">복사</button>
          <button class="fr-btn-ghost" id="fr-share-btn" type="button">공유</button>
          <button class="fr-btn-ghost" id="fr-rotate-btn" type="button" title="코드 재발급">재발급</button>
        </div>
        <div class="fr-mycode-hint">코드 또는 초대 링크로 친구 추가.</div>
      </section>

      <section class="fr-addbox">
        <label class="fr-addbox-label" for="fr-add-input">코드로 친구 추가</label>
        <div class="fr-addbox-row">
          <input class="fr-addbox-input" id="fr-add-input" type="text" maxlength="10"
            placeholder="XXXXXXXX" autocapitalize="characters" autocomplete="off" spellcheck="false">
          <button class="fr-btn" id="fr-add-btn" type="button">추가</button>
        </div>
        <div class="fr-addbox-msg" id="fr-add-msg"></div>
      </section>

      <section class="fr-section" id="fr-incoming-section" hidden>
        <div class="fr-section-head">
          <div class="fr-section-title">받은 요청</div>
          <div class="fr-section-count" id="fr-incoming-count">0</div>
        </div>
        <div class="fr-list" id="fr-incoming-list"></div>
      </section>

      <section class="fr-section" id="fr-inbox-section" hidden>
        <div class="fr-section-head">
          <div class="fr-section-title">받은 Nudge</div>
          <div class="fr-section-head-right">
            <button class="fr-link-btn" id="fr-inbox-toggle" type="button" data-mode="unread">전체 보기</button>
            <div class="fr-section-count" id="fr-inbox-count">0</div>
          </div>
        </div>
        <div class="fr-list" id="fr-inbox-list"></div>
      </section>

      <section class="fr-section">
        <div class="fr-section-head">
          <div class="fr-section-title">친구</div>
          <div class="fr-section-count" id="fr-friends-count">0</div>
        </div>
        <div class="fr-list" id="fr-friends-list"></div>
      </section>
    </div>
  `;
}

function bindHeaderActions() {
  const copyBtn = document.getElementById('fr-copy-btn');
  const rotateBtn = document.getElementById('fr-rotate-btn');
  const addBtn = document.getElementById('fr-add-btn');
  const addInput = document.getElementById('fr-add-input');

  copyBtn?.addEventListener('click', async () => {
    const code = document.getElementById('fr-code-value')?.textContent?.trim();
    if (!code || code === '········') return;
    try {
      await navigator.clipboard.writeText(code);
      toast('코드 복사됨.');
    } catch {
      toast('복사 실패.');
    }
  });

  // Share Sheet — deeplink 기반 초대 링크 공유
  const shareBtn = document.getElementById('fr-share-btn');
  shareBtn?.addEventListener('click', async () => {
    const code = document.getElementById('fr-code-value')?.textContent?.trim();
    if (!code || code === '········') return;
    const url = (window.sh && window.sh.deeplink && window.sh.deeplink.buildInviteUrl)
      ? window.sh.deeplink.buildInviteUrl(code)
      : `${location.origin}/add/${code}`;
    const text = `큐록 초대 · 내 코드 ${code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: '큐록 초대', text, url });
        try { if (window.logEvent && window.EVT) window.logEvent(window.EVT.FRIEND_CODE_SHARED, { via: 'native_share' }); } catch {}
      } else {
        await navigator.clipboard.writeText(url);
        toast('초대 링크 복사됨.');
        try { if (window.logEvent && window.EVT) window.logEvent(window.EVT.FRIEND_CODE_SHARED, { via: 'clipboard' }); } catch {}
      }
    } catch (e) {
      console.warn('[friends] share', e);
    }
  });

  rotateBtn?.addEventListener('click', async () => {
    if (!confirm('친구 코드를 새로 발급할까요? 이전 코드는 더 이상 쓸 수 없어요.')) return;
    const next = await api.rotateMyFriendCode();
    if (next) {
      setMyCode(next);
      toast('코드 재발급됨.');
    } else {
      toast('재발급 실패.');
    }
  });

  addInput?.addEventListener('input', () => {
    // Normalize: strip whitespace/hyphens, uppercase.
    addInput.value = addInput.value.replace(/[\s-]/g, '').toUpperCase().slice(0, 8);
  });

  addBtn?.addEventListener('click', async () => {
    const code = (addInput?.value || '').trim();
    const msgEl = document.getElementById('fr-add-msg');
    if (code.length !== 8) { if (msgEl) msgEl.textContent = '8글자 코드를 입력해 주세요.'; return; }
    addBtn.disabled = true;
    const res = await api.sendFriendRequestByCode(code);
    addBtn.disabled = false;
    if (res.ok) {
      addInput.value = '';
      if (msgEl) msgEl.textContent = '';
      if (res.auto_accepted) {
        toast('친구 수락 완료.');
      } else {
        toast('친구 요청 보냄.');
      }
      await refresh();
    } else {
      const copy = api.FRIEND_ERROR_COPY[res.error] || '오류가 났어요.';
      if (msgEl) msgEl.textContent = copy;
    }
  });
}

function setMyCode(code) {
  const el = document.getElementById('fr-code-value');
  if (!el) return;
  el.textContent = code || '········';
}

function renderIncoming(rows) {
  const wrap = document.getElementById('fr-incoming-section');
  const list = document.getElementById('fr-incoming-list');
  const count = document.getElementById('fr-incoming-count');
  if (!wrap || !list || !count) return;
  if (!rows || rows.length === 0) { wrap.hidden = true; list.innerHTML = ''; return; }
  wrap.hidden = false;
  count.textContent = String(rows.length);
  list.innerHTML = rows.map(r => _incomingRowHTML(r)).join('');
  list.querySelectorAll('[data-accept]').forEach(btn => {
    btn.addEventListener('click', () => handleRespond(btn.getAttribute('data-accept'), true));
  });
  list.querySelectorAll('[data-reject]').forEach(btn => {
    btn.addEventListener('click', () => handleRespond(btn.getAttribute('data-reject'), false));
  });
}

function _incomingRowHTML(r) {
  const name = escapeHTML(r.requester_display_name || r.requester_username || '이름 없음');
  const tier = escapeHTML(tierLabel(r.requester_tier));
  return `
    <div class="fr-incoming-row">
      <div class="fr-incoming-main">
        <div class="fr-row-name">${name}</div>
        <div class="fr-row-sub">${tier}</div>
      </div>
      <div class="fr-incoming-actions">
        <button class="fr-btn-small" data-reject="${r.id}" type="button">거절</button>
        <button class="fr-btn-small fr-btn-accept" data-accept="${r.id}" type="button">수락</button>
      </div>
    </div>
  `;
}

// ── Nudge inbox ────────────────────────────────────────────────
let _inboxCache = [];
let _inboxMode = 'unread'; // 'unread' | 'all'

function renderInbox(rows) {
  _inboxCache = Array.isArray(rows) ? rows.slice() : [];
  const section = document.getElementById('fr-inbox-section');
  const list    = document.getElementById('fr-inbox-list');
  const count   = document.getElementById('fr-inbox-count');
  const toggle  = document.getElementById('fr-inbox-toggle');
  if (!section || !list || !count) return;

  // Bind toggle once.
  if (toggle && !toggle.dataset.bound) {
    toggle.dataset.bound = '1';
    toggle.addEventListener('click', () => {
      _inboxMode = _inboxMode === 'unread' ? 'all' : 'unread';
      toggle.dataset.mode = _inboxMode;
      toggle.textContent = _inboxMode === 'unread' ? '전체 보기' : '안 읽은 것만';
      _paintInbox();
    });
  }

  if (_inboxCache.length === 0) { section.hidden = true; list.innerHTML = ''; count.textContent = '0'; return; }
  section.hidden = false;
  _paintInbox();
}

function _paintInbox() {
  const list  = document.getElementById('fr-inbox-list');
  const count = document.getElementById('fr-inbox-count');
  if (!list || !count) return;

  const rows = _inboxMode === 'unread'
    ? _inboxCache.filter(r => !r.read_at)
    : _inboxCache;
  const unread = _inboxCache.filter(r => !r.read_at).length;
  count.textContent = String(unread);

  if (rows.length === 0) {
    list.innerHTML = `<div class="fr-inbox-empty">${_inboxMode === 'unread' ? '안 읽은 nudge 없음.' : 'nudge 받은 기록 없음.'}</div>`;
    return;
  }
  list.innerHTML = rows.map(r => _inboxRowHTML(r)).join('');

  list.querySelectorAll('[data-reply]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fid  = btn.getAttribute('data-reply');
      const name = btn.getAttribute('data-name') || '';
      openNudgeSheet(fid, name);
    });
  });
  list.querySelectorAll('.fr-inbox-row[data-unread="1"]').forEach(row => {
    const id = row.getAttribute('data-id');
    row.addEventListener('click', () => _markOneRead(id, row));
  });
}

function _inboxRowHTML(n) {
  const name = escapeHTML(n.sender_display_name || n.sender_username || '이름 없음');
  const body = escapeHTML(presetBody(n.preset_id));
  const time = _timeAgo(n.created_at);
  const unread = !n.read_at;
  return `
    <div class="fr-inbox-row ${unread ? 'unread' : ''}" data-unread="${unread ? '1' : '0'}" data-id="${n.id}">
      <div class="fr-inbox-dot ${unread ? 'on' : 'off'}"></div>
      <div class="fr-inbox-main">
        <div class="fr-inbox-body">${body}</div>
        <div class="fr-inbox-meta">${name} · ${time}</div>
      </div>
      <button class="fr-btn-small" data-reply="${n.sender_id}" data-name="${name}" type="button">응답</button>
    </div>
  `;
}

async function _markOneRead(id, rowEl) {
  if (!id) return;
  // Optimistic UI: flip style immediately.
  if (rowEl) {
    rowEl.classList.remove('unread');
    rowEl.setAttribute('data-unread', '0');
    const dot = rowEl.querySelector('.fr-inbox-dot'); if (dot) { dot.classList.remove('on'); dot.classList.add('off'); }
  }
  const cached = _inboxCache.find(r => r.id === id);
  if (cached) cached.read_at = new Date().toISOString();
  // Re-paint count (inbox filter may shift in unread-only mode).
  const unread = _inboxCache.filter(r => !r.read_at).length;
  const count = document.getElementById('fr-inbox-count');
  if (count) count.textContent = String(unread);
  // Fire-and-forget server write.
  nudgeApi.markRead([id]).catch(() => {});
}

// Time-ago: 방금 / N분 전 / N시간 전 / N일 전.
function _timeAgo(iso) {
  const t = new Date(iso).getTime();
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 45)           return '방금';
  if (s < 60 * 60)      return `${Math.floor(s / 60)}분 전`;
  if (s < 60 * 60 * 24) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}

async function handleRespond(id, accept) {
  if (!id) return;
  const res = await api.respondFriendRequest(id, accept);
  if (res.ok) {
    toast(accept ? '친구 수락됨.' : '요청 거절됨.');
    await refresh();
  } else {
    toast(api.FRIEND_ERROR_COPY[res.error] || '처리 실패.');
  }
}

function renderFriendList(friends) {
  const list = document.getElementById('fr-friends-list');
  const count = document.getElementById('fr-friends-count');
  if (!list || !count) return;
  count.textContent = String(friends?.length || 0);
  if (!friends || friends.length === 0) {
    list.innerHTML = `
      <div class="fr-empty">
        <div class="fr-empty-title">친구 없음.</div>
        <div class="fr-empty-body">위 코드를 친구한테 주거나, 친구 코드 받아서 추가해.</div>
      </div>
    `;
    return;
  }
  list.innerHTML = friends.map(f => _friendRowHTML(f)).join('');
  list.querySelectorAll('[data-nudge]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fid = btn.getAttribute('data-nudge');
      const name = btn.getAttribute('data-name') || '';
      openNudgeSheet(fid, name);
    });
  });
  list.querySelectorAll('[data-unfriend]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const fid = btn.getAttribute('data-unfriend');
      const name = btn.getAttribute('data-name') || '친구';
      if (!confirm(`${name} 친구 해제할까요? 되돌릴 수 없어요.`)) return;
      const res = await api.unfriend(fid);
      if (res.ok) { toast('친구 해제됨.'); await refresh(); }
      else toast(api.FRIEND_ERROR_COPY[res.error] || '해제 실패.');
    });
  });
}

function _friendRowHTML(f) {
  const name = escapeHTML(f.display_name || f.username || '이름 없음');
  const tier = escapeHTML(tierLabel(f.tier));
  const streak = Number(f.streak) || 0;
  const moved = !!f.moved_today;
  return `
    <div class="fr-friend-row">
      <div class="fr-dot ${moved ? 'on' : 'off'}" title="${moved ? '오늘 움직임' : '아직'}"></div>
      <div class="fr-friend-main">
        <div class="fr-row-name">${name}</div>
        <div class="fr-row-sub">${tier} · 연속 ${streak}일</div>
      </div>
      <button class="fr-btn-small" data-nudge="${f.friend_id}" data-name="${name}" type="button">nudge</button>
      <button class="fr-btn-icon" data-unfriend="${f.friend_id}" data-name="${name}" type="button" title="친구 해제">⋯</button>
    </div>
  `;
}

// ── Nudge bottom sheet ─────────────────────────────────────────
let _sheetEl = null;

function openNudgeSheet(friendId, friendName) {
  closeNudgeSheet();
  const sheet = document.createElement('div');
  sheet.className = 'fr-nudge-sheet-overlay';
  sheet.innerHTML = `
    <div class="fr-nudge-sheet">
      <div class="fr-nudge-head">
        <div class="fr-nudge-title">${escapeHTML(friendName)}에게 nudge</div>
        <button class="fr-btn-icon" id="fr-nudge-close" type="button">✕</button>
      </div>
      <div class="fr-nudge-list">
        ${NUDGE_PRESETS.map(p => `
          <button class="fr-nudge-item" data-preset="${p.id}" type="button">
            <div class="fr-nudge-body">${escapeHTML(p.body)}</div>
            <div class="fr-nudge-sub">${escapeHTML(p.subtitle)}</div>
          </button>
        `).join('')}
      </div>
      <div class="fr-nudge-foot">같은 친구에게 하루 1회, 전체 하루 5회.</div>
    </div>
  `;
  document.body.appendChild(sheet);
  _sheetEl = sheet;
  requestAnimationFrame(() => sheet.classList.add('on'));

  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) closeNudgeSheet();
  });
  sheet.querySelector('#fr-nudge-close')?.addEventListener('click', closeNudgeSheet);
  sheet.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const presetId = btn.getAttribute('data-preset');
      btn.disabled = true;
      const res = await nudgeApi.sendNudge(friendId, presetId);
      btn.disabled = false;
      if (res.ok) {
        closeNudgeSheet();
        toast('보냈음.');
      } else {
        const copy = nudgeApi.NUDGE_ERROR_COPY[res.error] || '전송 실패.';
        toast(copy);
      }
    });
  });
}

function closeNudgeSheet() {
  if (!_sheetEl) return;
  _sheetEl.classList.remove('on');
  const el = _sheetEl;
  _sheetEl = null;
  setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
}

// ── Helpers ────────────────────────────────────────────────────
function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// Tier label override — map DB placeholder `_tier6` to something user-facing.
// Final label pending rebrand decision (AGENT_COORDINATION.md 2026-04-24).
// Keep neutral placeholder here; change in ONE place when rebrand locks in.
function tierLabel(dbLabel) {
  if (dbLabel === '_tier6') return '극한';
  return dbLabel || '';
}

function toast(msg) {
  // Reuse global showToast if available, else fall back to console.
  if (typeof window.showToast === 'function') { window.showToast(msg); return; }
  console.log('[friends]', msg);
}

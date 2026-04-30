// QROK · sprite sheet 기반 캐릭터 애니메이션
// Build: 20260501-tier-sheets-6f
//
// 모든 sheet : 2172×724 (6 frames × 362×724, 가로 6프레임 portrait).
// per-tier 5 actions: idle / walk / exercise / food / special.
// tier.js TIER_ASSETS 에 sheet URL 정의됨.
//
// API (window):
//   initMiniChar(color)          — char-mini-canvas (홈 카드 미니) idle 애니
//   startRoomScene()             — room-canvas (room-overlay) 행동 사이클
//   stopRoomScene()              — room scene RAF 중지

(function(){
  'use strict';

  const SHEET_FW = 362;
  const SHEET_FH = 724;
  const SHEET_FRAMES = 6;

  // tier idx → loaded sheet Image cache
  const _sheetCache = {};

  function _resolveTierIdx(score){
    const TIERS = window.TIERS;
    if(!TIERS) return 0;
    const tier = window.getTier ? window.getTier(score||0) : TIERS[0];
    const idx = TIERS.indexOf(tier);
    return idx < 0 ? 0 : idx;
  }

  function _currentTierIdx(){
    const score = (window.CP && +window.CP.total_score) || 0;
    return _resolveTierIdx(score);
  }

  function _loadTierSheets(tierIdx){
    if(_sheetCache[tierIdx]) return _sheetCache[tierIdx];
    const TIER_ASSETS = window.TIER_ASSETS;
    if(!TIER_ASSETS || !TIER_ASSETS[tierIdx]) return null;
    const cfg = TIER_ASSETS[tierIdx];
    const sheets = (cfg && cfg.sheets) || {};
    const cache = { _loaded: 0, _total: 0 };
    ['idle','walk','exercise','food','special'].forEach(act => {
      const url = sheets[act];
      if(!url) return;
      cache._total++;
      const img = new Image();
      img.onload = () => { cache._loaded++; };
      img.onerror = () => { cache._loaded++; };
      img.src = url;
      cache[act] = img;
    });
    _sheetCache[tierIdx] = cache;
    return cache;
  }

  function _drawFrame(ctx, img, frameIdx, dx, dy, dw, dh){
    if(!img || !img.complete || !img.naturalWidth) return;
    // 1px inset — sub-pixel sampling 으로 인한 인접 frame bleed 방지
    const sx = (frameIdx % SHEET_FRAMES) * SHEET_FW + 1;
    const sw = SHEET_FW - 2;
    ctx.drawImage(img, sx, 0, sw, SHEET_FH, dx, dy, dw, dh);
  }

  // ─────────────────────────────────────────────
  // MINI CHAR — char-mini-canvas (44×52)
  // ─────────────────────────────────────────────
  let _miniRaf = null;
  let _miniFi = 0;
  let _miniLastT = 0;
  let _miniGlow = '#888';
  let _miniBoundTier = -1;
  const MINI_FPS_MS = 380;

  window.initMiniChar = function(color){
    _miniGlow = color || '#888';
    const cv = document.getElementById('char-mini-canvas');
    if(!cv) return;
    cv.style.filter = 'drop-shadow(0 0 3px '+_miniGlow+'66)';
    const tierIdx = _currentTierIdx();
    if(tierIdx !== _miniBoundTier){
      _miniBoundTier = tierIdx;
      _loadTierSheets(tierIdx);
      _miniFi = 0;
      _miniLastT = 0;
    }
    if(_miniRaf == null) _startMiniLoop();
  };

  function _startMiniLoop(){
    const cv = document.getElementById('char-mini-canvas');
    if(!cv) return;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = false; // 픽셀 아트 — frame bleed 방지
    const W = cv.width || 44;
    const H = cv.height || 52;
    function loop(now){
      _miniRaf = requestAnimationFrame(loop);
      if(now - _miniLastT < MINI_FPS_MS) return;
      _miniLastT = now;
      _miniFi = (_miniFi + 1) % SHEET_FRAMES;
      const cache = _sheetCache[_miniBoundTier];
      const img = cache && cache.idle;
      if(!img || !img.complete || !img.naturalWidth) return;
      cx.clearRect(0, 0, W, H);
      const scale = Math.min(W / SHEET_FW, H / SHEET_FH);
      const dw = SHEET_FW * scale;
      const dh = SHEET_FH * scale;
      const dx = (W - dw) / 2;
      const dy = (H - dh) / 2;
      _drawFrame(cx, img, _miniFi, dx, dy, dw, dh);
    }
    _miniRaf = requestAnimationFrame(loop);
  }

  // ─────────────────────────────────────────────
  // ROOM SCENE — room-canvas (520×520)
  // ─────────────────────────────────────────────
  const ROOM_W = 520, ROOM_H = 520;
  const ROOM_CHAR_H = 240;
  const ROOM_CHAR_FLOOR_Y = 455; // 룸 floor 근처
  const ROOM_DB = { x: ROOM_W - 150, y: ROOM_H - 215, w: 130, h: 120 };

  const ROOM_FPS = { idle: 380, walk: 160, exercise: 150, food: 200, special: 500 };
  // walk 시간 늘림 — 캐릭터가 방에서 더 오래 돌아다니게
  const ROOM_DUR_MIN = { idle: 8, walk: 28, exercise: 20, food: 12, special: 14 };
  const ROOM_DUR_MAX = { idle: 16, walk: 50, exercise: 30, food: 18, special: 22 };

  let _roomRaf = null;
  let _roomBgImg = null;
  let _roomBgUrl = null;
  let _roomBoundTier = -1;
  let _roomAct = 'idle';
  let _roomFi = 0;
  let _roomLastFt = 0;
  let _roomActLeft = 0;
  let _roomWalkX = ROOM_W * 0.5;
  let _roomWalkDir = 1;
  let _roomFlipH = false;
  let _roomToastTo = null;
  let _exForced = false;

  function _pickNextAct(prev){
    // walk 빈도 ↑ — 캐릭터가 방을 적극적으로 돌아다니게
    const pool = ['walk','walk','walk','walk','idle','food','special'];
    const choices = pool.filter(a => a !== prev);
    return choices[Math.floor(Math.random() * choices.length)];
  }

  function _enterAct(name){
    _roomAct = name;
    _roomFi = 0;
    _roomLastFt = 0;
    const lo = ROOM_DUR_MIN[name] || 12;
    const hi = ROOM_DUR_MAX[name] || 24;
    _roomActLeft = lo + Math.floor(Math.random() * (hi - lo));
    if(name === 'walk'){
      _roomWalkDir = Math.random() < 0.5 ? -1 : 1;
      _roomFlipH = _roomWalkDir < 0;
    }
  }

  function _showRoomToast(msg, dur){
    const el = document.getElementById('room-toast');
    if(!el) return;
    el.textContent = msg;
    el.style.opacity = '1';
    if(_roomToastTo) clearTimeout(_roomToastTo);
    _roomToastTo = setTimeout(() => { el.style.opacity = '0'; }, dur || 2800);
  }

  function _forceExercise(){
    if(_exForced) return;
    _exForced = true;
    _enterAct('exercise');
    _roomActLeft = 28;
    const TIER_ASSETS = window.TIER_ASSETS || {};
    const tierName = (TIER_ASSETS[_roomBoundTier] && TIER_ASSETS[_roomBoundTier].name) || '';
    const msgs = {
      '방관자':'한 손이라도 움직여… 시작이다.',
      '각성자':'벤치에 누웠다. 책임이 시작됐다.',
      '저항자':'스쿼트로 다리부터 찢어라.',
      '수련자':'펀치로 내일을 깬다.',
      '지배자':'콤보로 쏟아라.',
      '기록자':'땅을 내려쳐라. 기록은 남는다.',
    };
    _showRoomToast(msgs[tierName] || '운동 시작.', 3000);
    setTimeout(() => { _exForced = false; }, 5500);
  }

  let _roomCanvasBound = false;
  function _setupRoomCanvas(){
    if(_roomCanvasBound) return;
    const cv = document.getElementById('room-canvas');
    if(!cv) return;
    _roomCanvasBound = true;
    cv.addEventListener('click', e => {
      const r = cv.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (ROOM_W / r.width);
      const my = (e.clientY - r.top) * (ROOM_H / r.height);
      if(mx >= ROOM_DB.x && mx <= ROOM_DB.x + ROOM_DB.w &&
         my >= ROOM_DB.y && my <= ROOM_DB.y + ROOM_DB.h){
        _forceExercise();
      }
    });
    cv.addEventListener('mousemove', e => {
      const r = cv.getBoundingClientRect();
      const mx = (e.clientX - r.left) * (ROOM_W / r.width);
      const my = (e.clientY - r.top) * (ROOM_H / r.height);
      const hover = mx >= ROOM_DB.x && mx <= ROOM_DB.x + ROOM_DB.w &&
                    my >= ROOM_DB.y && my <= ROOM_DB.y + ROOM_DB.h;
      cv.style.cursor = hover ? 'pointer' : 'default';
    });
  }

  function _roomDraw(){
    const cv = document.getElementById('room-canvas');
    if(!cv) return;
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = false;
    cx.clearRect(0, 0, ROOM_W, ROOM_H);
    if(_roomBgImg && _roomBgImg.complete && _roomBgImg.naturalWidth){
      cx.drawImage(_roomBgImg, 0, 0, ROOM_W, ROOM_H);
    } else {
      const grad = cx.createLinearGradient(0, 0, 0, ROOM_H);
      grad.addColorStop(0, '#1a1a22');
      grad.addColorStop(1, '#0d0d12');
      cx.fillStyle = grad;
      cx.fillRect(0, 0, ROOM_W, ROOM_H);
    }
    const cache = _sheetCache[_roomBoundTier];
    if(!cache) return;
    const img = cache[_roomAct] || cache.idle;
    if(!img) return;
    if(_roomAct === 'walk'){
      _roomWalkX += _roomWalkDir * 1.6;
      if(_roomWalkX < ROOM_W * 0.20){ _roomWalkX = ROOM_W * 0.20; _roomWalkDir = 1; _roomFlipH = false; }
      if(_roomWalkX > ROOM_W * 0.80){ _roomWalkX = ROOM_W * 0.80; _roomWalkDir = -1; _roomFlipH = true; }
    }
    const dh = ROOM_CHAR_H;
    const dw = dh * (SHEET_FW / SHEET_FH); // portrait — width=height/2
    const dx = _roomWalkX - dw / 2;
    const dy = ROOM_CHAR_FLOOR_Y - dh;
    if(_roomFlipH){
      cx.save();
      cx.translate(dx + dw, dy);
      cx.scale(-1, 1);
      _drawFrame(cx, img, _roomFi, 0, 0, dw, dh);
      cx.restore();
    } else {
      _drawFrame(cx, img, _roomFi, dx, dy, dw, dh);
    }
    // 덤벨 트리거 영역 — 시각적 hint 없이 hover 시 cursor 만 변화 (룸 그래픽 보호)
  }

  function _roomLoop(now){
    _roomRaf = requestAnimationFrame(_roomLoop);
    const fps = ROOM_FPS[_roomAct] || 250;
    if(now - _roomLastFt >= fps){
      _roomLastFt = now;
      _roomFi = (_roomFi + 1) % SHEET_FRAMES;
      _roomActLeft--;
      if(_roomActLeft <= 0 && !_exForced){
        _enterAct(_pickNextAct(_roomAct));
      }
    }
    _roomDraw();
  }

  window.startRoomScene = function(){
    _setupRoomCanvas();
    const tierIdx = _currentTierIdx();
    if(tierIdx !== _roomBoundTier){
      _roomBoundTier = tierIdx;
      _loadTierSheets(tierIdx);
      const TIER_ASSETS = window.TIER_ASSETS || {};
      const url = TIER_ASSETS[tierIdx] && TIER_ASSETS[tierIdx].room;
      if(url && url !== _roomBgUrl){
        _roomBgUrl = url;
        _roomBgImg = new Image();
        _roomBgImg.src = url;
      }
      _enterAct('idle');
      _roomWalkX = ROOM_W * 0.5;
    }
    if(_roomRaf == null){
      _roomLastFt = 0;
      _roomRaf = requestAnimationFrame(_roomLoop);
    }
  };

  window.stopRoomScene = function(){
    if(_roomRaf != null){ cancelAnimationFrame(_roomRaf); _roomRaf = null; }
  };

})();

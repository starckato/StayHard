// QROK · Pushup Counter Modal — CV 자동 카운트 + 영상 녹화 + 핸드폰 앨범 저장
//
// 픽셀 모션 알고리즘 (rep-counter-test.html 기반 단순화):
//   1. video stream → 매 frame canvas 에 그림
//   2. 이전 frame 과 grayscale diff (1/8 res 다운샘플)
//   3. avg motion delta 가 threshold 초과 시 rep 증가 (peak detection + cooldown)
// 영상: MediaRecorder on video stream → blob → download (앨범 저장)
//
// Usage:
//   window.openPushupCounter({ dailyGoal: 10, onComplete: (reps, videoBlob) => {...} });

let _modalEl = null;
let _state = null;

const CFG = {
  THRESHOLD: 8.0,        // 모션 인식 임계 (조명 따라 조절)
  COOLDOWN_MS: 700,      // rep 사이 최소 간격
  CALIBRATION_MS: 2500,  // 시작 후 무시 (조명 안정화)
  WIDTH: 480,            // capture resolution
  HEIGHT: 360,
  DOWNSAMPLE: 8,         // motion analysis 다운샘플
};

export function openPushupCounter({ dailyGoal = 0, onComplete = null } = {}) {
  if (_modalEl) closePushupCounter();
  _state = {
    reps: 0,
    dailyGoal: +dailyGoal || 0,
    onComplete,
    stream: null,
    video: null,
    motionCanvas: null,
    rafId: null,
    prevFrameData: null,
    lastRepAt: 0,
    startedAt: Date.now(),
    recorder: null,
    recChunks: [],
    cameraReady: false,
    err: null,
  };

  const el = document.createElement('div');
  el.id = 'pushup-counter-modal';
  el.style.cssText = 'position:fixed;inset:0;background:#0a0a0c;z-index:10001;display:flex;flex-direction:column;font-family:DM Sans,sans-serif;';
  el.innerHTML = _renderHTML();
  document.body.appendChild(el);
  _modalEl = el;
  document.body.style.overflow = 'hidden';

  el.querySelector('#pc-close').addEventListener('click', _onClose);
  el.querySelector('#pc-done').addEventListener('click', _confirmComplete);
  el.querySelectorAll('[data-add]').forEach(b => {
    b.addEventListener('click', () => _updateReps(+b.dataset.add));
  });

  _state.video = el.querySelector('#pc-video');
  _state.motionCanvas = el.querySelector('#pc-motion-canvas');

  // 카메라 + 녹화 시작 (비동기 — 권한 prompt 후 stream 활성)
  _startCamera().catch(err => {
    console.warn('[pushup-counter] camera failed', err);
    _state.err = err;
    _showCameraError(err);
  });
}

export function closePushupCounter() {
  if (!_modalEl) return;
  _stopCamera();
  _modalEl.remove();
  _modalEl = null;
  _state = null;
  document.body.style.overflow = '';
}

function _renderHTML() {
  const goalHint = _state.dailyGoal ? `오늘 목표 ${_state.dailyGoal}개` : '';
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;">
      <button id="pc-close" type="button" style="background:none;border:none;color:#a8a8b4;font-size:22px;cursor:pointer;touch-action:manipulation;padding:4px 8px;">←</button>
      <div style="font-size:14px;font-weight:700;color:#eaeaea;">푸쉬업 카운터</div>
      <div id="pc-rec-dot" style="display:none;align-items:center;gap:5px;font-size:11px;color:#ff4d4d;font-weight:700;">
        <span style="width:8px;height:8px;border-radius:50%;background:#ff4d4d;animation:pcPulse 1s ease-in-out infinite;"></span>REC
      </div>
    </div>
    <style>@keyframes pcPulse{0%,100%{opacity:0.5}50%{opacity:1}}</style>
    <div style="position:relative;flex:1;background:#000;overflow:hidden;display:flex;align-items:center;justify-content:center;">
      <video id="pc-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;"></video>
      <canvas id="pc-motion-canvas" width="${CFG.WIDTH}" height="${CFG.HEIGHT}" style="display:none;"></canvas>
      <div id="pc-status" style="position:absolute;top:12px;left:50%;transform:translateX(-50%);padding:6px 12px;background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.15);border-radius:14px;font-size:11px;color:#a8a8b4;letter-spacing:0.04em;">카메라 준비 중...</div>
      <div id="pc-count" style="position:absolute;bottom:80px;left:50%;transform:translateX(-50%);font-size:120px;font-weight:800;font-family:DM Mono,monospace;color:#ffd54a;line-height:1;text-shadow:0 4px 20px rgba(0,0,0,0.85);">0</div>
      <div id="pc-progress" style="position:absolute;bottom:54px;left:50%;transform:translateX(-50%);font-size:13px;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,0.85);font-family:DM Mono,monospace;">${goalHint}</div>
    </div>
    <div style="padding:12px 14px;border-top:1px solid rgba(255,255,255,0.06);background:#0a0a0c;flex-shrink:0;">
      <div style="display:flex;gap:6px;justify-content:center;margin-bottom:10px;">
        <button data-add="-1" type="button" style="width:42px;height:42px;border-radius:21px;background:#1c1c22;border:1px solid rgba(255,255,255,0.12);color:#a8a8b4;font-size:16px;cursor:pointer;font-weight:700;touch-action:manipulation;">−</button>
        <button data-add="1" type="button" style="width:42px;height:42px;border-radius:21px;background:rgba(255,77,77,0.10);border:1px solid rgba(255,77,77,0.30);color:#ff4d4d;font-size:16px;cursor:pointer;font-weight:700;touch-action:manipulation;">+1</button>
        <button data-add="5" type="button" style="padding:0 14px;height:42px;border-radius:21px;background:rgba(255,77,77,0.10);border:1px solid rgba(255,77,77,0.30);color:#ff4d4d;font-size:13px;cursor:pointer;font-weight:700;touch-action:manipulation;">+5</button>
        <button data-add="10" type="button" style="padding:0 14px;height:42px;border-radius:21px;background:rgba(255,77,77,0.10);border:1px solid rgba(255,77,77,0.30);color:#ff4d4d;font-size:13px;cursor:pointer;font-weight:700;touch-action:manipulation;">+10</button>
      </div>
      <button id="pc-done" type="button" style="width:100%;padding:14px;border-radius:14px;background:#ff4d4d;border:none;color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:DM Sans,sans-serif;touch-action:manipulation;">완료</button>
    </div>
  `;
}

async function _startCamera() {
  const constraints = {
    video: { facingMode: { ideal: 'environment' }, width: { ideal: CFG.WIDTH }, height: { ideal: CFG.HEIGHT } },
    audio: false,
  };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (e) {
    // fallback to user-facing camera
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  }
  _state.stream = stream;
  _state.video.srcObject = stream;
  await new Promise(resolve => {
    if (_state.video.readyState >= 2) resolve();
    else _state.video.addEventListener('loadeddata', resolve, { once: true });
  });
  _state.cameraReady = true;
  _state.startedAt = Date.now();
  _setStatus('카메라 안정화 중...');
  setTimeout(() => { if (_state) _setStatus('동작 인식 시작'); }, CFG.CALIBRATION_MS);

  // 녹화 시작
  try {
    const mimeType = _pickMimeType();
    if (mimeType) {
      _state.recorder = new MediaRecorder(stream, { mimeType });
      _state.recorder.ondataavailable = e => { if (e.data?.size > 0) _state.recChunks.push(e.data); };
      _state.recorder.start(1000);
      const dot = _modalEl?.querySelector('#pc-rec-dot');
      if (dot) dot.style.display = 'flex';
    }
  } catch (e) {
    console.warn('[pushup-counter] recorder', e);
  }

  // motion loop 시작
  _motionLoop();
}

function _pickMimeType() {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  }
  return null;
}

function _motionLoop() {
  if (!_state || !_state.cameraReady) return;
  const ctx = _state.motionCanvas.getContext('2d', { willReadFrequently: true });
  const W = CFG.WIDTH, H = CFG.HEIGHT;

  function frame() {
    if (!_state) return;
    try {
      ctx.drawImage(_state.video, 0, 0, W, H);
      const img = ctx.getImageData(0, 0, W, H);
      const data = img.data;
      // grayscale 다운샘플
      const ds = CFG.DOWNSAMPLE;
      const gW = Math.floor(W / ds), gH = Math.floor(H / ds);
      const gray = new Uint8Array(gW * gH);
      for (let y = 0; y < gH; y++) {
        for (let x = 0; x < gW; x++) {
          const i = ((y * ds) * W + (x * ds)) * 4;
          gray[y * gW + x] = (data[i] + data[i + 1] + data[i + 2]) / 3;
        }
      }
      // diff
      let totalDiff = 0;
      if (_state.prevFrameData) {
        const prev = _state.prevFrameData;
        for (let i = 0; i < gray.length; i++) {
          totalDiff += Math.abs(gray[i] - prev[i]);
        }
      }
      _state.prevFrameData = gray;
      const avgDiff = totalDiff / (gW * gH);

      // calibration 끝난 후 + cooldown 지났을 때 rep 검출
      const sinceStart = Date.now() - _state.startedAt;
      const sinceLastRep = Date.now() - _state.lastRepAt;
      if (sinceStart > CFG.CALIBRATION_MS && sinceLastRep > CFG.COOLDOWN_MS && avgDiff > CFG.THRESHOLD) {
        _state.lastRepAt = Date.now();
        _updateReps(+1, true);
      }
    } catch (e) { /* video not ready 등 */ }
    _state.rafId = requestAnimationFrame(frame);
  }
  _state.rafId = requestAnimationFrame(frame);
}

function _updateReps(delta, fromCV) {
  if (!_state) return;
  _state.reps = Math.max(0, _state.reps + Number(delta));
  _renderCount();
  if (fromCV && _modalEl) {
    const cnt = _modalEl.querySelector('#pc-count');
    if (cnt) {
      cnt.style.transform = 'translateX(-50%) scale(1.15)';
      cnt.style.transition = 'transform 120ms ease-out';
      setTimeout(() => { if (cnt) cnt.style.transform = 'translateX(-50%) scale(1)'; }, 140);
    }
  }
}

function _renderCount() {
  if (!_modalEl || !_state) return;
  const cntEl = _modalEl.querySelector('#pc-count');
  if (!cntEl) return;
  cntEl.textContent = _state.reps;
  if (_state.dailyGoal > 0) {
    const pct = Math.min(100, Math.round((_state.reps / _state.dailyGoal) * 100));
    const progEl = _modalEl.querySelector('#pc-progress');
    if (progEl) progEl.textContent = `${_state.reps} / ${_state.dailyGoal} (${pct}%)`;
    cntEl.style.color = pct >= 100 ? '#34d399' : '#ffd54a';
  }
}

function _setStatus(text) {
  if (!_modalEl) return;
  const el = _modalEl.querySelector('#pc-status');
  if (el) el.textContent = text;
}

function _showCameraError(err) {
  if (!_modalEl) return;
  const msg = err?.name === 'NotAllowedError' ? '카메라 권한 거부 — 손가락 ± 로 카운트' :
              err?.name === 'NotFoundError'   ? '카메라 없음 — 손가락 ± 로 카운트' :
              '카메라 시작 실패 — 손가락 ± 로 카운트';
  _setStatus(msg);
}

function _stopCamera() {
  if (!_state) return;
  if (_state.rafId) cancelAnimationFrame(_state.rafId);
  if (_state.recorder && _state.recorder.state !== 'inactive') {
    try { _state.recorder.stop(); } catch (_) {}
  }
  if (_state.stream) {
    try { _state.stream.getTracks().forEach(t => t.stop()); } catch (_) {}
  }
}

function _onClose() {
  if (_state && _state.reps > 0) {
    if (!confirm('카운트가 ' + _state.reps + '개. 저장 안 하고 닫을까요?')) return;
  }
  closePushupCounter();
}

async function _confirmComplete() {
  if (!_state) return;
  if (_state.reps === 0) {
    if (!confirm('카운트가 0이에요. 그래도 종료할까요?')) return;
  }
  const reps = _state.reps;
  const cb = _state.onComplete;
  // recorder stop + blob 수집 + download
  let blob = null;
  if (_state.recorder && _state.recorder.state !== 'inactive') {
    await new Promise(resolve => {
      _state.recorder.onstop = resolve;
      try { _state.recorder.stop(); } catch (_) { resolve(); }
      setTimeout(resolve, 1500); // 안전 fallback
    });
    if (_state.recChunks.length > 0) {
      const mimeType = _state.recorder.mimeType || 'video/webm';
      blob = new Blob(_state.recChunks, { type: mimeType });
    }
  }
  // 핸드폰 앨범 저장 — Web Share with File 우선, 그 외 download fallback
  if (blob) {
    await _saveVideoToAlbum(blob, reps);
  }
  closePushupCounter();
  if (typeof cb === 'function') {
    try { await cb(reps, blob); }
    catch (e) { console.warn('[pushup-counter] onComplete', e); }
  }
}

async function _saveVideoToAlbum(blob, reps) {
  const ext = (blob.type.includes('mp4') ? 'mp4' : 'webm');
  const filename = `qrok-pushup-${reps}-${Date.now()}.${ext}`;
  const file = new File([blob], filename, { type: blob.type });
  // 1) Web Share API with File (iOS 15+ Safari, Android Chrome)
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'QROK 푸쉬업', text: `푸쉬업 ${reps}개` });
      try { (window.showToast || alert)('영상이 앨범에 저장되었습니다.'); } catch (_) {}
      return;
    }
  } catch (e) { /* user cancelled or fail */ }
  // 2) Download fallback
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
    try { (window.showToast || alert)('영상이 다운로드 폴더에 저장되었습니다.'); } catch (_) {}
  } catch (e) {
    console.warn('[pushup-counter] save', e);
  }
}

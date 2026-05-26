// 큐록 Prototype Workspace · selector helper
// 각 prototype HTML 에 자동 로드. iframe 내부에서 부모 workspace 와 postMessage 통신.
// 부모: wks.enableSelect / wks.disableSelect 보냄
// 자식: wks.ready (boot) / wks.selected (click)
(function(){
  if (window === window.parent) return; // 단독 실행 시 동작 X

  let selectMode = false;
  let hoverBox = null;

  function ensureHoverBox(){
    if (hoverBox) return hoverBox;
    hoverBox = document.createElement('div');
    hoverBox.id = '__wks_hover';
    hoverBox.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #ff4d4d;border-radius:3px;z-index:99999;transition:all .08s ease;background:rgba(255,77,77,.06);display:none;box-shadow:0 0 0 9999px rgba(0,0,0,0.18);';
    document.body.appendChild(hoverBox);
    return hoverBox;
  }

  function hideHoverBox(){
    if (hoverBox) hoverBox.style.display = 'none';
  }

  function getSelector(el){
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + el.id;
    const parts = [];
    let cur = el;
    for (let i = 0; i < 4 && cur && cur.nodeName !== 'BODY' && cur.nodeName !== 'HTML'; i++) {
      let s = cur.nodeName.toLowerCase();
      if (cur.classList && cur.classList.length) {
        s += '.' + Array.from(cur.classList).slice(0, 2).join('.');
      }
      parts.unshift(s);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function onHover(e){
    if (!selectMode) return;
    const t = e.target;
    if (!t || t.id === '__wks_hover') return;
    const r = t.getBoundingClientRect();
    const b = ensureHoverBox();
    b.style.display = 'block';
    b.style.left = r.left + 'px';
    b.style.top = r.top + 'px';
    b.style.width = r.width + 'px';
    b.style.height = r.height + 'px';
  }

  function onClick(e){
    if (!selectMode) return;
    e.preventDefault();
    e.stopPropagation();
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    try {
      window.parent.postMessage({
        type: 'wks.selected',
        selector: getSelector(t),
        html: (t.outerHTML || '').slice(0, 500),
        text: (t.textContent || '').trim().slice(0, 200)
      }, '*');
    } catch (err) {}
    selectMode = false;
    document.body.style.cursor = '';
    hideHoverBox();
  }

  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'wks.enableSelect') {
      selectMode = true;
      document.body.style.cursor = 'crosshair';
    } else if (d.type === 'wks.disableSelect') {
      selectMode = false;
      document.body.style.cursor = '';
      hideHoverBox();
    }
  });

  document.addEventListener('mouseover', onHover, true);
  document.addEventListener('mouseout', (e) => {
    if (!selectMode) return;
    // 빠른 hover-out 시 box 빠르게 따라가도록 — 다른 mouseover 가 즉시 옴
  }, true);
  document.addEventListener('click', onClick, true);

  // boot signal
  try {
    window.parent.postMessage({ type: 'wks.ready' }, '*');
  } catch {}
})();

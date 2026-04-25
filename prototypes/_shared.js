// Shared cube fly animation. Each option page provides a settle handler
// that places the cube in option-specific layout after it reaches the character.
(function(){
  window.flyCubeToCharacter = function(originBtn, color, onSettle){
    const oRect = originBtn.getBoundingClientRect();
    const charEl = document.querySelector('.character');
    if(!charEl) return;
    const cRect = charEl.getBoundingClientRect();
    const flyer = document.createElement('div');
    flyer.className = 'flyer cube ' + color;
    flyer.style.cssText = `position:fixed;left:${oRect.left + oRect.width/2 - 12}px;top:${oRect.top + oRect.height/2 - 12}px;width:24px;height:24px;`;
    document.body.appendChild(flyer);
    const dx = cRect.left + cRect.width/2 - (oRect.left + oRect.width/2);
    const dy = cRect.top + cRect.height/2 - (oRect.top + oRect.height/2);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      flyer.style.transform = `translate(${dx}px, ${dy}px) scale(0.6)`;
      flyer.style.opacity = '0';
    }));
    setTimeout(()=>{
      // Character pulse
      charEl.classList.add('eat');
      setTimeout(()=>charEl.classList.remove('eat'), 380);
      // Trigger settle handler
      if(typeof onSettle === 'function') onSettle(color);
      // Remove flyer
      try{flyer.remove();}catch(_){}
    }, 600);
  };

  window.bumpCounter = function(el){
    if(!el) return;
    el.classList.remove('bumped');
    void el.offsetWidth;
    el.classList.add('bumped');
  };
})();

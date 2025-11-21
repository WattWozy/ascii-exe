// Simple UI helpers for ASCII Miner
// Exposes `window.playExitAnimation(screenEl, opts)` which returns a Promise
// Resolves when animation completes. Does not rely on other modules.

(function(){
  function playExitAnimation(screenEl, opts = {}){
    const frames = opts.frames || [
      "   Exiting   ",
      "  Exiting.  ",
      " Exiting.. ",
      "Exiting...",
      " Exiting.. ",
      "  Exiting.  "
    ];
    const interval = opts.interval || 180; // ms per frame
    const loops = opts.loops || 6; // total frame cycles

    return new Promise((resolve) => {
      const original = screenEl.textContent;
      let count = 0;
      let idx = 0;
      const timer = setInterval(() => {
        screenEl.textContent = frames[idx];
        idx = (idx + 1) % frames.length;
        count++;
        if (count >= frames.length * loops) {
          clearInterval(timer);
          // small fade-to-black effect: clear screen briefly
          setTimeout(() => {
            screenEl.textContent = '';
            resolve();
          }, 120);
        }
      }, interval);
    });
  }

  if (typeof window !== 'undefined') window.playExitAnimation = playExitAnimation;
  if (typeof module !== 'undefined' && module.exports) module.exports.playExitAnimation = playExitAnimation;
})();

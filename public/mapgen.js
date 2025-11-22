// Map generator for ASCII Miner

// Exposes `window.generateMap(size = 20, opts = {})` which returns a 2D array of characters.
// opts:
//  - pushableProb: probability of an 'o' tile on inner cells (default 0.06)
//  - holeMidpoints: whether to leave midpoints in borders as '.' (default true)
//  - seed: optional number for deterministic pseudo-random (not implemented yet)

(function () {
  function defaultOptions() {
    return {
      pushableProb: 0.06,
      wallProb: 0.08,
      boxCount: 5,
      boxSymbol: 'Ø',
      bombCount: 5,
      bombSymbol: 'B',
      boxSymbol: 'Ø',
      bombCount: 5,
      bombSymbol: 'B',
      dropletCount: 5,
      dropletSymbol: '•',
      holeMidpoints: true
    };
  }

  function rand() { return Math.random(); }

  function generateMap(cols = 20, rows = 20, opts = {}) {
    // new signature: generateMap(cols, rows, opts)
    opts = Object.assign(defaultOptions(), opts);
    const newMap = [];
    const midX = Math.floor(cols / 2);
    const midY = Math.floor(rows / 2);

    for (let y = 0; y < rows; y++) {
      let row = '';
      for (let x = 0; x < cols; x++) {
        // Borders are walls except optional midpoints
        if (y === 0 || y === rows - 1 || x === 0 || x === cols - 1) {
          const hole = opts.holeMidpoints && (
            (y === 0 && x === midX) ||
            (y === rows - 1 && x === midX) ||
            (x === 0 && y === midY) ||
            (x === cols - 1 && y === midY)
          );
          row += hole ? '.' : '#';
        } else {
          // inner cell: can be wall '#', pushable 'o', or floor '.'
          const r = rand();
          if (r < opts.wallProb) {
            row += '#';
          } else if (r < opts.wallProb + opts.pushableProb) {
            // avoid creating >2 consecutive 'o' horizontally
            const prev1 = row[row.length - 1] === 'o';
            const prev2 = row[row.length - 2] === 'o';
            row += (prev1 && prev2) ? '.' : 'o';
          } else {
            row += '.';
          }
        }
      }
      newMap.push(row.split(''));
    }

    // place oxygen droplets on floor tiles ('.')
    if (opts.dropletCount && opts.dropletSymbol) {
      let placed = 0;
      const maxAttempts = cols * rows * 5;
      let attempts = 0;
      while (placed < opts.dropletCount && attempts < maxAttempts) {
        attempts++;
        const px = Math.floor(rand() * (cols - 2)) + 1; // avoid border
        const py = Math.floor(rand() * (rows - 2)) + 1;
        if (newMap[py][px] === '.') {
          newMap[py][px] = opts.dropletSymbol;
          placed++;
        }
      }
    }

    // place random bombs on floor tiles
    if (opts.bombCount && opts.bombSymbol) {
      let placed = 0;
      const maxAttempts = cols * rows * 5;
      let attempts = 0;
      while (placed < opts.bombCount && attempts < maxAttempts) {
        attempts++;
        const bx = Math.floor(rand() * (cols - 2)) + 1;
        const by = Math.floor(rand() * (rows - 2)) + 1;
        if (newMap[by][bx] === '.') {
          newMap[by][bx] = opts.bombSymbol;
          placed++;
        }
      }
    }

    // place boxes on floor tiles (each box will later be assigned a single collectable)
    if (opts.boxCount && opts.boxSymbol) {
      let placed = 0;
      const maxAttempts = cols * rows * 6;
      let attempts = 0;
      while (placed < opts.boxCount && attempts < maxAttempts) {
        attempts++;
        const bx = Math.floor(rand() * (cols - 2)) + 1;
        const by = Math.floor(rand() * (rows - 2)) + 1;
        if (newMap[by][bx] === '.') {
          newMap[by][bx] = opts.boxSymbol;
          placed++;
        }
      }
    }

    return newMap;
  }

  // attach to window for use from non-module scripts
  if (typeof window !== 'undefined') {
    window.generateMap = generateMap;
  }

  // also export for module consumers
  if (typeof module !== 'undefined' && module.exports) {
    module.exports.generateMap = generateMap;
  }
})();

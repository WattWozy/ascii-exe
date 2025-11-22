// Game logic module
// Exposes `window.createGame(config)` which returns a game object
// config: { map, width, height, screenEl, stateMenuEl, mapOpts, TILE_* constants, playExitAnimation, generateMap }
(function () {
  function createGame(cfg) {
    const {
      map: initialMap,
      width: initialWidth,
      height: initialHeight,
      screenEl,
      stateMenuEl,
      bombsEl,
      oxygenBarEl,
      oxygenTextEl,
      mapOpts = {},
      TILE_WALL = '#', TILE_FLOOR = '.', TILE_PLAYER = '@', TILE_PUSH = 'o', TILE_PUMP = '*', TILE_DROPLET = '•',
      PUMP_VALUE_DEFAULT = 25,
      playExitAnimation, generateMap,
      // new callbacks (client supplies these). fall back to no-ops that try window.gameClient if present
      onSendMove = (x, y) => { if (window.gameClient && typeof window.gameClient.sendMove === 'function') window.gameClient.sendMove(x, y); },
      onAction = (action) => { if (window.gameClient && typeof window.gameClient.sendAction === 'function') window.gameClient.sendAction(action); }
    } = cfg;

    // copy map so we can mutate
    let map = initialMap;
    let width = initialWidth;
    let height = initialHeight;

    const playerState = { jumps: 1, bombs: 0, dash: false, oxygen: 200 };
    // give player 3 bombs by default
    playerState.bombs = 3;
    const maxOxygen = 200;

    // find player start
    let player = { x: 1, y: 1 };
    outer: for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (map[y][x] === TILE_FLOOR) { player.x = x; player.y = y; break outer; }
      }
    }

    // aliens list - managed by server
    let aliens = [];

    // other players list (from server)
    let otherPlayers = [];
    // bombs attached to walls
    const bombs = [];
    // boxes placed on the map; each box holds a single collectable: 'bomb' or 'oxygen'
    const boxes = [];

    function findBoxAt(x, y) {
      return boxes.find(b => b.x === x && b.y === y);
    }

    function findBombAt(x, y) {
      return bombs.find(b => b.x === x && b.y === y);
    }

    function placeBombAt(x, y) {
      // do not place if already a bomb here
      if (findBombAt(x, y)) return false;
      // must be a wall
      if (map[y][x] !== TILE_WALL) return false;
      if (playerState.bombs <= 0) return false;

      // Send bomb placement to server
      onAction({ action: 'placeBomb', x, y });

      // Optimistically add bomb locally (server will validate and sync)
      playerState.bombs -= 1;
      const bomb = { x, y, blinkOn: false, delay: 800, minDelay: 80, stopped: false };
      bombs.push(bomb);

      // recursive blink & accelerate (client-side visual only, server handles explosion)
      function tick() {
        if (bomb.stopped) return;
        bomb.blinkOn = !bomb.blinkOn;
        // speed up
        bomb.delay = Math.max(bomb.minDelay, Math.floor(bomb.delay * 0.75));
        // schedule next or explode if delay at min
        if (bomb.delay <= bomb.minDelay) {
          // final short blinks then explode (server will send mapChange)
          setTimeout(() => {
            // remove wall (optimistic, server will confirm)
            map[bomb.y][bomb.x] = TILE_FLOOR;
            // remove bomb from list
            const idx = bombs.indexOf(bomb);
            if (idx !== -1) bombs.splice(idx, 1);
            render();
          }, bomb.delay);
        } else {
          setTimeout(() => { tick(); render(); }, bomb.delay);
        }
        render();
      }

      // start blinking
      setTimeout(() => { tick(); }, bomb.delay);
      return true;
    }
    // movement helpers
    function canWalk(nx, ny, dx = 0, dy = 0) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false;
      const tile = map[ny][nx];
      if (tile === TILE_WALL) return false;
      if (tile === TILE_PUSH) {
        const pushX = nx + dx, pushY = ny + dy;
        if (pushX < 0 || pushY < 0 || pushX >= width || pushY >= height) return false;
        if (map[pushY][pushX] !== TILE_FLOOR) return false;
        // Send push action to server (server will validate and apply)
        onAction({ action: 'push', fromX: nx, fromY: ny, toX: pushX, toY: pushY });
        // Optimistically apply locally (server will correct if invalid)
        map[ny][nx] = TILE_FLOOR;
        map[pushY][pushX] = TILE_PUSH;
        return true;
      }
      return true;
    }

    function isExit(x, y) {
      return map[y] && map[y][x] === TILE_FLOOR && (x === 0 || x === width - 1 || y === 0 || y === height - 1);
    }

    function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function render() {
      let out = '';
      // Create sets for quick lookup
      const alienPositions = new Set();
      aliens.forEach(a => {
        if (a && a.x !== undefined && a.y !== undefined) {
          alienPositions.add(`${a.x},${a.y}`);
        }
      });

      // Create map of other player positions with their colors
      const otherPlayerMap = new Map();
      otherPlayers.forEach(p => {
        if (p && p.x !== undefined && p.y !== undefined) {
          otherPlayerMap.set(`${p.x},${p.y}`, p);
        }
      });

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let ch = map[y][x];
          let classes = ['tile'];
          let style = '';

          // Check for other players first (they render on top of floor)
          const otherPlayerAtPos = otherPlayerMap.get(`${x},${y}`);
          if (otherPlayerAtPos) {
            ch = TILE_PLAYER;
            classes.push('other-player');
            if (otherPlayerAtPos.color) {
              style = `color: ${otherPlayerAtPos.color};`;
            }
          }
          // Then check for local player
          else if (x === player.x && y === player.y) {
            ch = TILE_PLAYER;
            classes.push('player');
          }
          // Then check for aliens
          else if (alienPositions.has(`${x},${y}`)) {
            ch = '&';
            classes.push('alien');
          }
          else if (ch === TILE_FLOOR) { ch = ' '; }
          else if (ch === TILE_PUMP) { classes.push('pump'); }
          else if (ch === (mapOpts.boxSymbol || 'Ø')) {
            const box = findBoxAt(x, y);
            if (box && box.content) classes.push('box-filled'); else classes.push('box-empty');
          }
          else if (ch === (mapOpts.bombSymbol || 'B')) { classes.push('map-bomb'); }
          else if (ch === TILE_DROPLET) { classes.push('droplet'); }
          // check bombs to color the wall if attached
          const b = findBombAt(x, y);
          if (b) {
            classes.push('bomb');
            if (b.blinkOn) classes.push('bomb-on');
          }
          const disp = (ch === ' ') ? '&nbsp;' : escapeHtml(ch);
          const styleAttr = style ? ` style="${style}"` : '';
          out += `<span class="${classes.join(' ')}"${styleAttr}>${disp}</span>`;
        }
        out += '<br/>';
      }
      screenEl.innerHTML = out;

      // Update sidebar stats
      if (bombsEl) bombsEl.textContent = playerState.bombs;
      if (oxygenBarEl) {
        const pct = Math.max(0, Math.min(100, (playerState.oxygen / maxOxygen) * 100));
        oxygenBarEl.style.width = `${pct}%`;
        // Change color based on level
        if (pct < 25) oxygenBarEl.style.backgroundColor = '#ff6666'; // red
        else if (pct < 50) oxygenBarEl.style.backgroundColor = '#ffeb3b'; // yellow
        else oxygenBarEl.style.backgroundColor = '#4fc3ff'; // blue
      }
      if (oxygenTextEl) oxygenTextEl.textContent = `${playerState.oxygen}/${maxOxygen}`;

      // Update state menu (removed bombs/oxygen, kept dash/jumps)
      stateMenuEl.textContent = `dash: ${playerState.dash ? 'yes' : 'no'}  jumps: ${playerState.jumps}`;
    }

    // input handling
    const keyMap = { 'ArrowUp': [0, -1], 'ArrowDown': [0, 1], 'ArrowLeft': [-1, 0], 'ArrowRight': [1, 0], 'w': [0, -1], 's': [0, 1], 'a': [-1, 0], 'd': [1, 0] };
    let lastDir = null;
    let keyHandler = (e) => {
      // Don't process game input if chat is open
      if (window.gameClient && window.gameClient.chatOpen) {
        return;
      }

      const k = e.key;
      // place bomb with 'x' using last direction
      if (k === 'x') {
        e.preventDefault();
        if (lastDir) {
          const bx = player.x + lastDir[0];
          const by = player.y + lastDir[1];
          if (bx >= 0 && by >= 0 && bx < width && by < height) {
            if (placeBombAt(bx, by)) render();
          }
        }
        return;
      }
      if (!keyMap[k]) return;
      e.preventDefault();
      const [dx, dy] = keyMap[k];
      lastDir = [dx, dy];
      const nx = player.x + dx, ny = player.y + dy;

      if (canWalk(nx, ny, dx, dy)) {
        // Update local position immediately for responsive feel
        player.x = nx;
        player.y = ny;
        // decrease oxygen on move
        if (playerState.oxygen > 0) playerState.oxygen--;
        // Send move to server for authoritative sync
        // Server will handle collection automatically when player moves onto items
        onSendMove(nx, ny);
        render();
        if (isExit(player.x, player.y)) {
          if (typeof playExitAnimation === 'function') {
            playExitAnimation(screenEl).then(() => {
              // generate new map
              map = (typeof generateMap === 'function') ? generateMap(width, height, mapOpts) : map;
              height = map.length; width = map[0] ? map[0].length : width;
              // place player at first floor tile
              outer2: for (let yy = 0; yy < height; yy++) {
                for (let xx = 0; xx < width; xx++) {
                  if (map[yy][xx] === TILE_FLOOR) { player.x = xx; player.y = yy; break outer2; }
                }
              }
              render();
            });
          } else {
            map = (typeof generateMap === 'function') ? generateMap(width, height, mapOpts) : map;
            height = map.length; width = map[0] ? map[0].length : width;
          }
        }
      }
    };

    function getState() {
      return {
        player: { x: player.x, y: player.y, oxygen: playerState.oxygen },
        aliens: aliens.map(a => ({ x: a.x, y: a.y }))
      };
    }

    let started = false;
    function start() {
      if (started) return;
      started = true;
      render();
      window.addEventListener('keydown', keyHandler);
    }
    function stop() { if (!started) return; started = false; window.removeEventListener('keydown', keyHandler); }

    // Allow external code to update player position (for server sync)
    function setPlayerPosition(x, y) {
      if (x >= 0 && x < width && y >= 0 && y < height) {
        player.x = x;
        player.y = y;
        render();
      }
    }

    // Update player position from server (with validation)
    function updatePlayerPosition(x, y) {
      if (x >= 0 && x < width && y >= 0 && y < height) {
        // Only update if significantly different to avoid jitter
        if (Math.abs(player.x - x) > 0 || Math.abs(player.y - y) > 0) {
          player.x = x;
          player.y = y;
          render();
        }
      }
    }

    // Update aliens from server (authoritative)
    function updateAliens(serverAliens) {
      // Update aliens array with server data
      aliens = serverAliens.map(a => ({ x: a.x, y: a.y }));
      render();
    }

    // Update other players from server
    function updateOtherPlayers(players) {
      otherPlayers = players || [];
      render();
    }

    // Apply map changes from server (authoritative)
    function applyMapChanges(changes) {
      changes.forEach(change => {
        if (change.x >= 0 && change.x < width && change.y >= 0 && change.y < height) {
          if (map[change.y]) {
            map[change.y][change.x] = change.tile;
          }
        }
      });
      render();
    }

    // Update boxes from server (authoritative)
    function updateBoxes(serverBoxes) {
      boxes.length = 0;
      serverBoxes.forEach(b => {
        boxes.push({ x: b.x, y: b.y, content: b.content });
      });
      render();
    }

    // Update bombs from server (authoritative)
    function updateBombs(serverBombs) {
      // Clear client-side bombs that aren't on server
      const serverBombPositions = new Set(serverBombs.map(b => `${b.x},${b.y}`));
      for (let i = bombs.length - 1; i >= 0; i--) {
        const posKey = `${bombs[i].x},${bombs[i].y}`;
        if (!serverBombPositions.has(posKey)) {
          bombs[i].stopped = true;
          bombs.splice(i, 1);
        }
      }
      // Update existing bombs or add new ones
      serverBombs.forEach(sb => {
        let bomb = findBombAt(sb.x, sb.y);
        if (!bomb) {
          bomb = { x: sb.x, y: sb.y, blinkOn: false, delay: 800, minDelay: 80, stopped: false };
          bombs.push(bomb);
        }
        bomb.blinkOn = sb.blinkOn;
      });
      render();
    }

    // Update single bomb state
    function updateBomb(bombData) {
      const bomb = findBombAt(bombData.x, bombData.y);
      if (bomb) {
        bomb.blinkOn = bombData.blinkOn;
        render();
      }
    }

    // Update player inventory from server
    function updateInventory(inv) {
      if (inv.bombs !== undefined) playerState.bombs = inv.bombs;
      if (inv.oxygen !== undefined) playerState.oxygen = inv.oxygen;
      if (inv.jumps !== undefined) playerState.jumps = inv.jumps;
      if (inv.dash !== undefined) playerState.dash = inv.dash;
      render();
    }

    return {
      start, stop, getState, render,
      setPlayerPosition, updatePlayerPosition,
      updateAliens, updateOtherPlayers,
      applyMapChanges, updateBoxes, updateBombs, updateBomb, updateInventory
    };
  }

  window.createGame = createGame;
})();

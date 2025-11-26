/**
 * Game logic module
 * Exposes `window.createGame(config)` which returns a game object
 */
(function () {
  /**
   * Goal: Initialize and manage the core game loop, rendering, and state.
   * Input: cfg (object) - Configuration object containing map, DOM elements, and callbacks.
   * Output: Game object with methods to control the game and update state.
   */
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
      // Tile constants (defaults if not provided globally)
      TILE_WALL = (window.TILES && window.TILES.WALL) || '#',
      TILE_FLOOR = (window.TILES && window.TILES.FLOOR) || '.',
      TILE_PLAYER = (window.TILES && window.TILES.PLAYER) || '@',
      TILE_PUSH = (window.TILES && window.TILES.PUSHABLE) || 'o',
      TILE_PUMP = (window.TILES && window.TILES.PUMP) || '*',
      TILE_DROPLET = (window.TILES && window.TILES.DROPLET) || '•',
      TILE_GOLD = (window.TILES && window.TILES.GOLD) || '€',
      TILE_BANK = (window.TILES && window.TILES.BANK) || '$',
      TILE_FLAG_RED = (window.TILES && window.TILES.FLAG_RED) || 'P',
      TILE_FLAG_BLUE = (window.TILES && window.TILES.FLAG_BLUE) || 'p',
      TILE_BASE_RED = (window.TILES && window.TILES.BASE_RED) || '[',
      TILE_BASE_BLUE = (window.TILES && window.TILES.BASE_BLUE) || ']',
      TILE_HILL = (window.TILES && window.TILES.HILL) || 'H',
      PUMP_VALUE_DEFAULT = 25,
      // Callbacks
      onSendMove = (x, y) => window.gameClient?.sendMove?.(x, y),
      onAction = (action) => window.gameClient?.sendAction?.(action)
    } = cfg;

    // --- State Initialization ---
    let map = initialMap; // Mutable map
    const width = initialWidth;
    const height = initialHeight;

    // Player State
    const playerState = {
      jumps: 1,
      bombs: 3,
      dash: false,
      oxygen: 200,
      isDead: false
    };
    const maxOxygen = 200;

    // Entities
    let player = findStartPosition();
    let aliens = [];
    let otherPlayers = [];
    let draggedWall = null;
    const bombs = [];
    const boxes = [];

    // Game Phase
    let currentPhase = 'LOBBY';
    let winner = null;
    let started = false;

    // Dark-room mode
    let darkRoomMode = false;
    let visibilityRadius = 2;

    // --- Helpers ---

    /**
     * Goal: Find the starting position for the local player.
     * Input: None
     * Output: Object {x, y}
     */
    function findStartPosition() {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (map[y][x] === TILE_FLOOR) return { x, y };
        }
      }
      return { x: 1, y: 1 }; // Fallback
    }

    /**
     * Goal: Find a box at a specific coordinate.
     * Input: x, y
     * Output: Box object or undefined
     */
    function findBoxAt(x, y) {
      return window.findBoxAt(boxes, x, y);
    }

    /**
     * Goal: Find a bomb at a specific coordinate.
     * Input: x, y
     * Output: Bomb object or undefined
     */
    function findBombAt(x, y) {
      return window.findBombAt(bombs, x, y);
    }

    /**
     * Goal: Escape HTML characters to prevent XSS in rendering.
     * Input: s (string)
     * Output: Escaped string
     */
    function escapeHtml(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // --- Core Logic ---

    /**
     * Goal: Attempt to place a bomb at the specified coordinates.
     * Input: x, y
     * Output: Boolean (success)
     */
    function placeBombAt(x, y) {
      if (!window.canPlaceBomb(map, bombs, x, y, width, height, TILE_WALL)) return false;
      if (playerState.bombs <= 0) return false;

      onAction({ action: 'placeBomb', x, y });
      return true;
    }

    /**
     * Goal: Check if a tile is walkable and handle interactions (like pushing).
     * Input: nx, ny (target coords), dx, dy (direction)
     * Output: Boolean (is walkable)
     */
    function canWalk(nx, ny, dx = 0, dy = 0) {
      if (!window.isWalkable(map, nx, ny, width, height, TILE_WALL)) return false;

      const tile = map[ny][nx];

      // Handle Pushable Walls
      if (tile === TILE_PUSH) {
        // Allow walking through if it's the wall we are dragging
        if (draggedWall && draggedWall.x === nx && draggedWall.y === ny) return true;

        const pushX = nx + dx, pushY = ny + dy;
        // Check bounds and if target is floor
        if (pushX < 0 || pushY < 0 || pushX >= width || pushY >= height) return false;
        if (map[pushY][pushX] !== TILE_FLOOR) return false;

        onAction({ action: 'push', fromX: nx, fromY: ny, toX: pushX, toY: pushY });
        return true;
      }
      return true;
    }

    // --- Rendering ---

    /**
     * Goal: Render the entire game state to the DOM.
     * Input: None
     * Output: None (Updates DOM)
     */
    function render() {
      // Safety check: don't render if DOM elements aren't ready
      if (!screenEl) return;

      // 1. Pre-calculate lookups for performance
      const otherPlayerMap = new Map(otherPlayers.map(p => [`${p.x},${p.y}`, p]));
      const alienMap = new Set(aliens.map(a => `${a.x},${a.y}`));
      const bombMap = new Map(bombs.map(b => [`${b.x},${b.y}`, b]));

      // 2. Build Grid HTML
      let out = '';
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          out += renderTile(x, y, otherPlayerMap, alienMap, bombMap);
        }
        out += '<br/>';
      }
      screenEl.innerHTML = out;

      // 3. Update UI Elements
      updateUI();
    }

    /**
     * Goal: Render a single tile based on its state and entities.
     * Input: x, y, lookup maps
     * Output: HTML string for the tile
     */
    function renderTile(x, y, otherPlayerMap, alienMap, bombMap) {
      // Check visibility in dark-room mode
      if (darkRoomMode) {
        const dist = Math.max(Math.abs(x - player.x), Math.abs(y - player.y));
        if (dist > visibilityRadius) {
          // Outside visibility: render as empty/black
          return '<span class="tile invisible">&nbsp;</span>';
        }
      }

      let ch = map[y][x];
      let classes = ['tile'];
      let style = '';

      const key = `${x},${y}`;

      // Entity Layering: Other Players -> Local Player -> Aliens -> Map Tiles

      // Other Players
      const otherP = otherPlayerMap.get(key);
      if (otherP && !otherP.isDead) {
        ch = TILE_PLAYER;
        classes.push('player');
        if (otherP.color) style = `color: ${otherP.color}`;
      }
      // Local Player
      else if (player.x === x && player.y === y && !playerState.isDead) {
        ch = TILE_PLAYER;
        classes.push('player');
      }
      // Aliens
      else if (alienMap.has(key)) {
        ch = '👾';
        classes.push('alien');
      }
      // Map Tiles
      else {
        if (ch === TILE_FLOOR) ch = ' ';
        else if (ch === TILE_PUSH) {
          if (draggedWall && draggedWall.x === x && draggedWall.y === y) classes.push('dragging');
        }
        else if (ch === TILE_PUMP) classes.push('pump');
        else if (ch === (mapOpts.boxSymbol || window.TILES?.BOX || 'Ø')) {
          const box = findBoxAt(x, y);
          classes.push(box && box.content ? 'box-filled' : 'box-empty');
        }
        else if (ch === (mapOpts.bombSymbol || window.TILES?.BOMB || 'B')) classes.push('map-bomb');
        else if (ch === TILE_DROPLET) classes.push('droplet');
        else if (ch === TILE_GOLD) classes.push('gold');
        else if (ch === TILE_BANK) classes.push('bank');
        else if (ch === TILE_FLAG_RED) classes.push('flag-red');
        else if (ch === TILE_FLAG_BLUE) classes.push('flag-blue');
        else if (ch === TILE_BASE_RED) classes.push('base-red');
        else if (ch === TILE_BASE_BLUE) classes.push('base-blue');
        else if (ch === TILE_HILL) classes.push('hill');
      }

      // Bombs (Overlay)
      const b = bombMap.get(key);
      if (b) {
        classes.push('bomb');
        if (b.blinkOn) classes.push('bomb-on');
      }

      const disp = (ch === ' ') ? '&nbsp;' : escapeHtml(ch);
      const styleAttr = style ? ` style="${style}"` : '';
      return `<span class="${classes.join(' ')}"${styleAttr}>${disp}</span>`;
    }

    /**
     * Goal: Update HUD and Overlay elements.
     * Input: None
     * Output: None
     */
    function updateUI() {
      // Stats
      if (bombsEl) bombsEl.textContent = playerState.bombs;
      if (oxygenBarEl) {
        const pct = Math.max(0, Math.min(100, (playerState.oxygen / maxOxygen) * 100));
        oxygenBarEl.style.width = `${pct}%`;
        oxygenBarEl.style.backgroundColor = pct < 25 ? '#ff6666' : pct < 50 ? '#ffeb3b' : '#4fc3ff';
      }
      if (oxygenTextEl) oxygenTextEl.textContent = `${playerState.oxygen}/${maxOxygen}`;

      // State Menu
      stateMenuEl.textContent = `dash: ${playerState.dash ? 'yes' : 'no'}  jumps: ${playerState.jumps}`;

      // Overlay
      updateOverlay();

      // Fix positioning
      screenEl.style.position = 'relative';
    }

    /**
     * Goal: Update the game overlay (Game Over / Death screen).
     * Input: None
     * Output: None
     */
    function updateOverlay() {
      const overlayEl = document.getElementById('game-overlay');
      if (!overlayEl) return;

      let targetState = 'NONE';
      if (currentPhase === 'GAME_OVER') targetState = 'GAME_OVER';
      else if (playerState.isDead) targetState = 'DEAD';

      if (overlayEl.dataset.state !== targetState) {
        overlayEl.dataset.state = targetState;

        if (targetState === 'NONE') {
          overlayEl.innerHTML = '';
        } else if (targetState === 'GAME_OVER') {
          renderGameOverOverlay(overlayEl);
        } else if (targetState === 'DEAD') {
          renderDeathOverlay(overlayEl);
        }
      }
    }

    function renderGameOverOverlay(el) {
      const isVictory = winner === 'Players';
      const color = isVictory ? '#7cd67c' : '#ff6666';
      const title = isVictory ? 'VICTORY' : 'GAME OVER';
      const subtext = isVictory ? 'You Won' : 'Aliens Win';

      el.innerHTML = `
        <div style="background: rgba(13, 17, 23, 0.95); padding: 32px; border: 2px solid ${color}; border-radius: 12px; text-align: center; box-shadow: 0 0 50px rgba(0,0,0,0.8), 0 0 20px ${color}40; min-width: 300px; backdrop-filter: blur(4px); pointer-events: auto;">
          <h1 style="color: ${color}; margin: 0 0 8px 0; font-size: 32px; text-shadow: 0 0 10px ${color}40; letter-spacing: 2px;">${title}</h1>
          <p style="color: #aab3c2; margin: 0 0 24px 0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">${subtext}</p>
          <button onclick="window.location.href='/'" style="background: rgba(255,255,255,0.05); color: #e8eef6; border: 1px solid rgba(255,255,255,0.1); padding: 12px 24px; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 16px; transition: all 0.2s; display: inline-flex; align-items: center; gap: 8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
          </button>
        </div>`;
    }

    function renderDeathOverlay(el) {
      el.innerHTML = `
        <div style="background: rgba(0, 0, 0, 0.8); padding: 20px; border: 1px solid #666; text-align: center; pointer-events: auto;">
          <h2 style="color:#ff6666;margin:0;">YOU DIED</h2>
          <p style="color:#ccc;margin:5px 0;">Spectating...</p>
        </div>`;
    }

    // --- Input Handling ---

    const keyMap = { 'ArrowUp': [0, -1], 'ArrowDown': [0, 1], 'ArrowLeft': [-1, 0], 'ArrowRight': [1, 0], 'w': [0, -1], 's': [0, 1], 'a': [-1, 0] };
    let lastDir = null;

    /**
     * Goal: Handle keyboard input for movement and actions.
     * Input: e (Event)
     * Output: None
     */
    const keyHandler = (e) => {
      if (window.gameClient?.chatOpen || playerState.isDead || currentPhase === 'GAME_OVER') return;

      const k = e.key;

      // Bomb Placement
      if (k === 'x') {
        e.preventDefault();
        if (lastDir) {
          const bx = player.x + lastDir[0], by = player.y + lastDir[1];
          if (bx >= 0 && by >= 0 && bx < width && by < height) {
            if (placeBombAt(bx, by)) render();
          }
        }
        return;
      }

      // Dragging
      if (k === 'd') {
        e.preventDefault();
        if (draggedWall) {
          onAction({ action: 'drag', isDragging: false });
        } else if (lastDir) {
          const wx = player.x + lastDir[0], wy = player.y + lastDir[1];
          if (wx >= 0 && wy >= 0 && wx < width && wy < height && map[wy]?.[wx] === TILE_PUSH) {
            onAction({ action: 'drag', wallX: wx, wallY: wy, isDragging: true });
          }
        }
        return;
      }

      // Movement
      if (!keyMap[k]) return;
      e.preventDefault();

      const [dx, dy] = keyMap[k];
      lastDir = [dx, dy];
      const nx = player.x + dx, ny = player.y + dy;

      if (canWalk(nx, ny, dx, dy)) {
        onSendMove(nx, ny);
      }
    };

    // --- External API (Methods exposed to Client) ---

    function start() {
      if (started) return;
      started = true;
      render();
      window.addEventListener('keydown', keyHandler);
    }

    function stop() {
      if (!started) return;
      started = false;
      window.removeEventListener('keydown', keyHandler);
    }

    function setPlayerPosition(x, y) {
      if (x >= 0 && x < width && y >= 0 && y < height) {
        player.x = x;
        player.y = y;
        render();
      }
    }

    function updatePlayerPosition(x, y) {
      if (x >= 0 && x < width && y >= 0 && y < height) {
        if (Math.abs(player.x - x) > 0 || Math.abs(player.y - y) > 0) {
          player.x = x;
          player.y = y;
          render();
        }
      }
    }

    function updateAliens(serverAliens) {
      aliens = serverAliens.map(a => ({ x: a.x, y: a.y }));
      render();
    }

    function updateOtherPlayers(players) {
      otherPlayers = players || [];
      render();
    }

    function applyMapChanges(changes) {
      changes.forEach(change => {
        if (change.x >= 0 && change.x < width && change.y >= 0 && change.y < height && map[change.y]) {
          map[change.y][change.x] = change.tile;
        }
      });
      render();
    }

    function updateBoxes(serverBoxes) {
      boxes.length = 0;
      serverBoxes.forEach(b => boxes.push({ x: b.x, y: b.y, content: b.content }));
      render();
    }

    function updateBombs(serverBombs) {
      const serverBombPositions = new Set(serverBombs.map(b => `${b.x},${b.y}`));

      // Remove stale bombs
      for (let i = bombs.length - 1; i >= 0; i--) {
        if (!serverBombPositions.has(`${bombs[i].x},${bombs[i].y}`)) {
          bombs.splice(i, 1);
        }
      }

      // Update/Add bombs
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

    function updateBomb(bombData) {
      const bomb = findBombAt(bombData.x, bombData.y);
      if (bomb) {
        bomb.blinkOn = bombData.blinkOn;
        render();
      }
    }

    function updateInventory(inv) {
      if (inv.bombs !== undefined) playerState.bombs = inv.bombs;
      if (inv.oxygen !== undefined) playerState.oxygen = inv.oxygen;
      if (inv.jumps !== undefined) playerState.jumps = inv.jumps;
      if (inv.dash !== undefined) playerState.dash = inv.dash;
      if (inv.isDead !== undefined) playerState.isDead = inv.isDead;

      if (inv.modeStatus) updateModeStatus(inv.modeStatus);
      render();
    }

    function updateModeStatus(status) {
      const container = document.getElementById('mode-status-container');
      const content = document.getElementById('mode-stats-content');
      const title = document.getElementById('mode-title');

      if (!container || !content) return;

      container.style.display = 'flex';
      let html = '';

      if (status.type === 'ROB_BANK') {
        title.textContent = 'ROB THE BANK';
        html = `
          <div class="stat-row">
            <div class="stat-label"><span>COLLECTED</span><span class="stat-value" style="color:#ffd700">${status.collected}/${status.total}</span></div>
            <div class="progress-bar-container"><div class="progress-bar-fill" style="width:${(status.collected / status.total) * 100}%; background:#ffd700"></div></div>
          </div>
          <div class="stat-row"><div class="stat-label"><span>HELD</span><span class="stat-value">${status.held}</span></div></div>`;
      } else if (status.type === 'CAPTURE_FLAG') {
        title.textContent = 'CAPTURE THE FLAG';
        html = `
          <div class="stat-row"><div class="stat-label"><span style="color:#ff4444">RED TEAM</span><span class="stat-value">${status.scores.RED}</span></div></div>
          <div class="stat-row"><div class="stat-label"><span style="color:#4444ff">BLUE TEAM</span><span class="stat-value">${status.scores.BLUE}</span></div></div>
          <div class="stat-row" style="margin-top:8px; border-top:1px solid rgba(255,255,255,0.1); padding-top:4px;">
             <div class="stat-label"><span>YOUR TEAM</span><span class="stat-value" style="color:${status.myTeam === 'RED' ? '#ff4444' : '#4444ff'}">${status.myTeam}</span></div>
          </div>`;
      } else if (status.type === 'KING_HILL') {
        title.textContent = 'KING OF THE HILL';
        const sorted = Object.entries(status.scores).sort((a, b) => b[1] - a[1]).slice(0, 3);
        html = `<div class="stat-row"><div class="stat-label"><span>TOP PLAYERS</span></div></div>`;
        sorted.forEach(([name, score]) => {
          html += `<div class="stat-row"><div class="stat-label"><span>${name}</span><span class="stat-value">${Math.floor(score / 10)}s</span></div></div>`;
        });
        if (status.myScore !== undefined) {
          html += `<div class="stat-row" style="margin-top:8px; border-top:1px solid rgba(255,255,255,0.1); padding-top:4px;">
              <div class="stat-label"><span>YOUR TIME</span><span class="stat-value">${Math.floor(status.myScore / 10)}s</span></div>
            </div>`;
        }
      }
      content.innerHTML = html;
    }

    function updateDragState(serverDraggedWall) {
      draggedWall = serverDraggedWall;
      render();
    }

    function updateGamePhase(phase, win) {
      currentPhase = phase;
      winner = win;
      render();
      if (phase === 'GAME_OVER') setTimeout(() => window.location.href = '/', 5000);
    }

    function getState() {
      return {
        player: { x: player.x, y: player.y, oxygen: playerState.oxygen },
        aliens: aliens.map(a => ({ x: a.x, y: a.y }))
      };
    }

    function updateDarkRoomMode(enabled) {
      darkRoomMode = enabled;
      // Only render if game has started (screenEl exists)
      if (started && screenEl) {
        render();
      }
    }

    return {
      start, stop, getState, render,
      setPlayerPosition, updatePlayerPosition,
      updateAliens, updateOtherPlayers,
      applyMapChanges, updateBoxes, updateBombs, updateBomb, updateInventory,
      updateDragState, updateGamePhase, updateDarkRoomMode
    };
  }

  window.createGame = createGame;
})();

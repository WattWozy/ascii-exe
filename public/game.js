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

    // dragging state
    let draggedWall = null; // {x, y} when player is dragging a wall

    // other players list (from server)
    let otherPlayers = [];
    // bombs attached to walls
    const bombs = [];
    // boxes placed on the map; each box holds a single collectable: 'bomb' or 'oxygen'
    const boxes = [];

    // CLIENT-SIDE PREDICTION HELPERS
    // Uses shared utility functions from utils.js
    function findBoxAt(x, y) {
      return window.findBoxAt(boxes, x, y);
    }

    function findBombAt(x, y) {
      return window.findBombAt(bombs, x, y);
    }

    function placeBombAt(x, y) {
      // Use shared validation
      if (!window.canPlaceBomb(map, bombs, x, y, width, height, TILE_WALL)) return false;
      if (playerState.bombs <= 0) return false;

      // Send bomb placement to server
      onAction({ action: 'placeBomb', x, y });

      return true;
    }
    // movement helpers
    function canWalk(nx, ny, dx = 0, dy = 0) {
      // Use shared validation for basic walkability
      if (!window.isWalkable(map, nx, ny, width, height, TILE_WALL)) return false;

      const tile = map[ny][nx];
      if (tile === TILE_PUSH) {
        // Skip auto-push if this is our dragged wall
        if (draggedWall && draggedWall.x === nx && draggedWall.y === ny) {
          return true; // Can walk through dragged wall
        }
        const pushX = nx + dx, pushY = ny + dy;
        if (pushX < 0 || pushY < 0 || pushX >= width || pushY >= height) return false;
        if (map[pushY][pushX] !== TILE_FLOOR) return false;
        // Send push action to server (server will validate and apply)
        onAction({ action: 'push', fromX: nx, fromY: ny, toX: pushX, toY: pushY });

        return true;
      }
      return true;
    }



    function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function render() {
      let out = '';
      // Create sets for quick lookup


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
          // REMOVED: Players are now rendered in entity layer

          // Then check for local player
          // REMOVED: Player is now rendered in entity layer

          if (ch === TILE_FLOOR) { ch = ' '; }
          else if (ch === TILE_PUSH) {
            // Don't render pushable wall in grid, it's an entity now
            ch = ' ';
          }
          else if (ch === TILE_PUMP) { classes.push('pump'); }
          else if (ch === (mapOpts.boxSymbol || (window.TILES && window.TILES.BOX) || 'Ø')) {
            const box = findBoxAt(x, y);
            if (box && box.content) classes.push('box-filled'); else classes.push('box-empty');
          }
          else if (ch === (mapOpts.bombSymbol || (window.TILES && window.TILES.BOMB) || 'B')) { classes.push('map-bomb'); }
          else if (ch === TILE_DROPLET) { classes.push('droplet'); }
          else if (ch === TILE_GOLD) { classes.push('gold'); }
          else if (ch === TILE_BANK) { classes.push('bank'); }
          else if (ch === TILE_FLAG_RED) { classes.push('flag-red'); }
          else if (ch === TILE_FLAG_BLUE) { classes.push('flag-blue'); }
          else if (ch === TILE_BASE_RED) { classes.push('base-red'); }
          else if (ch === TILE_BASE_BLUE) { classes.push('base-blue'); }
          else if (ch === TILE_HILL) { classes.push('hill'); }
          // check bombs to color the wall if attached
          const b = findBombAt(x, y);
          if (b) {
            classes.push('bomb');
            if (b.blinkOn) classes.push('bomb-on');
          }
          // check if this is the dragged wall
          if (draggedWall && draggedWall.x === x && draggedWall.y === y) {
            classes.push('dragging');
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

      screenEl.innerHTML = out;

      // Handle Overlay (Game Over / Death)
      // We use a separate element and only update when state changes to avoid killing click events
      const overlayEl = document.getElementById('game-overlay');
      if (overlayEl) {
        let targetOverlayState = 'NONE';
        if (currentPhase === 'GAME_OVER') targetOverlayState = 'GAME_OVER';
        else if (playerState.isDead) targetOverlayState = 'DEAD';

        // Only update if state changed
        if (overlayEl.dataset.state !== targetOverlayState) {
          overlayEl.dataset.state = targetOverlayState;

          if (targetOverlayState === 'NONE') {
            overlayEl.innerHTML = '';
          } else if (targetOverlayState === 'GAME_OVER') {
            const isVictory = winner === 'Players';
            const color = isVictory ? '#7cd67c' : '#ff6666';
            const title = isVictory ? 'VICTORY' : 'GAME OVER';
            const subtext = isVictory ? 'You Won' : 'Aliens Win';

            overlayEl.innerHTML = `<div style="
              background: rgba(13, 17, 23, 0.95);
              padding: 32px;
              border: 2px solid ${color};
              border-radius: 12px;
              text-align: center;
              box-shadow: 0 0 50px rgba(0,0,0,0.8), 0 0 20px ${color}40;
              min-width: 300px;
              backdrop-filter: blur(4px);
              pointer-events: auto;
            ">
              <h1 style="
                color: ${color};
                margin: 0 0 8px 0;
                font-size: 32px;
                text-shadow: 0 0 10px ${color}40;
                letter-spacing: 2px;
              ">${title}</h1>
              
              <p style="
                color: #aab3c2;
                margin: 0 0 24px 0;
                font-size: 14px;
                text-transform: uppercase;
                letter-spacing: 1px;
              ">${subtext}</p>
              
              <button onclick="window.location.href='/'" style="
                background: rgba(255,255,255,0.05);
                color: #e8eef6;
                border: 1px solid rgba(255,255,255,0.1);
                padding: 12px 24px;
                border-radius: 6px;
                cursor: pointer;
                font-family: inherit;
                font-size: 16px;
                transition: all 0.2s;
                display: inline-flex;
                align-items: center;
                gap: 8px;
              " onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                  <polyline points="9 22 9 12 15 12 15 22"></polyline>
                </svg>
              </button>
            </div>`;
          } else if (targetOverlayState === 'DEAD') {
            overlayEl.innerHTML = `<div style="
              background: rgba(0, 0, 0, 0.8);
              padding: 20px;
              border: 1px solid #666;
              text-align: center;
              pointer-events: auto;
            ">
              <h2 style="color:#ff6666;margin:0;">YOU DIED</h2>
              <p style="color:#ccc;margin:5px 0;">Spectating...</p>
            </div>`;
          }
        }
      }
      // Ensure screenEl is relative so absolute children work
      screenEl.style.position = 'relative';
    }

    // input handling
    const keyMap = { 'ArrowUp': [0, -1], 'ArrowDown': [0, 1], 'ArrowLeft': [-1, 0], 'ArrowRight': [1, 0], 'w': [0, -1], 's': [0, 1], 'a': [-1, 0] };
    let lastDir = null;
    let keyHandler = (e) => {
      // Don't process game input if chat is open OR if player is dead OR game over
      if ((window.gameClient && window.gameClient.chatOpen) || playerState.isDead || currentPhase === 'GAME_OVER') {
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
      // drag/release wall with 'd' using last direction
      if (k === 'd') {
        e.preventDefault();
        if (draggedWall) {
          // Release wall
          onAction({ action: 'drag', isDragging: false });
        } else if (lastDir) {
          // Try to grab wall
          const wx = player.x + lastDir[0];
          const wy = player.y + lastDir[1];
          if (wx >= 0 && wy >= 0 && wx < width && wy < height && map[wy] && map[wy][wx] === TILE_PUSH) {
            onAction({ action: 'drag', wallX: wx, wallY: wy, isDragging: true });
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
        // Send move to server for authoritative sync
        // Server will handle collection automatically when player moves onto items
        onSendMove(nx, ny);

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

    // Walls list - managed by server
    let walls = [];

    // Update aliens from server (authoritative)
    function updateAliens(serverAliens) {
      // Update aliens array with server data
      aliens = serverAliens.map(a => ({ id: a.id, x: a.x, y: a.y }));
      renderEntities();
    }

    // Update walls from server
    function updateWalls(serverWalls) {
      walls = serverWalls.map(w => ({ id: w.id, x: w.x, y: w.y }));
      renderEntities();
    }

    function renderEntities() {
      const layerEl = document.getElementById('entity-layer');
      if (!layerEl) return;

      // Helper to update/create sprites
      const updateSprites = (items, typeClass, getContent, getColor, getExtraClass) => {
        const existing = new Map();
        layerEl.querySelectorAll(`.${typeClass}`).forEach(el => {
          existing.set(el.dataset.id, el);
        });

        const currentIds = new Set();

        items.forEach(item => {
          const id = String(item.id);
          currentIds.add(id);

          let el = existing.get(id);
          const left = `calc(12px + ${item.x} * 1.5ch)`;
          const top = `calc(12px + ${item.y} * 1.25em)`;

          if (!el) {
            el = document.createElement('div');
            el.className = `${typeClass} entering`;
            el.dataset.id = id;
            el.textContent = getContent(item);
            el.style.left = left;
            el.style.top = top;
            if (getColor) el.style.color = getColor(item);
            if (getExtraClass) {
              const extra = getExtraClass(item);
              if (extra) el.classList.add(extra);
            }
            layerEl.appendChild(el);

            // Trigger reflow
            el.offsetHeight;
            el.classList.remove('entering');
            el.classList.add('visible');
          } else {
            el.style.left = left;
            el.style.top = top;
            if (getColor) el.style.color = getColor(item);

            // Update extra classes (like dragging)
            if (getExtraClass) {
              const extra = getExtraClass(item);
              // Reset specific classes? For now just add/remove known ones
              if (extra === 'dragging') el.classList.add('dragging');
              else el.classList.remove('dragging');
            }

            if (!el.classList.contains('visible')) {
              el.classList.add('visible');
              el.classList.remove('entering');
            }
          }
        });

        // Remove old
        existing.forEach((el, id) => {
          if (!currentIds.has(id)) {
            el.classList.remove('visible');
            el.classList.add('exiting');
            setTimeout(() => {
              if (el.parentNode) el.parentNode.removeChild(el);
            }, 200);
          }
        });
      };

      // Render Aliens
      updateSprites(aliens, 'alien-sprite', () => '👾', () => null);

      // Render Walls
      updateSprites(walls, 'wall-sprite', () => 'o', () => null, (w) => {
        if (draggedWall && draggedWall.x === w.x && draggedWall.y === w.y) return 'dragging';
        return null;
      });

      // Render Players
      // Combine local player and other players
      const allPlayers = [];
      // Local player (use special ID 'me')
      if (!playerState.isDead) {
        allPlayers.push({ id: 'me', x: player.x, y: player.y, color: '#7cd67c' });
      }
      // Other players
      otherPlayers.forEach(p => {
        if (!p.isDead) {
          allPlayers.push({ id: `p_${p.id}`, x: p.x, y: p.y, color: p.color || '#7cd67c' });
        }
      });

      updateSprites(allPlayers, 'player-sprite', () => '@', (p) => p.color);
    }

    // Update other players from server
    function updateOtherPlayers(players) {
      otherPlayers = players || [];
      renderEntities();
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
      // Also re-render entities as map changes might affect them (e.g. wall destroyed)
      // Actually walls are separate now, but if a wall is destroyed it should be removed from walls list by server update
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
      if (inv.isDead !== undefined) playerState.isDead = inv.isDead;

      // Handle Mode Status if present
      if (inv.modeStatus) {
        console.log('Received mode status:', inv.modeStatus);
        updateModeStatus(inv.modeStatus);
      }

      render();
      renderEntities(); // Re-render to handle death state
    }

    function updateModeStatus(status) {
      const container = document.getElementById('mode-status-container');
      const content = document.getElementById('mode-stats-content');
      const title = document.getElementById('mode-title');

      if (!container || !content) {
        console.error('Mode status container missing');
        return;
      }

      container.style.display = 'flex';
      console.log('Updating mode status display for', status.type);

      let html = '';
      if (status.type === 'ROB_BANK') {
        title.textContent = 'ROB THE BANK';
        html += `
          <div class="stat-row">
            <div class="stat-label">
              <span>COLLECTED</span>
              <span class="stat-value" style="color:#ffd700">${status.collected}/${status.total}</span>
            </div>
            <div class="progress-bar-container">
              <div class="progress-bar-fill" style="width:${(status.collected / status.total) * 100}%; background:#ffd700"></div>
            </div>
          </div>
          <div class="stat-row">
            <div class="stat-label">
              <span>HELD</span>
              <span class="stat-value">${status.held}</span>
            </div>
          </div>
        `;
      } else if (status.type === 'CAPTURE_FLAG') {
        title.textContent = 'CAPTURE THE FLAG';
        html += `
          <div class="stat-row">
            <div class="stat-label">
              <span style="color:#ff4444">RED TEAM</span>
              <span class="stat-value">${status.scores.RED}</span>
            </div>
          </div>
          <div class="stat-row">
            <div class="stat-label">
              <span style="color:#4444ff">BLUE TEAM</span>
              <span class="stat-value">${status.scores.BLUE}</span>
            </div>
          </div>
          <div class="stat-row" style="margin-top:8px; border-top:1px solid rgba(255,255,255,0.1); padding-top:4px;">
             <div class="stat-label">
              <span>YOUR TEAM</span>
              <span class="stat-value" style="color:${status.myTeam === 'RED' ? '#ff4444' : '#4444ff'}">${status.myTeam}</span>
            </div>
          </div>
        `;
      } else if (status.type === 'KING_HILL') {
        title.textContent = 'KING OF THE HILL';
        // Sort scores
        const sorted = Object.entries(status.scores).sort((a, b) => b[1] - a[1]).slice(0, 3);

        html += `<div class="stat-row"><div class="stat-label"><span>TOP PLAYERS</span></div></div>`;

        sorted.forEach(([name, score]) => {
          html += `
            <div class="stat-row">
              <div class="stat-label">
                <span>${name}</span>
                <span class="stat-value">${Math.floor(score / 10)}s</span> <!-- Approx seconds -->
              </div>
            </div>
           `;
        });

        if (status.myScore !== undefined) {
          html += `
            <div class="stat-row" style="margin-top:8px; border-top:1px solid rgba(255,255,255,0.1); padding-top:4px;">
              <div class="stat-label">
                <span>YOUR TIME</span>
                <span class="stat-value">${Math.floor(status.myScore / 10)}s</span>
              </div>
            </div>
           `;
        }
      }

      content.innerHTML = html;
    }

    // Update drag state from server
    function updateDragState(serverDraggedWall) {
      draggedWall = serverDraggedWall;
      render();
      renderEntities(); // Re-render to show dragging effect on wall
    }

    // Game Phase handling
    let currentPhase = 'LOBBY';
    let winner = null;

    function updateGamePhase(phase, win) {
      currentPhase = phase;
      winner = win;
      render();

      if (phase === 'GAME_OVER') {
        setTimeout(() => {
          window.location.href = '/';
        }, 5000);
      }
    }

    return {
      start, stop, getState, render,
      setPlayerPosition, updatePlayerPosition,
      updateAliens, updateOtherPlayers,
      applyMapChanges, updateBoxes, updateBombs, updateBomb, updateInventory,
      updateDragState, updateGamePhase, updateWalls
    };
  }

  window.createGame = createGame;
})();

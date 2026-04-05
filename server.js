const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { TILES } = require('./public/constants.js');
const { getPlayerName, findBoxAt, findBombAt, canPlaceBomb, isWalkable } = require('./public/utils.js');

// Simple map generator for server
function generateSimpleMap(width, height) {
  const map = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) {
      if (y === 0 || y === height - 1 || x === 0 || x === width - 1) {
        // Border walls with exits
        const midX = Math.floor(width / 2);
        const midY = Math.floor(height / 2);
        if ((y === 0 && x === midX) || (y === height - 1 && x === midX) ||
          (x === 0 && y === midY) || (x === width - 1 && y === midY)) {
          row.push(TILES.FLOOR);
        } else {
          row.push(TILES.WALL);
        }
      } else {
        // Inner cells: mostly floor with some walls
        row.push(Math.random() < 0.15 ? TILES.WALL : TILES.FLOOR);
      }
    }
    map.push(row);
  }
  return map;
}

// Try to load mapgen.js for better map generation
let generateMap = generateSimpleMap;
try {
  // mapgen.js uses module.exports, so we can require it
  const mapgenModule = require('./public/mapgen.js');
  if (mapgenModule && typeof mapgenModule.generateMap === 'function') {
    generateMap = mapgenModule.generateMap;
  }
} catch (e) {
  // Fallback to simple map generator if module loading fails
  console.log('Using simple map generator (mapgen.js not available)');
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files (your HTML and JS files)
app.use(express.static(path.join(__dirname, 'public')));

// Game rooms - each room has its own isolated game state
const rooms = {};

const { GameState, PHASES, MODES, GameModeHandler } = require('./public/gamestate.js');

class SurvivalMode extends GameModeHandler {
  constructor(gameRoom) {
    super(gameRoom);
    this.room = gameRoom;
  }

  update() {
    if (this.room.state.phase !== PHASES.PLAYING) return;

    // Check for player deaths
    this.room.players.forEach(player => {
      if (player.isDead) return;

      // 1. Oxygen Death
      if (player.oxygen <= 0) {
        this.killPlayer(player, 'ran out of oxygen');
      }

      // 2. Alien Collision Death
      // Simple check: is any alien on the same tile?
      const hitByAlien = this.room.aliens.some(alien => alien.x === player.x && alien.y === player.y);
      if (hitByAlien) {
        this.killPlayer(player, 'was eaten by an alien');
      }
    });

    // Check Win/Loss Condition
    this.checkWinCondition();
  }

  killPlayer(player, reason) {
    if (player.isDead) return;
    player.isDead = true;
    console.log(`Player ${player.id} died: ${reason}`);

    this.room.broadcast({
      type: 'playerDied',
      playerId: player.id,
      reason: reason
    });

    this.room.chatHistory.push({
      type: 'system',
      message: `${getPlayerName(player.id)} died: ${reason}`,
      timestamp: Date.now()
    });
  }

  checkWinCondition() {
    const activePlayers = Array.from(this.room.players.values()).filter(p => !p.isDead);
    const totalPlayers = this.room.players.size;

    // If everyone is dead
    if (activePlayers.length === 0 && totalPlayers > 0) {
      this.room.state.setPhase(PHASES.GAME_OVER);
      this.room.state.winner = 'Aliens';
      this.room.broadcast({
        type: 'gameOver',
        winner: 'Aliens'
      });
    }

    // If all aliens are dead
    if (this.room.aliens.length === 0) {
      this.room.state.setPhase(PHASES.GAME_OVER);
      this.room.state.winner = 'Players';
      this.room.broadcast({
        type: 'gameOver',
        winner: 'Players'
      });
    }
  }
}

class RobBankMode extends GameModeHandler {
  constructor(gameRoom) {
    super(gameRoom);
    this.room = gameRoom;
    this.goldCount = 0;
    this.bankLocation = null;
    this.totalGold = 10; // Target gold to collect
    this.collectedGold = 0;
  }

  init() {
    // Spawn Bank Vault
    this.spawnBank();
    // Spawn Gold
    this.spawnGold(this.totalGold);
  }

  spawnBank() {
    // Find a spot for the bank (preferably near center or a specific edge)
    // For simplicity, let's put it near the center
    const midX = Math.floor(this.room.width / 2);
    const midY = Math.floor(this.room.height / 2);

    // Find nearest floor tile
    let found = false;
    let radius = 0;
    while (!found && radius < 10) {
      for (let y = midY - radius; y <= midY + radius; y++) {
        for (let x = midX - radius; x <= midX + radius; x++) {
          if (y >= 0 && y < this.room.height && x >= 0 && x < this.room.width) {
            if (this.room.map[y][x] === TILES.FLOOR) {
              this.room.map[y][x] = TILES.BANK;
              this.bankLocation = { x, y };
              found = true;
              break;
            }
          }
        }
        if (found) break;
      }
      radius++;
    }

    if (this.bankLocation) {
      this.room.broadcastMapChange([{ x: this.bankLocation.x, y: this.bankLocation.y, tile: TILES.BANK }]);
    }
  }

  spawnGold(count) {
    let placed = 0;
    let attempts = 0;
    const maxAttempts = 1000;

    while (placed < count && attempts < maxAttempts) {
      attempts++;
      const x = Math.floor(Math.random() * (this.room.width - 2)) + 1;
      const y = Math.floor(Math.random() * (this.room.height - 2)) + 1;

      if (this.room.map[y][x] === TILES.FLOOR) {
        this.room.map[y][x] = TILES.GOLD;
        placed++;
      }
    }

    // We don't broadcast map change here because this is called during init, 
    // but if called later we should.
  }

  update() {
    if (this.room.state.phase !== PHASES.PLAYING) return;

    // Check for player deaths (same as survival for now)
    this.room.players.forEach(player => {
      if (player.isDead) return;
      if (player.oxygen <= 0) this.killPlayer(player, 'ran out of oxygen');
      const hitByAlien = this.room.aliens.some(alien => alien.x === player.x && alien.y === player.y);
      if (hitByAlien) this.killPlayer(player, 'was eaten by an alien');
    });

    this.checkWinCondition();
  }

  handleCollect(player, x, y, tile) {
    if (tile === TILES.GOLD) {
      player.gold = (player.gold || 0) + 1;
      this.room.map[y][x] = TILES.FLOOR;
      this.room.broadcastMapChange([{ x, y, tile: TILES.FLOOR }]);

      this.room.chatHistory.push({
        type: 'system',
        message: `${getPlayerName(player.id)} picked up gold! (${player.gold} held)`,
        timestamp: Date.now()
      });
      return true;
    }
    return false;
  }

  handleMove(player, newX, newY) {
    // Check if moved onto bank
    if (this.bankLocation && newX === this.bankLocation.x && newY === this.bankLocation.y) {
      if (player.gold > 0) {
        this.collectedGold += player.gold;
        const deposited = player.gold;
        player.gold = 0;

        this.room.chatHistory.push({
          type: 'system',
          message: `${getPlayerName(player.id)} deposited ${deposited} gold! Total: ${this.collectedGold}/${this.totalGold}`,
          timestamp: Date.now()
        });

        this.room.broadcast({
          type: 'chat',
          message: `Deposited ${deposited} gold!`,
          playerId: player.id
        });
      }
    }
  }

  killPlayer(player, reason) {
    if (player.isDead) return;
    player.isDead = true;

    // Drop gold on death?
    if (player.gold > 0) {
      if (this.room.map[player.y][player.x] === TILES.FLOOR) {
        this.room.map[player.y][player.x] = TILES.GOLD;
        this.room.broadcastMapChange([{ x: player.x, y: player.y, tile: TILES.GOLD }]);
        player.gold = 0;
      }
    }

    this.room.broadcast({
      type: 'playerDied',
      playerId: player.id,
      reason: reason
    });
  }

  checkWinCondition() {
    if (this.collectedGold >= this.totalGold) {
      this.room.state.setPhase(PHASES.GAME_OVER);
      this.room.state.winner = 'Players';
      this.room.broadcast({
        type: 'gameOver',
        winner: 'Players'
      });
    }

    // Fail if everyone dead
    const activePlayers = Array.from(this.room.players.values()).filter(p => !p.isDead);
    if (activePlayers.length === 0 && this.room.players.size > 0) {
      this.room.state.setPhase(PHASES.GAME_OVER);
      this.room.state.winner = 'Aliens';
      this.room.broadcast({
        type: 'gameOver',
        winner: 'Aliens'
      });
    }
  }
}

class CaptureTheFlagMode extends GameModeHandler {
  constructor(gameRoom) {
    super(gameRoom);
    this.room = gameRoom;
    this.scores = { RED: 0, BLUE: 0 };
    this.flags = {
      RED: { x: 0, y: 0, carrier: null, home: { x: 0, y: 0 } },
      BLUE: { x: 0, y: 0, carrier: null, home: { x: 0, y: 0 } }
    };
    this.winScore = 3;
  }

  init() {
    // Place Bases and Flags
    // Red Base (Top Leftish)
    this.flags.RED.home = { x: 2, y: 2 };
    this.flags.RED.x = 2;
    this.flags.RED.y = 2;
    this.room.map[2][2] = TILES.FLAG_RED;
    this.room.map[2][1] = TILES.BASE_RED; // Base marker next to flag

    // Blue Base (Bottom Rightish)
    const bx = this.room.width - 3;
    const by = this.room.height - 3;
    this.flags.BLUE.home = { x: bx, y: by };
    this.flags.BLUE.x = bx;
    this.flags.BLUE.y = by;
    this.room.map[by][bx] = TILES.FLAG_BLUE;
    this.room.map[by][bx - 1] = TILES.BASE_BLUE;

    this.room.broadcastMapChange([
      { x: 2, y: 2, tile: TILES.FLAG_RED },
      { x: 2, y: 1, tile: TILES.BASE_RED },
      { x: bx, y: by, tile: TILES.FLAG_BLUE },
      { x: bx, y: by - 1, tile: TILES.BASE_BLUE }
    ]);
  }

  onPlayerJoin(player) {
    // Assign Team
    const redCount = Array.from(this.room.players.values()).filter(p => p.team === 'RED').length;
    const blueCount = Array.from(this.room.players.values()).filter(p => p.team === 'BLUE').length;

    player.team = redCount <= blueCount ? 'RED' : 'BLUE';
    player.color = player.team === 'RED' ? '#ff4444' : '#4444ff';

    this.room.broadcast({
      type: 'chat',
      message: `${getPlayerName(player.id)} joined team ${player.team}`,
      playerId: null // System message
    });
  }

  update() {
    if (this.room.state.phase !== PHASES.PLAYING) return;

    // Check win condition
    if (this.scores.RED >= this.winScore) this.endGame('RED');
    if (this.scores.BLUE >= this.winScore) this.endGame('BLUE');
  }

  handleMove(player, newX, newY) {
    if (!player.team) return;

    const enemyTeam = player.team === 'RED' ? 'BLUE' : 'RED';
    const enemyFlag = this.flags[enemyTeam];
    const myFlag = this.flags[player.team];

    // 1. Pick up enemy flag
    if (!enemyFlag.carrier && newX === enemyFlag.x && newY === enemyFlag.y) {
      enemyFlag.carrier = player.id;
      // Remove flag from map
      this.room.map[newY][newX] = TILES.FLOOR; // Or base tile if at home
      this.room.broadcastMapChange([{ x: newX, y: newY, tile: TILES.FLOOR }]);

      this.room.broadcast({
        type: 'chat',
        message: `${getPlayerName(player.id)} picked up the ${enemyTeam} flag!`,
        playerId: null
      });
    }

    // 2. Capture flag (bring enemy flag to my base)
    // Check if at my base (simple check: near my flag's home)
    const distToHome = Math.abs(newX - myFlag.home.x) + Math.abs(newY - myFlag.home.y);
    if (enemyFlag.carrier === player.id && distToHome <= 1) {
      // Capture!
      this.scores[player.team]++;
      enemyFlag.carrier = null;
      enemyFlag.x = enemyFlag.home.x;
      enemyFlag.y = enemyFlag.home.y;

      // Restore flag on map
      this.room.map[enemyFlag.y][enemyFlag.x] = enemyTeam === 'RED' ? TILES.FLAG_RED : TILES.FLAG_BLUE;
      this.room.broadcastMapChange([{ x: enemyFlag.x, y: enemyFlag.y, tile: this.room.map[enemyFlag.y][enemyFlag.x] }]);

      this.room.broadcast({
        type: 'chat',
        message: `${getPlayerName(player.id)} captured the ${enemyTeam} flag! Score: RED ${this.scores.RED} - BLUE ${this.scores.BLUE}`,
        playerId: null
      });
    }
  }

  killPlayer(player, reason) {
    if (player.isDead) return;
    player.isDead = true;

    // Drop flag if carrying
    ['RED', 'BLUE'].forEach(team => {
      if (this.flags[team].carrier === player.id) {
        this.flags[team].carrier = null;
        // Return to home immediately (simple rule)
        this.flags[team].x = this.flags[team].home.x;
        this.flags[team].y = this.flags[team].home.y;

        const tile = team === 'RED' ? TILES.FLAG_RED : TILES.FLAG_BLUE;
        this.room.map[this.flags[team].y][this.flags[team].x] = tile;
        this.room.broadcastMapChange([{ x: this.flags[team].x, y: this.flags[team].y, tile: tile }]);

        this.room.broadcast({
          type: 'chat',
          message: `${team} flag returned to base!`,
          playerId: null
        });
      }
    });

    this.room.broadcast({
      type: 'playerDied',
      playerId: player.id,
      reason: reason
    });
  }

  endGame(winnerTeam) {
    this.room.state.setPhase(PHASES.GAME_OVER);
    this.room.state.winner = winnerTeam;
    this.room.broadcast({
      type: 'gameOver',
      winner: winnerTeam + ' Team'
    });
  }
}

class KingOfTheHillMode extends GameModeHandler {
  constructor(gameRoom) {
    super(gameRoom);
    this.room = gameRoom;
    this.scores = {}; // playerId -> score
    this.hill = { x: 0, y: 0, width: 3, height: 3 };
    this.winScore = 1000; // Ticks
  }

  init() {
    // Create Hill in center
    const cx = Math.floor(this.room.width / 2) - 1;
    const cy = Math.floor(this.room.height / 2) - 1;
    this.hill = { x: cx, y: cy, width: 3, height: 3 };

    const changes = [];
    for (let y = cy; y < cy + 3; y++) {
      for (let x = cx; x < cx + 3; x++) {
        if (y >= 0 && y < this.room.height && x >= 0 && x < this.room.width) {
          this.room.map[y][x] = TILES.HILL;
          changes.push({ x, y, tile: TILES.HILL });
        }
      }
    }
    this.room.broadcastMapChange(changes);
  }

  update() {
    if (this.room.state.phase !== PHASES.PLAYING) return;

    // Check players on hill
    this.room.players.forEach(player => {
      if (player.isDead) return;

      if (player.x >= this.hill.x && player.x < this.hill.x + this.hill.width &&
        player.y >= this.hill.y && player.y < this.hill.y + this.hill.height) {

        this.scores[player.id] = (this.scores[player.id] || 0) + 1;

        // Check win
        if (this.scores[player.id] >= this.winScore) {
          this.room.state.setPhase(PHASES.GAME_OVER);
          this.room.state.winner = getPlayerName(player.id);
          this.room.broadcast({
            type: 'gameOver',
            winner: getPlayerName(player.id)
          });
        }
      }
    });
  }
}

// ─── Server Event System ──────────────────────────────────────────────────────

const SERVER_EVENTS = [
  {
    id: 'ALIEN_SURGE',
    name: 'ALIEN SURGE',
    description: 'A wave of aliens floods the sector!',
    type: 'destructive',
    duration: 20000,
    canActivate: (room) => room.settings.enableAliens,
    execute(room) {
      const before = room.aliens.length;
      room._spawnAliens(3);
      this._surgeCount = room.aliens.length - before;
    },
    cleanup(room) {
      if (this._surgeCount > 0) {
        room.aliens.splice(room.aliens.length - this._surgeCount, this._surgeCount);
        this._surgeCount = 0;
      }
    }
  },
  {
    id: 'O2_DRAIN',
    name: 'OXYGEN BLEED',
    description: 'Emergency: oxygen reserves compromised!',
    type: 'destructive',
    duration: 0,
    canActivate: (room) => room.settings.oxygenDepletion,
    execute(room) {
      room.players.forEach(player => {
        if (!player.isDead) {
          player.oxygen = Math.max(0, player.oxygen - Math.floor(player.maxOxygen * 0.3));
        }
      });
    },
    cleanup() {}
  },
  {
    id: 'METEOR_SHOWER',
    name: 'METEOR SHOWER',
    description: 'Debris is reshaping the terrain!',
    type: 'destructive',
    duration: 15000,
    canActivate: () => true,
    execute(room) {
      this._changedTiles = [];
      const playerOccupied = new Set();
      room.players.forEach(p => playerOccupied.add(`${p.x},${p.y}`));
      const floorTiles = [];
      for (let y = 1; y < room.height - 1; y++) {
        for (let x = 1; x < room.width - 1; x++) {
          if (room.map[y][x] === TILES.FLOOR && !playerOccupied.has(`${x},${y}`)) {
            floorTiles.push({ x, y });
          }
        }
      }
      const count = Math.min(8, Math.floor(floorTiles.length * 0.05));
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(Math.random() * floorTiles.length);
        const { x, y } = floorTiles.splice(idx, 1)[0];
        room.map[y][x] = TILES.WALL;
        this._changedTiles.push({ x, y });
      }
      if (this._changedTiles.length > 0) {
        room.broadcastMapChange(this._changedTiles.map(t => ({ x: t.x, y: t.y, tile: TILES.WALL })));
      }
    },
    cleanup(room) {
      if (this._changedTiles && this._changedTiles.length > 0) {
        this._changedTiles.forEach(({ x, y }) => { room.map[y][x] = TILES.FLOOR; });
        room.broadcastMapChange(this._changedTiles.map(t => ({ x: t.x, y: t.y, tile: TILES.FLOOR })));
        this._changedTiles = [];
      }
    }
  },
  {
    id: 'OXYGEN_BONUS',
    name: 'OXYGEN CACHE',
    description: 'Emergency oxygen reserves deployed!',
    type: 'creational',
    duration: 0,
    canActivate: (room) => room.settings.oxygenDepletion,
    execute(room) {
      const changes = [];
      let placed = 0;
      for (let attempts = 0; attempts < 100 && placed < 5; attempts++) {
        const x = 1 + Math.floor(Math.random() * (room.width - 2));
        const y = 1 + Math.floor(Math.random() * (room.height - 2));
        if (room.map[y][x] === TILES.FLOOR) {
          room.map[y][x] = TILES.DROPLET;
          changes.push({ x, y, tile: TILES.DROPLET });
          placed++;
        }
      }
      if (changes.length > 0) room.broadcastMapChange(changes);
    },
    cleanup() {}
  },
  {
    id: 'SPEED_BOOST',
    name: 'WARP FIELD',
    description: 'Aliens are moving at hyperspeed!',
    type: 'modificative',
    duration: 15000,
    canActivate: (room) => room.settings.enableAliens && room.aliens.length > 0,
    execute(room) {
      this._prevTickMs = room.alienBaseTickMs;
      room.alienBaseTickMs = Math.floor(room.alienBaseTickMs / 2);
      room._restartAlienTimer();
    },
    cleanup(room) {
      room.alienBaseTickMs = this._prevTickMs;
      room._restartAlienTimer();
    }
  },
  {
    id: 'LIGHTS_OUT',
    name: 'LIGHTS OUT',
    description: 'Visibility systems offline!',
    type: 'modificative',
    duration: 12000,
    canActivate: (room) => !room.settings.darkRoom,
    execute(room) {
      room.settings.darkRoom = true;
    },
    cleanup(room) {
      room.settings.darkRoom = false;
    }
  }
];

class ServerEventSystem {
  constructor(room) {
    this.room = room;
    this._timer = null;
    this._cleanupTimer = null;
    this._active = null;
  }

  start() {
    this._scheduleNext();
  }

  stop() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this._cleanupTimer) { clearTimeout(this._cleanupTimer); this._cleanupTimer = null; }
    if (this._active) {
      try { this._active.cleanup(this.room); } catch (e) { /* ignore cleanup errors on stop */ }
      this._active = null;
    }
  }

  _scheduleNext() {
    const delay = 20000 + Math.random() * 20000; // 20–40s
    this._timer = setTimeout(() => this._triggerRandom(), delay);
  }

  _triggerRandom() {
    if (this.room.state.phase !== PHASES.PLAYING) {
      this._scheduleNext();
      return;
    }

    const eligible = SERVER_EVENTS.filter(e => e.canActivate(this.room));
    if (eligible.length === 0) { this._scheduleNext(); return; }

    // Clone so per-execution state (_changedTiles etc.) doesn't persist across firings
    const template = eligible[Math.floor(Math.random() * eligible.length)];
    const event = Object.assign({}, template);

    // Phase 1: Warning (3s)
    this.room.broadcast({ type: 'serverEvent', phase: 'warning', id: event.id, name: event.name, description: event.description });

    setTimeout(() => {
      if (this.room.state.phase !== PHASES.PLAYING) {
        this.room.broadcast({ type: 'serverEvent', phase: 'ended', id: event.id });
        this._scheduleNext();
        return;
      }

      // Phase 2: Active
      this.room.broadcast({ type: 'serverEvent', phase: 'active', id: event.id, name: event.name, description: event.description });
      this._active = event;
      try { event.execute(this.room); } catch (e) { console.error(`[ServerEvent] execute ${event.id}:`, e); }

      const endEvent = () => {
        try { event.cleanup(this.room); } catch (e) { console.error(`[ServerEvent] cleanup ${event.id}:`, e); }
        this._active = null;
        this.room.broadcast({ type: 'serverEvent', phase: 'ended', id: event.id });
        this._scheduleNext();
      };

      if (event.duration > 0) {
        this._cleanupTimer = setTimeout(endEvent, event.duration);
      } else {
        // Instant events: show active banner briefly then end
        this._active = null;
        this._cleanupTimer = setTimeout(() => {
          this.room.broadcast({ type: 'serverEvent', phase: 'ended', id: event.id });
          this._scheduleNext();
        }, 2000);
      }
    }, 3000);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

class GameRoom {
  constructor(roomId, settings = {}) {
    this.roomId = roomId;
    this.settings = {
      dropletCount: settings.dropletCount !== undefined ? settings.dropletCount : 5,
      boxCount: settings.boxCount !== undefined ? settings.boxCount : 5,
      enemyCount: settings.enemyCount !== undefined ? settings.enemyCount : 3,
      darkRoom: settings.darkRoom || false,
      enableAliens: settings.enableAliens !== undefined ? settings.enableAliens : true,
      oxygenDepletion: settings.oxygenDepletion !== undefined ? settings.oxygenDepletion : true,
      gameMode: settings.gameMode || MODES.SURVIVAL
    };
    console.log(`[Room ${roomId}] Created with settings:`, this.settings);
    this.players = new Map();
    this.width = 40;
    this.height = 20;

    // Initialize Game State
    this.state = new GameState();

    // Select Mode Handler
    switch (this.settings.gameMode) {
      case MODES.ROB_BANK:
        this.modeHandler = new RobBankMode(this);
        break;
      case MODES.CAPTURE_FLAG:
        this.modeHandler = new CaptureTheFlagMode(this);
        break;
      case MODES.KING_HILL:
        this.modeHandler = new KingOfTheHillMode(this);
        break;
      case MODES.SURVIVAL:
      default:
        this.modeHandler = new SurvivalMode(this);
        break;
    }

    // Use generateMap if available, otherwise fallback
    try {
      const mapOpts = {
        dropletCount: this.settings.dropletCount,
        boxCount: this.settings.boxCount
      };
      this.map = (typeof generateMap === 'function') ? generateMap(this.width, this.height, mapOpts) : generateSimpleMap(this.width, this.height);
    } catch (e) {
      this.map = generateSimpleMap(this.width, this.height);
    }

    // Initialize mode-specific map elements
    if (this.modeHandler.init) {
      this.modeHandler.init();
    }

    // Aliens list - managed server-side for synchronization
    this.aliens = [];
    this.alienBaseTickMs = 700; // Base alien movement interval
    this.targetAcquired = false; // When true, aliens use BFS to hunt nearest player



    // Boxes - track positions and contents server-side
    this.boxes = [];
    this._populateBoxes();

    // Active bombs - track bomb placements
    this.bombs = [];

    // Chat history - store all messages in this room
    this.chatHistory = [];
    this.maxChatHistory = 100; // Limit to last 100 messages

    // Spawn initial aliens (only if enabled)
    if (this.settings.enableAliens) {
      this._spawnAliens(this.settings.enemyCount);
    }

    // Start the game loop for this room
    this._startGameLoop();

    // Server event system (starts when game begins, not in lobby)
    this.eventSystem = new ServerEventSystem(this);

    // Host management
    this.hostId = null;
    this.state.setPhase(PHASES.LOBBY);

  }



  // Populate boxes with contents (server-authoritative)
  _populateBoxes() {
    this.boxes = [];
    const boxSymbol = TILES.BOX;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.map[y] && this.map[y][x] === boxSymbol) {
          // Randomly assign content: 50% bomb, 50% oxygen
          const content = Math.random() < 0.5 ? 'bomb' : 'oxygen';
          this.boxes.push({ x, y, content });
        }
      }
    }
  }

  // Find box at position
  // Uses shared utility
  findBoxAt(x, y) {
    return findBoxAt(this.boxes, x, y);
  }

  // Find bomb at position
  findBombAt(x, y) {
    return findBombAt(this.bombs, x, y);
  }

  // Generate a random light color (pastel/light colors)
  _generatePlayerColor() {
    const lightColors = [
      '#FFB6C1', // Light Pink
      '#FFD700', // Gold
      '#87CEEB', // Sky Blue
      '#98FB98', // Pale Green
      '#F0E68C', // Khaki
      '#DDA0DD', // Plum
      '#FFA07A', // Light Salmon
      '#20B2AA', // Light Sea Green
      '#FFE4B5', // Moccasin
      '#B0E0E6', // Powder Blue
      '#FF69B4', // Hot Pink
      '#00CED1', // Dark Turquoise
      '#FFDAB9', // Peach Puff
      '#E0E6FF', // Lavender
      '#FFE4E1', // Misty Rose
      '#F5FFFA', // Mint Cream
    ];
    return lightColors[Math.floor(Math.random() * lightColors.length)];
  }

  // Find spawn position at a specific edge
  _findEdgeSpawn(edgeIndex) {
    const edges = [
      // Top edge (y = 0)
      () => {
        const midX = Math.floor(this.width / 2);
        for (let x = 0; x < this.width; x++) {
          const checkX = (midX + x) % this.width;
          if (this.map[0] && this.map[0][checkX] === TILES.FLOOR) {
            return { x: checkX, y: 0 };
          }
        }
        return null;
      },
      // Bottom edge (y = height - 1)
      () => {
        const midX = Math.floor(this.width / 2);
        const lastY = this.height - 1;
        for (let x = 0; x < this.width; x++) {
          const checkX = (midX + x) % this.width;
          if (this.map[lastY] && this.map[lastY][checkX] === TILES.FLOOR) {
            return { x: checkX, y: lastY };
          }
        }
        return null;
      },
      // Left edge (x = 0)
      () => {
        const midY = Math.floor(this.height / 2);
        for (let y = 0; y < this.height; y++) {
          const checkY = (midY + y) % this.height;
          if (this.map[checkY] && this.map[checkY][0] === TILES.FLOOR) {
            return { x: 0, y: checkY };
          }
        }
        return null;
      },
      // Right edge (x = width - 1)
      () => {
        const midY = Math.floor(this.height / 2);
        const lastX = this.width - 1;
        for (let y = 0; y < this.height; y++) {
          const checkY = (midY + y) % this.height;
          if (this.map[checkY] && this.map[checkY][lastX] === TILES.FLOOR) {
            return { x: lastX, y: checkY };
          }
        }
        return null;
      }
    ];

    // Try the specified edge first
    if (edgeIndex < edges.length) {
      const pos = edges[edgeIndex]();
      if (pos) return pos;
    }

    // Fallback: try all edges in order
    for (let i = 0; i < edges.length; i++) {
      const pos = edges[i]();
      if (pos) return pos;
    }

    // Last resort: find any floor tile
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.map[y] && this.map[y][x] === TILES.FLOOR) {
          return { x, y };
        }
      }
    }
    return { x: 1, y: 1 };
  }

  addPlayer(playerId, ws) {
    // Assign player to a different edge based on current player count
    const playerCount = this.players.size;
    const edgeIndex = playerCount % 4; // Cycle through 4 edges: top, bottom, left, right
    const spawnPos = this._findEdgeSpawn(edgeIndex);

    // Generate a random light color for this player
    const color = this._generatePlayerColor();

    const player = {
      id: playerId,
      ws: ws,
      x: spawnPos.x,
      y: spawnPos.y,
      color: color,
      // Player inventory (server-authoritative)
      bombs: 3,
      oxygen: 200,
      jumps: 1,
      dash: false,
      maxOxygen: 200,
      draggedWall: null, // {x, y} when dragging a wall
      isDead: false
    };

    // Assign host if none exists
    if (!this.hostId) {
      this.hostId = playerId;
    }

    this.players.set(playerId, player);

    // Mode-specific join logic (e.g. team assignment)
    if (this.modeHandler && this.modeHandler.onPlayerJoin) {
      this.modeHandler.onPlayerJoin(player);
    }

  }

  removePlayer(playerId) {
    this.players.delete(playerId);

    // Host migration
    if (playerId === this.hostId) {
      this.hostId = null;
      if (this.players.size > 0) {
        // Assign next player as host
        this.hostId = this.players.keys().next().value;
        this.chatHistory.push({
          type: 'system',
          message: `${getPlayerName(this.hostId)} is now the host`,
          timestamp: Date.now()
        });
      }
    }

    this.broadcastLobbyState();

    // If room is empty, close it immediately
    if (this.players.size === 0) {
      this._stopGameLoop();
      delete rooms[this.roomId];
      console.log(`Room ${this.roomId} closed (all players left)`);
    }
  }

  // Broadcast map change to all clients
  broadcastMapChange(changes) {
    if (changes.length === 0) return;
    this.broadcast({
      type: 'mapChange',
      changes: changes
    });
  }

  // Handle collecting an item at position
  handleCollect(playerId, x, y) {
    const player = this.players.get(playerId);
    if (!player || player.isDead) return false;

    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return false;
    if (!this.map[y] || !this.map[y][x]) return false;

    const tile = this.map[y][x];
    const changes = [];

    // Collect oxygen pump
    if (tile === TILES.PUMP) {
      const gained = 25; // PUMP_VALUE_DEFAULT
      player.oxygen = Math.min(player.maxOxygen, player.oxygen + gained);
      this.map[y][x] = TILES.FLOOR;
      changes.push({ x, y, tile: TILES.FLOOR });
      this.broadcastMapChange(changes);
      return true;
    }

    // Collect droplet
    if (tile === TILES.DROPLET) {
      player.oxygen = player.maxOxygen;
      this.map[y][x] = TILES.FLOOR;
      changes.push({ x, y, tile: TILES.FLOOR });
      this.broadcastMapChange(changes);
      return true;
    }

    // Collect box
    const box = this.findBoxAt(x, y);
    if (box && tile === TILES.BOX) {
      if (box.content === 'bomb') {
        player.bombs = (player.bombs || 0) + 1;
      } else if (box.content === 'oxygen') {
        const gained = 25;
        player.oxygen = Math.min(player.maxOxygen, player.oxygen + gained);
      }
      // Remove box
      this.map[y][x] = TILES.FLOOR;
      const idx = this.boxes.indexOf(box);
      if (idx !== -1) this.boxes.splice(idx, 1);
      changes.push({ x, y, tile: TILES.FLOOR });
      this.broadcastMapChange(changes);
      return true;
    }

    // Collect map bomb
    if (tile === TILES.BOMB) {
      player.bombs = (player.bombs || 0) + 1;
      this.map[y][x] = TILES.FLOOR;
      changes.push({ x, y, tile: TILES.FLOOR });
      this.broadcastMapChange(changes);
      return true;
    }

    // Delegate to mode handler for custom items (like Gold)
    if (this.modeHandler && this.modeHandler.handleCollect) {
      if (this.modeHandler.handleCollect(player, x, y, tile)) {
        return true;
      }
    }

    return false;
  }

  // Handle pushing an object
  handlePush(playerId, fromX, fromY, toX, toY) {
    const player = this.players.get(playerId);
    if (!player || player.isDead) return false;

    // Validate push
    if (fromX < 0 || fromY < 0 || fromX >= this.width || fromY >= this.height) return false;
    if (toX < 0 || toY < 0 || toX >= this.width || toY >= this.height) return false;
    if (!this.map[fromY] || this.map[fromY][fromX] !== TILES.PUSHABLE) return false; // Must be pushable
    if (!this.map[toY] || this.map[toY][toX] !== TILES.FLOOR) return false; // Destination must be floor

    // Check if this wall is being dragged by someone
    let isBeingDragged = false;
    this.players.forEach(p => {
      if (p.draggedWall && p.draggedWall.x === fromX && p.draggedWall.y === fromY) {
        isBeingDragged = true;
      }
    });
    if (isBeingDragged) return false;

    // Perform push
    this.map[fromY][fromX] = TILES.FLOOR;
    this.map[toY][toX] = TILES.PUSHABLE;



    this.broadcastMapChange([
      { x: fromX, y: fromY, tile: TILES.FLOOR },
      { x: toX, y: toY, tile: TILES.PUSHABLE }
    ]);
    return true;
  }

  // Handle placing a bomb
  handlePlaceBomb(playerId, x, y) {
    const player = this.players.get(playerId);
    if (!player || player.isDead) return false;

    // Validate
    // Validate using shared logic
    if (!canPlaceBomb(this.map, this.bombs, x, y, this.width, this.height, TILES.WALL)) return false;

    // Place bomb
    player.bombs -= 1;
    const bomb = { x, y, blinkOn: false, delay: 800, minDelay: 80, stopped: false, placedAt: Date.now() };
    this.bombs.push(bomb);

    // Start bomb timer (simplified - in real implementation, handle in game loop)
    const tick = () => {
      if (bomb.stopped) return;
      bomb.blinkOn = !bomb.blinkOn;
      bomb.delay = Math.max(bomb.minDelay, Math.floor(bomb.delay * 0.75));

      if (bomb.delay <= bomb.minDelay) {
        // Explode
        setTimeout(() => {
          if (bomb.stopped) return;
          this.map[bomb.y][bomb.x] = TILES.FLOOR;
          const idx = this.bombs.indexOf(bomb);
          if (idx !== -1) this.bombs.splice(idx, 1);

          // Check for aliens in the explosion
          for (let i = this.aliens.length - 1; i >= 0; i--) {
            const alien = this.aliens[i];
            // Simple collision: exact tile match
            if (alien.x === bomb.x && alien.y === bomb.y) {
              this.aliens.splice(i, 1);
              console.log(`Alien killed at ${alien.x},${alien.y}`);
            }
          }

          this.broadcastMapChange([{ x: bomb.x, y: bomb.y, tile: TILES.FLOOR }]);
        }, bomb.delay);
      } else {
        setTimeout(tick, bomb.delay);
      }

      // Broadcast bomb state update
      this.broadcast({
        type: 'bombUpdate',
        bomb: { x: bomb.x, y: bomb.y, blinkOn: bomb.blinkOn }
      });
    };

    setTimeout(() => tick(), bomb.delay);
    return true;
  }

  // Handle dragging a wall
  handleDrag(playerId, wallX, wallY, isDragging) {
    const player = this.players.get(playerId);
    if (!player || player.isDead) return false;

    if (isDragging) {
      // Validate wall is adjacent to player
      const dx = Math.abs(wallX - player.x);
      const dy = Math.abs(wallY - player.y);
      if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
        // Check if it's a pushable wall
        if (this.map[wallY] && this.map[wallY][wallX] === TILES.PUSHABLE) {
          // Check if another player is already dragging this wall
          let alreadyDragged = false;
          this.players.forEach((p, pid) => {
            if (pid !== playerId && p.draggedWall && p.draggedWall.x === wallX && p.draggedWall.y === wallY) {
              alreadyDragged = true;
            }
          });

          if (!alreadyDragged) {
            player.draggedWall = { x: wallX, y: wallY };
            return true;
          }
        }
      }
      return false;
    } else {
      // Release drag
      player.draggedWall = null;
      return true;
    }
  }

  handlePlayerInput(playerId, data) {
    const player = this.players.get(playerId);
    if (!player || player.isDead) return;

    switch (data.type) {
      case 'move':
        // Clamp to map bounds (tile-based coordinates)
        const newX = Math.max(0, Math.min(this.width - 1, data.x));
        const newY = Math.max(0, Math.min(this.height - 1, data.y));
        // Check if the target tile is walkable using shared logic
        if (isWalkable(this.map, newX, newY, this.width, this.height, TILES.WALL)) {
          // Check for player collision
          let occupied = false;
          for (const [pid, p] of this.players) {
            if (pid !== playerId && p.x === newX && p.y === newY && !p.isDead) {
              occupied = true;
              break;
            }
          }
          if (occupied) return;

          const oldX = player.x;
          const oldY = player.y;

          player.x = newX;
          player.y = newY;

          // Handle dragged wall movement
          if (player.draggedWall) {
            const wallX = player.draggedWall.x;
            const wallY = player.draggedWall.y;

            // Verify wall still exists (it might have been destroyed or pushed)
            if (this.map[wallY] && this.map[wallY][wallX] === TILES.PUSHABLE) {
              // Check if old position is valid for wall placement
              if (this.map[oldY] && this.map[oldY][oldX] === TILES.FLOOR) {
                // Move wall from current position to player's old position
                this.map[wallY][wallX] = TILES.FLOOR;
                this.map[oldY][oldX] = TILES.PUSHABLE;

                // Update dragged wall coordinates
                player.draggedWall = { x: oldX, y: oldY };

                // Broadcast map changes
                this.broadcastMapChange([
                  { x: wallX, y: wallY, tile: TILES.FLOOR },
                  { x: oldX, y: oldY, tile: TILES.PUSHABLE }
                ]);
              } else {
                // Can't place wall (blocked), release it
                player.draggedWall = null;
              }
            } else {
              // Wall is gone, release drag
              player.draggedWall = null;
            }
          }

          // Auto-collect items when moving onto them
          this.handleCollect(playerId, newX, newY);

          // Decrease oxygen on move (if enabled)
          if (this.settings.oxygenDepletion && player.oxygen > 0) {
            player.oxygen--;
          }

          // Delegate move event to mode handler (e.g. for bank deposit)
          if (this.modeHandler && this.modeHandler.handleMove) {
            this.modeHandler.handleMove(player, newX, newY);
          }
        }
        break;

      case 'toggleTargetAcquired':
        this.targetAcquired = !this.targetAcquired;
        this._restartAlienTimer();
        this.broadcast({
          type: 'targetAcquiredChanged',
          active: this.targetAcquired
        });
        break;

      case 'action':
        if (data.action === 'collect') {
          this.handleCollect(playerId, data.x, data.y);
        } else if (data.action === 'push') {
          this.handlePush(playerId, data.fromX, data.fromY, data.toX, data.toY);
        } else if (data.action === 'placeBomb') {
          this.handlePlaceBomb(playerId, data.x, data.y);
        } else if (data.action === 'drag') {
          this.handleDrag(playerId, data.wallX, data.wallY, data.isDragging);
        } else {
          player.action = data.action;
        }
        break;
    }
  }

  _spawnAliens(count = 3) {
    let placed = 0;
    const maxAttempts = this.width * this.height * 5;
    let attempts = 0;

    // Create sets for quick lookup
    const playerPositions = new Set();
    this.players.forEach(p => {
      playerPositions.add(`${p.x},${p.y}`);
    });
    const alienPositions = new Set();
    this.aliens.forEach(a => {
      alienPositions.add(`${a.x},${a.y}`);
    });

    while (placed < count && attempts < maxAttempts) {
      attempts++;
      const x = Math.floor(Math.random() * (this.width - 2)) + 1;
      const y = Math.floor(Math.random() * (this.height - 2)) + 1;

      // Check if tile is floor and not occupied by a player or alien
      if (this.map[y] && this.map[y][x] === TILES.FLOOR) {
        const posKey = `${x},${y}`;
        if (!playerPositions.has(posKey) && !alienPositions.has(posKey)) {
          this.aliens.push({ x, y });
          alienPositions.add(posKey); // Track it so we don't place another here
          placed++;
        }
      }
    }
  }

  // BFS: returns the first step an alien at (ax, ay) should take toward the nearest active player.
  // Returns [nx, ny] or null if no path found.
  _alienBfsStep(ax, ay, aliensSelf) {
    const activePlayers = Array.from(this.players.values()).filter(p => !p.isDead);
    if (activePlayers.length === 0) return null;

    const alienPositions = new Set(this.aliens.filter(a => a !== aliensSelf).map(a => `${a.x},${a.y}`));
    const targets = new Set(activePlayers.map(p => `${p.x},${p.y}`));
    const deltas = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    // BFS from alien position
    const visited = new Set([`${ax},${ay}`]);
    // Queue entries: [x, y, firstStepX, firstStepY]
    const queue = [];

    for (const [dx, dy] of deltas) {
      const nx = ax + dx, ny = ay + dy;
      if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
      const key = `${nx},${ny}`;
      if (visited.has(key)) continue;
      const tile = this.map[ny]?.[nx];
      if (tile !== TILES.FLOOR) continue;
      visited.add(key);
      if (targets.has(key)) return [nx, ny]; // adjacent player — move there
      if (!alienPositions.has(key)) queue.push([nx, ny, nx, ny]);
    }

    let head = 0;
    while (head < queue.length) {
      const [cx, cy, fx, fy] = queue[head++];
      for (const [dx, dy] of deltas) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
        const key = `${nx},${ny}`;
        if (visited.has(key)) continue;
        const tile = this.map[ny]?.[nx];
        if (tile !== TILES.FLOOR) continue;
        visited.add(key);
        if (targets.has(key)) return [fx, fy]; // found a player — return first step
        if (!alienPositions.has(key)) queue.push([nx, ny, fx, fy]);
      }
    }

    return null; // no path found
  }

  _stepAliens() {
    const deltas = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    // Iterate from end so we can splice safely
    for (let i = this.aliens.length - 1; i >= 0; i--) {
      const a = this.aliens[i];
      const ax = a.x, ay = a.y;

      // Get all player positions to avoid collisions
      const playerPositions = new Set();
      this.players.forEach(p => {
        if (!p.isDead) playerPositions.add(`${p.x},${p.y}`);
      });

      let chosenTile = null;

      if (this.targetAcquired) {
        // BFS toward nearest player, ignoring player tiles as obstacles (alien kills on contact)
        chosenTile = this._alienBfsStep(ax, ay, a);
      }

      if (!chosenTile) {
        // Random walk (fallback or default mode)
        const candidates = [];
        for (const [dx, dy] of deltas) {
          const nx = ax + dx, ny = ay + dy;
          if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
          if (this.map[ny] && this.map[ny][nx] === TILES.FLOOR && !playerPositions.has(`${nx},${ny}`)) {
            const alienAtPos = this.aliens.some(other => other !== a && other.x === nx && other.y === ny);
            if (!alienAtPos) candidates.push([nx, ny]);
          }
        }
        if (candidates.length === 0) {
          this.aliens.splice(i, 1);
          continue;
        }
        chosenTile = candidates[Math.floor(Math.random() * candidates.length)];
      }

      a.x = chosenTile[0];
      a.y = chosenTile[1];
    }
  }

  _updateGameLogic() {
    // Delegate to mode handler
    if (this.modeHandler) {
      this.modeHandler.update();
    }
  }

  _getModeStatus(player) {
    if (!this.modeHandler) return null;

    if (this.modeHandler instanceof RobBankMode) {
      return {
        type: 'ROB_BANK',
        collected: this.modeHandler.collectedGold,
        total: this.modeHandler.totalGold,
        held: player.gold || 0
      };
    } else if (this.modeHandler instanceof CaptureTheFlagMode) {
      return {
        type: 'CAPTURE_FLAG',
        scores: this.modeHandler.scores,
        myTeam: player.team
      };
    } else if (this.modeHandler instanceof KingOfTheHillMode) {
      // Convert player IDs to names for display
      const namedScores = {};
      for (const [pid, score] of Object.entries(this.modeHandler.scores)) {
        namedScores[getPlayerName(pid)] = score;
      }
      return {
        type: 'KING_HILL',
        scores: namedScores,
        myScore: this.modeHandler.scores[player.id] || 0
      };
    }
    return null;
  }

  _getAlienTickMs() {
    return this.targetAcquired ? this.alienBaseTickMs / 2 : this.alienBaseTickMs;
  }

  _restartAlienTimer() {
    if (this.alienTimer) clearInterval(this.alienTimer);
    this.alienTimer = setInterval(() => {
      this._stepAliens();
    }, this._getAlienTickMs());
  }

  _startGameLoop() {
    const TICK_RATE = 60;
    this.gameLoopInterval = setInterval(() => {
      this._updateGameLogic();
      this._broadcastState();
    }, 1000 / TICK_RATE);

    // Separate timer for alien movement (slower than game loop)
    this.alienTimer = setInterval(() => {
      this._stepAliens();
    }, this._getAlienTickMs());
  }

  _stopGameLoop() {
    if (this.gameLoopInterval) clearInterval(this.gameLoopInterval);
    if (this.alienTimer) clearInterval(this.alienTimer);
    if (this.eventSystem) this.eventSystem.stop();
  }

  /**
   * Filter entities visible to a player based on their position
   * Used for dark-room mode where visibility is limited
   */
  _getVisibleEntities(playerX, playerY, radius = 2) {
    const isVisible = (x, y) => {
      const dist = Math.max(Math.abs(x - playerX), Math.abs(y - playerY));
      return dist <= radius;
    };

    return {
      players: Array.from(this.players.values())
        .filter(p => isVisible(p.x, p.y))
        .map(p => ({
          id: p.id,
          x: p.x,
          y: p.y,
          color: p.color,
          isDead: p.isDead,
          action: p.action,
          draggedWall: p.draggedWall
        })),
      aliens: this.aliens
        .filter(a => isVisible(a.x, a.y))
        .map(a => ({ x: a.x, y: a.y })),
      boxes: this.boxes
        .filter(b => isVisible(b.x, b.y))
        .map(b => ({ x: b.x, y: b.y, content: b.content })),
      bombs: this.bombs
        .filter(b => isVisible(b.x, b.y))
        .map(b => ({ x: b.x, y: b.y, blinkOn: b.blinkOn }))
    };
  }

  _broadcastState() {
    // Send to each player
    this.players.forEach(player => {
      if (player.ws.readyState === WebSocket.OPEN) {
        let gameState;

        // In dark-room mode, filter entities based on player's visibility
        if (this.settings.darkRoom) {
          const visibleEntities = this._getVisibleEntities(player.x, player.y);
          gameState = {
            ...visibleEntities,
            phase: this.state.phase,
            winner: this.state.winner,
            ...this.state.modeState
          };
        } else {
          // Normal mode: send all entities
          gameState = {
            players: Array.from(this.players.values()).map(p => ({
              id: p.id,
              x: p.x,
              y: p.y,
              color: p.color,
              isDead: p.isDead,
              action: p.action,
              draggedWall: p.draggedWall
            })),
            aliens: this.aliens.map(a => ({ x: a.x, y: a.y })),
            boxes: this.boxes.map(b => ({ x: b.x, y: b.y, content: b.content })),
            bombs: this.bombs.map(b => ({ x: b.x, y: b.y, blinkOn: b.blinkOn })),
            phase: this.state.phase,
            winner: this.state.winner,
            ...this.state.modeState
          };
        }

        // Personalize update with inventory and mode status
        const personalUpdate = {
          type: 'stateUpdate',
          gameState: gameState,
          darkRoom: this.settings.darkRoom,
          targetAcquired: this.targetAcquired,
          playerPosition: { x: player.x, y: player.y },
          inventory: {
            bombs: player.bombs,
            oxygen: player.oxygen,
            jumps: player.jumps,
            dash: player.dash,
            isDead: player.isDead,
            modeStatus: this._getModeStatus(player)
          },
          timestamp: Date.now()
        };
        player.ws.send(JSON.stringify(personalUpdate));
      }
    });
  }

  broadcast(message, excludeWs = null) {
    const data = JSON.stringify(message);
    this.players.forEach((player) => {
      if (player.ws !== excludeWs && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(data);
      }
    });
  }

  broadcastLobbyState() {
    const playerList = Array.from(this.players.values()).map(p => ({
      id: p.id,
      name: getPlayerName(p.id),
      color: p.color,
      isHost: p.id === this.hostId
    }));

    this.broadcast({
      type: 'lobbyUpdate',
      players: playerList,
      hostId: this.hostId,
      roomId: this.roomId,
      phase: this.state.phase
    });
  }

  startGame(playerId) {
    if (playerId !== this.hostId) return; // Only host can start
    if (this.state.phase !== PHASES.LOBBY) return;

    this.state.setPhase(PHASES.PLAYING);
    this.broadcast({
      type: 'gameStarted',
      phase: PHASES.PLAYING
    });

    this.chatHistory.push({
      type: 'system',
      message: 'Game Started!',
      timestamp: Date.now()
    });

    this.eventSystem.start();
  }
}

// Get or create a room
function getOrCreateRoom(roomId, settings = {}) {
  if (!rooms[roomId]) {
    rooms[roomId] = new GameRoom(roomId, settings);
  }
  return rooms[roomId];
}

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  let currentRoom = null;
  let playerId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // Handle room join
      if (data.type === 'joinRoom') {
        const roomId = data.roomId || 'default';
        const settings = data.settings || {};
        playerId = generatePlayerId();
        currentRoom = getOrCreateRoom(roomId, settings);

        console.log(`Player ${playerId} joined room ${roomId}`);

        // Add player to room
        currentRoom.addPlayer(playerId, ws);

        // Send initialization data
        const player = currentRoom.players.get(playerId);
        ws.send(JSON.stringify({
          type: 'init',
          playerId,
          gameState: {
            ...currentRoom.gameState,
            aliens: currentRoom.aliens.map(a => ({ x: a.x, y: a.y })),
            players: Array.from(currentRoom.players.values()).map(p => ({
              id: p.id,
              x: p.x,
              y: p.y,
              color: p.color,
              bombs: p.bombs,
              oxygen: p.oxygen,
              jumps: p.jumps
            })),
            boxes: currentRoom.boxes.map(b => ({ x: b.x, y: b.y, content: b.content })),
            bombs: currentRoom.bombs.map(b => ({ x: b.x, y: b.y, blinkOn: b.blinkOn }))
          },
          map: currentRoom.map,
          width: currentRoom.width,
          height: currentRoom.height,
          playerX: player.x,
          playerY: player.y,
          playerColor: player.color,
          playerBombs: player.bombs,
          playerOxygen: player.oxygen,
          playerJumps: player.jumps,
          chatHistory: currentRoom.chatHistory // Send chat history to new player
        }));

        // Broadcast lobby update AFTER init so client knows its playerId
        currentRoom.broadcastLobbyState();

        // Notify others in room
        const newPlayer = currentRoom.players.get(playerId);
        const joinMessage = {
          type: 'playerJoined',
          player: {
            id: playerId,
            x: newPlayer.x,
            y: newPlayer.y,
            color: newPlayer.color
          }
        };
        currentRoom.broadcast(joinMessage, ws);

        // Add join notification to chat history
        currentRoom.chatHistory.push({
          type: 'system',
          message: `${getPlayerName(playerId)} joined the room`,
          timestamp: Date.now()
        });
        if (currentRoom.chatHistory.length > currentRoom.maxChatHistory) {
          currentRoom.chatHistory.shift();
        }

        return;
      }

      // Handle chat messages
      if (data.type === 'chat' && currentRoom && playerId) {
        const player = currentRoom.players.get(playerId);
        if (player && data.message && data.message.trim()) {
          const chatMessage = {
            type: 'chat',
            playerId: playerId,
            message: data.message.trim(),
            playerName: getPlayerName(playerId),
            playerColor: player.color,
            timestamp: Date.now()
          };

          // Store in chat history
          currentRoom.chatHistory.push(chatMessage);
          // Keep only last maxChatHistory messages
          if (currentRoom.chatHistory.length > currentRoom.maxChatHistory) {
            currentRoom.chatHistory.shift();
          }

          // Broadcast chat message to all players in room
          currentRoom.broadcast(chatMessage);
        }
        return;
      }

      // Handle game inputs
      if (currentRoom && playerId) {
        if (data.type === 'startGame') {
          currentRoom.startGame(playerId);
        } else if (data.type === 'voice-signal') {
          // Relay voice signal to target player
          const targetPlayer = currentRoom.players.get(data.targetId);
          if (targetPlayer && targetPlayer.ws.readyState === WebSocket.OPEN) {
            targetPlayer.ws.send(JSON.stringify({
              type: 'voice-signal',
              senderId: playerId,
              signal: data.signal
            }));
          }
        } else {
          currentRoom.handlePlayerInput(playerId, data);
        }
      }
    } catch (e) {
      console.error('Invalid message:', e);
    }
  });

  ws.on('close', () => {
    if (currentRoom && playerId) {
      console.log(`Player ${playerId} left room ${currentRoom.roomId}`);
      currentRoom.removePlayer(playerId);

      currentRoom.broadcast({
        type: 'playerLeft',
        playerId: playerId
      });

      // Add leave notification to chat history
      currentRoom.chatHistory.push({
        type: 'system',
        message: `${getPlayerName(playerId)} left the room`,
        timestamp: Date.now()
      });
      if (currentRoom.chatHistory.length > currentRoom.maxChatHistory) {
        currentRoom.chatHistory.shift();
      }
    }
  });
});

function generatePlayerId() {
  return `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}



// API endpoint to get room info (optional, for debugging)
app.get('/api/rooms', (req, res) => {
  const roomList = Object.entries(rooms).map(([id, room]) => ({
    id,
    players: room.players ? room.players.size : 0,
    created: room.gameState ? room.gameState.createdAt : Date.now()
  }));
  res.json(roomList);
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎮 Game server running!`);
  console.log(`\nLocal: http://localhost:${PORT}`);
  console.log(`LAN: http://${getLocalIP()}:${PORT}\n`);
  console.log(`Players can join rooms by adding ?room=ROOMNAME to the URL`);
  console.log(`Example: http://localhost:${PORT}/?room=game1\n`);
});

function getLocalIP() {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        return net.address;
      }
    }
  }
  return 'localhost';
}
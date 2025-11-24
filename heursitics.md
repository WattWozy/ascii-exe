# ASCII Miner - Code Heuristics & Development Guidelines

## Project Architecture Philosophy

### Core Principle: Server-Authoritative Multiplayer
**The server is the single source of truth. Clients are view-only with input capabilities.**

```
CLIENT: Input → Display
SERVER: Validate → Mutate → Broadcast
```

---

## File Organization & Responsibilities

### Client-Side Files

#### `client.js`
**Purpose:** WebSocket communication layer
**Responsibilities:**
- Establish and maintain WebSocket connection
- Send user inputs to server (move, action, chat)
- Receive server state updates
- Dispatch state to game renderer
- Handle reconnection logic

**Rules:**
- ❌ NEVER validate game logic
- ❌ NEVER mutate game state
- ✅ Only send raw inputs
- ✅ Apply server state via callbacks

```javascript
// GOOD: Send input, let server decide
sendMove(x, y) {
  this.ws.send(JSON.stringify({ type: 'move', x, y }));
}

// BAD: Client validates before sending
sendMove(x, y) {
  if (this.canWalk(x, y)) { // ❌ Client shouldn't validate
    this.ws.send(JSON.stringify({ type: 'move', x, y }));
  }
}
```

#### `game.js`
**Purpose:** Pure rendering engine
**Responsibilities:**
- Render game state to DOM
- Handle keyboard input capture
- Send inputs via callbacks (onSendMove, onAction)
- Display server state (aliens, players, bombs, walls)
- Client-side prediction (optional, for responsiveness)

**Rules:**
- ❌ NEVER mutate map array
- ❌ NEVER validate moves/actions
- ❌ NEVER run game logic (AI, collision, physics)
- ✅ Render what server tells you
- ✅ Send all inputs immediately
- ✅ Optimistic updates OK, but always defer to server

```javascript
// GOOD: Pure rendering
function render(gameState) {
  const out = gameState.map.map(row => 
    row.map(tile => renderTile(tile)).join('')
  ).join('<br/>');
  screenEl.innerHTML = out;
}

// BAD: Mutating state during render
function render() {
  if (player.oxygen <= 0) {
    player.isDead = true; // ❌ Client shouldn't mutate
  }
}
```

**Client-Side Prediction Pattern:**
```javascript
// Acceptable for responsiveness:
function handleInput(key) {
  const [dx, dy] = keyMap[key];
  const nx = player.x + dx;
  const ny = player.y + dy;
  
  // Optimistic update (visual only)
  player.x = nx;
  player.y = ny;
  render();
  
  // Send to server for validation
  onSendMove(nx, ny);
  
  // Server will send back true position via updatePlayerPosition()
  // If different, we snap to server's authoritative state
}
```

#### `utils.js`
**Purpose:** Shared helper functions
**Responsibilities:**
- Player name extraction
- Entity lookup (findBoxAt, findBombAt)
- Display helpers

**Rules:**
- ✅ Pure functions only
- ✅ No side effects
- ⚠️ Validation functions (isValidMove, canPlaceBomb) are SERVER-ONLY
  - Keep them for server use, but client should not call them

---

### Server-Side Files

#### `server.js` (MAIN AUTHORITY)
**Purpose:** Game server and authoritative state
**Responsibilities:**
- Maintain all GameRoom instances
- Run game loop (10 ticks/second)
- Validate all inputs
- Update entity states
- Broadcast state to clients
- Handle player connections/disconnections

**Rules:**
- ✅ All game logic lives here
- ✅ Validate EVERY input (never trust client)
- ✅ Use OOP for entities (Player, Alien, Bomb, Wall)
- ✅ Immutable where possible, but practical mutations OK
- ✅ Broadcast minimal state deltas (optimize bandwidth)

**Entity Design Pattern:**
```javascript
class Entity {
  constructor(x, y) {
    this.id = generateId();
    this.x = x;
    this.y = y;
  }
  
  // Override in subclasses
  update(gameState) {}
  toJSON() {
    return { id: this.id, x: this.x, y: this.y };
  }
}

class Player extends Entity {
  constructor(x, y, socketId, name, color) {
    super(x, y);
    this.socketId = socketId;
    this.name = name;
    this.color = color;
    this.bombs = 3;
    this.oxygen = 200;
    this.isDead = false;
    this.draggedWall = null;
  }
  
  takeDamage(amount) {
    this.oxygen -= amount;
    if (this.oxygen <= 0) {
      this.isDead = true;
    }
  }
  
  toJSON() {
    return {
      ...super.toJSON(),
      name: this.name,
      color: this.color,
      bombs: this.bombs,
      oxygen: this.oxygen,
      isDead: this.isDead,
      draggedWall: this.draggedWall
    };
  }
}
```

**GameRoom Pattern:**
```javascript
class GameRoom {
  constructor(roomId, map, width, height) {
    this.roomId = roomId;
    this.map = map; // 2D array - SERVER OWNS THIS
    this.width = width;
    this.height = height;
    this.players = new Map(); // socketId -> Player
    this.aliens = []; // Alien[]
    this.walls = []; // Wall[]
    this.bombs = []; // Bomb[]
    this.boxes = []; // Box[]
    this.gameState = new GameState();
  }
  
  // Input handlers - VALIDATE EVERYTHING
  handleMove(socketId, x, y) {
    const player = this.players.get(socketId);
    if (!player || player.isDead) return; // Invalid
    
    if (!this.isValidMove(player, x, y)) return; // Invalid
    
    // Apply move
    const dx = x - player.x;
    const dy = y - player.y;
    
    // Handle pushable walls
    const tile = this.map[y][x];
    if (tile === TILE_PUSH) {
      const pushX = x + dx;
      const pushY = y + dy;
      if (!this.canPushWall(x, y, pushX, pushY)) return; // Invalid
      this.pushWall(x, y, pushX, pushY);
    }
    
    // Move player
    player.x = x;
    player.y = y;
    player.takeDamage(1); // Oxygen cost
    
    // Check pickups
    this.checkPickups(player);
  }
  
  // Game loop tick
  update() {
    // Update all entities
    this.aliens.forEach(alien => alien.update(this));
    this.bombs.forEach((bomb, i) => {
      const shouldExplode = bomb.update();
      if (shouldExplode) {
        this.explodeBomb(bomb);
        this.bombs.splice(i, 1);
      }
    });
    
    // Check win conditions
    this.checkWinConditions();
  }
  
  // Serialize for clients
  getStateForClient() {
    return {
      players: Array.from(this.players.values()).map(p => p.toJSON()),
      aliens: this.aliens.map(a => a.toJSON()),
      walls: this.walls.map(w => w.toJSON()),
      bombs: this.bombs.map(b => b.toJSON()),
      boxes: this.boxes,
      phase: this.gameState.phase,
      winner: this.gameState.winner
    };
  }
}
```

**Server Game Loop:**
```javascript
const TICK_RATE = 10; // 10 Hz
const rooms = new Map(); // roomId -> GameRoom

setInterval(() => {
  rooms.forEach(room => {
    // Update game state
    room.update();
    
    // Broadcast to all players
    const state = room.getStateForClient();
    room.players.forEach((player) => {
      const socket = io.sockets.sockets.get(player.socketId);
      if (socket) {
        socket.emit('stateUpdate', { gameState: state });
      }
    });
  });
}, 1000 / TICK_RATE);
```

#### `gamestate.js`
**Purpose:** Game phase and mode management
**Responsibilities:**
- Track game phases (LOBBY, PLAYING, GAME_OVER)
- Mode-specific logic (Survival, Crystal Rush, etc.)
- Win condition checking

**Pattern:**
```javascript
class GameModeHandler {
  constructor(gameRoom) {
    this.room = gameRoom;
  }
  
  onPlayerJoin(player) { /* Override */ }
  onPlayerLeave(player) { /* Override */ }
  onPlayerDeath(player) { /* Override */ }
  update() { /* Override - called every tick */ }
  checkWinCondition() { /* Override - return true if game over */ }
}

class SurvivalMode extends GameModeHandler {
  checkWinCondition() {
    const alivePlayers = Array.from(this.room.players.values())
      .filter(p => !p.isDead).length;
    const aliveAliens = this.room.aliens.length;
    
    if (aliveAliens === 0) {
      this.room.gameState.winner = 'Players';
      return true;
    }
    if (alivePlayers === 0) {
      this.room.gameState.winner = 'Aliens';
      return true;
    }
    return false;
  }
}
```

---

## Shared Files (Client + Server)

#### `constants.js`
**Purpose:** Shared constants
**Rules:**
- ✅ Only constants, no functions
- ✅ Tile definitions, item info
- ✅ Should work in both Node.js and browser

#### `mapgen.js`
**Purpose:** Procedural map generation
**Rules:**
- ✅ Pure function: inputs → map array
- ✅ No side effects
- ✅ Deterministic (same seed = same map)

---

## Coding Standards

### Naming Conventions
```javascript
// Classes: PascalCase
class GameRoom {}
class PlayerEntity {}

// Functions: camelCase
function handleMove() {}
function checkWinCondition() {}

// Constants: UPPER_SNAKE_CASE
const TICK_RATE = 10;
const MAX_PLAYERS = 8;

// Private methods: _prefixed
class GameRoom {
  _validateMove() {} // Internal helper
  handleMove() {} // Public API
}
```

### Error Handling
```javascript
// Server: Always validate, never crash
handleMove(socketId, x, y) {
  const player = this.players.get(socketId);
  if (!player) {
    console.warn(`Invalid player: ${socketId}`);
    return; // Fail silently
  }
  
  if (!this.isValidMove(player, x, y)) {
    console.warn(`Invalid move: ${player.name} to (${x}, ${y})`);
    return; // Don't crash, just ignore
  }
  
  // ... proceed
}

// Client: Graceful degradation
function render() {
  try {
    // Render logic
  } catch (error) {
    console.error('Render error:', error);
    screenEl.innerHTML = 'Error rendering game';
  }
}
```

### Performance Guidelines

**Server:**
- Avoid O(n²) loops in game tick (runs 10x/sec)
- Use Maps/Sets for entity lookups, not arrays
- Only broadcast changed state (deltas), not full state
- Freeze inactive rooms (no players = no ticks)

```javascript
// GOOD: O(1) lookup
const player = this.players.get(socketId);

// BAD: O(n) lookup in hot path
const player = Array.from(this.players.values())
  .find(p => p.socketId === socketId);
```

**Client:**
- Minimize DOM updates (batch changes)
- Use CSS for animations, not JS timers
- Cache DOM element references

```javascript
// GOOD: Cache element
const screenEl = document.getElementById('screen');
function render() {
  screenEl.innerHTML = generateHTML();
}

// BAD: Query every render
function render() {
  document.getElementById('screen').innerHTML = generateHTML();
}
```

---

## Testing Heuristics

### Manual Testing Checklist
1. **Authority Test:** Can client cheat by sending invalid inputs?
   - Try teleporting (send move to illegal position)
   - Try infinite bombs (send placeBomb without having bombs)
   - Expected: Server ignores invalid inputs

2. **Sync Test:** Do multiple clients see the same state?
   - Open 2 browser windows in same room
   - Move player in window 1
   - Expected: Player appears in same position in window 2

3. **Lag Test:** Does high latency cause desync?
   - Throttle network to 500ms delay
   - Move player rapidly
   - Expected: Server corrects client position, no permanent desync

4. **Disconnect Test:** What happens when player disconnects?
   - Disconnect client mid-game
   - Expected: Player removed from room, other clients notified

### Unit Testing Patterns
```javascript
// Test server validation
describe('GameRoom.handleMove', () => {
  it('should reject moves to walls', () => {
    const room = new GameRoom('test', testMap, 20, 20);
    const player = room.addPlayer('socket1', 'Alice', '#fff');
    
    // Try to move into wall at (0, 0)
    room.handleMove('socket1', 0, 0);
    
    expect(player.x).not.toBe(0); // Player shouldn't move
  });
});
```

---

## Common Pitfalls & Solutions

### ❌ Pitfall: Client validates moves
```javascript
// BAD
if (canWalk(nx, ny)) {
  player.x = nx;
  sendMove(nx, ny);
}
```
**Solution:** Send all inputs, let server validate
```javascript
// GOOD
sendMove(nx, ny); // Server decides if valid
```

### ❌ Pitfall: Trusting client timestamps
```javascript
// BAD - client could fake timestamp
socket.on('move', ({ x, y, timestamp }) => {
  // Use client timestamp for game logic
});
```
**Solution:** Use server time
```javascript
// GOOD
socket.on('move', ({ x, y }) => {
  const serverTime = Date.now();
  // Use serverTime for all logic
});
```

### ❌ Pitfall: Sending full state every tick
```javascript
// BAD - 1KB state * 10 Hz * 100 players = 1MB/s
setInterval(() => {
  broadcast(room.getFullState());
}, 100);
```
**Solution:** Send deltas only
```javascript
// GOOD - only changed entities
setInterval(() => {
  const delta = room.getChangedState(lastState);
  broadcast(delta);
  lastState = room.getStateSnapshot();
}, 100);
```

---

## Debugging Guidelines

### Server Debugging
```javascript
// Log input validation failures
handleMove(socketId, x, y) {
  const player = this.players.get(socketId);
  if (!player) {
    console.log(`[INVALID] No player for socket ${socketId}`);
    return;
  }
  
  if (!this.isValidMove(player, x, y)) {
    console.log(`[INVALID] Move rejected: ${player.name} (${player.x},${player.y}) -> (${x},${y})`);
    return;
  }
  
  console.log(`[MOVE] ${player.name}: (${player.x},${player.y}) -> (${x},${y})`);
  // ... apply move
}
```

### Client Debugging
```javascript
// Log server corrections
function updatePlayerPosition(x, y) {
  if (Math.abs(player.x - x) > 0 || Math.abs(player.y - y) > 0) {
    console.log(`[CORRECTION] Client=(${player.x},${player.y}) Server=(${x},${y})`);
  }
  player.x = x;
  player.y = y;
}
```

---

## Extensibility Guidelines

### Adding New Entity Types
1. Create class extending `Entity`
2. Implement `update(gameState)` method
3. Add to room's entity array
4. Add to `getStateForClient()` serialization
5. Update client's `renderEntities()` to display

### Adding New Game Modes
1. Create class extending `GameModeHandler`
2. Implement lifecycle methods (onPlayerJoin, update, checkWinCondition)
3. Register in `MODES` constant
4. Add UI for mode selection

### Adding New Actions
1. Add action type to `client.js` sendAction()
2. Add handler in `server.js` GameRoom.handleAction()
3. Validate input, mutate state, broadcast update

---

## Summary: Golden Rules

1. **Server is God:** All game logic on server, clients are dumb terminals
2. **Never Trust Client:** Validate every input
3. **Pure Rendering:** Client renders what server says, nothing more
4. **OOP Entities:** Use classes for game objects (Player, Alien, Bomb)
5. **Functional Updates:** State transformations should be predictable
6. **Broadcast Deltas:** Don't send full state every tick
7. **Fail Gracefully:** Invalid inputs are ignored, not crashed
8. **Test Authority:** If client can cheat, architecture is wrong

**When in doubt:** Ask "Can the server enforce this rule?" If no, redesign.
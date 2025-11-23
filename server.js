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

class GameRoom {
  constructor(roomId) {
    this.roomId = roomId;
    this.players = new Map();
    this.width = 40;
    this.height = 20;
    // Use generateMap if available, otherwise fallback
    try {
      this.map = (typeof generateMap === 'function') ? generateMap(this.width, this.height) : generateSimpleMap(this.width, this.height);
    } catch (e) {
      this.map = generateSimpleMap(this.width, this.height);
    }
    this.gameState = {
      // Add your game-specific state here
      started: false,
      createdAt: Date.now()
    };

    // Aliens list - managed server-side for synchronization
    this.aliens = [];
    this.alienTickMs = 700; // Alien movement interval

    // Boxes - track positions and contents server-side
    this.boxes = [];
    this.populateBoxes();

    // Active bombs - track bomb placements
    this.bombs = [];

    // Chat history - store all messages in this room
    this.chatHistory = [];
    this.maxChatHistory = 100; // Limit to last 100 messages

    // Spawn initial aliens
    this.spawnAliens(3);

    // Start the game loop for this room
    this.startGameLoop();
  }

  // Populate boxes with contents (server-authoritative)
  populateBoxes() {
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
  generatePlayerColor() {
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
  findEdgeSpawn(edgeIndex) {
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
    const spawnPos = this.findEdgeSpawn(edgeIndex);

    // Generate a random light color for this player
    const color = this.generatePlayerColor();

    this.players.set(playerId, {
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
      draggedWall: null // {x, y} when dragging a wall
    });
  }

  removePlayer(playerId) {
    this.players.delete(playerId);

    // Clean up empty rooms after 5 minutes
    if (this.players.size === 0) {
      setTimeout(() => {
        if (this.players.size === 0) {
          rooms.delete(this.roomId);
          clearInterval(this.gameLoopInterval);
          if (this.alienTimer) {
            clearInterval(this.alienTimer);
          }
          console.log(`Room ${this.roomId} closed (empty)`);
        }
      }, 5 * 60 * 1000);
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
    if (!player) return false;

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

    return false;
  }

  // Handle pushing an object
  handlePush(playerId, fromX, fromY, toX, toY) {
    const player = this.players.get(playerId);
    if (!player) return false;

    // Validate push
    if (fromX < 0 || fromY < 0 || fromX >= this.width || fromY >= this.height) return false;
    if (toX < 0 || toY < 0 || toX >= this.width || toY >= this.height) return false;
    if (!this.map[fromY] || this.map[fromY][fromX] !== TILES.PUSHABLE) return false; // Must be pushable
    if (!this.map[toY] || this.map[toY][toX] !== TILES.FLOOR) return false; // Destination must be floor

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
    if (!player) return false;

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
    if (!player) return false;

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
    if (!player) return;

    switch (data.type) {
      case 'move':
        // Clamp to map bounds (tile-based coordinates)
        const newX = Math.max(0, Math.min(this.width - 1, data.x));
        const newY = Math.max(0, Math.min(this.height - 1, data.y));
        // Check if the target tile is walkable using shared logic
        if (isWalkable(this.map, newX, newY, this.width, this.height, TILES.WALL)) {
          const oldX = player.x;
          const oldY = player.y;

          player.x = newX;
          player.y = newY;

          // Handle dragged wall movement
          if (player.draggedWall) {
            const wallX = player.draggedWall.x;
            const wallY = player.draggedWall.y;

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
              // Can't place wall, release it
              player.draggedWall = null;
            }
          }

          // Auto-collect items when moving onto them
          this.handleCollect(playerId, newX, newY);

          // Decrease oxygen on move
          if (player.oxygen > 0) {
            player.oxygen--;
          }
        }
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

  spawnAliens(count = 3) {
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

  stepAliens() {
    const TILE_DROPLET = '•';

    // Iterate from end so we can splice safely
    for (let i = this.aliens.length - 1; i >= 0; i--) {
      const a = this.aliens[i];
      const ax = a.x, ay = a.y;
      const candidates = [];
      const deltas = [[1, 0], [-1, 0], [0, 1], [0, -1]];

      // Get all player positions to avoid collisions
      const playerPositions = new Set();
      this.players.forEach(p => {
        playerPositions.add(`${p.x},${p.y}`);
      });

      for (const [dx, dy] of deltas) {
        const nx = ax + dx, ny = ay + dy;
        if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;

        // Can only move into floor tiles (cannot push or move into pumps/droplets/aliens/players)
        if (this.map[ny] && this.map[ny][nx] === TILES.FLOOR && !playerPositions.has(`${nx},${ny}`)) {
          // Also check if another alien is at this position
          const alienAtPos = this.aliens.some(other => other !== a && other.x === nx && other.y === ny);
          if (!alienAtPos) {
            candidates.push([nx, ny]);
          }
        }
      }

      if (candidates.length === 0) {
        // Trapped: remove alien (could turn into droplet, but for now just remove)
        this.aliens.splice(i, 1);
        continue;
      }

      // Pick a random candidate and move
      const [nx, ny] = candidates[Math.floor(Math.random() * candidates.length)];
      a.x = nx;
      a.y = ny;
    }
  }

  updateGameLogic() {
    // Move aliens (step them periodically)
    // This will be called by the game loop, but we'll also have a separate timer for aliens
    // TODO: apply collisions, enemy movement, bombs, rooms etc.
  }

  startGameLoop() {
    const TICK_RATE = 60;
    this.gameLoopInterval = setInterval(() => {
      this.updateGameLogic();
      this.broadcastState();
    }, 1000 / TICK_RATE);

    // Separate timer for alien movement (slower than game loop)
    this.alienTimer = setInterval(() => {
      this.stepAliens();
    }, this.alienTickMs);
  }

  broadcastState() {
    const state = {
      type: 'stateUpdate',
      gameState: {
        players: Array.from(this.players.values()).map(p => ({
          id: p.id,
          x: p.x,
          y: p.y,
          color: p.color,
          bombs: p.bombs,
          oxygen: p.oxygen,
          jumps: p.jumps,
          dash: p.dash,
          action: p.action,
          draggedWall: p.draggedWall
        })),
        aliens: this.aliens.map(a => ({ x: a.x, y: a.y })),
        boxes: this.boxes.map(b => ({ x: b.x, y: b.y, content: b.content })),
        bombs: this.bombs.map(b => ({ x: b.x, y: b.y, blinkOn: b.blinkOn })),
        ...this.gameState
      },
      timestamp: Date.now()
    };

    this.broadcast(state);
  }

  broadcast(message, excludeWs = null) {
    const data = JSON.stringify(message);
    this.players.forEach((player) => {
      if (player.ws !== excludeWs && player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(data);
      }
    });
  }
}

// Get or create a room
function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = new GameRoom(roomId);
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
        playerId = generatePlayerId();
        currentRoom = getOrCreateRoom(roomId);

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
        currentRoom.handlePlayerInput(playerId, data);
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
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}
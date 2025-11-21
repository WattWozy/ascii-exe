const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

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
    this.width = 20;
    this.height = 20;
    this.map = generateSimpleMap(20, 20);
    this.gameState = {
    // Add your game-specific state here
    started: false,
    createdAt: Date.now()
    };
    
    // Start the game loop for this room
    this.startGameLoop();
}

  addPlayer(playerId, ws) {
    this.players.set(playerId, {
      id: playerId,
      ws: ws,
      x: Math.random() * 800,
      y: Math.random() * 600,
      // Add your game-specific player properties here
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
          console.log(`Room ${this.roomId} closed (empty)`);
        }
      }, 5 * 60 * 1000);
    }
  }

  handlePlayerInput(playerId, data) {
    const player = this.players.get(playerId);
    if (!player) return;

    switch (data.type) {
      case 'move':
        player.x = Math.max(0, Math.min(800, data.x));
        player.y = Math.max(0, Math.min(600, data.y));
        break;
      
      case 'action':
        player.action = data.action;
        break;
    }
  }

  updateGameLogic() {
    // TODO: apply collisions, enemy movement, bombs, rooms etc.
    
    // broadcast new state
    const state = {
        type: 'stateUpdate',
        gameState: {
        players: Array.from(this.players.values()).map(p => ({
            id: p.id,
            x: p.x,
            y: p.y
        }))
        }
    };

    for (const player of this.players.values()) {
        player.ws.send(JSON.stringify(state));
    }
    }

  startGameLoop() {
    const TICK_RATE = 60;
    this.gameLoopInterval = setInterval(() => {
      this.updateGameLogic();
      this.broadcastState();
    }, 1000 / TICK_RATE);
  }

  broadcastState() {
    const state = {
      type: 'stateUpdate',
      gameState: {
        players: Array.from(this.players.values()).map(p => ({
          id: p.id,
          x: p.x,
          y: p.y,
          action: p.action
          // Add other player properties
        })),
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
    rooms[roomId] = {
      id: roomId,
      map: generateMap(40, 20),
      players: {}
    };
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
        ws.send(JSON.stringify({
            type: 'init',
            playerId,
            gameState: currentRoom.gameState,
            map: currentRoom.map,
            width: currentRoom.width,
            height: currentRoom.height
        }));

        // Notify others in room
        currentRoom.broadcast({
          type: 'playerJoined',
          player: {
            id: playerId,
            x: currentRoom.players.get(playerId).x,
            y: currentRoom.players.get(playerId).y
          }
        }, ws);

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
    }
  });
});

function generatePlayerId() {
  return `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// API endpoint to get room info (optional, for debugging)
app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.entries()).map(([id, room]) => ({
    id,
    players: room.players.size,
    created: room.gameState.createdAt
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
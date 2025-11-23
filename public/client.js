class GameClient {
  constructor() {
    this.ws = null;
    this.playerId = null;
    this.players = new Map();
    this.game = null;
    this.chatOpen = false;
    this.connect();
    this.initChat();
  }



  initChat() {
    const chatInput = document.getElementById('chat-input');
    const chatInputContainer = document.getElementById('chat-input-container');
    const chatMessages = document.getElementById('chat-messages');

    if (!chatInput || !chatInputContainer || !chatMessages) return;

    // Handle C key to open chat (only when not typing in input)
    document.addEventListener('keydown', (e) => {
      // Don't interfere if already typing in chat or other input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      if (e.key === 'c' || e.key === 'C') {
        if (!this.chatOpen) {
          this.openChat();
          e.preventDefault();
          e.stopPropagation();
        }
      } else if (e.key === 'Escape') {
        if (this.chatOpen) {
          this.closeChat();
          e.preventDefault();
          e.stopPropagation();
        }
      }
    }, true); // Use capture phase to catch before game handler

    // Handle Enter to send message
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const message = chatInput.value.trim();
        if (message) {
          this.sendChatMessage(message);
          chatInput.value = '';
        }
        this.closeChat();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        this.closeChat();
        e.preventDefault();
      }
    });
  }

  openChat() {
    const chatInput = document.getElementById('chat-input');
    const chatInputContainer = document.getElementById('chat-input-container');
    if (!chatInput || !chatInputContainer) return;

    this.chatOpen = true;
    chatInputContainer.classList.add('active');
    chatInput.focus();
  }

  closeChat() {
    const chatInput = document.getElementById('chat-input');
    const chatInputContainer = document.getElementById('chat-input-container');
    if (!chatInput || !chatInputContainer) return;

    this.chatOpen = false;
    chatInputContainer.classList.remove('active');
    chatInput.blur();
    // Return focus to game screen
    const screen = document.getElementById('screen');
    if (screen) screen.focus();
  }

  addChatMessage(message, isSystem = false, playerName = null, playerColor = null) {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isSystem ? 'system' : ''}`;

    if (isSystem) {
      messageDiv.textContent = message;
    } else if (playerName) {
      // Format: PlayerName: message
      const nameSpan = document.createElement('span');
      nameSpan.className = 'player-name';
      if (playerColor) {
        nameSpan.style.color = playerColor;
      }
      nameSpan.textContent = playerName;
      messageDiv.appendChild(nameSpan);
      messageDiv.appendChild(document.createTextNode(': ' + message));
    } else {
      messageDiv.textContent = message;
    }

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  loadChatHistory(chatHistory) {
    if (!chatHistory || !Array.isArray(chatHistory)) return;

    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;

    // Clear existing messages
    chatMessages.innerHTML = '';

    // Load all messages from history
    chatHistory.forEach(msg => {
      if (msg.type === 'chat') {
        // Extract player name - use stored name or extract from playerId
        const playerName = msg.playerName || (msg.playerId ? this.getPlayerName(msg.playerId) : 'unknown');
        this.addChatMessage(msg.message, false, playerName, msg.playerColor);
      } else if (msg.type === 'system') {
        this.addChatMessage(msg.message, true);
      }
    });
  }

  sendChatMessage(message) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'chat',
        message: message
      }));
    }
  }

  connect() {
    // Connect to WebSocket server
    this.ws = new WebSocket(`ws://${window.location.host}`);

    this.ws.onopen = () => {
      console.log('Connected to game server');
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };

    this.ws.onclose = () => {
      console.log('Disconnected from server');
      // Attempt to reconnect after 2 seconds
      setTimeout(() => this.connect(), 2000);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  handleMessage(data) {
    switch (data.type) {
      case 'init':
        this.playerId = data.playerId;

        // create game instance and inject callbacks
        this.game = window.createGame({
          map: data.map,
          width: data.width,
          height: data.height,
          screenEl: document.getElementById('screen') || document.getElementById('game-screen'),
          stateMenuEl: document.getElementById('stateMenu') || document.getElementById('game-state'),
          bombsEl: document.getElementById('bombs-val'),
          oxygenBarEl: document.getElementById('oxygen-bar'),
          oxygenTextEl: document.getElementById('oxygen-val'),
          generateMap: (typeof window.generateMap !== 'undefined') ? window.generateMap : undefined,
          onSendMove: (x, y) => this.sendMove(x, y),
          onAction: (action) => this.sendAction(action)
        });

        // Set initial player position from server if provided
        if (data.playerX !== undefined && data.playerY !== undefined && this.game.setPlayerPosition) {
          this.game.setPlayerPosition(data.playerX, data.playerY);
        }

        // Set initial aliens from server if provided
        if (data.gameState && data.gameState.aliens && this.game.updateAliens) {
          this.game.updateAliens(data.gameState.aliens);
        }

        // Set initial boxes from server
        if (data.gameState && data.gameState.boxes && this.game.updateBoxes) {
          this.game.updateBoxes(data.gameState.boxes);
        }

        // Set initial bombs from server
        if (data.gameState && data.gameState.bombs && this.game.updateBombs) {
          this.game.updateBombs(data.gameState.bombs);
        }

        // Set initial walls from server
        if (data.gameState && data.gameState.walls && this.game.updateWalls) {
          this.game.updateWalls(data.gameState.walls);
        }

        // Set initial other players if any
        if (data.gameState && data.gameState.players && this.game.updateOtherPlayers) {
          const otherPlayers = data.gameState.players
            .filter(p => p.id !== this.playerId)
            .map(p => ({ id: p.id, x: p.x, y: p.y, color: p.color }));
          this.game.updateOtherPlayers(otherPlayers);
        }

        // Set initial inventory from server
        if (data.playerBombs !== undefined && this.game.updateInventory) {
          this.game.updateInventory({
            bombs: data.playerBombs,
            oxygen: data.playerOxygen || 50,
            jumps: data.playerJumps || 1,
            dash: false
          });
        }

        // Load chat history
        if (data.chatHistory && Array.isArray(data.chatHistory)) {
          this.loadChatHistory(data.chatHistory);
        }

        this.game.start();
        break;

      case 'stateUpdate':
        // Update game state from server
        this.players = new Map(data.gameState.players.map(p => [p.id, p]));

        // Update local player position from authoritative server state
        if (this.game && this.game.updatePlayerPosition) {
          const myPlayer = this.players.get(this.playerId);
          if (myPlayer) {
            this.game.updatePlayerPosition(myPlayer.x, myPlayer.y);
            // Update inventory from server
            if (this.game.updateInventory) {
              this.game.updateInventory({
                bombs: myPlayer.bombs,
                oxygen: myPlayer.oxygen,
                jumps: myPlayer.jumps,
                dash: myPlayer.dash
              });
            }
            // Update drag state from server
            if (this.game.updateDragState) {
              this.game.updateDragState(myPlayer.draggedWall);
            }
          }
        }

        // Update other players from server
        if (this.game && this.game.updateOtherPlayers) {
          const otherPlayers = this.getOtherPlayers();
          this.game.updateOtherPlayers(otherPlayers);
        }

        // Update aliens from server (authoritative)
        if (this.game && this.game.updateAliens && data.gameState.aliens) {
          this.game.updateAliens(data.gameState.aliens);
        }

        // Update boxes from server (authoritative)
        if (this.game && this.game.updateBoxes && data.gameState.boxes) {
          this.game.updateBoxes(data.gameState.boxes);
        }

        // Update walls from server (authoritative)
        if (this.game && this.game.updateWalls && data.gameState.walls) {
          this.game.updateWalls(data.gameState.walls);
        }

        // Update bombs from server (authoritative)
        if (this.game && this.game.updateBombs && data.gameState.bombs) {
          this.game.updateBombs(data.gameState.bombs);
        }

        // Update game phase
        if (this.game && this.game.updateGamePhase && data.gameState.phase) {
          this.game.updateGamePhase(data.gameState.phase, data.gameState.winner);
        }
        break;

      case 'playerDied':
        // Handle player death notification
        const diedPlayer = this.players.get(data.playerId);
        if (diedPlayer) {
          diedPlayer.isDead = true;
          this.addChatMessage(`${window.getPlayerName(data.playerId)} died: ${data.reason}`, true);
        }
        break;

      case 'gameOver':
        // Handle game over notification
        this.addChatMessage(`GAME OVER! Winner: ${data.winner}`, true);
        break;

      case 'mapChange':
        // Apply map changes from server
        if (this.game && this.game.applyMapChanges && data.changes) {
          this.game.applyMapChanges(data.changes);
        }
        break;

      case 'bombUpdate':
        // Update bomb state
        if (this.game && this.game.updateBomb && data.bomb) {
          this.game.updateBomb(data.bomb);
        }
        break;

      case 'playerJoined':
        // New player joined
        this.players.set(data.player.id, data.player);
        console.log('Player joined:', data.player.id);

        // Show in chat
        const joinedPlayer = this.players.get(data.player.id);
        if (joinedPlayer && joinedPlayer.id !== this.playerId) {
          this.addChatMessage(`${window.getPlayerName(joinedPlayer.id)} joined the room`, true);
        }

        // Update other players display
        if (this.game && this.game.updateOtherPlayers) {
          const otherPlayers = this.getOtherPlayers();
          this.game.updateOtherPlayers(otherPlayers);
        }
        break;

      case 'playerLeft':
        // Player left
        this.players.delete(data.playerId);
        console.log('Player left:', data.playerId);

        // Show in chat
        this.addChatMessage(`${this.getPlayerName(data.playerId)} left the room`, true);
        break;

      case 'chat':
        // Chat message received
        if (data.playerId && data.message) {
          // Use the playerName and playerColor from server if available
          const senderName = data.playerName || this.getPlayerName(data.playerId);
          const senderColor = data.playerColor || (this.players.get(data.playerId)?.color);
          this.addChatMessage(data.message, false, senderName, senderColor);
        }
        break;
    }
  }

  // Send player input to server
  sendMove(x, y) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'move',
        x: x,
        y: y
      }));
    }
  }

  sendAction(action) {
    if (this.ws.readyState === WebSocket.OPEN) {
      // Spread action object into the message
      this.ws.send(JSON.stringify({
        type: 'action',
        ...action
      }));
    }
  }

  // Get your player data
  getMyPlayer() {
    return this.players.get(this.playerId);
  }

  // Get all other players
  getOtherPlayers() {
    return Array.from(this.players.values())
      .filter(p => p.id !== this.playerId);
  }

  // Join a room
  joinRoom(roomId, settings = {}) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'joinRoom',
        roomId: roomId,
        settings: settings
      }));
    } else {
      // If not connected yet, wait for connection
      this.ws.addEventListener('open', () => {
        this.ws.send(JSON.stringify({
          type: 'joinRoom',
          roomId: roomId,
          settings: settings
        }));
      }, { once: true });
    }
  }
}

const urlParams = new URLSearchParams(location.search);
const roomId =
  urlParams.get("room") ||
  localStorage.getItem("currentRoom") ||
  "default";

// Parse settings from SessionStorage (priority) or URL (fallback)
let settings = {};
const storedSettings = sessionStorage.getItem('roomSettings');
if (storedSettings) {
  try {
    settings = JSON.parse(storedSettings);
    // Clear it so it doesn't persist if we reload or join another room via URL later
    sessionStorage.removeItem('roomSettings');
  } catch (e) {
    console.error('Failed to parse stored settings', e);
  }
}

// URL params override storage if present (e.g. if clicking a shared link)
if (urlParams.has("enemies")) settings.enemyCount = parseInt(urlParams.get("enemies"));
if (urlParams.has("droplets")) settings.dropletCount = parseInt(urlParams.get("droplets"));
if (urlParams.has("boxes")) settings.boxCount = parseInt(urlParams.get("boxes"));

localStorage.setItem("currentRoom", roomId);
// Initialize the client
const gameClient = new GameClient();
// Expose to window for debugging/access
window.gameClient = gameClient;
// Join room (will wait for connection if needed)
gameClient.joinRoom(roomId, settings);

// Example usage in your game loop:
// gameClient.sendMove(playerX, playerY);
// const otherPlayers = gameClient.getOtherPlayers();
// // Render other players...
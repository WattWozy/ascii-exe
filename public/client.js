/**
 * GameClient class handles the WebSocket connection and client-side game logic.
 * It acts as the bridge between the server and the rendering/input logic.
 */
class GameClient {
  /**
   * Goal: Initialize the GameClient, connect to server, and set up chat.
   * Input: None
   * Output: New GameClient instance
   */
  constructor() {
    this.ws = null;
    this.playerId = null;
    this.roomId = null;
    this.players = new Map();
    this.game = null;
    this.chatOpen = false;

    // Cache DOM elements for reuse
    this.dom = {
      chatInput: document.getElementById('chat-input'),
      chatContainer: document.getElementById('chat-input-container'),
      chatMessages: document.getElementById('chat-messages'),
      screen: document.getElementById('screen') || document.getElementById('game-screen'),
      stateMenu: document.getElementById('stateMenu') || document.getElementById('game-state'),
      bombs: document.getElementById('bombs-val'),
      oxygenBar: document.getElementById('oxygen-bar'),
      oxygenText: document.getElementById('oxygen-val')
    };

    this.connect();
    this.initChat();

    // Voice Chat
    this.voiceManager = window.VoiceManager ? new window.VoiceManager(this) : null;
  }

  /**
   * Goal: Initialize chat event listeners for opening/closing and sending messages.
   * Input: None
   * Output: None (Sets up side effects)
   */
  initChat() {
    if (!this.dom.chatInput || !this.dom.chatContainer || !this.dom.chatMessages) return;

    // Global key handler for chat toggle and voice
    document.addEventListener('keydown', (e) => {
      // Ignore if typing in an input field
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if (e.key.toLowerCase() === 'c' && !this.chatOpen) {
        this.toggleChat(true);
        e.preventDefault();
      } else if (e.key === 'Escape' && this.chatOpen) {
        this.toggleChat(false);
        e.preventDefault();
      } else if (e.key.toLowerCase() === 'm') {
        this.voiceManager?.toggleMute();
        e.preventDefault();
      }
    }, true);

    // Input field key handler
    this.dom.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const message = this.dom.chatInput.value.trim();
        if (message) {
          this.sendChatMessage(message);
          this.dom.chatInput.value = '';
        }
        this.toggleChat(false);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        this.toggleChat(false);
        e.preventDefault();
      }
    });
  }

  /**
   * Goal: Open or close the chat interface.
   * Input: isOpen (boolean) - true to open, false to close
   * Output: None
   */
  toggleChat(isOpen) {
    if (!this.dom.chatInput || !this.dom.chatContainer) return;

    this.chatOpen = isOpen;
    if (isOpen) {
      this.dom.chatContainer.classList.add('active');
      this.dom.chatInput.focus();
    } else {
      this.dom.chatContainer.classList.remove('active');
      this.dom.chatInput.blur();
      if (this.dom.screen) this.dom.screen.focus();
    }
  }

  /**
   * Goal: Add a message to the chat window.
   * Input: message (string), isSystem (boolean), playerName (string), playerColor (string)
   * Output: None (Updates DOM)
   */
  addChatMessage(message, isSystem = false, playerName = null, playerColor = null) {
    if (!this.dom.chatMessages) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isSystem ? 'system' : ''}`;

    if (isSystem) {
      messageDiv.textContent = message;
    } else if (playerName) {
      const nameSpan = document.createElement('span');
      nameSpan.className = 'player-name';
      if (playerColor) nameSpan.style.color = playerColor;
      nameSpan.textContent = playerName;

      messageDiv.appendChild(nameSpan);
      messageDiv.appendChild(document.createTextNode(`: ${message}`));
    } else {
      messageDiv.textContent = message;
    }

    this.dom.chatMessages.appendChild(messageDiv);
    this.dom.chatMessages.scrollTop = this.dom.chatMessages.scrollHeight;
  }

  /**
   * Goal: Load a history of chat messages.
   * Input: chatHistory (Array of message objects)
   * Output: None
   */
  loadChatHistory(chatHistory) {
    if (!chatHistory || !Array.isArray(chatHistory) || !this.dom.chatMessages) return;

    this.dom.chatMessages.innerHTML = ''; // Clear existing

    chatHistory.forEach(msg => {
      if (msg.type === 'chat') {
        const name = msg.playerName || (msg.playerId ? this.getPlayerName(msg.playerId) : 'unknown');
        this.addChatMessage(msg.message, false, name, msg.playerColor);
      } else if (msg.type === 'system') {
        this.addChatMessage(msg.message, true);
      }
    });
  }

  /**
   * Goal: Send a chat message to the server.
   * Input: message (string)
   * Output: None
   */
  sendChatMessage(message) {
    this.send({ type: 'chat', message });
  }

  /**
   * Goal: Establish WebSocket connection and set up handlers.
   * Input: None
   * Output: None
   */
  connect() {
    this.ws = new WebSocket(`ws://${window.location.host}`);

    this.ws.onopen = () => console.log('Connected to game server');
    this.ws.onmessage = (event) => this.handleMessage(JSON.parse(event.data));
    this.ws.onclose = () => {
      console.log('Disconnected from server');
      setTimeout(() => this.connect(), 2000);
    };
    this.ws.onerror = (error) => console.error('WebSocket error:', error);
  }

  /**
   * Goal: Helper to send data safely over WebSocket.
   * Input: data (object)
   * Output: None
   */
  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  /**
   * Goal: Dispatch incoming server messages to appropriate handlers.
   * Input: data (object) - The parsed JSON message from server
   * Output: None
   */
  handleMessage(data) {
    const handlers = {
      'init': () => this.handleInit(data),
      'stateUpdate': () => this.handleStateUpdate(data),
      'playerDied': () => this.handlePlayerDied(data),
      'gameOver': () => this.addChatMessage(`GAME OVER! Winner: ${data.winner}`, true),
      'mapChange': () => this.game?.applyMapChanges?.(data.changes),
      'bombUpdate': () => this.game?.updateBomb?.(data.bomb),
      'playerJoined': () => this.handlePlayerJoined(data),
      'playerLeft': () => this.handlePlayerLeft(data),
      'chat': () => this.handleChat(data),
      'lobbyUpdate': () => this.handleLobbyUpdate(data),
      'gameStarted': () => this.handleGameStarted(data),
      'voice-signal': () => this.voiceManager?.handleSignal(data),
      'targetAcquiredChanged': () => this.updateTargetAcquiredButton(data.active)
    };

    if (handlers[data.type]) {
      handlers[data.type]();
    }
  }

  handleLobbyUpdate(data) {
    const lobbyOverlay = document.getElementById('lobby-overlay');
    const roomIdEl = document.getElementById('lobby-room-id');
    const playerListEl = document.getElementById('lobby-player-list');
    const startBtn = document.getElementById('btn-start-game');
    const waitingMsg = document.getElementById('lobby-waiting-msg');

    if (!lobbyOverlay) return;

    // Show lobby if phase is LOBBY
    if (data.phase === 'LOBBY') {
      lobbyOverlay.style.display = 'flex';
    } else {
      lobbyOverlay.style.display = 'none';
      return;
    }

    if (roomIdEl) roomIdEl.textContent = data.roomId;

    // Update player list
    if (playerListEl) {
      playerListEl.innerHTML = '';
      data.players.forEach(p => {
        const div = document.createElement('div');
        div.className = 'lobby-player';
        div.style.color = p.color;
        const isMe = p.id === this.playerId;
        div.innerHTML = `${p.name}${isMe ? ' (YOU)' : ''} ${p.isHost ? '<span style="color:#ffd700">[HOST]</span>' : ''}`;
        playerListEl.appendChild(div);
      });
    }

    // Show/Hide Start Button based on host status
    const isHost = data.hostId === this.playerId;
    if (startBtn) startBtn.style.display = isHost ? 'inline-block' : 'none';
    if (waitingMsg) waitingMsg.style.display = isHost ? 'none' : 'block';
  }

  handleGameStarted(data) {
    const lobbyOverlay = document.getElementById('lobby-overlay');
    if (lobbyOverlay) lobbyOverlay.style.display = 'none';

    if (this.game) {
      this.game.updateGamePhase?.(data.phase);
    }
  }

  sendStartGame() {
    this.send({ type: 'startGame' });
  }

  toggleTargetAcquired() {
    this.send({ type: 'toggleTargetAcquired' });
  }

  updateTargetAcquiredButton(active) {
    const btn = document.getElementById('btn-target-acquired');
    if (!btn) return;
    btn.textContent = `TARGET ACQUIRED: ${active ? 'ON' : 'OFF'}`;
    btn.style.color = active ? '#ff4444' : '#7b8596';
    btn.style.borderColor = active ? '#ff4444' : '#444';
  }

  /**
   * Goal: Initialize the game with server data.
   * Input: data (object) - Init data including map, player info, etc.
   * Output: None
   */
  handleInit(data) {
    this.playerId = data.playerId;

    this.game = window.createGame({
      map: data.map,
      width: data.width,
      height: data.height,
      screenEl: this.dom.screen,
      stateMenuEl: this.dom.stateMenu,
      bombsEl: this.dom.bombs,
      oxygenBarEl: this.dom.oxygenBar,
      oxygenTextEl: this.dom.oxygenText,
      generateMap: window.generateMap,
      onSendMove: (x, y) => this.sendMove(x, y),
      onAction: (action) => this.sendAction(action)
    });

    // Initial Sync
    if (this.game.setPlayerPosition) this.game.setPlayerPosition(data.playerX, data.playerY);
    this.syncGameState(data.gameState);

    // Inventory Sync
    if (data.playerBombs !== undefined && this.game.updateInventory) {
      this.game.updateInventory({
        bombs: data.playerBombs,
        oxygen: data.playerOxygen || 50,
        jumps: data.playerJumps || 1,
        dash: false
      });
    }

    this.loadChatHistory(data.chatHistory);
    this.game.start();

    // Update HUD with player info
    this.updateHUD();
  }

  /**
   * Goal: Update game state based on server broadcast.
   * Input: data (object) - Contains gameState and inventory
   * Output: None
   */
  handleStateUpdate(data) {
    this.players = new Map(data.gameState.players.map(p => [p.id, p]));
    const myPlayer = this.players.get(this.playerId);

    if (this.game) {
      // Update dark-room mode if specified
      if (data.darkRoom !== undefined) {
        this.game.updateDarkRoomMode?.(data.darkRoom);
      }

      // Update local player
      if (myPlayer) {
        this.game.updatePlayerPosition?.(myPlayer.x, myPlayer.y);
        this.game.updateInventory?.(data.inventory || {
          bombs: myPlayer.bombs,
          oxygen: myPlayer.oxygen,
          jumps: myPlayer.jumps,
          dash: myPlayer.dash
        });
        this.game.updateDragState?.(myPlayer.draggedWall);
      }

      // Update world
      this.game.updateOtherPlayers?.(this.getOtherPlayers());
      this.syncGameState(data.gameState);
      this.game.updateGamePhase?.(data.gameState.phase, data.gameState.winner);
    }
  }

  /**
   * Goal: Sync common game state entities (aliens, boxes, walls, bombs).
   * Input: gameState (object)
   * Output: None
   */
  syncGameState(gameState) {
    if (!gameState || !this.game) return;
    if (gameState.aliens) this.game.updateAliens?.(gameState.aliens);
    if (gameState.boxes) this.game.updateBoxes?.(gameState.boxes);
    if (gameState.walls) this.game.updateWalls?.(gameState.walls);
    if (gameState.bombs) this.game.updateBombs?.(gameState.bombs);

    // Initial player sync for init
    if (gameState.players && !this.players.size) {
      const otherPlayers = gameState.players
        .filter(p => p.id !== this.playerId)
        .map(p => ({ id: p.id, x: p.x, y: p.y, color: p.color }));
      this.game.updateOtherPlayers?.(otherPlayers);
    }
  }

  /**
   * Goal: Handle player death event.
   * Input: data (object)
   * Output: None
   */
  handlePlayerDied(data) {
    const player = this.players.get(data.playerId);
    if (player) {
      player.isDead = true;
      this.addChatMessage(`${window.getPlayerName(data.playerId)} died: ${data.reason}`, true);
    }
  }

  /**
   * Goal: Handle new player joining.
   * Input: data (object)
   * Output: None
   */
  handlePlayerJoined(data) {
    this.players.set(data.player.id, data.player);
    console.log('Player joined:', data.player.id);

    if (data.player.id !== this.playerId) {
      this.addChatMessage(`${window.getPlayerName(data.player.id)} joined the room`, true);
      // Initiate voice connection to new player
      this.voiceManager?.createPeerConnection(data.player.id, true);
    }
    this.game?.updateOtherPlayers?.(this.getOtherPlayers());
  }

  /**
   * Goal: Handle player leaving.
   * Input: data (object)
   * Output: None
   */
  handlePlayerLeft(data) {
    this.players.delete(data.playerId);
    console.log('Player left:', data.playerId);
    this.addChatMessage(`${this.getPlayerName(data.playerId)} left the room`, true);
    this.voiceManager?.removePeer(data.playerId);
  }

  /**
   * Goal: Handle incoming chat message.
   * Input: data (object)
   * Output: None
   */
  handleChat(data) {
    if (!data.playerId || !data.message) return;
    const name = data.playerName || this.getPlayerName(data.playerId);
    const color = data.playerColor || this.players.get(data.playerId)?.color;
    this.addChatMessage(data.message, false, name, color);
  }

  /**
   * Goal: Send movement command to server.
   * Input: x (number), y (number)
   * Output: None
   */
  sendMove(x, y) {
    this.send({ type: 'move', x, y });
  }

  /**
   * Goal: Send generic action to server.
   * Input: action (object)
   * Output: None
   */
  sendAction(action) {
    this.send({ type: 'action', ...action });
  }

  /**
   * Goal: Get local player object.
   * Input: None
   * Output: Player object or undefined
   */
  getMyPlayer() {
    return this.players.get(this.playerId);
  }

  /**
   * Goal: Get list of other players.
   * Input: None
   * Output: Array of player objects
   */
  getOtherPlayers() {
    return Array.from(this.players.values()).filter(p => p.id !== this.playerId);
  }

  /**
   * Goal: Helper to get player name (wrapper around global util).
   * Input: playerId (string)
   * Output: string
   */
  getPlayerName(playerId) {
    return window.getPlayerName ? window.getPlayerName(playerId) : playerId;
  }

  /**
   * Goal: Update the HUD with player name and room ID
   * Input: None
   * Output: None
   */
  updateHUD() {
    const hudPlayerName = document.getElementById('hud-player-name');
    const hudRoomId = document.getElementById('hud-room-id');

    if (hudPlayerName && this.playerId) {
      hudPlayerName.textContent = this.getPlayerName(this.playerId);
    }

    if (hudRoomId && this.roomId) {
      hudRoomId.textContent = this.roomId;
    }
  }

  /**
   * Goal: Join a specific game room.
   * Input: roomId (string), settings (object)
   * Output: None
   */
  joinRoom(roomId, settings = {}) {
    this.roomId = roomId; // Store room ID for display
    const msg = { type: 'joinRoom', roomId, settings };
    if (this.ws.readyState === WebSocket.OPEN) {
      this.send(msg);
    } else {
      this.ws.addEventListener('open', () => this.send(msg), { once: true });
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
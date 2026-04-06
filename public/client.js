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
    this._disconnecting = false;
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
    window.addEventListener('beforeunload', () => { this._disconnecting = true; });

    // Voice Chat
    this.voiceManager = window.VoiceManager ? new window.VoiceManager(this) : null;

    // Audio
    this.audio = window.AudioManager ? new window.AudioManager() : null;
    this._prevInventory = { gold: 0, oxygen: 0 };
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
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${wsProtocol}//${window.location.host}`);

    this.ws.onopen = () => console.log('Connected to game server');
    this.ws.onmessage = (event) => this.handleMessage(JSON.parse(event.data));
    this.ws.onclose = () => {
      console.log('Disconnected from server');
      if (!this._disconnecting) {
        setTimeout(() => this.connect(), 2000);
      }
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
      'gameOver': () => this.handleGameOver(data),
      'mapChange': () => this.game?.applyMapChanges?.(data.changes),
      'bombUpdate': () => this.game?.updateBomb?.(data.bomb),
      'playerJoined': () => this.handlePlayerJoined(data),
      'playerLeft': () => this.handlePlayerLeft(data),
      'chat': () => this.handleChat(data),
      'lobbyUpdate': () => this.handleLobbyUpdate(data),
      'countdown': () => this.handleCountdown(data),
      'gameStarted': () => this.handleGameStarted(data),
      'voice-signal': () => this.voiceManager?.handleSignal(data),
      'alienDied': () => this.audio?.playSound('alienDeath'),
      'targetAcquiredChanged': () => this.updateTargetAcquiredButton(data.active),
      'serverEvent': () => this.handleServerEvent(data),
      'raceGlobalRank': () => this.game?.setGlobalRank?.(data.rank)
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

  handleCountdown(data) {
    const overlay = document.getElementById('lobby-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    overlay.innerHTML = `<div class="overlay-content" style="text-align:center;padding:40px;">
      <div style="font-size:96px;color:#fff;font-family:monospace;line-height:1;">${data.count}</div>
      <div style="font-size:14px;color:#7b8596;letter-spacing:3px;margin-top:16px;">GET READY</div>
    </div>`;
  }

  handleGameStarted(data) {
    const lobbyOverlay = document.getElementById('lobby-overlay');
    if (lobbyOverlay) lobbyOverlay.style.display = 'none';

    this.audio?.announce('gameStarted', 'Game started!');

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
    if (active) this.audio?.playSound('alienGrowl');
  }

  handleServerEvent(data) {
    const banner = document.getElementById('event-banner');
    if (!banner) return;

    if (data.phase === 'warning') {
      banner.className = 'warning';
      banner.textContent = `⚠  ${data.name}  —  ${data.description}  ⚠`;
      banner.style.display = 'block';
      this.addChatMessage(`⚠ INCOMING: ${data.name} — ${data.description}`, true);
      this.audio?.announce('serverWarning', `Warning: ${data.name}. ${data.description}`);
    } else if (data.phase === 'active') {
      banner.className = 'active';
      banner.textContent = `▶  ${data.name} ACTIVE`;
      this.audio?.announce('serverActive', `${data.name} is now active!`);
      if (data.id === 'GRAVITY_MALFUNCTION') this.game?.setGravityInverted?.(true);
    } else if (data.phase === 'ended') {
      banner.className = '';
      banner.style.display = 'none';
      if (data.id === 'GRAVITY_MALFUNCTION') this.game?.setGravityInverted?.(false);
    }
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
        const inv = data.inventory || { bombs: myPlayer.bombs, oxygen: myPlayer.oxygen, jumps: myPlayer.jumps, dash: myPlayer.dash };
        this.game.updateInventory?.(inv);
        this.game.updateDragState?.(myPlayer.draggedWall);

        // Pickup sounds
        if (inv.gold > this._prevInventory.gold) this.audio?.playSound('coinPickup');
        if (inv.oxygen > this._prevInventory.oxygen) this.audio?.playSound('dropletPickup');
        this._prevInventory.gold = inv.gold ?? this._prevInventory.gold;
        this._prevInventory.oxygen = inv.oxygen ?? this._prevInventory.oxygen;
      }

      // Update world
      this.game.updateOtherPlayers?.(this.getOtherPlayers());
      this.syncGameState(data.gameState);
      this.game.updateGamePhase?.(data.gameState.phase, data.gameState.winner, data.gameState.rankings);
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
      const name = window.getPlayerName(data.playerId);
      this.addChatMessage(`${name} died: ${data.reason}`, true);
      if (data.playerId === this.playerId) {
        this.audio?.announce('playerDied', 'You died!');
      } else {
        this.audio?.playSound('playerDied');
      }
    }
  }

  handleGameOver(data) {
    this.addChatMessage(`GAME OVER! Winner: ${data.winner}`, true);
    const isVictory = data.winner === 'Players';
    this.audio?.announce(
      isVictory ? 'gameOverWin' : 'gameOverLose',
      isVictory ? 'Victory! Players win!' : `Game over. ${data.winner} wins.`
    );
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
      this.audio?.playSound('playerJoined');
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
    this.audio?.playSound('playerLeft');
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
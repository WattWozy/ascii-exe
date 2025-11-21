class GameClient {
  constructor() {
    this.ws = null;
    this.playerId = null;
    this.players = new Map();
    this.game = null;
    this.connect();
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
            screenEl: document.getElementById('game-screen'),
            stateMenuEl: document.getElementById('game-state'),
            generateMap: data.generateMap,
            onSendMove: (x, y) => this.sendMove(x, y),
            onAction: (action) => this.sendAction(action)
        });

        this.game.start();
        break;

      case 'stateUpdate':
        // Update game state from server
        this.players = new Map(data.gameState.players.map(p => [p.id, p]));
        break;

      case 'playerJoined':
        // New player joined
        this.players.set(data.player.id, data.player);
        console.log('Player joined:', data.player.id);
        break;

      case 'playerLeft':
        // Player left
        this.players.delete(data.playerId);
        console.log('Player left:', data.playerId);
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
      this.ws.send(JSON.stringify({
        type: 'action',
        action: action
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
}

const roomId =
  new URLSearchParams(location.search).get("room") ||
  localStorage.getItem("currentRoom") ||
  "default";

localStorage.setItem("currentRoom", roomId);
// Initialize the client
const gameClient = new GameClient();
gameClient.joinRoom(roomId);

// Example usage in your game loop:
// gameClient.sendMove(playerX, playerY);
// const otherPlayers = gameClient.getOtherPlayers();
// // Render other players...
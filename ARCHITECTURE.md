# Game Architecture

## Overview
The game uses a **Server-Authoritative** architecture with **Client-Side Prediction**. The server is the single source of truth for the game state, while the client handles input and rendering with optimistic updates to ensure responsiveness.

---

## 🏗 Core Systems

### 1. Server Authority
The server maintains the master state of:
- **Map**: The 2D grid of tiles (walls, floors, etc.).
- **Players**: Position, color, inventory (bombs, oxygen, jumps).
- **Entities**: Aliens, Boxes (and their contents), Active Bombs.
- **Rooms**: Game sessions are isolated in "rooms".

### 2. Client Prediction & Synchronization
To prevent lag perception:
- **Movement**: Client updates player position immediately. Server validates and sends corrections if needed.
- **Actions**: Pushing boxes or placing bombs is shown immediately. Server validates and broadcasts the result.
- **State Updates**: The server broadcasts the full game state (players, aliens, boxes) at a fixed tick rate (60Hz logic, broadcast periodically).

### 3. Map Management
- **Generation**: The server generates the map (using `mapgen.js` or fallback).
- **Updates**: When a tile changes (e.g., wall blown up, item collected), the server broadcasts a `mapChange` event to all clients.

### 4. Chat System
- **Room-based**: Messages are broadcast only to players in the same room.
- **History**: The server stores a limited history of messages for new joiners.

---

## 📡 Communication Protocol

The communication uses **WebSockets** with JSON messages.

### Client → Server

| Type | Fields | Description |
|------|--------|-------------|
| `joinRoom` | `{ roomId }` | Request to join a specific game room. |
| `move` | `{ x, y }` | Request to move to a coordinate. |
| `action` | `{ action: 'collect', x, y }` | Request to collect an item. |
| `action` | `{ action: 'push', fromX, fromY, toX, toY }` | Request to push a wall/box. |
| `action` | `{ action: 'placeBomb', x, y }` | Request to place a bomb. |
| `chat` | `{ message }` | Send a chat message. |

### Server → Client

| Type | Fields | Description |
|------|--------|-------------|
| `init` | `{ playerId, map, gameState, chatHistory, ... }` | Sent on join. Contains full initial state. |
| `stateUpdate` | `{ gameState: { players, aliens, boxes, bombs } }` | Periodic sync of dynamic entities. |
| `mapChange` | `{ changes: [{x, y, tile}] }` | Immediate update when map tiles change. |
| `bombUpdate` | `{ bomb: {x, y, blinkOn} }` | Syncs bomb visual state (blinking). |
| `playerJoined` | `{ player: {id, x, y, color} }` | Notification that a new player joined. |
| `playerLeft` | `{ playerId }` | Notification that a player left. |
| `chat` | `{ message, playerName, playerColor, ... }` | A chat message to display. |

---

## 🧩 State Definitions

### Map Tiles
- `#`: Wall
- `.`: Floor
- `o`: Pushable Wall
- `*`: Oxygen Pump
- `•`: Oxygen Droplet
- `Ø`: Box (contains Bomb or Oxygen)
- `B`: Map Bomb

### Player Object
```json
{
  "id": "player_123...",
  "x": 5,
  "y": 10,
  "color": "#FFB6C1",
  "bombs": 3,
  "oxygen": 200,
  "jumps": 1,
  "dash": false
}
```

### Box Object
```json
{
  "x": 12,
  "y": 8,
  "content": "bomb" // or "oxygen"
}
```

---

## ✅ Completed Features (Architecture Status)

- [x] **Server-side Map State**: Server holds the 2D array and validates moves.
- [x] **Action Validation**: Server checks if you have bombs, if a push is valid, etc.
- [x] **Inventory Sync**: Server tracks oxygen/bombs and syncs to client.
- [x] **Box Contents**: Server determines box contents (preventing client-side cheating).
- [x] **Multiplayer Sync**: Players see each other, aliens, and map changes in real-time.
- [x] **Chat**: Functional room chat with history.
- [x] **Room Logic**: Support for multiple isolated game rooms.

## 🖥 Frontend Structure

- **`index.html`**: The landing page. Provides options to start a new game or join an existing room.
- **`game.html`**: The main game client. Connects to the server via WebSocket and renders the game.
- **`client.js`**: Handles WebSocket communication and game initialization.
- **`game.js`**: Core game logic and rendering.
- **`ui.js`**: UI helper functions.
- **`mapgen.js`**: Map generation logic (shared with server).

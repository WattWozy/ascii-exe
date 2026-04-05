
---

# 📘 **Documentation: Multiplayer Browser Game System**

This documentation covers the three key components of the multiplayer game:

* **server.js** – WebSocket + Express game server, room management, authoritative state
* **client.js** – WebSocket client + bridge between server and game engine
* **game.js** – Standalone client-side game engine with rendering, controls, entities, and simulation

---

# ------------------------------------------------------------

# 🟦 **1. server.js — Multiplayer Game Server**

# ------------------------------------------------------------

## **Purpose**

Node.js server responsible for:

* Hosting static frontend (HTML/JS).
* Handling WebSocket connections.
* Managing isolated **game rooms**, each with its own players and map.
* Running authoritative game loops.
* Broadcasting synchronized state to clients.

---

## **Key Components**

### **Express Server**

* Serves all files inside `/public`.
* Exposes optional endpoint `/api/rooms` for debugging room states.

### **WebSocket Server**

* Accepts WebSocket connections from browsers.
* Handles messages such as:

  * `joinRoom`
  * `move`
  * `action`

---

## **Rooms & Game State**

### **`rooms`**

Global registry:

```js
const rooms = {};
```

Each room ID maps to one instance of `GameRoom`.

---

## **GameRoom Class**

### **Responsibilities**

* Track all players in the room.
* Maintain authoritative game state.
* Store and regenerate maps.
* Run a 60 FPS game loop.
* Broadcast updates to all room members.

---

### **Constructor**

Initializes:

* `this.roomId`
* `this.players` (Map)
* Default map: `generateSimpleMap(20,20)`
* `gameState` (createdAt, started flag)
* Game loop (`startGameLoop()`)

---

### **addPlayer(playerId, ws)**

Registers a player:

* Stores WebSocket reference.
* Initializes random starting coordinates (placeholder).
* Prepares player structure for syncing.

---

### **removePlayer(playerId)**

Removes a player and schedules room cleanup:

* If room becomes empty:

  * Wait 5 minutes
  * Destroy room and interval loop

---

### **handlePlayerInput(playerId, data)**

Processes inbound interactions:

* `move` → clamps x,y within 0–800 / 0–600
* `action` → stores action keyword

---

### **Game Loop**

Runs at **60 ticks/sec**:

* `updateGameLogic()`
* `broadcastState()`

### **updateGameLogic()**

Placeholder for real game logic:

* Physics
* Collisions
* Bomb logic
* Enemies
* Rooms

Currently just broadcasts all player positions.

---

### **broadcast()**

Utility: sends JSON to all players (except optional excluded WebSocket).

---

## **WebSocket Lifecycle**

### **On `connection`**

Maintains:

```
currentRoom
playerId
```

---

### **On `joinRoom` message**

Steps:

1. Generate a unique playerId
2. Assign client to the requested room
3. Add player to room
4. Respond with:

   * Initial map
   * Assigned playerId
   * GameState
   * Dimensions
5. Notify other players in the room

---

### **On player input**

Routes to:

```
currentRoom.handlePlayerInput(playerId, data)
```

---

### **On disconnect**

* Remove player
* Broadcast `playerLeft`

---

## **Utility Endpoints**

### `/api/rooms`

Returns:

* Room ID
* # of players
* Timestamp

---

## **Server Startup**

Binds to:

```
0.0.0.0:3000
```

Logs LAN IP for easy access across devices.

---

# ------------------------------------------------------------

# 🟦 **2. client.js — WebSocket Game Client**

# ------------------------------------------------------------

## **Purpose**

Browser-side client responsible for:

* Connecting to server.
* Managing local player registry.
* Passing events into the game engine.
* Receiving authoritative updates from server.
* Handling room selection.

---

## **GameClient Class**

### **constructor()**

Initializes:

* WebSocket connection
* playerId
* players map
* `game` instance from game.js

---

## **connect()**

Attempts a WebSocket connection to:

```
ws://<current host>
```

Handles:

* `onopen` → ready
* `onmessage` → parse + dispatch
* `onclose` → auto-reconnect after 2 seconds
* `onerror` → logs error

---

## **handleMessage(data)**

Handles server message types:

### **`init`**

* Assigns `playerId`
* Creates the game instance:

  * Injects callbacks: `onSendMove`, `onAction`
  * Starts the game engine via `game.start()`

### **`stateUpdate`**

* Updates the `players` Map, maintaining authoritativeness.

### **`playerJoined`**

* Adds the new player to local registry.

### **`playerLeft`**

* Removes player from registry.

---

## **sendMove(x,y)**

Sends player position to server (if WebSocket is open).

---

## **sendAction(action)**

Sends action events: attack, bomb, dash etc.

---

## **getMyPlayer()**

Returns structure for the local player.

---

## **getOtherPlayers()**

Returns all players except self.

---

## **Room Selection Logic**

Determines room priority:

1. URL: `?room=xyz`
2. localStorage: `currentRoom`
3. fallback: `"default"`

Stores selected room in localStorage.

---

## **Client Boot**

After constructing:

```
gameClient.joinRoom(roomId)
```

(Assumes you added joinRoom manually or earlier in code.)

---

# ------------------------------------------------------------

# 🟦 **3. game.js — Client-Side Game Logic Engine**

# ------------------------------------------------------------

## **Purpose**

Self-contained game engine that:

* Manages the map
* Renders tiles to HTML grid
* Tracks player state (bombs, jumps, oxygen…)
* Handles keyboard input
* Simulates entities (aliens, boxes, bombs)
* Supports map regeneration
* Supplies callbacks to client.js

The server **does not** run this engine — it only synchronizes movement and actions.

---

## **createGame(config)**

### **Configuration**

The client passes:

* `map`, `width`, `height`
* DOM nodes (`screenEl`, `stateMenuEl`)
* Rendering symbols (walls, floors…)
* Optional map options (`mapOpts`)
* Callback hooks:

  * `onSendMove(x,y)`
  * `onAction(action)`

---

## **Internal State**

### Player:

```
{ x, y, jumps, bombs, dash, oxygen }
```

### Map:

2D grid (characters)

### Entities:

* `aliens[]`
* `bombs[]`
* `boxes[]` (yield bombs or oxygen)

---

## **Core Features**

### **1. Alien AI**

* Random movement
* Avoids walls/obstacles
* Converts to O₂ droplet when blocked

### **2. Bomb Logic**

* Attaches to walls
* Has blinking timer
* Delay shrinks over time
* Explodes & clears a wall

### **3. Boxes**

Randomly filled with:

* bombs
* oxygen

---

### **4. Rendering**

Renders entire map → `<span>` tiles with CSS classes:

* `player`
* `wall`
* `alien`
* `droplet`
* `bomb`
* `pump`
* `box-filled`
* `box-empty`

Menu shows:

```
jumps, bombs, dash, oxygen/maxOxygen
```

---

### **5. Player Movement**

Movement rules enforced:

* Cannot enter walls
* Can push TILE_PUSH if behind space
* Jump using SPACE + direction
* Exit detection (`isExit`)

---

### **6. Inputs**

Maps keyboard:

```
WASD + ArrowKeys
SPACE for jump
Other keys for bomb placement etc.
```

Tracks `lastDir` for directional actions.

---

## **Game Loop**

The rendering & logic loop is internal to the game engine (client-side).
Server only sends synchronization, not visual logic.

---

## **Return API from createGame()**

Returned object exposes methods such as:

* `start()`
* Possibly additional helpers (not shown in truncated snippet)

Used by client.js.

---

# ------------------------------------------------------------

# ✅ **End of Documentation**

# ------------------------------------------------------------

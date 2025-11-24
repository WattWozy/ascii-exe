---
trigger: model_decision
description: When editing or modifying game logic, instructions, locations and boundaries on what to do
---

# Core Game Logic Locations

This document defines the authoritative location for the game's essential mechanics. When modifying core gameplay (movement, physics, stats), you MUST edit the following locations in [server.js](cci:7://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:0:0-0:0).

## 1. Player Actions (The "Verbs")
**Location:** [server.js](cci:7://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:0:0-0:0) -> [GameRoom](cci:2://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:494:0-1252:1) class -> [handlePlayerInput(playerId, data)](cci:1://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:984:2-1062:3)

This method is the central switchboard for all player interactions. It is the **only** place where player input is converted into game state changes.

*   **Movement**: Logic for `data.type === 'move'`.
    *   Validates the move (collision checks).
    *   Updates `player.x` / `player.y`.
    *   **Oxygen Depletion**: `player.oxygen` is decremented here upon successful move.
*   **Pushing**: Logic for `data.type === 'action' && action === 'push'`.
    *   Validates if the wall can move.
    *   Updates wall coordinates in `this.pushableWalls`.
*   **Dragging**: Logic for `data.type === 'action' && action === 'drag'`.
    *   Sets `player.draggedWall` state.
    *   Actual movement of the dragged wall happens in the **Movement** block above.
*   **Bomb Placement**: Logic for `data.type === 'action' && action === 'placeBomb'`.
    *   Checks `player.bombs > 0`.
    *   Decrements bomb count and adds bomb to `this.bombs`.

## 2. Player Stats (The "Numbers")
**Location:** [server.js](cci:7://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:0:0-0:0) -> [GameRoom](cci:2://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:494:0-1252:1) class

*   **Initialization**: [addPlayer(playerId, ws)](cci:1://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:724:2-761:3) defines the starting values (e.g., `oxygen: 200`, `bombs: 3`).
*   **Modification**: Stats are mutated directly within [handlePlayerInput](cci:1://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:984:2-1062:3) as immediate consequences of actions.

## 3. Game Loop & State (The "Pulse")
**Location:** [server.js](cci:7://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:0:0-0:0) -> [GameRoom](cci:2://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:494:0-1252:1) class

*   **[_startGameLoop()](cci:1://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:1181:2-1192:3)**: Runs the 60Hz server tick.
*   **[_updateGameLogic()](cci:1://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:1143:2-1148:3)**: The entry point for frame-by-frame updates.
    *   It calls `this.modeHandler.update()` to check for Win/Loss conditions or mode-specific events (like King of the Hill timers).
*   **[_broadcastState()](cci:1://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:1199:2-1242:3)**: The **ONLY** exit point for data. It packages the entire authoritative state (including private inventory) and sends it to clients.

## ❌ Strict Prohibition
**NEVER** implement these core mechanics in [client.js](cci:7://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/public/client.js:0:0-0:0) or [game.js](cci:7://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/public/game.js:0:0-0:0).
*   The Client only sends the **intent** (e.g., "I want to move right").
*   The Server executes the logic, checks the rules, and updates the state.
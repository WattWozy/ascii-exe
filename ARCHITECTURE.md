# Game Architecture: Server vs Client Responsibilities

## Overview
This document outlines what should be **server-authoritative** (shared state) vs **client-side** (local presentation/input).

---

## 🟦 **SERVER (Authoritative State)**

The server is the **single source of truth** for all shared game state.

### **Map State**
- **Tile positions** - What tile is at each (x,y) coordinate
- **Collectibles** - Oxygen pumps, boxes, map bombs, droplets
- **Pushable objects** - Positions of pushable walls (`o`)
- **Bombs** - Active bomb placements and their states
- **Box contents** - What's inside each box (bomb or oxygen)

**Why:** All players must see the same map state. If one player collects an oxygen pump, all players should see it disappear.

### **Player State**
- **Positions** - Current (x,y) coordinates
- **Inventory** - Bombs count, oxygen level, jumps remaining
- **Colors** - Assigned player color

**Why:** Prevents cheating and ensures consistency. Server validates all actions.

### **Entity State**
- **Aliens** - Positions and movement
- **Boxes** - Positions and contents

**Why:** All players must see synchronized aliens and boxes.

---

## 🟨 **CLIENT (Presentation & Input)**

The client handles **rendering** and **input**, with **local prediction** for responsiveness.

### **Rendering**
- Display map tiles
- Render players, aliens, objects
- UI/HUD updates
- Visual effects

**Why:** Rendering is expensive and doesn't need to be synchronized.

### **Input Handling**
- Keyboard input
- Movement requests
- Action requests (collect, push, place bomb)

**Why:** Input is captured locally and sent to server for validation.

### **Local Prediction**
- Immediate visual feedback (optimistic updates)
- Server corrections override predictions

**Why:** Makes the game feel responsive. Server always has final say.

---

## 📡 **Communication Protocol**

### **Client → Server Messages**

1. **`move`** - Player movement request
   ```json
   { "type": "move", "x": 5, "y": 10 }
   ```

2. **`action`** - Game action
   ```json
   { "type": "action", "action": "collect", "x": 5, "y": 10 }
   { "type": "action", "action": "push", "fromX": 5, "fromY": 10, "toX": 6, "toY": 10 }
   { "type": "action", "action": "placeBomb", "x": 5, "y": 10 }
   ```

### **Server → Client Messages**

1. **`init`** - Initial game state
   ```json
   {
     "type": "init",
     "playerId": "player_123",
     "map": [...],
     "width": 40,
     "height": 20,
     "playerX": 1,
     "playerY": 1,
     "playerColor": "#FFB6C1",
     "gameState": {
       "players": [...],
       "aliens": [...],
       "boxes": [...]
     }
   }
   ```

2. **`stateUpdate`** - Periodic state sync
   ```json
   {
     "type": "stateUpdate",
     "gameState": {
       "players": [...],
       "aliens": [...],
       "mapChanges": [
         { "x": 5, "y": 10, "tile": "." }
       ]
     }
   }
   ```

3. **`mapChange`** - Immediate map update
   ```json
   {
     "type": "mapChange",
     "changes": [
       { "x": 5, "y": 10, "tile": "." }
     ]
   }
   ```

---

## 🔄 **Current Issues & Solutions**

### **Issue 1: Map Changes Not Synced**
**Problem:** Collecting oxygen, pushing objects, placing bombs only happens client-side.

**Solution:** 
- Send `action` messages to server for all map modifications
- Server validates and applies changes
- Server broadcasts `mapChange` to all clients
- Clients apply server changes (overriding local predictions)

### **Issue 2: Player Inventory Not Synced**
**Problem:** Bombs, oxygen, jumps are only tracked client-side.

**Solution:**
- Server tracks player inventory
- Server validates actions (e.g., can't place bomb without bombs)
- Server sends inventory updates in `stateUpdate`

### **Issue 3: Box Contents Not Synced**
**Problem:** Box contents are randomly generated client-side.

**Solution:**
- Server generates and stores box contents
- Server sends box data in `init` and `stateUpdate`
- Clients render boxes based on server data

---

## ✅ **Implementation Plan**

1. **Server-side map state management**
   - Track map as 2D array
   - Track boxes with contents
   - Track active bombs

2. **Action validation**
   - Validate collect actions (item exists, not already collected)
   - Validate push actions (object exists, destination valid)
   - Validate bomb placement (player has bombs, valid location)

3. **Map change broadcasting**
   - Send immediate `mapChange` messages for important events
   - Include map state in periodic `stateUpdate`

4. **Client-side updates**
   - Apply server map changes
   - Override local predictions with server state
   - Update inventory from server

---

## 🎯 **Benefits**

- **Consistency:** All players see the same game state
- **Anti-cheat:** Server validates all actions
- **Reliability:** Server is authoritative, clients can reconnect and sync
- **Scalability:** Can add more players without client-side conflicts



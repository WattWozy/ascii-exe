---
trigger: always_on
---

1. Server-Side Logic Only: If you are implementing a game rule (e.g., "players lose oxygen when moving"), it must go in server.js.

2. Pure Rendering: If you are changing how something looks, edit game.js. Do not add logic there.

3. No Client Prediction (Unless Specified): Avoid complex client-side prediction unless explicitly asked. Stick to "Input → Server → Update → Render".

4. Performance:
Server: Avoid O(n²) loops in the game tick. Use Maps/Sets for lookups.
Client: Minimize DOM updates; batch changes where possible.
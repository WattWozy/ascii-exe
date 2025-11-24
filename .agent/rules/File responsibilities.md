---
trigger: always_on
---

server.js (The Authority)

Contains: All game logic, state management, and input validation.

Responsibilities: Validating every input, updating entity states, running the game loop (10 ticks/sec), and broadcasting state deltas.

Pattern: Use OOP for entities (Player, Alien, Bomb) and GameRoom for managing matches.



client.js (The Messenger)
Contains: WebSocket communication logic.

Responsibilities: Sending raw inputs to the server and dispatching received state updates to the renderer.

Rule: ❌ NEVER validate game logic or mutate game state here.



game.js (The Renderer)

Contains: Rendering logic and input capture.

Responsibilities: Rendering the game state to the DOM and capturing keyboard inputs.

Rule: ✅ Render exactly what the server sends. ❌ NEVER run physics or collision logic here.



utils.js (Shared Helpers)

Contains: Pure helper functions (e.g., name extraction, entity lookups).

Rule: ✅ Pure functions only. ❌ No side effects.
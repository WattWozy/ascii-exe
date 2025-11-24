---
trigger: model_decision
description: When adding a new rule to a game mode
---

# Game Mode Implementation Rules

When adding new rules or mechanics to a specific game mode (e.g., "Rob the Bank", "Capture the Flag"), you MUST follow these guidelines to ensure isolation, authority, and stability.

## 1. Isolation of Logic
*   **Specific Handlers Only**: All mode-specific logic MUST reside within its corresponding `GameModeHandler` subclass in [server.js](cci:7://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:0:0-0:0) (e.g., [RobBankMode](cci:2://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:132:0-294:1), [CaptureTheFlagMode](cci:2://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:296:0-439:1)).
*   **No Pollution**: ❌ DO NOT add mode-specific `if/else` checks inside the main [GameRoom](cci:2://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:494:0-1252:1) class. The [GameRoom](cci:2://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:494:0-1252:1) should delegate to `this.modeHandler`.

## 2. Implementation Hooks
Use the provided hooks in the `GameModeHandler` base class to enforce your rules:
*   **[init()](cci:1://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:308:2-332:3)**: Run once when the room is created. Use this to spawn mode-specific entities (Flags, Banks, Hills).
*   **[onPlayerJoin(player)](cci:1://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:334:2-347:3)**: Use this to assign teams, give starting items, or set initial mode-specific state.
*   **[handleMove(player, x, y)](cci:1://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:230:2-251:3)**: Intercept movement to trigger events (e.g., stepping on a base, entering a zone).
*   **[handleCollect(player, x, y, tile)](cci:1://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:214:2-228:3)**: Intercept item collection to handle custom items (e.g., picking up Gold).
*   **[update()](cci:1://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:200:2-212:3)**: Called every game tick. Use this for time-based rules, scoring loops, or win condition checks.

## 3. Server Authority & Communication
*   **Server is God**: The server calculates the outcome of the rule. The client simply renders the result.
*   **Broadcast Changes**:
    *   **Map**: If a rule changes a tile (e.g., flag taken), use `this.room.broadcastMapChange()`.
    *   **State**: If a rule changes scores or inventory, ensure it is captured in [_getModeStatus](cci:1://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:1150:2-1179:3) or [_broadcastState](cci:1://file:///Users/niklaswozniaklopez/Desktop/ascii-exe/server.js:1199:2-1242:3).
    *   **Feedback**: Send system chat messages to inform players of major events (e.g., "Red Team Scored!").

## 4. Data Privacy
*   **Private vs Public**: Public state (position, alive/dead) goes to everyone. Private mode state (e.g., "You are on Red Team", "You have 5 gold") MUST be sent via the personalized `inventory` object in `_broadcastState`.
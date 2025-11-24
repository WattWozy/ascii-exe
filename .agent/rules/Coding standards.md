---
trigger: always_on
---

Naming:

Classes: PascalCase (e.g., GameRoom)

Functions: camelCase (e.g., handleMove)

Constants: UPPER_SNAKE_CASE (e.g., TICK_RATE)

Private Methods: _prefixed (e.g., _validateMove)



Error Handling:

Server: Log warnings for invalid inputs but never crash. Fail silently or ignore invalid actions.

Client: Degrade gracefully; catch render errors to prevent the UI from freezing.
# UI Rendering Guidelines

This document defines the standards and workflows for modifying the game's User Interface (UI). Follow these guidelines to ensure a consistent, performant, and clean visual experience.

## 1. File Responsibilities

*   **`public/game.html`**: The Source of Truth for Structure and Style.
    *   **Structure**: Contains the static HTML skeleton (containers, sidebars, HUD elements).
    *   **Style**: Contains the CSS in the `<style>` block. All visual definitions (colors, animations, layout) belong here.
    *   **Rule**: ❌ Do NOT create DOM elements purely in JavaScript if they can be defined statically here and toggled via CSS.

*   **`public/game.js`**: The Renderer.
    *   **Logic**: Updates the DOM based on the current game state.
    *   **Rule**: ✅ Use `render()` for the main grid and `renderEntities()` for moving objects.

## 2. CSS & Styling Standards

*   **Location**: Add all new styles to the `<style>` block in `public/game.html`.
*   **Naming**: Use kebab-case for classes (e.g., `.mode-status-container`, `.progress-bar-fill`).
*   **Colors**:
    *   Use the established palette (Neon Green/Pink/Blue on Dark Background).
    *   **Gold**: `#ffd700`
    *   **Red (Danger/Enemy)**: `#ff6666` or `#ff4444`
    *   **Blue (Ally/Pump)**: `#4fc3ff` or `#4444ff`
    *   **Green (Player/Success)**: `#7cd67c`
*   **Animations**: Define keyframes in CSS. Use classes to trigger them (e.g., `.blinking`, `.dragging`).

## 3. Dynamic Updates (The Render Loop)

The `render()` function in `public/game.js` is called frequently. Optimization is key.

*   **Grid Rendering**: The main ASCII grid is rebuilt as a string of HTML spans and injected into `#screen`.
    *   **New Tiles**: If adding a new tile type (e.g., Flag), add a check in the main loop:
        ```javascript
        else if (ch === TILE_FLAG_RED) { classes.push('flag-red'); }
        ```
*   **Entity Rendering**: Moving objects (Players, Aliens, Pushable Walls) are rendered in a separate `#entity-layer` to allow smooth CSS transitions.
    *   **Method**: `renderEntities()` syncs DOM nodes with the state.
    *   **Rule**: If an object moves smoothly, it MUST be an entity, not a grid tile.

## 4. HUD & Mode-Specific UI

*   **Static Containers**: Create the container in `game.html` (e.g., `#mode-status-container`) and set `display: none` by default.
*   **Update Logic**: In `game.js` -> `updateInventory()` or a dedicated `updateModeStatus()` function:
    1.  Check if the data exists.
    2.  If yes, show the container (`display: flex`) and update content.
    3.  If no, hide the container.
*   **Example**:
    ```javascript
    function updateModeStatus(status) {
      const container = document.getElementById('mode-status-container');
      if (!status) { container.style.display = 'none'; return; }
      container.style.display = 'flex';
      // ... update innerHTML ...
    }
    ```

## 5. Overlays (Game Over, Menus)

*   **Location**: `#game-overlay` in `game.html`.
*   **Behavior**:
    *   The overlay sits on top of the game.
    *   Use `pointer-events: none` on the container, but `pointer-events: auto` on the actual message box/buttons so clicks pass through to the game when the overlay is transparent.
*   **State**: Use `dataset.state` to prevent unnecessary re-renders (e.g., `if (overlayEl.dataset.state !== newState) ...`).

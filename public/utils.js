/**
 * Shared utility functions
 */
(function (exports) {
    /**
     * Goal: Extract a readable player name from a unique ID.
     * Input: playerId (string) - The full player ID (e.g., "player_123_name").
     * Output: (string) - The extracted name or a fallback string.
     */
    function getPlayerName(playerId) {
        if (!playerId) return 'unknown';
        const parts = playerId.split('_');
        // Return last part (the hash), or fallback to last 8 chars if format is unexpected
        return parts.length > 2 ? parts[parts.length - 1] : playerId.substring(playerId.length - 8);
    }

    /**
     * Goal: Find a box entity at specific coordinates.
     * Input: boxes (Array), x (number), y (number)
     * Output: (Object|undefined) - The box object if found, otherwise undefined.
     */
    function findBoxAt(boxes, x, y) {
        return boxes?.find(b => b.x === x && b.y === y);
    }

    /**
     * Goal: Find a bomb entity at specific coordinates.
     * Input: bombs (Array), x (number), y (number)
     * Output: (Object|undefined) - The bomb object if found, otherwise undefined.
     */
    function findBombAt(bombs, x, y) {
        return bombs?.find(b => b.x === x && b.y === y);
    }

    /**
     * Goal: Check if a specific tile is within bounds and not a wall.
     * Input: map (Array), x (number), y (number), width (number), height (number), TILE_WALL (string)
     * Output: (boolean) - True if the tile is walkable, false otherwise.
     */
    function isWalkable(map, x, y, width, height, TILE_WALL) {
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        return map[y]?.[x] !== TILE_WALL;
    }

    /**
     * Goal: Validate a move, considering walls, bounds, and pushable objects.
     * Input: map (Array), x (number), y (number), width (number), height (number), TILE_WALL (string), TILE_PUSH (string), TILE_FLOOR (string), draggedWall (Object)
     * Output: (boolean) - True if the move is valid.
     */
    function isValidMove(map, x, y, width, height, TILE_WALL, TILE_PUSH, TILE_FLOOR, draggedWall) {
        // Basic bounds and wall check
        if (!isWalkable(map, x, y, width, height, TILE_WALL)) return false;

        const tile = map[y][x];

        // Handle pushable blocks
        if (tile === TILE_PUSH) {
            // Allow movement if we are dragging this specific wall (it moves with the player)
            if (draggedWall && draggedWall.x === x && draggedWall.y === y) {
                return true;
            }
            // Otherwise, we cannot step directly onto a pushable block without a push action
            return false;
        }

        return true;
    }

    /**
     * Goal: Check if a bomb can be placed at the target location.
     * Input: map (Array), bombs (Array), x (number), y (number), width (number), height (number), TILE_WALL (string)
     * Output: (boolean) - True if placement is allowed.
     */
    function canPlaceBomb(map, bombs, x, y, width, height, TILE_WALL) {
        // Must be within bounds
        if (x < 0 || y < 0 || x >= width || y >= height) return false;

        // Must be a wall
        if (map[y]?.[x] !== TILE_WALL) return false;

        // Cannot place if a bomb is already there
        if (findBombAt(bombs, x, y)) return false;

        return true;
    }

    /**
     * Goal: Display a text-based exit animation on a DOM element.
     * Input: screenEl (HTMLElement), opts (Object) - Animation options (frames, interval, loops).
     * Output: (Promise) - Resolves when the animation completes.
     */
    function playExitAnimation(screenEl, opts = {}) {
        const frames = opts.frames || [
            "   Exiting   ",
            "  Exiting.  ",
            " Exiting.. ",
            "Exiting...",
            " Exiting.. ",
            "  Exiting.  "
        ];
        const interval = opts.interval || 180; // ms per frame
        const loops = opts.loops || 6; // total frame cycles

        return new Promise((resolve) => {
            let count = 0;
            let idx = 0;
            const timer = setInterval(() => {
                screenEl.textContent = frames[idx];
                idx = (idx + 1) % frames.length;
                count++;

                if (count >= frames.length * loops) {
                    clearInterval(timer);
                    // small fade-to-black effect: clear screen briefly
                    setTimeout(() => {
                        screenEl.textContent = '';
                        resolve();
                    }, 120);
                }
            }, interval);
        });
    }

    const utils = {
        getPlayerName,
        findBoxAt,
        findBombAt,
        isWalkable,
        isValidMove,
        canPlaceBomb,
        playExitAnimation
    };

    // Export logic
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = utils;
    } else {
        window.utils = utils;
        // Expose functions globally for convenience
        Object.assign(window, utils);
    }
})(typeof module === 'undefined' ? window : module.exports);

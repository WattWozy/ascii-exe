// Shared utility functions
(function (exports) {
    // Extract player name from player ID (last part after underscore)
    function getPlayerName(playerId) {
        if (!playerId) return 'unknown';
        const parts = playerId.split('_');
        // Return last part (the hash), or fallback to last 8 chars if format is unexpected
        return parts.length > 2 ? parts[parts.length - 1] : playerId.substring(playerId.length - 8);
    }

    // Find box at position
    function findBoxAt(boxes, x, y) {
        if (!boxes) return null;
        return boxes.find(b => b.x === x && b.y === y);
    }

    // Find bomb at position
    function findBombAt(bombs, x, y) {
        if (!bombs) return null;
        return bombs.find(b => b.x === x && b.y === y);
    }

    // Check if a tile is walkable (basic terrain check)
    function isWalkable(map, x, y, width, height, TILE_WALL) {
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        if (!map[y]) return false;
        return map[y][x] !== TILE_WALL;
    }

    // Comprehensive move validation
    function isValidMove(map, x, y, width, height, TILE_WALL, TILE_PUSH, TILE_FLOOR, draggedWall) {
        // Basic bounds and wall check
        if (!isWalkable(map, x, y, width, height, TILE_WALL)) return false;

        const tile = map[y][x];

        // Handle pushable blocks
        if (tile === TILE_PUSH) {
            // If this is the wall we are dragging, we can walk "through" it (it moves with us)
            if (draggedWall && draggedWall.x === x && draggedWall.y === y) {
                return true;
            }
            // Otherwise, we need to check if we can push it
            // Note: Actual push logic involves checking the tile BEHIND the pushable block
            // This function just checks if we can step onto this tile. 
            // For pushable blocks, we generally can't step ON them unless we push them.
            // So this function might need to be used in context.
            // For now, let's say we can't walk on it unless it's being pushed (handled separately)
            return false;
        }

        return true;
    }

    // Check if bomb can be placed
    function canPlaceBomb(map, bombs, x, y, width, height, TILE_WALL) {
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        // Must be a wall
        if (!map[y] || map[y][x] !== TILE_WALL) return false;
        // Cannot place if bomb already exists
        if (findBombAt(bombs, x, y)) return false;

        return true;
    }

    const utils = {
        getPlayerName,
        findBoxAt,
        findBombAt,
        isWalkable,
        isValidMove,
        canPlaceBomb
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = utils;
    } else {
        // Expose individually to window for easier access or as a namespace
        window.utils = utils;
        window.getPlayerName = getPlayerName;
        window.findBoxAt = findBoxAt;
        window.findBombAt = findBombAt;
        window.isWalkable = isWalkable;
        window.isValidMove = isValidMove;
        window.canPlaceBomb = canPlaceBomb;
    }
})(typeof module === 'undefined' ? window : module.exports);

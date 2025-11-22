(function (exports) {
    const TILES = {
        WALL: '#',
        FLOOR: '.',
        PLAYER: '@',
        PUSHABLE: 'o',
        PUMP: '*',
        DROPLET: '•',
        BOX: 'Ø',
        BOMB: 'B'
    };

    const ITEM_INFO = {
        BOMBS: {
            name: 'Bombs',
            description: 'Press X to place on adjacent walls.',
            usage: 'X key'
        },
        OXYGEN: {
            name: 'Oxygen',
            description: 'Depletes with each move.',
            usage: 'Auto-depletes'
        },
        JUMPS: {
            name: 'Jumps',
            description: 'Special ability (not yet implemented).',
            usage: 'TBD'
        },
        DASH: {
            name: 'Dash',
            description: 'Special ability (not yet implemented).',
            usage: 'TBD'
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { TILES, ITEM_INFO };
    } else {
        window.TILES = TILES;
        window.ITEM_INFO = ITEM_INFO;
    }
})(typeof module === 'undefined' ? window : module.exports);

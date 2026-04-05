(function (exports) {
    // Game Phases
    const PHASES = {
        LOBBY: 'LOBBY',
        PLAYING: 'PLAYING',
        GAME_OVER: 'GAME_OVER'
    };

    // Game Modes
    const MODES = {
        SURVIVAL: 'SURVIVAL',
        ROB_BANK: 'ROB_BANK',
        CAPTURE_FLAG: 'CAPTURE_FLAG',
        KING_HILL: 'KING_HILL'
    };

    class GameState {
        constructor() {
            this.phase = PHASES.LOBBY;
            this.mode = MODES.SURVIVAL; // Default mode
            this.startTime = 0;
            this.endTime = 0;
            this.winner = null;

            // Mode-specific state
            this.modeState = {};
        }

        setPhase(phase) {
            this.phase = phase;
            if (phase === PHASES.PLAYING) {
                this.startTime = Date.now();
            } else if (phase === PHASES.GAME_OVER) {
                this.endTime = Date.now();
            }
        }

        reset() {
            this.phase = PHASES.LOBBY;
            this.startTime = 0;
            this.endTime = 0;
            this.winner = null;
            this.modeState = {};
        }
    }

    // Base class for Game Mode logic
    class GameModeHandler {
        constructor(gameRoom) {
            this.room = gameRoom;
        }

        onPlayerJoin(player) { }
        onPlayerLeave(player) { }
        onPlayerDeath(player) { }
        update() { } // Called every tick
        checkWinCondition() { return false; }
    }

    // Export for both Node.js and Browser
    exports.PHASES = PHASES;
    exports.MODES = MODES;
    exports.GameState = GameState;
    exports.GameModeHandler = GameModeHandler;

})(typeof exports === 'undefined' ? (window.GameStateModule = {}) : exports);

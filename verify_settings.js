const WebSocket = require('ws');

const ws = new WebSocket('ws://localhost:3000');

ws.on('open', () => {
    console.log('Connected to server');
    const settings = {
        dropletCount: 15,
        boxCount: 12,
        enemyCount: 7
    };

    ws.send(JSON.stringify({
        type: 'joinRoom',
        roomId: 'verify_room_' + Date.now(),
        settings: settings
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.type === 'init') {
        console.log('Received init message');

        const aliens = msg.gameState.aliens.length;
        const boxes = msg.gameState.boxes.length;

        // Count droplets in map
        let droplets = 0;
        for (let y = 0; y < msg.height; y++) {
            for (let x = 0; x < msg.width; x++) {
                if (msg.map[y][x] === '•') { // Assuming droplet symbol is •
                    droplets++;
                }
            }
        }

        console.log(`Aliens: ${aliens} (Expected: 7)`);
        console.log(`Boxes: ${boxes} (Expected: 12)`);
        console.log(`Droplets: ${droplets} (Expected: 15)`);

        if (aliens === 7 && boxes === 12 && droplets === 15) {
            console.log('VERIFICATION SUCCESS');
        } else {
            console.log('VERIFICATION FAILED');
        }

        ws.close();
        process.exit(0);
    }
});

ws.on('error', (err) => {
    console.error('Connection error:', err);
    process.exit(1);
});

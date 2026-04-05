# ASCIINAUT

A multiplayer browser-based ASCII game. Navigate mazes, manage oxygen, and compete against other players in real-time.

## Requirements

- [Node.js](https://nodejs.org/) (v18+ recommended)

## Setup

```bash
npm install
npm start
```

Then open `http://localhost:3000` in your browser.

To play with others on your local network, share your machine's LAN IP (e.g. `http://192.168.x.x:3000`).

## Game Modes

| Mode | Description |
|------|-------------|
| **Enclose** | Survive while enclosed by aliens |
| **Rob the Bank** | Collect gold before other players |
| **Capture the Flag** | Team-based flag capture |
| **King of the Hill** | Control and hold the hill zone |

## Controls

Move with arrow keys or WASD. Place bombs to break through walls. Collect oxygen to survive.

## Stack

- **Server**: Node.js, Express, WebSocket (`ws`)
- **Client**: Vanilla JavaScript, HTML5 Canvas
- **Rendering**: ASCII tile-based canvas renderer

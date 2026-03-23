# Multiplayer Tic-Tac-Toe with Nakama

A production-ready, real-time multiplayer Tic-Tac-Toe game built with React + TypeScript on the frontend and Nakama (server-authoritative) on the backend.

---

## Features

- **Server-authoritative game logic** — all moves validated server-side; no client cheating possible
- **Real-time multiplayer** — WebSocket-based live game state broadcast
- **Quick Matchmaking** — auto-pair with any open game room
- **Private Rooms** — create a room and share the Match ID
- **Classic & Timed modes** — optional 30-second per-turn timer with auto-forfeit on timeout
- **Leaderboard** — global win rankings persisted in Nakama's storage
- **Disconnect handling** — opponent forfeits if they leave mid-game
- **Rematch** — play again (first player swaps each game)
- **Responsive mobile UI** — dark-themed, works on phones and desktop

---

## Architecture

```
tic-tac-toe/
├── frontend/          # React 19 + TypeScript + Vite
│   └── src/
│       ├── App.tsx            # All UI screens (login, lobby, game, leaderboard)
│       ├── App.css            # Dark-theme responsive styles
│       └── services/
│           ├── nakamaClient.ts  # Nakama HTTP client (configurable via env vars)
│           └── socket.ts        # Auth + WebSocket connection helpers
├── nakama/
│   ├── modules/match.ts       # TypeScript source for server module
│   └── build/match.js         # Compiled JS loaded by Nakama runtime
└── docker-compose.yml         # PostgreSQL + Nakama services
```

### Game Flow

1. Player authenticates with a persistent device ID (stored in `localStorage`)
2. Player calls `find_match` RPC → server finds an open match or creates one
3. Both players join the match via WebSocket
4. All moves are sent as match data (op_code 2) → validated server-side → broadcast back (op_code 1)
5. Win/draw/timeout/forfeit detected server-side; leaderboard updated automatically

### Server Module (Nakama JS Runtime)

| Handler | Purpose |
|---|---|
| `matchInit` | Initialize empty board, read `timerMode` param |
| `matchJoinAttempt` | Reject if match full or over |
| `matchJoin` | Assign X/O symbols, start game when 2 players join |
| `matchLoop` | Validate moves, check win/draw, countdown timer |
| `matchLeave` | Forfeit game if player disconnects |
| `rpcFindMatch` | Find open match or create new one |
| `rpcCreateMatch` | Create a private match |
| `rpcGetLeaderboard` | Top 20 players by wins |
| `rpcGetStats` | Current player's wins + rank |

---

## Setup & Installation

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Node.js 18+](https://nodejs.org/)

### 1. Start the backend

```bash
cd tic-tac-toe
docker compose up -d
```

Nakama will be available at `http://localhost:7350`.
Admin console: `http://localhost:7351` (admin / admin123)

### 2. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`

---

## Environment Variables (Frontend)

Create `frontend/.env.local` to override defaults:

```env
VITE_NAKAMA_HOST=127.0.0.1
VITE_NAKAMA_PORT=7350
VITE_NAKAMA_KEY=defaultkey
```

For production deployment set these to your cloud server's address.

---

## Testing Multiplayer

1. Open two browser tabs (or two different browsers) at `http://localhost:5173`
2. Enter different usernames and click **Play Now** in each tab
3. Click **Quick Match** in both tabs — they will be paired automatically
4. Play the game; moves update in real time in both tabs

### Testing Timed Mode

1. Select **Timed (30s)** toggle before clicking Quick Match in both tabs
2. If a player doesn't move within 30 seconds, they forfeit the turn and lose

### Testing Private Room

1. Tab A: Click **Create Private Room** → copy the Match ID
2. Tab B: Paste the Match ID in the join field → click **Join**

### Testing Disconnect Handling

1. Start a game in two tabs
2. Close one tab mid-game
3. The remaining player is declared the winner

---

## Deployment

### Backend (Docker on any cloud VM)

```bash
# On your server
git clone <repo>
cd tic-tac-toe
docker compose up -d
```

Open port `7350` (API) and `7351` (console) in your firewall/security group.

### Frontend (Vercel / Netlify)

```bash
cd frontend
npm run build
# Deploy the dist/ folder
```

Set environment variables in your hosting dashboard:
```
VITE_NAKAMA_HOST=<your-server-ip-or-domain>
VITE_NAKAMA_PORT=7350
VITE_NAKAMA_KEY=defaultkey
```

### Recompiling the Nakama module (after changes)

```bash
cd nakama
npm install
npx tsc
# Restart Nakama to pick up changes
docker compose restart nakama
```

---

## API / Server Configuration

| Endpoint | Description |
|---|---|
| `POST /v2/rpc/find_match` | Find or create a match. Body: `{"timerMode": false}` |
| `POST /v2/rpc/create_match` | Create a private match. Body: `{"timerMode": false}` |
| `POST /v2/rpc/get_leaderboard` | Get top 20 players |
| `POST /v2/rpc/get_stats` | Get current player's stats |

Match data op-codes:
- `1` — Server → Client: full game state broadcast
- `2` — Client → Server: player actions (`{"type":"move","index":4}` or `{"type":"rematch"}`)

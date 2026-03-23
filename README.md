# Multiplayer Tic-Tac-Toe

A production-ready, real-time multiplayer Tic-Tac-Toe game built with **React + TypeScript** (frontend) and **Nakama** game server (backend). All game logic runs server-side — moves are validated by the server, not the client.

---

## Features

- **Server-authoritative moves** — the server validates every move; no client-side cheating
- **Quick Game** — auto-matchmaking pairs you with a random online player
- **Private Room** — create a room with a 6-digit code, share it with a friend
- **Local 2-Player** — two players on the same device, pass-and-play
- **30s turn timer** — skips the turn (not forfeit) if time runs out
- **Vote to restart** — both players must agree to play again (online modes)
- **Disconnect handling** — opponent wins automatically if you leave mid-game
- **Leaderboard** — global win rankings stored in Nakama + PostgreSQL
- **Game tags** — random display names (e.g. `SwiftTiger42`) used on the leaderboard; your real name stays local
- **Dark theme** — responsive UI, works on desktop and mobile

---

## Architecture

```
tic-tac-toe/
├── docker-compose.yml          # PostgreSQL + Nakama services
├── nakama/
│   ├── modules/match.ts        # TypeScript source (compile → build/)
│   └── build/match.js          # Compiled JS loaded by Nakama at runtime
└── frontend/
    ├── vite.config.ts
    └── src/
        ├── App.tsx             # All screens: login, lobby, game, leaderboard
        ├── App.css             # Dark-themed responsive styles
        └── services/
            ├── nakamaClient.ts # Nakama HTTP client (env-var configurable)
            └── socket.ts       # Device auth + WebSocket connection
```

### How a game works

```
Player opens app
  → Authenticated via persistent device ID (localStorage)
  → Assigned a random game tag stored in Nakama

Player clicks Quick Game
  → RPC: quick_match → server finds open "classic" match or creates one
  → Player joins match via WebSocket
  → Second player joins → server starts round, broadcasts state

During the game
  → Client sends: { type: "move", index: 4 }   (op_code 2)
  → Server validates move, updates board, checks win/draw
  → Server broadcasts full game state to both players  (op_code 1)
  → Turn timer runs server-side (5 ticks/sec); skips turn at 0

Game ends
  → Server records win to leaderboard
  → Both players vote { type: "restart_vote" } to play again
```

### Design Decisions

| Decision | Why |
|---|---|
| Server-authoritative logic | Prevents cheating; one source of truth for game state |
| Nakama JS runtime (goja) | No separate service needed; runs alongside match handlers |
| `nk.binaryToString(msg.data)` | Nakama delivers WebSocket messages as binary buffers, not strings |
| Game tag ≠ real name | Real name never leaves the browser; only the random tag hits the server |
| Match labels for matchmaking | `"classic"` / `"room:XXXXXX"` labels allow `nk.matchList` filtering without a separate lobby service |
| Vote restart (both modes) | Avoids forcing a player into another game they don't want |
| Local mode client-only | No server round-trip needed; same UI/rules reused client-side |

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

Services started:
- **PostgreSQL** on `localhost:5433`
- **Nakama** API on `localhost:7350`
- **Nakama Console** on `http://localhost:7351` → login: `admin / admin123`

Wait ~10 seconds for Nakama to run migrations and load the game module. You can confirm with:

```bash
docker logs tic-tac-toe-nakama-1 2>&1 | grep "Tic-Tac-Toe"
# Should print:
# === Tic-Tac-Toe initializing ===
# Leaderboard created: tictactoe_wins
# === Tic-Tac-Toe ready ===
```

### 2. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`

---

## Environment Variables

Create `frontend/.env.local` to override defaults:

```env
VITE_NAKAMA_HOST=127.0.0.1
VITE_NAKAMA_PORT=7350
VITE_NAKAMA_KEY=defaultkey
```

For production set `VITE_NAKAMA_HOST` to your server's IP or domain and `VITE_NAKAMA_PORT=443`.

---

## API / Server Configuration

### RPC Endpoints

All RPCs are called over the WebSocket connection using `socket.rpc(id, payload)`.

| RPC ID | Payload | Returns | Description |
|---|---|---|---|
| `quick_match` | `{}` | `{ matchId }` | Find an open classic match (1 player waiting) or create a new one |
| `create_room` | `{}` | `{ code, matchId }` | Create a private room with a 6-digit code |
| `join_room` | `{ code: "123456" }` | `{ matchId }` | Find a room by its 6-digit code |
| `get_leaderboard` | `""` | `{ records: [...] }` | Top 20 players by wins |
| `get_stats` | `""` | `{ wins, rank }` | Current player's stats |

### Match Data Op-Codes

| Op-Code | Direction | Purpose |
|---|---|---|
| `1` | Server → Client | Full game state broadcast (board, players, timers, scores) |
| `2` | Client → Server | Player action messages (see below) |

### Client → Server Message Types (op_code 2)

```json
{ "type": "move", "index": 4 }
```
Place a symbol at board position 0–8. Rejected if: not your turn, cell taken, game over.

```json
{ "type": "restart_vote" }
```
Vote to start a new round after game over. Game restarts when both players send this.

### Game State Broadcast (op_code 1)

```json
{
  "board":              ["X","","O","","X","","","",""],
  "players":            ["user-id-1", "user-id-2"],
  "playerTags":         { "user-id-1": "SwiftTiger42", "user-id-2": "BoldFox17" },
  "symbols":            { "user-id-1": "X", "user-id-2": "O" },
  "currentPlayer":      "user-id-1",
  "winner":             null,
  "winnerName":         null,
  "draw":               false,
  "forfeit":            false,
  "gameStarted":        true,
  "gameOver":           false,
  "turnSeconds":        24,
  "skipNotice":         null,
  "restartVotes":       [],
  "mode":               "classic",
  "roomCode":           "",
  "gameNumber":         1
}
```

### Match Label System

Nakama match labels are used for matchmaking without a separate lobby:

| Label | Meaning |
|---|---|
| `classic` | Quick game waiting for 2nd player |
| `classic:full` | Quick game in progress |
| `room:XXXXXX` | Private room waiting for 2nd player |
| `room:XXXXXX:full` | Private room in progress |

### Nakama Configuration (docker-compose.yml)

```yaml
--runtime.js_entrypoint build/match.js   # path relative to modules dir
--socket.max_message_size_bytes 4096
--logger.level DEBUG
```

The JS module is mounted via:
```yaml
volumes:
  - ./nakama/build:/nakama/data/modules/build
```

---

## Testing Multiplayer

### Quick Game (auto-matchmaking)

1. Open **two browser tabs** at `http://localhost:5173`
2. Enter any name and click **Let's Play** in both tabs
3. Click **Quick Game** in both tabs — they pair automatically
4. Make moves in one tab — the other updates in real time

### Private Room

1. Tab A: Click **New Room → Create a Room** → note the 6-digit code
2. Tab B: Click **New Room → Enter code → Join**
3. Both tabs enter the game

### Turn Timer

1. Start any online game
2. Do nothing for 30 seconds — the turn is **skipped** (not forfeited); the other player gets to move

### Restart Vote

1. Complete a game
2. Click **Play Again** in one tab — it shows "Waiting for opponent… (1/2)"
3. Click **Play Again** in the other tab — new round starts immediately

### Disconnect Handling

1. Start a game in two tabs
2. Close one tab mid-game
3. The remaining player sees "You Win!" immediately

### Leaderboard

1. Complete a game (win)
2. Click the 🏆 trophy icon from the lobby or game screen
3. Your game tag appears with win count

### Local 2-Player (same device)

1. Click **New Room → Local 2-Player**
2. Two players take turns clicking cells on the same screen
3. Same 30s timer, same win/draw detection

---

## Recompiling the Server Module

After editing `nakama/modules/match.ts`:

```bash
cd nakama
npm install        # first time only
npx tsc            # compiles to build/match.js
docker compose restart nakama
```

Confirm reload:
```bash
docker logs tic-tac-toe-nakama-1 2>&1 | grep "Tic-Tac-Toe"
```

---

## Deployment

### Option A — VPS (DigitalOcean, Hetzner, etc.)

```bash
# On the server
git clone https://github.com/karthikeyan18v/tic-tac-toe.git
cd tic-tac-toe
docker compose up -d

# Build and serve frontend with nginx
cd frontend
npm install
npm run build      # outputs to dist/
```

Open firewall ports: `7350` (Nakama API), `7351` (console, optional), `80`/`443` (frontend).

### Option B — Railway (backend) + Vercel (frontend)

**Backend on Railway:**
1. New Project → Deploy from GitHub → select this repo
2. Railway detects `docker-compose.yml` automatically
3. Note the public Nakama URL (e.g. `nakama-xxx.up.railway.app`)

**Frontend on Vercel:**
1. New Project → Import this repo → set **Root Directory** to `frontend`
2. Add environment variables:
   ```
   VITE_NAKAMA_HOST=nakama-xxx.up.railway.app
   VITE_NAKAMA_PORT=443
   VITE_NAKAMA_KEY=defaultkey
   ```
3. Deploy — live at `yourapp.vercel.app`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite |
| Nakama SDK | `@heroiclabs/nakama-js` v2.8 |
| Backend | Nakama 3.22.0 (JS runtime / goja) |
| Database | PostgreSQL 12 |
| Infrastructure | Docker Compose |

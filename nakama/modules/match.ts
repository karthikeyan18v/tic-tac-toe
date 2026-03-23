// Tic-Tac-Toe — Nakama TypeScript source
// Compile: cd nakama && npx tsc  →  outputs to build/match.js
// NOTE: Nakama runs a goja JS runtime, not Node.js.

const TICK_RATE      = 5;
const TURN_TICKS     = TICK_RATE * 30;
const AUTO_RESTART_T = TICK_RATE * 5;
const ROOM_EXPIRY_T  = TICK_RATE * 60 * 10;
const LEADERBOARD_ID = "tictactoe_wins";

const WIN_COMBOS = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6],
];

interface State {
  board:              string[];
  players:            string[];
  playerTags:         Record<string, string>;
  symbols:            Record<string, string>;
  currentPlayer:      string;
  winner:             string | null;
  winnerName:         string | null;
  draw:               boolean;
  forfeit:            boolean;
  gameStarted:        boolean;
  gameOver:           boolean;
  turnTicks:          number;
  skipNotice:         string | null;
  restartVotes:       string[];
  autoRestartTicks:   number;
  mode:               "classic" | "room";
  roomCode:           string;
  gameNumber:         number;
  firstIdx:           number;
  waitTick:           number;
}

function checkWinner(board: string[]): string | null {
  for (const [a, b, c] of WIN_COMBOS) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}

function isFull(board: string[]): boolean {
  return board.every(c => c !== "");
}

function otherPlayer(state: State): string {
  return state.players.filter(p => p !== state.currentPlayer)[0];
}

function startNewRound(state: State): void {
  state.board             = Array(9).fill("");
  state.winner            = null;
  state.winnerName        = null;
  state.draw              = false;
  state.gameOver          = false;
  state.forfeit           = false;
  state.skipNotice        = null;
  state.restartVotes      = [];
  state.autoRestartTicks  = 0;

  if (state.gameNumber === 0) {
    state.firstIdx = Math.floor(Math.random() * 2);
  } else {
    state.firstIdx = 1 - state.firstIdx;
  }
  state.gameNumber++;
  state.symbols[state.players[state.firstIdx]]     = "X";
  state.symbols[state.players[1 - state.firstIdx]] = "O";
  state.currentPlayer = state.players[state.firstIdx];
  state.turnTicks     = TURN_TICKS;
}

function broadcastState(dispatcher: any, state: State, tick: number): void {
  dispatcher.broadcastMessage(1, JSON.stringify({
    board:               state.board,
    players:             state.players,
    playerTags:          state.playerTags,
    symbols:             state.symbols,
    currentPlayer:       state.currentPlayer,
    winner:              state.winner,
    winnerName:          state.winnerName,
    draw:                state.draw,
    forfeit:             state.forfeit,
    gameStarted:         state.gameStarted,
    gameOver:            state.gameOver,
    turnSeconds:         Math.ceil(state.turnTicks / TICK_RATE),
    skipNotice:          state.skipNotice,
    restartVotes:        state.restartVotes,
    autoRestartSeconds:  Math.ceil(state.autoRestartTicks / TICK_RATE),
    mode:                state.mode,
    roomCode:            state.roomCode,
    gameNumber:          state.gameNumber,
  }), null, null, true);
  void tick;
}

function recordWin(nk: any, logger: any, userId: string, tag: string): void {
  try { nk.leaderboardRecordWrite(LEADERBOARD_ID, userId, tag, 1, 0, {}); }
  catch (e: any) { logger.warn("Leaderboard: %s", e.message); }
}

// ── Handlers ────────────────────────────────────────────────────────────────

const matchInit = (_ctx: any, logger: any, _nk: any, params: Record<string, string>) => {
  const mode  = params?.["mode"] || "classic";
  const code  = params?.["code"] || "";
  const label = mode === "room" ? `room:${code}` : "classic";
  const state: State = {
    board: Array(9).fill(""), players: [], playerTags: {}, symbols: {},
    currentPlayer: "", winner: null, winnerName: null, draw: false, forfeit: false,
    gameStarted: false, gameOver: false, turnTicks: TURN_TICKS, skipNotice: null,
    restartVotes: [], autoRestartTicks: 0,
    mode: mode as "classic" | "room", roomCode: code, gameNumber: 0, firstIdx: 0, waitTick: 0,
  };
  logger.info("matchInit mode=%s code=%s", mode, code);
  return { state, tickRate: TICK_RATE, label };
};

const matchJoinAttempt = (_ctx: any, _l: any, _nk: any, _d: any, _t: number, state: State, _p: any, _m: any) => {
  if (state.players.length >= 2) return { state, accept: false, rejectMessage: "Match is full" };
  return { state, accept: true };
};

const matchJoin = (_ctx: any, logger: any, _nk: any, dispatcher: any, tick: number, state: State, presences: any[]) => {
  presences.forEach(p => {
    if (!state.players.includes(p.userId)) {
      state.players.push(p.userId);
      state.playerTags[p.userId] = p.username || `Tag_${p.userId.slice(0, 6)}`;
      logger.info("Joined: %s (%s)", p.userId, state.playerTags[p.userId]);
    }
  });
  if (state.players.length === 2 && !state.gameStarted) {
    state.gameStarted = true;
    state.waitTick    = 0;
    startNewRound(state);
    const fullLabel = state.mode === "room" ? `room:${state.roomCode}:full` : "classic:full";
    dispatcher.matchLabelUpdate(fullLabel);
    logger.info("Game started: %s vs %s", state.players[0], state.players[1]);
  }
  broadcastState(dispatcher, state, tick);
  return { state };
};

const matchLeave = (_ctx: any, logger: any, nk: any, dispatcher: any, tick: number, state: State, presences: any[]) => {
  presences.forEach(p => {
    logger.info("Left: %s", p.userId);
    if (state.gameStarted && !state.gameOver) {
      const remaining = state.players.filter(id => id !== p.userId);
      if (remaining.length > 0) {
        state.winner     = remaining[0];
        state.winnerName = state.playerTags[remaining[0]];
        state.gameOver   = true;
        state.forfeit    = true;
        recordWin(nk, logger, remaining[0], state.winnerName);
        broadcastState(dispatcher, state, tick);
      }
    }
  });
  return { state };
};

const matchLoop = (_ctx: any, logger: any, nk: any, dispatcher: any, tick: number, state: State, messages: any[]) => {
  let needsBroadcast = false;

  messages.forEach(msg => {
    let data: any;
    try {
      const raw = typeof msg.data === "string" ? msg.data : nk.binaryToString(msg.data);
      data = JSON.parse(raw);
    } catch (e: any) { logger.warn("msg parse: %s", e.message); return; }

    if (data.type === "move") {
      if (!state.gameStarted || state.gameOver || state.players.length < 2) return;
      const idx: number = data.index;
      if (typeof idx !== "number" || idx < 0 || idx > 8) return;
      if (state.board[idx] !== "") return;
      if (msg.sender.userId !== state.currentPlayer) return;

      state.board[idx]  = state.symbols[state.currentPlayer];
      state.skipNotice  = null;

      const won = checkWinner(state.board);
      if (won) {
        state.winner     = state.currentPlayer;
        state.winnerName = state.playerTags[state.currentPlayer];
        state.gameOver   = true;
        recordWin(nk, logger, state.currentPlayer, state.winnerName);
        if (state.mode === "classic") state.autoRestartTicks = AUTO_RESTART_T;
      } else if (isFull(state.board)) {
        state.draw       = true;
        state.gameOver   = true;
        if (state.mode === "classic") state.autoRestartTicks = AUTO_RESTART_T;
      } else {
        state.currentPlayer = otherPlayer(state);
        state.turnTicks     = TURN_TICKS;
      }
      needsBroadcast = true;
    }

    if (data.type === "restart_vote" && state.gameOver) {
      const uid = msg.sender.userId;
      if (!state.restartVotes.includes(uid)) state.restartVotes.push(uid);
      if (state.restartVotes.length >= 2) startNewRound(state);
      needsBroadcast = true;
    }
  });

  if (state.gameStarted && !state.gameOver && state.players.length === 2) {
    state.turnTicks--;
    if (state.turnTicks <= 0) {
      state.skipNotice    = `${state.playerTags[state.currentPlayer]}'s turn was skipped!`;
      state.currentPlayer = otherPlayer(state);
      state.turnTicks     = TURN_TICKS;
      needsBroadcast = true;
    }
  }

  // (auto-restart removed — both players must vote to play again)

  if (!state.gameStarted && state.players.length < 2) {
    state.waitTick = (state.waitTick || 0) + 1;
    if (state.waitTick > ROOM_EXPIRY_T) return null;
  }

  if (needsBroadcast || tick % TICK_RATE === 0) broadcastState(dispatcher, state, tick);
  return { state };
};

const matchTerminate = (_ctx: any, _l: any, _nk: any, _d: any, _t: number, state: State, _g: number) =>
  ({ state });

const matchSignal = (_ctx: any, _l: any, _nk: any, _d: any, _t: number, state: State, _data: string) =>
  ({ state, data: "" });

// ── RPCs ─────────────────────────────────────────────────────────────────────

const rpcQuickMatch = (_ctx: any, logger: any, nk: any, _payload: string) => {
  try {
    const matches = nk.matchList(10, true, "classic", 1, 1, "*");
    if (matches?.length > 0) return JSON.stringify({ matchId: matches[0].matchId });
  } catch (e: any) { logger.warn("matchList: %s", e.message); }
  return JSON.stringify({ matchId: nk.matchCreate("tic-tac-toe", { mode: "classic" }) });
};

const rpcCreateRoom = (_ctx: any, logger: any, nk: any, _payload: string) => {
  const code    = Math.floor(100000 + Math.random() * 900000).toString();
  const matchId = nk.matchCreate("tic-tac-toe", { mode: "room", code });
  logger.info("Room created: code=%s match=%s", code, matchId);
  return JSON.stringify({ code, matchId });
};

const rpcJoinRoom = (_ctx: any, logger: any, nk: any, payload: string) => {
  const params = JSON.parse(payload || "{}");
  const code   = (params.code || "").toString().replace(/\D/g, "");
  if (code.length !== 6) throw new Error("Invalid code");
  try {
    const matches = nk.matchList(10, true, `room:${code}`, 1, 1, "*");
    if (matches?.length > 0) return JSON.stringify({ matchId: matches[0].matchId });
  } catch (e: any) { logger.warn("matchList: %s", e.message); }
  throw new Error("Room not found or already full");
};

const rpcGetLeaderboard = (_ctx: any, logger: any, nk: any, _payload: string) => {
  try {
    const result = nk.leaderboardRecordsList(LEADERBOARD_ID, null, 20, null, 0);
    return JSON.stringify({
      records: (result.records || []).map((r: any, i: number) => ({
        rank: i + 1, userId: r.ownerId, username: r.username, wins: r.score,
      })),
    });
  } catch (e: any) {
    logger.warn("Leaderboard: %s", e.message);
    return JSON.stringify({ records: [] });
  }
};

const rpcGetStats = (ctx: any, logger: any, nk: any, _payload: string) => {
  try {
    const result = nk.leaderboardRecordsList(LEADERBOARD_ID, [ctx.userId], 1, null, 0);
    if (result.ownerRecords?.length > 0) {
      const r = result.ownerRecords[0];
      return JSON.stringify({ wins: r.score, rank: r.rank });
    }
  } catch (e: any) { logger.warn("Stats: %s", e.message); }
  return JSON.stringify({ wins: 0, rank: 0 });
};

// ── InitModule ────────────────────────────────────────────────────────────────

const InitModule = (_ctx: any, logger: any, nk: any, initializer: any) => {
  logger.info("=== Tic-Tac-Toe initializing ===");
  try {
    nk.leaderboardCreate(LEADERBOARD_ID, false, "desc", "incr", "", {});
    logger.info("Leaderboard created: %s", LEADERBOARD_ID);
  } catch (e: any) { logger.info("Leaderboard already exists: %s", e.message); }

  initializer.registerMatch("tic-tac-toe", {
    matchInit, matchJoinAttempt, matchJoin,
    matchLeave, matchLoop, matchTerminate, matchSignal,
  });
  initializer.registerRpc("quick_match",     rpcQuickMatch);
  initializer.registerRpc("create_room",     rpcCreateRoom);
  initializer.registerRpc("join_room",       rpcJoinRoom);
  initializer.registerRpc("get_leaderboard", rpcGetLeaderboard);
  initializer.registerRpc("get_stats",       rpcGetStats);
  logger.info("=== Tic-Tac-Toe ready ===");
};

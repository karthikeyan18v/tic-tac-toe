// Tic-Tac-Toe — Nakama Server Module
// Features: server-auth moves, 30s turn timer (skip not forfeit),
// classic auto-restart, room vote-restart, 6-digit room codes, leaderboard

var TICK_RATE       = 5;
var TURN_TICKS      = TICK_RATE * 30;   // 30 s per turn
var AUTO_RESTART_T  = TICK_RATE * 5;    // 5 s auto-restart (classic)
var ROOM_EXPIRY_T   = TICK_RATE * 60 * 10; // 10 min idle expiry
var LEADERBOARD_ID  = "tictactoe_wins";

var WIN_COMBOS = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

function checkWinner(board) {
  for (var i = 0; i < WIN_COMBOS.length; i++) {
    var a = WIN_COMBOS[i][0], b = WIN_COMBOS[i][1], c = WIN_COMBOS[i][2];
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}

function isFull(board) {
  for (var i = 0; i < board.length; i++) { if (board[i] === "") return false; }
  return true;
}

function otherPlayer(state) {
  return state.players.filter(function(p) { return p !== state.currentPlayer; })[0];
}

// Reset board for a new game round; determines who goes first
function startNewRound(state) {
  state.board        = ["","","","","","","","",""];
  state.winner       = null;
  state.winnerName   = null;
  state.draw         = false;
  state.gameOver     = false;
  state.forfeit      = false;
  state.skipNotice   = null;
  state.restartVotes = [];
  state.autoRestartTicks = 0;

  // Game 1: random first player; after that: alternate
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

function broadcastState(dispatcher, state, tick) {
  var payload = JSON.stringify({
    board:               state.board,
    players:             state.players,
    playerTags:          state.playerTags,
    symbols:             state.symbols,
    currentPlayer:       state.currentPlayer,
    winner:              state.winner,
    winnerName:          state.winnerName,
    draw:                state.draw,
    forfeit:             state.forfeit || false,
    gameStarted:         state.gameStarted,
    gameOver:            state.gameOver,
    turnSeconds:         Math.ceil(state.turnTicks / TICK_RATE),
    skipNotice:          state.skipNotice,
    restartVotes:        state.restartVotes,
    autoRestartSeconds:  Math.ceil(state.autoRestartTicks / TICK_RATE),
    mode:                state.mode,
    roomCode:            state.roomCode,
    gameNumber:          state.gameNumber,
  });
  dispatcher.broadcastMessage(1, payload, null, null, true);
}

function recordWin(nk, logger, userId, tag) {
  try { nk.leaderboardRecordWrite(LEADERBOARD_ID, userId, tag, 1, 0, {}); }
  catch(e) { logger.warn("Leaderboard write: %s", e.message); }
}

// ─────────────────── Match Handlers ───────────────────────────────────────

var matchInit = function(ctx, logger, nk, params) {
  var mode = (params && params["mode"]) || "classic";
  var code = (params && params["code"]) || "";
  var label = mode === "room" ? ("room:" + code) : "classic";

  var state = {
    board:             ["","","","","","","","",""],
    players:           [],
    playerTags:        {},
    symbols:           {},
    currentPlayer:     "",
    winner:            null,
    winnerName:        null,
    draw:              false,
    forfeit:           false,
    gameStarted:       false,
    gameOver:          false,
    turnTicks:         TURN_TICKS,
    skipNotice:        null,
    restartVotes:      [],
    autoRestartTicks:  0,
    mode:              mode,
    roomCode:          code,
    gameNumber:        0,
    firstIdx:          0,
    waitTick:          0,
  };

  logger.info("matchInit mode=%s code=%s", mode, code);
  return { state: state, tickRate: TICK_RATE, label: label };
};

var matchJoinAttempt = function(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
  if (state.players.length >= 2)
    return { state: state, accept: false, rejectMessage: "Match is full" };
  return { state: state, accept: true };
};

var matchJoin = function(ctx, logger, nk, dispatcher, tick, state, presences) {
  presences.forEach(function(p) {
    if (state.players.indexOf(p.userId) < 0) {
      state.players.push(p.userId);
      state.playerTags[p.userId] = p.username || ("Tag_" + p.userId.slice(0, 6));
      logger.info("Joined: %s (%s)", p.userId, state.playerTags[p.userId]);
    }
  });

  if (state.players.length === 2 && !state.gameStarted) {
    state.gameStarted = true;
    state.waitTick    = 0;
    startNewRound(state);
    var fullLabel = state.mode === "room" ? ("room:" + state.roomCode + ":full") : "classic:full";
    dispatcher.matchLabelUpdate(fullLabel);
    logger.info("Game started: %s vs %s", state.players[0], state.players[1]);
  }

  broadcastState(dispatcher, state, tick);
  return { state: state };
};

var matchLeave = function(ctx, logger, nk, dispatcher, tick, state, presences) {
  presences.forEach(function(p) {
    logger.info("Player left: %s", p.userId);
    if (state.gameStarted && !state.gameOver) {
      var remaining = state.players.filter(function(id) { return id !== p.userId; });
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
  return { state: state };
};

var matchLoop = function(ctx, logger, nk, dispatcher, tick, state, messages) {
  var needsBroadcast = false;

  // ── Process messages ──
  messages.forEach(function(msg) {
    var data;
    try {
      // Nakama's server runtime delivers msg.data as binary — decode first
      var raw = typeof msg.data === "string" ? msg.data : nk.binaryToString(msg.data);
      data = JSON.parse(raw);
    } catch(e) { logger.warn("msg parse error: %s", e.message); return; }

    // ── Move ──
    if (data.type === "move") {
      if (!state.gameStarted || state.gameOver || state.players.length < 2) return;
      var idx = data.index;
      if (typeof idx !== "number" || idx < 0 || idx > 8) return;
      if (state.board[idx] !== "") return;
      if (msg.sender.userId !== state.currentPlayer) return;

      state.board[idx]  = state.symbols[state.currentPlayer];
      state.skipNotice  = null;

      var won = checkWinner(state.board);
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

    // ── Restart vote (both modes) ──
    if (data.type === "restart_vote" && state.gameOver) {
      var uid = msg.sender.userId;
      if (state.restartVotes.indexOf(uid) < 0) state.restartVotes.push(uid);
      if (state.restartVotes.length >= 2) {
        startNewRound(state);
      }
      needsBroadcast = true;
    }
  });

  // ── Turn timer (active game only) ──
  if (state.gameStarted && !state.gameOver && state.players.length === 2) {
    state.turnTicks--;
    if (state.turnTicks <= 0) {
      var skipped = state.playerTags[state.currentPlayer];
      state.skipNotice    = skipped + "'s turn was skipped!";
      state.currentPlayer = otherPlayer(state);
      state.turnTicks     = TURN_TICKS;
      needsBroadcast = true;
    }
  }

  // (auto-restart removed — both players must vote to play again)

  // ── Room expiry while waiting for 2nd player ──
  if (!state.gameStarted && state.players.length < 2) {
    state.waitTick = (state.waitTick || 0) + 1;
    if (state.waitTick > ROOM_EXPIRY_T) return null;
  }

  // Broadcast on change OR once per second for timer
  if (needsBroadcast || tick % TICK_RATE === 0) {
    broadcastState(dispatcher, state, tick);
  }

  return { state: state };
};

var matchTerminate = function(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
  return { state: state };
};

var matchSignal = function(ctx, logger, nk, dispatcher, tick, state, data) {
  return { state: state, data: "" };
};

// ─────────────────── RPC Handlers ─────────────────────────────────────────

// Quick match: find an open classic match (1 player waiting) or create one
var rpcQuickMatch = function(ctx, logger, nk, payload) {
  try {
    var matches = nk.matchList(10, true, "classic", 1, 1, "*");
    if (matches && matches.length > 0) {
      return JSON.stringify({ matchId: matches[0].matchId });
    }
  } catch(e) {
    logger.warn("matchList: %s", e.message);
  }
  var matchId = nk.matchCreate("tic-tac-toe", { mode: "classic" });
  return JSON.stringify({ matchId: matchId });
};

// Create a private room with 6-digit code
var rpcCreateRoom = function(ctx, logger, nk, payload) {
  var code = Math.floor(100000 + Math.random() * 900000).toString();
  var matchId = nk.matchCreate("tic-tac-toe", { mode: "room", code: code });
  logger.info("Room created: code=%s match=%s", code, matchId);
  return JSON.stringify({ code: code, matchId: matchId });
};

// Join a room by 6-digit code
var rpcJoinRoom = function(ctx, logger, nk, payload) {
  var params;
  try { params = JSON.parse(payload || "{}"); } catch(e) { params = {}; }
  var code = (params.code || "").toString().replace(/\D/g, "");
  if (code.length !== 6) throw new Error("Invalid code");

  try {
    var matches = nk.matchList(10, true, "room:" + code, 1, 1, "*");
    if (matches && matches.length > 0) {
      return JSON.stringify({ matchId: matches[0].matchId });
    }
  } catch(e) {
    logger.warn("matchList: %s", e.message);
  }
  throw new Error("Room not found or already full");
};

// Top 20 leaderboard
var rpcGetLeaderboard = function(ctx, logger, nk, payload) {
  try {
    var result = nk.leaderboardRecordsList(LEADERBOARD_ID, null, 20, null, 0);
    return JSON.stringify({
      records: (result.records || []).map(function(r, i) {
        return { rank: i + 1, userId: r.ownerId, username: r.username, wins: r.score };
      })
    });
  } catch(e) {
    logger.warn("Leaderboard: %s", e.message);
    return JSON.stringify({ records: [] });
  }
};

// Current player stats
var rpcGetStats = function(ctx, logger, nk, payload) {
  try {
    var result = nk.leaderboardRecordsList(LEADERBOARD_ID, [ctx.userId], 1, null, 0);
    if (result.ownerRecords && result.ownerRecords.length > 0) {
      var r = result.ownerRecords[0];
      return JSON.stringify({ wins: r.score, rank: r.rank });
    }
  } catch(e) {
    logger.warn("Stats: %s", e.message);
  }
  return JSON.stringify({ wins: 0, rank: 0 });
};

// ─────────────────── Module Init ──────────────────────────────────────────

var InitModule = function(ctx, logger, nk, initializer) {
  logger.info("=== Tic-Tac-Toe initializing ===");

  try {
    nk.leaderboardCreate(LEADERBOARD_ID, false, "desc", "incr", "", {});
    logger.info("Leaderboard created: %s", LEADERBOARD_ID);
  } catch(e) { logger.info("Leaderboard already exists: %s", e.message); }

  initializer.registerMatch("tic-tac-toe", {
    matchInit:        matchInit,
    matchJoinAttempt: matchJoinAttempt,
    matchJoin:        matchJoin,
    matchLeave:       matchLeave,
    matchLoop:        matchLoop,
    matchTerminate:   matchTerminate,
    matchSignal:      matchSignal,
  });

  initializer.registerRpc("quick_match",      rpcQuickMatch);
  initializer.registerRpc("create_room",      rpcCreateRoom);
  initializer.registerRpc("join_room",        rpcJoinRoom);
  initializer.registerRpc("get_leaderboard",  rpcGetLeaderboard);
  initializer.registerRpc("get_stats",        rpcGetStats);

  logger.info("=== Tic-Tac-Toe ready ===");
};

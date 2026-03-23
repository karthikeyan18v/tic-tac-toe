import { useState, useEffect, useCallback, useRef } from "react";
import { connect, getSavedRealName, saveRealName, getOrCreateGameTag } from "./services/socket";
import "./App.css";

// ── Types ──────────────────────────────────────────────────────────────────
interface GameState {
  board: string[];
  players: string[];
  playerTags: Record<string, string>;
  symbols: Record<string, string>;
  currentPlayer: string;
  winner: string | null;
  winnerName: string | null;
  draw: boolean;
  forfeit: boolean;
  gameStarted: boolean;
  gameOver: boolean;
  turnSeconds: number;
  skipNotice: string | null;
  restartVotes: string[];
  autoRestartSeconds: number;
  mode: "classic" | "room";
  roomCode: string;
  gameNumber: number;
}

interface LbRecord {
  rank: number;
  userId: string;
  username: string;
  wins: number;
}

type Screen = "login" | "lobby" | "searching" | "room-menu" | "waiting-room" | "game" | "leaderboard" | "local-game";

interface LocalState {
  board:        string[];
  current:      "X" | "O";
  winner:       "X" | "O" | null;
  draw:         boolean;
  gameOver:     boolean;
  turnSecs:     number;
  skipNotice:   string | null;
  gameNumber:   number;
  firstSymbol:  "X" | "O";
}

const WIN_COMBOS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

function checkLocalWinner(board: string[]): string | null {
  for (const [a, b, c] of WIN_COMBOS) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  return null;
}

function newLocalRound(prev?: LocalState): LocalState {
  const first: "X" | "O" = prev
    ? (prev.firstSymbol === "X" ? "O" : "X")
    : (Math.random() < 0.5 ? "X" : "O");
  return {
    board: Array(9).fill(""), current: first, winner: null,
    draw: false, gameOver: false, turnSecs: 30, skipNotice: null,
    gameNumber: (prev?.gameNumber ?? 0) + 1, firstSymbol: first,
  };
}

// ── App ────────────────────────────────────────────────────────────────────
export default function App() {
  const [screen,       setScreen]       = useState<Screen>("login");
  const [realName,     setRealName]     = useState(getSavedRealName());
  const [nameInput,    setNameInput]    = useState(getSavedRealName());
  const [gameTag,      setGameTag]      = useState(getOrCreateGameTag());
  const [myUserId,     setMyUserId]     = useState("");
  const [matchId,      setMatchId]      = useState<string | null>(null);
  const [roomCode,     setRoomCode]     = useState("");
  const [joinCode,     setJoinCode]     = useState("");
  const [gameState,    setGameState]    = useState<GameState | null>(null);
  const [leaderboard,  setLeaderboard]  = useState<LbRecord[]>([]);
  const [myWins,       setMyWins]       = useState(0);
  const [busy,         setBusy]         = useState(false);
  const [errorMsg,     setErrorMsg]     = useState("");
  const [searchSecs,   setSearchSecs]   = useState(60);
  const [myVoted,      setMyVoted]      = useState(false);
  const [prevGame,     setPrevGame]     = useState(0);
  const [local,        setLocal]        = useState<LocalState | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const socketRef  = useRef<any>(null);
  const matchIdRef = useRef<string | null>(null);

  matchIdRef.current = matchId;

  // ── Local game timer ───────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== "local-game" || !local || local.gameOver) return;
    if (local.turnSecs <= 0) return;
    const t = setTimeout(() => {
      setLocal(prev => {
        if (!prev || prev.gameOver) return prev;
        const next = prev.turnSecs - 1;
        if (next <= 0) {
          const skipped = prev.current;
          return {
            ...prev,
            current:    skipped === "X" ? "O" : "X",
            turnSecs:   30,
            skipNotice: `Player ${skipped}'s turn was skipped!`,
          };
        }
        return { ...prev, turnSecs: next };
      });
    }, 1000);
    return () => clearTimeout(t);
  }, [screen, local]);

  // ── Local: make a move ─────────────────────────────────────────────────
  const handleLocalMove = useCallback((idx: number) => {
    setLocal(prev => {
      if (!prev || prev.gameOver || prev.board[idx] !== "") return prev;
      const board = [...prev.board];
      board[idx] = prev.current;
      const winner = checkLocalWinner(board) as "X" | "O" | null;
      const draw   = !winner && board.every(c => c !== "");
      return {
        ...prev,
        board,
        winner,
        draw,
        gameOver:   !!(winner || draw),
        skipNotice: null,
        current:    winner || draw ? prev.current : (prev.current === "X" ? "O" : "X"),
        turnSecs:   30,
      };
    });
  }, []);

  // ── Local: play again ──────────────────────────────────────────────────
  const handleLocalRestart = useCallback(() => {
    setLocal(prev => prev ? newLocalRound(prev) : newLocalRound());
  }, []);

  // ── Auto-advance to game when opponent joins ───────────────────────────
  useEffect(() => {
    if ((screen === "searching" || screen === "waiting-room") && gameState?.gameStarted) {
      setScreen("game");
      setErrorMsg("");
    }
  }, [gameState?.gameStarted, screen]);

  // Reset myVoted when a new game round starts
  useEffect(() => {
    if (gameState && gameState.gameNumber !== prevGame) {
      setMyVoted(false);
      setPrevGame(gameState.gameNumber);
    }
  }, [gameState?.gameNumber, gameState, prevGame]);

  // ── Login ──────────────────────────────────────────────────────────────
  const handleLogin = useCallback(async () => {
    const name = nameInput.trim() || "Player";
    setBusy(true);
    setErrorMsg("");
    try {
      const { socket, userId, gameTag: tag } = await connect(name);
      socketRef.current = socket;
      setMyUserId(userId);
      setRealName(name);
      saveRealName(name);
      setGameTag(tag);

      socket.onmatchdata = (md: { op_code: number; data: unknown }) => {
        if (md.op_code !== 1) return;
        try {
          const raw = typeof md.data === "string"
            ? md.data
            : new TextDecoder().decode(md.data as Uint8Array);
          setGameState(JSON.parse(raw) as GameState);
        } catch { /* ignore */ }
      };

      setScreen("lobby");
    } catch (e) {
      setErrorMsg("Connection failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [nameInput]);

  // ── Leave current match ────────────────────────────────────────────────
  const leaveMatch = useCallback(async () => {
    const mid = matchIdRef.current;
    if (socketRef.current && mid) {
      try { await socketRef.current.leaveMatch(mid); } catch { /* ok */ }
    }
    setMatchId(null);
    setGameState(null);
    setMyVoted(false);
  }, []);

  // ── Quick Game (classic auto-matchmaking) ──────────────────────────────
  const handleQuickGame = useCallback(async () => {
    if (!socketRef.current) return;
    setBusy(true);
    setErrorMsg("");
    setSearchSecs(60);
    try {
      const res = await socketRef.current.rpc("quick_match", "{}");
      const { matchId: mid } = JSON.parse(res.payload || "{}");
      if (!mid) throw new Error("No match returned");
      await socketRef.current.joinMatch(mid);
      setMatchId(mid);
      setGameState(null);
      setScreen("searching");
    } catch (e) {
      setErrorMsg("Matchmaking failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  // Searching: 60s countdown → auto-cancel
  useEffect(() => {
    if (screen !== "searching") return;
    if (searchSecs <= 0) {
      leaveMatch().then(() => {
        setScreen("lobby");
        setErrorMsg("No opponent found. Try again!");
      });
      return;
    }
    const t = setTimeout(() => setSearchSecs(s => s - 1), 1000);
    return () => clearTimeout(t);
  }, [screen, searchSecs, leaveMatch]);

  const handleCancelSearch = useCallback(async () => {
    await leaveMatch();
    setScreen("lobby");
    setErrorMsg("");
  }, [leaveMatch]);

  // ── Room: Create ───────────────────────────────────────────────────────
  const handleCreateRoom = useCallback(async () => {
    if (!socketRef.current) return;
    setBusy(true);
    setErrorMsg("");
    try {
      const res = await socketRef.current.rpc("create_room", "{}");
      const { code, matchId: mid } = JSON.parse(res.payload || "{}");
      if (!mid) throw new Error("Failed to create room");
      await socketRef.current.joinMatch(mid);
      setMatchId(mid);
      setRoomCode(code);
      setGameState(null);
      setScreen("waiting-room");
    } catch (e) {
      setErrorMsg("Create room failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  // ── Room: Join by code ─────────────────────────────────────────────────
  const handleJoinRoom = useCallback(async () => {
    const code = joinCode.trim().replace(/\D/g, "");
    if (code.length !== 6 || !socketRef.current) return;
    setBusy(true);
    setErrorMsg("");
    try {
      const res = await socketRef.current.rpc("join_room", JSON.stringify({ code }));
      const { matchId: mid } = JSON.parse(res.payload || "{}");
      if (!mid) throw new Error("Room not found");
      await socketRef.current.joinMatch(mid);
      setMatchId(mid);
      setGameState(null);
      setScreen("waiting-room");
    } catch (e) {
      setErrorMsg("Join failed: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [joinCode]);

  // ── Make a move ────────────────────────────────────────────────────────
  const handleMove = useCallback(async (index: number) => {
    const mid = matchIdRef.current;
    if (!socketRef.current || !mid || !gameState) return;
    if (!gameState.gameStarted || gameState.gameOver) return;
    if (gameState.currentPlayer !== myUserId) return;
    if (gameState.board[index] !== "") return;
    try {
      await socketRef.current.sendMatchState(mid, 2, JSON.stringify({ type: "move", index }));
    } catch { /* ignore */ }
  }, [gameState, myUserId]);

  // ── Restart vote (room mode) ───────────────────────────────────────────
  const handleRestartVote = useCallback(async () => {
    const mid = matchIdRef.current;
    if (!socketRef.current || !mid || myVoted) return;
    try {
      await socketRef.current.sendMatchState(mid, 2, JSON.stringify({ type: "restart_vote" }));
      setMyVoted(true);
    } catch { /* ignore */ }
  }, [myVoted]);

  // ── Leave game → lobby ─────────────────────────────────────────────────
  const handleLeave = useCallback(async () => {
    await leaveMatch();
    setScreen("lobby");
    setErrorMsg("");
  }, [leaveMatch]);

  // ── Leaderboard ────────────────────────────────────────────────────────
  const loadLeaderboard = useCallback(async () => {
    if (!socketRef.current) return;
    try {
      const res   = await socketRef.current.rpc("get_leaderboard", "");
      const data  = JSON.parse(res.payload || "{}");
      setLeaderboard(data.records || []);
      const sres  = await socketRef.current.rpc("get_stats", "");
      const stats = JSON.parse(sres.payload || "{}");
      setMyWins(stats.wins || 0);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (screen === "leaderboard") loadLeaderboard();
  }, [screen, loadLeaderboard]);

  // ── Derived ────────────────────────────────────────────────────────────
  const opponentId   = gameState?.players?.find(p => p !== myUserId) || "";
  const opponentTag  = opponentId ? (gameState?.playerTags?.[opponentId] || "Opponent") : "Waiting…";
  const myTag        = gameState?.playerTags?.[myUserId] || gameTag;
  const mySymbol     = gameState?.symbols?.[myUserId] || "";
  const oppSymbol    = opponentId ? (gameState?.symbols?.[opponentId] || "") : "?";
  const isMyTurn     = !!(gameState?.gameStarted && !gameState?.gameOver && gameState?.currentPlayer === myUserId);
  const opponentVoted = gameState ? gameState.restartVotes.includes(opponentId) : false;

  // ── Result helpers ─────────────────────────────────────────────────────
  function resultText() {
    if (!gameState?.gameOver) return "";
    if (gameState.draw)                return "It's a Draw!";
    if (gameState.winner === myUserId) return "You Win!";
    return "Better Luck Next Time!";
  }
  function resultSubText() {
    if (!gameState?.gameOver) return "";
    if (gameState.draw)                return "Nobody wins this round.";
    if (gameState.winner === myUserId) return "Congratulations! Great game.";
    return "Don't give up — try again!";
  }
  function resultClass() {
    if (!gameState?.gameOver) return "";
    if (gameState.draw)               return "draw";
    return gameState.winner === myUserId ? "win" : "lose";
  }

  // ══════════════════════════════════════════════════════════════════════
  // ── SCREENS ────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════

  // ── LOGIN ──────────────────────────────────────────────────────────────
  if (screen === "login") return (
    <div className="screen center-screen">
      <div className="card login-card">
        <h1 className="logo">Tic‑Tac‑Toe</h1>
        <p className="logo-sub">Real‑time · Multiplayer</p>

        <div className="field">
          <label>Your Name</label>
          <input
            className="input"
            placeholder="Enter your name"
            value={nameInput}
            maxLength={20}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleLogin()}
          />
        </div>

        <div className="tag-preview">
          <span className="tag-label">Game tag</span>
          <span className="tag-value">{gameTag}</span>
          <span className="tag-note">(shown to others)</span>
        </div>

        {errorMsg && <p className="err">{errorMsg}</p>}

        <button className="btn primary" onClick={handleLogin} disabled={busy}>
          {busy ? "Connecting…" : "Let's Play!"}
        </button>
      </div>
    </div>
  );

  // ── LEADERBOARD ────────────────────────────────────────────────────────
  if (screen === "leaderboard") return (
    <div className="screen">
      <header className="topbar">
        <button className="btn ghost" onClick={() => setScreen("lobby")}>← Back</button>
        <h2>Leaderboard</h2>
        <span className="my-wins-badge">{myWins} win{myWins !== 1 ? "s" : ""}</span>
      </header>
      <div className="lb-list">
        {leaderboard.length === 0 && <p className="empty">No records yet. Be the first!</p>}
        {leaderboard.map(r => (
          <div key={r.userId} className={"lb-row" + (r.userId === myUserId ? " me" : "")}>
            <span className="lb-rank">
              {r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : `#${r.rank}`}
            </span>
            <span className="lb-name">{r.username}</span>
            <span className="lb-wins">{r.wins}W</span>
          </div>
        ))}
      </div>
    </div>
  );

  // ── LOBBY ──────────────────────────────────────────────────────────────
  if (screen === "lobby") return (
    <div className="screen center-screen lobby-screen">
      <header className="lobby-header">
        <div className="my-tag-info">
          <span className="name-display">{realName || gameTag}</span>
          <span className="tag-chip">{gameTag}</span>
        </div>
        <button className="btn ghost icon-btn" onClick={() => setScreen("leaderboard")} title="Leaderboard">
          🏆
        </button>
      </header>

      <h1 className="logo">Tic‑Tac‑Toe</h1>

      {errorMsg && <p className="err">{errorMsg}</p>}

      <div className="lobby-btns">
        <button className="btn primary big-btn" onClick={handleQuickGame} disabled={busy}>
          <span className="btn-icon">⚡</span>
          <span>
            <strong>Quick Game</strong>
            <small>Auto-match with a random player</small>
          </span>
        </button>

        <button className="btn secondary big-btn" onClick={() => { setScreen("room-menu"); setErrorMsg(""); }} disabled={busy}>
          <span className="btn-icon">🚪</span>
          <span>
            <strong>New Room</strong>
            <small>Create or join a private room</small>
          </span>
        </button>
      </div>
    </div>
  );

  // ── SEARCHING ──────────────────────────────────────────────────────────
  if (screen === "searching") return (
    <div className="screen center-screen">
      <div className="card search-card">
        <div className="spinner" />
        <h2>Finding opponent…</h2>
        <p className="search-sub">Matching you with another player</p>

        <div className={"search-timer" + (searchSecs <= 10 ? " urgent" : "")}>
          <div className="search-fill" style={{ width: `${(searchSecs / 60) * 100}%` }} />
          <span className="search-secs">{searchSecs}s</span>
        </div>

        <button className="btn ghost cancel-btn" onClick={handleCancelSearch}>Cancel</button>
      </div>
    </div>
  );

  // ── ROOM MENU ──────────────────────────────────────────────────────────
  if (screen === "room-menu") return (
    <div className="screen center-screen">
      <div className="card room-card">
        <button className="back-link" onClick={() => setScreen("lobby")}>← Back</button>
        <h2>Private Room</h2>

        <button className="btn primary" onClick={handleCreateRoom} disabled={busy}>
          {busy ? "Creating…" : "Create a Room"}
        </button>

        <div className="divider"><span>or join one</span></div>

        <div className="code-join-row">
          <input
            className="input code-input"
            placeholder="Enter 6-digit code"
            value={joinCode}
            maxLength={6}
            inputMode="numeric"
            onChange={e => setJoinCode(e.target.value.replace(/\D/g, ""))}
            onKeyDown={e => e.key === "Enter" && handleJoinRoom()}
          />
          <button
            className="btn primary"
            onClick={handleJoinRoom}
            disabled={busy || joinCode.replace(/\D/g, "").length !== 6}
          >
            Join
          </button>
        </div>

        <div className="divider"><span>or play locally</span></div>

        <button
          className="btn secondary local-btn"
          onClick={() => { setLocal(newLocalRound()); setScreen("local-game"); }}
        >
          <span className="btn-icon">🎮</span> Local 2‑Player
          <small className="local-btn-sub">Same device · Pass & play</small>
        </button>

        {errorMsg && <p className="err">{errorMsg}</p>}
      </div>
    </div>
  );

  // ── LOCAL GAME ─────────────────────────────────────────────────────────
  if (screen === "local-game" && local) {
    const lRes = local.gameOver
      ? local.draw ? "It's a Draw!" : `${local.winner} Wins!`
      : "";
    const lSub = local.gameOver
      ? local.draw
        ? "Nobody wins this round."
        : `Congratulations Player ${local.winner}! Better luck next time, Player ${local.winner === "X" ? "O" : "X"}!`
      : "";
    const lRc = local.gameOver
      ? local.draw
        ? "draw"
        : local.winner === "X" ? "x-win" : "o-win"
      : "";

    return (
      <div className="screen game-screen">
        <header className="topbar">
          <button className="btn ghost" onClick={() => { setLocal(null); setScreen("lobby"); }}>← Leave</button>
          <div className="mode-badge">🎮 Local</div>
          <div />
        </header>

        {/* Players */}
        <div className="players-row">
          <div className={"pcard" + (!local.gameOver && local.current === "X" ? " my-turn-card" : "")}>
            <span className="psymbol x">X</span>
            <span className="ptag">Player X</span>
          </div>
          <div className="vs-col">
            <span className="vs">VS</span>
            {local.gameNumber > 1 && <span className="game-num">Game {local.gameNumber}</span>}
          </div>
          <div className={"pcard" + (!local.gameOver && local.current === "O" ? " my-turn-card" : "")}>
            <span className="psymbol o">O</span>
            <span className="ptag">Player O</span>
          </div>
        </div>

        {/* Timer */}
        {!local.gameOver && (
          <div className={"timer-wrap" + (local.turnSecs <= 8 ? " urgent" : "")}>
            <div className="timer-track">
              <div className="timer-fill" style={{ width: `${(local.turnSecs / 30) * 100}%` }} />
            </div>
            <span className="timer-label">Player {local.current}'s turn · {local.turnSecs}s</span>
          </div>
        )}

        {/* Skip notice */}
        {local.skipNotice && <div className="skip-notice">{local.skipNotice}</div>}

        {/* Turn label */}
        {!local.gameOver && !local.skipNotice && (
          <p className="turn-label active">Player {local.current}'s turn</p>
        )}

        {/* Result banner */}
        {lRes && (
          <div className={"result-banner " + lRc}>
            <div className="result-main">{lRes}</div>
            <div className="result-sub">{lSub}</div>
          </div>
        )}

        {/* Board */}
        <div className="board">
          {local.board.map((cell, i) => {
            const clickable = !local.gameOver && cell === "";
            return (
              <button
                key={i}
                className={"cell" + (cell ? " " + cell.toLowerCase() : "") + (clickable ? " hot" : "")}
                onClick={() => handleLocalMove(i)}
                disabled={!clickable}
              >
                {cell}
              </button>
            );
          })}
        </div>

        {/* Post-game */}
        {local.gameOver && (
          <div className="postgame">
            <button className="btn primary" onClick={handleLocalRestart}>Play Again</button>
            <button className="btn secondary" onClick={() => { setLocal(null); setScreen("lobby"); }}>
              Back to Lobby
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── WAITING ROOM ───────────────────────────────────────────────────────
  if (screen === "waiting-room") return (
    <div className="screen center-screen">
      <div className="card waiting-card">
        <button className="back-link" onClick={async () => { await leaveMatch(); setScreen("lobby"); }}>
          ← Leave
        </button>
        <h2>Room Created!</h2>
        <p className="waiting-sub">Share this code with your opponent</p>

        <div className="room-code-display">
          {roomCode.split("").map((ch, i) => (
            <span key={i} className="code-digit">{ch}</span>
          ))}
        </div>

        <button
          className="btn ghost btn-sm copy-btn"
          onClick={() => navigator.clipboard.writeText(roomCode)}
        >
          Copy Code
        </button>

        <div className="waiting-dots">
          <div className="spinner sm" />
          <span>Waiting for opponent…</span>
        </div>

        <p className="waiting-note">Room expires in 10 minutes</p>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════
  // ── GAME ───────────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════════
  const board = gameState?.board || Array(9).fill("");
  const ts    = gameState?.turnSeconds ?? 30;
  const res   = resultText();
  const rc    = resultClass();

  return (
    <div className="screen game-screen">
      {/* Top bar */}
      <header className="topbar">
        <button className="btn ghost" onClick={handleLeave}>← Leave</button>
        <div className="mode-badge">
          {gameState?.mode === "room" ? `🚪 #${gameState.roomCode}` : "⚡ Quick"}
        </div>
        <button className="btn ghost icon-btn" onClick={() => setScreen("leaderboard")}>🏆</button>
      </header>

      {/* Players */}
      <div className="players-row">
        <div className={"pcard" + (isMyTurn ? " my-turn-card" : "")}>
          <span className={"psymbol " + mySymbol.toLowerCase()}>{mySymbol || "?"}</span>
          <span className="ptag">{myTag}</span>
          <span className="pname-sub">{realName}</span>
          <span className="you-chip">You</span>
        </div>

        <div className="vs-col">
          <span className="vs">VS</span>
          {gameState?.gameNumber ? <span className="game-num">Game {gameState.gameNumber}</span> : null}
        </div>

        <div className={"pcard" + (!isMyTurn && gameState?.gameStarted && !gameState?.gameOver ? " my-turn-card" : "")}>
          <span className={"psymbol " + oppSymbol.toLowerCase()}>{oppSymbol}</span>
          <span className="ptag">{opponentTag}</span>
        </div>
      </div>

      {/* Timer bar — always visible while game active */}
      {gameState?.gameStarted && !gameState?.gameOver && (
        <div className={"timer-wrap" + (ts <= 8 ? " urgent" : "")}>
          <div className="timer-track">
            <div className="timer-fill" style={{ width: `${(ts / 30) * 100}%` }} />
          </div>
          <span className="timer-label">
            {isMyTurn ? `Your turn · ${ts}s` : `${opponentTag} · ${ts}s`}
          </span>
        </div>
      )}

      {/* Skip notice */}
      {gameState?.skipNotice && (
        <div className="skip-notice">{gameState.skipNotice}</div>
      )}

      {/* Waiting / turn status */}
      {!gameState?.gameStarted && !gameState?.gameOver && (
        <p className="status-pulse">Waiting for opponent…</p>
      )}
      {gameState?.gameStarted && !gameState?.gameOver && !gameState?.skipNotice && (
        <p className={"turn-label" + (isMyTurn ? " active" : "")}>
          {isMyTurn ? "Your turn" : `${opponentTag}'s turn`}
        </p>
      )}

      {/* Result banner */}
      {res && (
        <div className={"result-banner " + rc}>
          <div className="result-main">{res}</div>
          <div className="result-sub">{resultSubText()}</div>
        </div>
      )}


      {/* Board */}
      <div className="board">
        {board.map((cell: string, i: number) => {
          const clickable = isMyTurn && cell === "" && !gameState?.gameOver;
          return (
            <button
              key={i}
              className={"cell" + (cell ? " " + cell.toLowerCase() : "") + (clickable ? " hot" : "")}
              onClick={() => handleMove(i)}
              disabled={!clickable}
            >
              {cell}
            </button>
          );
        })}
      </div>

      {/* Post-game actions */}
      {gameState?.gameOver && (
        <div className="postgame">
          {/* Both modes: vote restart */}
          {gameState.players.length === 2 && (
            <button
              className={"btn primary" + (myVoted ? " voted" : "")}
              onClick={handleRestartVote}
              disabled={myVoted}
            >
              {myVoted
                ? `Waiting for opponent… (${gameState.restartVotes.length}/2)`
                : opponentVoted
                  ? "Opponent wants to play again — Accept?"
                  : "Play Again"}
            </button>
          )}

          <button className="btn secondary" onClick={handleLeave}>Back to Lobby</button>
        </div>
      )}

      {/* Share room code (waiting) */}
      {gameState?.mode === "room" && !gameState?.gameStarted && roomCode && (
        <div className="room-code-bar">
          <span>Code: <strong>{roomCode}</strong></span>
          <button className="btn ghost btn-sm" onClick={() => navigator.clipboard.writeText(roomCode)}>Copy</button>
        </div>
      )}
    </div>
  );
}

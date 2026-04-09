import { Platform } from 'react-native';
import { createWorkletRuntime, runOnJS, runOnRuntime, type WorkletRuntime } from 'react-native-worklets';
import type { MarsMinersGame, PlayerId, PlayerRole, AIMove, Player } from '../MarsMinersGame';
import type { AIThinkResult } from './AIPlayer';
import { createAIPlayer } from './createAIPlayer';

type AITurnRole = Extract<PlayerRole, 'easy_ai' | 'normal_ai' | 'hard_ai'>;

type SnapshotPlayer = Pick<Player, 'st' | 'mi' | 'name' | 'pos' | 'color'>;

type GameSnapshot = {
    width: number;
    height: number;
    grid: string[][];
    roles: Record<PlayerId, PlayerRole>;
    weapon_req: number;
    turn: PlayerId;
    player_lost: Record<PlayerId, boolean>;
    game_over: boolean;
    battleLog: string[];
    playerIds: Record<PlayerId, string>;
    players: Record<PlayerId, SnapshotPlayer>;
};

type PendingRequest = {
    resolve: (result: AIThinkResult) => void;
};

let runtime: WorkletRuntime | null = null;
let runtimeInitFailed = false;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();
let webAIWorker: any = null;
let webAIWorkerUrl: string | null = null;

const WEB_AI_WORKER_SOURCE = `
self.onmessage = function (event) {
  const data = event.data;
  if (!data || data.type !== 'compute-ai') return;
  const result = computeMove(data.snapshot, data.role, data.maxThinkTimeMs);
  self.postMessage({ type: 'compute-ai-result', requestId: data.requestId, result: result });
};

function computeMove(snapshot, role, maxThinkTimeMs) {
  const deadline = Date.now() + (maxThinkTimeMs || 5000);
  const ctx = { deadline, timedOut: false };
  const player = snapshot.turn;
  const moves = generateOrderedMoves(ctx, snapshot, player);
  if (moves.length === 0) return { move: null, finishedBy: ctx.timedOut ? 'timeout' : 'completed' };

  let depth = (role === 'hard_ai' ? 4 : (role === 'normal_ai' ? 3 : 2));
  let bestMove = moves[0].move;
  let bestScore = Number.NEGATIVE_INFINITY;
  let alpha = Number.NEGATIVE_INFINITY;
  const beta = Number.POSITIVE_INFINITY;

  for (const candidate of moves) {
    if (isOutOfTime(ctx)) break;
    const nextSnapshot = applyMove(snapshot, candidate.move);
    const score = -negamax(ctx, nextSnapshot, depth - 1, -beta, -alpha, player);
    if (score > bestScore) { bestScore = score; bestMove = candidate.move; }
    alpha = Math.max(alpha, score);
  }
  return { move: bestMove, finishedBy: ctx.timedOut ? 'timeout' : 'completed' };
}

function isOutOfTime(ctx) { if (Date.now() >= ctx.deadline) { ctx.timedOut = true; return true; } return false; }

function negamax(ctx, snapshot, depth, alpha, beta, rootPlayer) {
  if (isOutOfTime(ctx) || snapshot.game_over || depth <= 0) return evaluatePosition(ctx, snapshot, rootPlayer);
  const moves = generateOrderedMoves(ctx, snapshot, snapshot.turn);
  if (moves.length === 0) return evaluatePosition(ctx, snapshot, rootPlayer);
  let best = Number.NEGATIVE_INFINITY;
  let localAlpha = alpha;
  for (const candidate of moves) {
    if (isOutOfTime(ctx)) break;
    const nextSnapshot = applyMove(snapshot, candidate.move);
    const score = -negamax(ctx, nextSnapshot, depth - 1, -beta, -localAlpha, rootPlayer);
    best = Math.max(best, score);
    localAlpha = Math.max(localAlpha, score);
    if (localAlpha >= beta) break;
  }
  return best;
}

function evaluatePosition(ctx, snapshot, rootPlayer) {
  if (snapshot.game_over) {
    const scores = getScores(ctx, snapshot);
    let bestScore = -1, winners = [];
    for (let pid = 1; pid <= 4; pid++) {
      if (snapshot.roles[pid] === 'none') continue;
      const s = scores[pid] || 0;
      if (s > bestScore) { bestScore = s; winners = [pid]; }
      else if (s === bestScore) winners.push(pid);
    }
    if (winners.includes(rootPlayer)) return winners.length === 1 ? 10000 : 1000;
    return -10000;
  }
  let total = 0;
  for (let pid = 1; pid <= 4; pid++) {
    if (snapshot.roles[pid] === 'none') continue;
    total += (pid === rootPlayer ? 1 : -0.5) * evaluatePlayerState(ctx, snapshot, pid);
  }
  return total;
}

function evaluatePlayerState(ctx, snapshot, player) {
  if (snapshot.player_lost[player]) return -5000;
  let score = 0;
  const p = snapshot.players[player];
  for (let r = 0; r < snapshot.height; r++) {
    for (let c = 0; c < snapshot.width; c++) {
      if (snapshot.grid[r][c] === p.st) {
        score += 10;
        score += (6 - (Math.abs(r - (snapshot.height - 1) / 2) + Math.abs(c - (snapshot.width - 1) / 2)));
      } else if (snapshot.grid[r][c] === p.mi) score += 50;
    }
  }
  const power = getLinePower(ctx, snapshot, player);
  score += power * 20;
  if (power >= snapshot.weapon_req) score += 100;
  return score;
}

function generateOrderedMoves(ctx, snapshot, player) {
  const moves = [];
  for (let r = 0; r < snapshot.height; r++) {
    if (isOutOfTime(ctx)) break;
    for (let c = 0; c < snapshot.width; c++) {
      if (isOutOfTime(ctx)) break;
      if (!canBuild(snapshot, r, c, player)) continue;
      moves.push({ type: 'S', r, c });
      if (Math.random() < 0.3) moves.push({ type: 'M', r, c });
    }
  }
  if (getLinePower(ctx, snapshot, player) >= snapshot.weapon_req) {
    const weapons = getWeaponCells(ctx, snapshot).filter(pos => snapshot.grid[pos[0]][pos[1]] === snapshot.players[player].st);
    if (weapons.length > 0) {
      for (let r = 0; r < snapshot.height; r++) {
        if (isOutOfTime(ctx)) break;
        for (let c = 0; c < snapshot.width; c++) {
          let isEnemy = false;
          for (let pid = 1; pid <= 4; pid++) if (pid !== player && snapshot.grid[r][c] === snapshot.players[pid].st) { isEnemy = true; break; }
          if (isEnemy) {
            const s = weapons[0];
            moves.push({ type: 'L', tr: r, tc: c, sr: s[0], sc: s[1] });
          }
        }
      }
    }
  }
  return moves.map(m => ({ move: m, score: (m.type === 'L' ? 1000 : 100) })).sort((a,b) => b.score - a.score).slice(0, 15);
}

function canBuild(snapshot, r, c, player) {
  if (snapshot.grid[r][c] !== '.') return false;
  const adj = [[-1,0],[1,0],[0,-1],[0,1]];
  for (const p of adj) {
    const nr = r + p[0], nc = c + p[1];
    if (nr >= 0 && nr < snapshot.height && nc >= 0 && nc < snapshot.width && snapshot.grid[nr][nc] === snapshot.players[player].st) return true;
  }
  return false;
}

function getLinePower(ctx, snapshot, player) {
  const st = snapshot.players[player].st; let max = 0;
  for (let r = 0; r < snapshot.height; r++) { let cur = 0; for (let c = 0; c < snapshot.width; c++) { cur = snapshot.grid[r][c] === st ? cur + 1 : 0; max = Math.max(max, cur); } }
  for (let c = 0; c < snapshot.width; c++) { let cur = 0; for (let r = 0; r < snapshot.height; r++) { cur = snapshot.grid[r][c] === st ? cur + 1 : 0; max = Math.max(max, cur); } }
  return max;
}

function getWeaponCells(ctx, snapshot) {
  const cells = [];
  for (let pid = 1; pid <= 4; pid++) {
    const st = snapshot.players[pid].st;
    if (snapshot.roles[pid] === 'none') continue;
    for (let r = 0; r < snapshot.height; r++) {
      let l = [];
      for (let c = 0; c < snapshot.width; c++) { if (snapshot.grid[r][c] === st) l.push([r,c]); else { if (l.length >= snapshot.weapon_req) l.forEach(p => cells.push(p)); l = []; } }
      if (l.length >= snapshot.weapon_req) l.forEach(p => cells.push(p));
    }
    for (let c = 0; c < snapshot.width; c++) {
      let l = [];
      for (let r = 0; r < snapshot.height; r++) { if (snapshot.grid[r][c] === st) l.push([r,c]); else { if (l.length >= snapshot.weapon_req) l.forEach(p => cells.push(p)); l = []; } }
      if (l.length >= snapshot.weapon_req) l.forEach(p => cells.push(p));
    }
  }
  return cells;
}

function applyMove(snapshot, move) {
  const next = JSON.parse(JSON.stringify(snapshot));
  if (move.type === 'S') next.grid[move.r][move.c] = next.players[next.turn].st;
  else if (move.type === 'M') next.grid[move.r][move.c] = next.players[next.turn].mi;
  else { next.grid[move.tr][move.tc] = '█'; next.grid[move.sr][move.sc] = '█'; }
  nextTurn(next);
  return next;
}

function nextTurn(snapshot) {
  let start = snapshot.turn;
  do { snapshot.turn = (snapshot.turn % 4) + 1; } while ((snapshot.roles[snapshot.turn] === 'none' || snapshot.player_lost[snapshot.turn]) && snapshot.turn !== start);
}

function getScores(ctx, snapshot) {
  const s = {};
  for (let pid = 1; pid <= 4; pid++) {
    if (snapshot.roles[pid] === 'none') continue;
    let t = 0;
    for (const r of snapshot.grid) for (const c of r) if (c === snapshot.players[pid].mi) t++;
    s[pid] = t;
  }
  return s;
}
`;

function makeSnapshot(game: MarsMinersGame): GameSnapshot {
    return {
        width: game.width,
        height: game.height,
        grid: game.grid.map(row => [...row]),
        roles: { ...game.roles },
        weapon_req: game.weapon_req,
        turn: game.turn,
        player_lost: { ...game.player_lost },
        game_over: game.game_over,
        battleLog: [...game.battleLog],
        playerIds: { ...game.playerIds },
        players: {
            1: { ...game.players[1] },
            2: { ...game.players[2] },
            3: { ...game.players[3] },
            4: { ...game.players[4] },
        },
    };
}

function roleToDifficulty(role: AITurnRole): 'easy' | 'normal' | 'hard' {
    switch (role) {
        case 'hard_ai': return 'hard';
        case 'normal_ai': return 'normal';
        case 'easy_ai':
        default: return 'easy';
    }
}

function deliverResult(requestId: number, result: AIThinkResult) {
    const request = pending.get(requestId);
    if (!request) return;
    pending.delete(requestId);
    request.resolve(result);
}

function deliverError(requestId: number, errorMessage: string) {
    const request = pending.get(requestId);
    if (!request) return;
    pending.delete(requestId);
    console.error('AI background request failed', errorMessage);
    request.resolve({ move: null, finishedBy: 'timeout' });
}

function getRuntime(): WorkletRuntime | null {
    if (Platform.OS === 'web' || runtimeInitFailed) return null;
    if (!runtime) {
        try { runtime = createWorkletRuntime({ name: 'ai-runtime' }); }
        catch { runtimeInitFailed = true; return null; }
    }
    return runtime;
}

function getWebAIWorker(): any | null {
    if (Platform.OS !== 'web' || typeof Worker === 'undefined' || typeof window === 'undefined') return null;
    if (!webAIWorker) {
        const blob = new Blob([WEB_AI_WORKER_SOURCE], { type: 'text/javascript' });
        webAIWorkerUrl = URL.createObjectURL(blob);
        webAIWorker = new Worker(webAIWorkerUrl);
        webAIWorker.onmessage = (event: any) => {
            const data = event.data;
            if (!data || data.type !== 'compute-ai-result') return;
            deliverResult(data.requestId, data.result as AIThinkResult);
        };
        webAIWorker.onerror = () => {
            webAIWorker?.terminate();
            webAIWorker = null;
        };
    }
    return webAIWorker;
}

function computeMove(snapshot: GameSnapshot, role: AITurnRole, maxThinkTimeMs: number): AIThinkResult {
    const emptyRoles: Record<PlayerId, PlayerRole> = { 1: 'none', 2: 'none', 3: 'none', 4: 'none' };
    const game = new (require('../MarsMinersGame').MarsMinersGame)(emptyRoles, snapshot.weapon_req);
    game.width = snapshot.width;
    game.height = snapshot.height;
    game.grid = snapshot.grid.map(row => [...row]);
    game.roles = { ...snapshot.roles };
    game.player_lost = { ...snapshot.player_lost };
    game.turn = snapshot.turn;
    game.game_over = snapshot.game_over;
    game.battleLog = [...snapshot.battleLog];
    game.players = JSON.parse(JSON.stringify(snapshot.players));
    
    return createAIPlayer(roleToDifficulty(role)).getMove(game, { maxThinkTimeMs });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void, fallbackValue: T): Promise<T> {
    return new Promise<T>((resolve) => {
        const timer = setTimeout(() => { onTimeout(); resolve(fallbackValue); }, timeoutMs);
        promise.then(value => { clearTimeout(timer); resolve(value); })
               .catch(error => { clearTimeout(timer); resolve(fallbackValue); });
    });
}

export async function computeAIMoveInBackground(
    game: MarsMinersGame,
    role: AITurnRole,
    maxThinkTimeMs: number
): Promise<AIThinkResult> {
    const snapshot = makeSnapshot(game);
    const serviceTimeoutMs = Math.max(1, maxThinkTimeMs + 1000);

    if (Platform.OS === 'web') {
        const worker = getWebAIWorker();
        if (worker) {
            const requestId = nextRequestId++;
            return withTimeout(
                new Promise<AIThinkResult>((resolve) => {
                    pending.set(requestId, { resolve });
                    worker.postMessage({ type: 'compute-ai', requestId, snapshot, role, maxThinkTimeMs });
                }),
                serviceTimeoutMs,
                () => { pending.delete(requestId); },
                { move: null, finishedBy: 'timeout' }
            );
        }
    }

    const workerRuntime = getRuntime();
    if (!workerRuntime) return withTimeout(Promise.resolve().then(() => computeMove(snapshot, role, maxThinkTimeMs)), serviceTimeoutMs, () => {}, { move: null, finishedBy: 'timeout' });

    const requestId = nextRequestId++;
    return withTimeout(
        new Promise<AIThinkResult>((resolve) => {
            pending.set(requestId, { resolve });
            try {
                runOnRuntime(workerRuntime, (rId: number, snap: GameSnapshot, r: AITurnRole, time: number) => {
                    'worklet';
                    try {
                        const move = computeMove(snap, r, time);
                        runOnJS(deliverResult)(rId, move);
                    } catch (error) {
                        runOnJS(deliverError)(rId, error instanceof Error ? error.message : 'AI failed');
                    }
                })(requestId, snapshot, role, maxThinkTimeMs);
            } catch (error) { pending.delete(requestId); resolve(computeMove(snapshot, role, maxThinkTimeMs)); }
        }),
        serviceTimeoutMs,
        () => { pending.delete(requestId); },
        { move: null, finishedBy: 'timeout' }
    );
}

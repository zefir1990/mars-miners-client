import { Platform } from 'react-native';
import { createWorkletRuntime, runOnJS, runOnRuntime, type WorkletRuntime } from 'react-native-worklets';
import type { MarsMinersGame, PlayerId, PlayerRole, AIMove, Player } from '../MarsMinersGame';
import type { AIThinkResult } from './AIPlayer';
import { createAIPlayer } from './createAIPlayer';

type AITurnRole = Extract<PlayerRole, 'ai' | 'warrior_ai'>;

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
let webWarriorWorker: any = null;
let webWarriorWorkerUrl: string | null = null;

const WEB_WARRIOR_WORKER_SOURCE = `
self.onmessage = function (event) {
  const data = event.data;
  if (!data || data.type !== 'compute-warrior-ai') return;
  const result = computeWarriorMove(data.snapshot, data.maxThinkTimeMs);
  self.postMessage({ type: 'compute-warrior-ai-result', requestId: data.requestId, result: result });
};
function computeWarriorMove(snapshot, maxThinkTimeMs) {
  const ctx = createContext(snapshot, maxThinkTimeMs);
  const player = snapshot.turn;
  const moves = generateOrderedMoves(ctx, snapshot, player);
  if (moves.length === 0) {
    return ctx.timedOut
      ? { move: computeSimpleMove(snapshot), finishedBy: 'timeout' }
      : { move: null, finishedBy: 'completed' };
  }
  let bestMove = moves[0].move;
  let bestScore = Number.NEGATIVE_INFINITY;
  let alpha = Number.NEGATIVE_INFINITY;
  const beta = Number.POSITIVE_INFINITY;
  for (const candidate of moves) {
    if (isOutOfTime(ctx)) break;
    const nextSnapshot = applyMove(snapshot, candidate.move);
    const score = -negamax(ctx, nextSnapshot, 2, -beta, -alpha, player);
    if (score > bestScore) {
      bestScore = score;
      bestMove = candidate.move;
    }
    alpha = Math.max(alpha, score);
  }
  if (ctx.timedOut) {
    return { move: computeSimpleMove(snapshot), finishedBy: 'timeout' };
  }
  return { move: bestMove, finishedBy: 'completed' };
}
function createContext(snapshot, maxThinkTimeMs) { return { deadline: Date.now() + (maxThinkTimeMs || 5000), timedOut: false }; }
function isOutOfTime(ctx) { const out = Date.now() >= ctx.deadline; if (out) ctx.timedOut = true; return out; }
function negamax(ctx, snapshot, depth, alpha, beta, rootPlayer) {
  if (isOutOfTime(ctx)) return evaluatePosition(ctx, snapshot, rootPlayer);
  if (snapshot.game_over) return evaluatePosition(ctx, snapshot, rootPlayer);
  if (depth <= 0) { if (isTacticalPosition(ctx, snapshot, snapshot.turn)) depth = 1; else return evaluatePosition(ctx, snapshot, rootPlayer); }
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
  if (snapshot.game_over) return evaluateTerminal(ctx, snapshot, rootPlayer);
  let total = 0;
  for (let pid = 1; pid <= 4; pid++) {
    if (isOutOfTime(ctx)) break;
    if (snapshot.roles[pid] === 'none') continue;
    total += (pid === rootPlayer ? 1 : -0.65) * evaluatePlayerState(ctx, snapshot, pid);
  }
  if (snapshot.turn === rootPlayer) total += 15;
  return total;
}
function evaluateTerminal(ctx, snapshot, rootPlayer) {
  const scores = getScores(ctx, snapshot);
  let bestScore = Number.NEGATIVE_INFINITY;
  let winners = [];
  for (let pid = 1; pid <= 4; pid++) {
    if (isOutOfTime(ctx)) break;
    if (snapshot.roles[pid] === 'none') continue;
    const score = scores[pid] || 0;
    if (score > bestScore) { bestScore = score; winners = [pid]; } else if (score === bestScore) winners.push(pid);
  }
  if (winners.indexOf(rootPlayer) !== -1) return winners.length === 1 ? 100000 : 10000;
  return -100000;
}
function evaluatePlayerState(ctx, snapshot, player) {
  if (isOutOfTime(ctx)) return 0;
  if (snapshot.player_lost[player]) return -50000;
  const mineCount = countCells(ctx, snapshot, player, 'mi');
  const stationCount = countCells(ctx, snapshot, player, 'st');
  const linePower = getLinePower(ctx, snapshot, player);
  const mobility = countBuildMoves(ctx, snapshot, player);
  const weaponCells = getWeaponCellsForPlayer(ctx, snapshot, player).length;
  const attackTargets = countEnemyStations(ctx, snapshot, player);
  const centerControl = computeCenterControl(ctx, snapshot, player);
  const frontierQuality = computeFrontierQuality(ctx, snapshot, player);
  const imminentThreat = countImmediateEnemyWeaponThreats(ctx, snapshot, player);
  const readyTargets = countReadyShotTargets(ctx, snapshot, player);
  let score = 0;
  score += mineCount * 160 + stationCount * 28 + mobility * 18 + centerControl * 10 + weaponCells * 18 + frontierQuality * 16;
  score += Math.min(linePower, snapshot.weapon_req) * 35;
  score += linePower >= snapshot.weapon_req ? 260 + attackTargets * 30 + readyTargets * 40 : linePower * 12;
  if (mobility === 0 && linePower < snapshot.weapon_req) score -= 400;
  if (linePower === snapshot.weapon_req - 1) score += 110;
  score -= imminentThreat * 120;
  return score;
}
function generateOrderedMoves(ctx, snapshot, player) {
  if (isOutOfTime(ctx)) return [];
  return generateMoves(ctx, snapshot, player).map(function (move) { return { move: move, score: scoreMove(ctx, snapshot, player, move) }; }).sort(function (a, b) { return b.score - a.score; });
}
function generateMoves(ctx, snapshot, player) {
  if (isOutOfTime(ctx) || snapshot.player_lost[player] || snapshot.roles[player] === 'none') return [];
  const moves = [];
  const buildCandidates = [];
  const center = [(snapshot.height - 1) / 2, (snapshot.width - 1) / 2];
  const mobility = countBuildMoves(ctx, snapshot, player);
  const linePower = getLinePower(ctx, snapshot, player);
  for (let r = 0; r < snapshot.height; r++) {
    if (isOutOfTime(ctx)) break;
    for (let c = 0; c < snapshot.width; c++) {
      if (isOutOfTime(ctx)) break;
      if (!canBuild(snapshot, r, c, player)) continue;
      const openNeighbors = countOpenNeighbors(ctx, snapshot, r, c);
      const powerGain = measureLinePotential(ctx, snapshot, player, r, c);
      const blockScore = measureBlockingValue(ctx, snapshot, player, r, c);
      const enemyAdjacency = countAdjacentEnemyStations(ctx, snapshot, player, r, c);
      const ownAdjacency = countAdjacentOwnStations(ctx, snapshot, player, r, c);
      const dist = Math.abs(r - center[0]) + Math.abs(c - center[1]);
      buildCandidates.push({ move: { type: 'S', r: r, c: c }, score: 40 + openNeighbors * 22 + powerGain * 34 + blockScore * 28 + ownAdjacency * 10 + enemyAdjacency * 8 - dist * 4 });
      const shouldConsiderMine = openNeighbors <= 1 || (mobility >= 8 && ownAdjacency >= 2) || linePower >= snapshot.weapon_req;
      if (shouldConsiderMine) {
        const mineScore = 18 + Math.max(0, 2 - openNeighbors) * 35 + (linePower >= snapshot.weapon_req ? 45 : 0) + (mobility >= 8 ? 20 : 0) - powerGain * 18 - dist * 2;
        buildCandidates.push({ move: { type: 'M', r: r, c: c }, score: mineScore });
      }
    }
  }
  buildCandidates.sort(function (a, b) { return b.score - a.score; });
  for (const candidate of buildCandidates.slice(0, 10)) moves.push(candidate.move);
  if (linePower >= snapshot.weapon_req) {
    const weaponCells = getWeaponCellsForPlayer(ctx, snapshot, player);
    const enemyTargets = getEnemyStations(ctx, snapshot, player);
    for (const target of enemyTargets.slice(0, 5)) {
      if (isOutOfTime(ctx)) break;
      for (const sacrifice of weaponCells.slice(0, 3)) {
        if (isOutOfTime(ctx)) break;
        moves.push({ type: 'L', tr: target[0], tc: target[1], sr: sacrifice[0], sc: sacrifice[1] });
      }
    }
  }
  return moves;
}
function scoreMove(ctx, snapshot, player, move) {
  if (isOutOfTime(ctx)) return Number.NEGATIVE_INFINITY;
  if (move.type === 'L') return scoreLaserMove(ctx, snapshot, player, move);
  const centerDist = Math.abs(move.r - (snapshot.height - 1) / 2) + Math.abs(move.c - (snapshot.width - 1) / 2);
  const openNeighbors = countOpenNeighbors(ctx, snapshot, move.r, move.c);
  const mobility = countBuildMoves(ctx, snapshot, player);
  const linePower = getLinePower(ctx, snapshot, player);
  const blockScore = measureBlockingValue(ctx, snapshot, player, move.r, move.c);
  const ownAdjacency = countAdjacentOwnStations(ctx, snapshot, player, move.r, move.c);
  const enemyAdjacency = countAdjacentEnemyStations(ctx, snapshot, player, move.r, move.c);
  if (move.type === 'M') {
    let score = 70 - centerDist * 2;
    score += Math.max(0, 2 - openNeighbors) * 60;
    score -= openNeighbors * 35;
    score -= blockScore * 24;
    if (mobility < 6) score -= 140;
    if (linePower < snapshot.weapon_req) score -= 40;
    return score;
  }
  const powerBoost = measureLinePotential(ctx, snapshot, player, move.r, move.c);
  return 240 + powerBoost * 42 + openNeighbors * 22 + blockScore * 26 + ownAdjacency * 10 + enemyAdjacency * 8 - centerDist * 5;
}
function scoreLaserMove(ctx, snapshot, player, move) {
  if (isOutOfTime(ctx)) return Number.NEGATIVE_INFINITY;
  const targetPlayer = getOwnerOfStation(ctx, snapshot, snapshot.grid[move.tr][move.tc]);
  let score = 760;
  if (targetPlayer !== null) {
    const targetLinePower = getLinePower(ctx, snapshot, targetPlayer);
    score += countCells(ctx, snapshot, targetPlayer, 'st') * 14 + countCells(ctx, snapshot, targetPlayer, 'mi') * 24 + targetLinePower * 60;
    if (targetLinePower >= snapshot.weapon_req) score += 220;
    if (isWeaponCell(ctx, snapshot, targetPlayer, move.tr, move.tc)) score += 140;
  }
  if (isWeaponCell(ctx, snapshot, player, move.sr, move.sc)) score -= 40;
  score -= countOpenNeighbors(ctx, snapshot, move.sr, move.sc) * 20;
  if (isCriticalOwnBridge(ctx, snapshot, player, move.sr, move.sc)) score -= 180;
  return score;
}
function applyMove(snapshot, move) {
  const next = cloneSnapshot(snapshot);
  if (move.type === 'S' || move.type === 'M') {
    next.grid[move.r][move.c] = move.type === 'S' ? next.players[next.turn].st : next.players[next.turn].mi;
    next.battleLog.push(move.type + ' ' + move.c + ' ' + move.r);
  } else {
    next.grid[move.tr][move.tc] = '█';
    next.grid[move.sr][move.sc] = '█';
    next.battleLog.push('L ' + move.tc + ' ' + move.tr + ' ' + move.sc + ' ' + move.sr);
  }
  nextTurnInternal(next);
  return next;
}
function cloneSnapshot(snapshot) {
  return { width: snapshot.width, height: snapshot.height, grid: snapshot.grid.map(function (row) { return row.slice(); }), roles: Object.assign({}, snapshot.roles), weapon_req: snapshot.weapon_req, turn: snapshot.turn, player_lost: Object.assign({}, snapshot.player_lost), game_over: snapshot.game_over, battleLog: snapshot.battleLog.slice(), playerIds: Object.assign({}, snapshot.playerIds), players: { 1: Object.assign({}, snapshot.players[1]), 2: Object.assign({}, snapshot.players[2]), 3: Object.assign({}, snapshot.players[3]), 4: Object.assign({}, snapshot.players[4]) } };
}
function nextTurnInternal(snapshot) {
  for (let pid = 1; pid <= 4; pid++) if (snapshot.roles[pid] !== 'none' && !snapshot.player_lost[pid] && !canPlayerMove(snapshot, pid)) snapshot.player_lost[pid] = true;
  const activePlayers = [1, 2, 3, 4].filter(function (pid) { return snapshot.roles[pid] !== 'none' && !snapshot.player_lost[pid]; });
  if (activePlayers.length === 0) { snapshot.game_over = true; return; }
  if (activePlayers.length === 1) {
    const scores = getScores({ deadline: Number.MAX_SAFE_INTEGER, timedOut: false }, snapshot);
    const winnerId = activePlayers[0];
    let maxOtherScore = 0;
    for (let pid = 1; pid <= 4; pid++) if (pid !== winnerId && snapshot.roles[pid] !== 'none') maxOtherScore = Math.max(maxOtherScore, scores[pid] || 0);
    if ((scores[winnerId] || 0) > maxOtherScore) { snapshot.game_over = true; return; }
  }
  const startTurn = snapshot.turn;
  do { snapshot.turn = (snapshot.turn % 4) + 1; } while ((snapshot.roles[snapshot.turn] === 'none' || snapshot.player_lost[snapshot.turn]) && snapshot.turn !== startTurn);
}
function canPlayerMove(snapshot, player) { for (let r = 0; r < snapshot.height; r++) for (let c = 0; c < snapshot.width; c++) if (canBuild(snapshot, r, c, player)) return true; return false; }
function canBuild(snapshot, r, c, player) {
  if (!(r >= 0 && r < snapshot.height && c >= 0 && c < snapshot.width)) return false;
  if (snapshot.grid[r][c] !== '.') return false;
  const targetStation = snapshot.players[player].st;
  const adj = [[-1,0],[1,0],[0,-1],[0,1]];
  for (const pair of adj) { const nr = r + pair[0]; const nc = c + pair[1]; if (nr >= 0 && nr < snapshot.height && nc >= 0 && nc < snapshot.width && snapshot.grid[nr][nc] === targetStation) return true; }
  return false;
}
function getLinePower(ctx, snapshot, player) {
  if (isOutOfTime(ctx)) return 0;
  const st = snapshot.players[player].st; let max = 0;
  for (let r = 0; r < snapshot.height; r++) { if (isOutOfTime(ctx)) break; let cur = 0; for (let c = 0; c < snapshot.width; c++) { if (isOutOfTime(ctx)) break; cur = snapshot.grid[r][c] === st ? cur + 1 : 0; max = Math.max(max, cur); } }
  for (let c = 0; c < snapshot.width; c++) { if (isOutOfTime(ctx)) break; let cur = 0; for (let r = 0; r < snapshot.height; r++) { if (isOutOfTime(ctx)) break; cur = snapshot.grid[r][c] === st ? cur + 1 : 0; max = Math.max(max, cur); } }
  return max;
}
function getScores(ctx, snapshot) {
  const scores = {};
  for (let pid = 1; pid <= 4; pid++) { if (isOutOfTime(ctx)) break; if (snapshot.roles[pid] === 'none') continue; let total = 0; for (const row of snapshot.grid) for (const cell of row) if (cell === snapshot.players[pid].mi) total++; scores[pid] = total; }
  return scores;
}
function getWeaponCells(ctx, snapshot) {
  if (isOutOfTime(ctx)) return [];
  const cells = []; const seen = {};
  for (let pid = 1; pid <= 4; pid++) {
    if (isOutOfTime(ctx)) break;
    if (snapshot.roles[pid] === 'none') continue;
    const st = snapshot.players[pid].st;
    for (let r = 0; r < snapshot.height; r++) { let line = []; for (let c = 0; c < snapshot.width; c++) { if (snapshot.grid[r][c] === st) line.push([r,c]); else { if (line.length >= snapshot.weapon_req) addWeaponLine(cells, seen, line); line = []; } } if (line.length >= snapshot.weapon_req) addWeaponLine(cells, seen, line); }
    for (let c = 0; c < snapshot.width; c++) { let line = []; for (let r = 0; r < snapshot.height; r++) { if (snapshot.grid[r][c] === st) line.push([r,c]); else { if (line.length >= snapshot.weapon_req) addWeaponLine(cells, seen, line); line = []; } } if (line.length >= snapshot.weapon_req) addWeaponLine(cells, seen, line); }
  }
  return cells;
}
function addWeaponLine(cells, seen, line) { for (const pos of line) { const key = pos[0] + ',' + pos[1]; if (!seen[key]) { seen[key] = true; cells.push(pos); } } }
function countBuildMoves(ctx, snapshot, player) { let total = 0; for (let r = 0; r < snapshot.height; r++) { if (isOutOfTime(ctx)) break; for (let c = 0; c < snapshot.width; c++) { if (isOutOfTime(ctx)) break; if (canBuild(snapshot, r, c, player)) total++; } } return total; }
function countOpenNeighbors(ctx, snapshot, r, c) { if (isOutOfTime(ctx)) return 0; let total = 0; const adj = [[-1,0],[1,0],[0,-1],[0,1]]; for (const pair of adj) { const nr = r + pair[0]; const nc = c + pair[1]; if (nr >= 0 && nr < snapshot.height && nc >= 0 && nc < snapshot.width && snapshot.grid[nr][nc] === '.') total++; } return total; }
function countAdjacentOwnStations(ctx, snapshot, player, r, c) { if (isOutOfTime(ctx)) return 0; let total = 0; const st = snapshot.players[player].st; const adj = [[-1,0],[1,0],[0,-1],[0,1]]; for (const pair of adj) { const nr = r + pair[0]; const nc = c + pair[1]; if (nr >= 0 && nr < snapshot.height && nc >= 0 && nc < snapshot.width && snapshot.grid[nr][nc] === st) total++; } return total; }
function countAdjacentEnemyStations(ctx, snapshot, player, r, c) { if (isOutOfTime(ctx)) return 0; let total = 0; const adj = [[-1,0],[1,0],[0,-1],[0,1]]; for (const pair of adj) { const nr = r + pair[0]; const nc = c + pair[1]; if (nr < 0 || nr >= snapshot.height || nc < 0 || nc >= snapshot.width) continue; const owner = getOwnerOfStation(ctx, snapshot, snapshot.grid[nr][nc]); if (owner !== null && owner !== player) total++; } return total; }
function countCells(ctx, snapshot, player, type) { if (isOutOfTime(ctx)) return 0; const symbol = snapshot.players[player][type]; let total = 0; for (const row of snapshot.grid) { if (isOutOfTime(ctx)) break; for (const cell of row) if (cell === symbol) total++; } return total; }
function getWeaponCellsForPlayer(ctx, snapshot, player) { if (isOutOfTime(ctx)) return []; const st = snapshot.players[player].st; return getWeaponCells(ctx, snapshot).filter(function (pos) { return snapshot.grid[pos[0]][pos[1]] === st; }); }
function getEnemyStations(ctx, snapshot, player) { const targets = []; for (let r = 0; r < snapshot.height; r++) { if (isOutOfTime(ctx)) break; for (let c = 0; c < snapshot.width; c++) { if (isOutOfTime(ctx)) break; const owner = getOwnerOfStation(ctx, snapshot, snapshot.grid[r][c]); if (owner === null || owner === player) continue; const danger = countCells(ctx, snapshot, owner, 'mi') * 3 + getLinePower(ctx, snapshot, owner) * 8 + computeCenterBias(snapshot, r, c); targets.push({ pos: [r,c], danger: danger }); } } targets.sort(function (a,b) { return b.danger - a.danger; }); return targets.map(function (target) { return target.pos; }); }
function countEnemyStations(ctx, snapshot, player) { let total = 0; for (let r = 0; r < snapshot.height; r++) { if (isOutOfTime(ctx)) break; for (let c = 0; c < snapshot.width; c++) { if (isOutOfTime(ctx)) break; const owner = getOwnerOfStation(ctx, snapshot, snapshot.grid[r][c]); if (owner !== null && owner !== player) total++; } } return total; }
function getOwnerOfStation(ctx, snapshot, cell) { if (isOutOfTime(ctx)) return null; for (let pid = 1; pid <= 4; pid++) if (snapshot.players[pid].st === cell) return pid; return null; }
function computeCenterControl(ctx, snapshot, player) { let control = 0; for (let r = 0; r < snapshot.height; r++) { if (isOutOfTime(ctx)) break; for (let c = 0; c < snapshot.width; c++) { if (isOutOfTime(ctx)) break; const cell = snapshot.grid[r][c]; if (cell === snapshot.players[player].st || cell === snapshot.players[player].mi) control += computeCenterBias(snapshot, r, c); } } return control; }
function computeFrontierQuality(ctx, snapshot, player) { let total = 0; for (let r = 0; r < snapshot.height; r++) { if (isOutOfTime(ctx)) break; for (let c = 0; c < snapshot.width; c++) { if (isOutOfTime(ctx)) break; if (snapshot.grid[r][c] === snapshot.players[player].st) total += countOpenNeighbors(ctx, snapshot, r, c); } } return total; }
function computeCenterBias(snapshot, r, c) { const centerR = (snapshot.height - 1) / 2; const centerC = (snapshot.width - 1) / 2; return Math.max(0, 6 - (Math.abs(r - centerR) + Math.abs(c - centerC))); }
function measureLinePotential(ctx, snapshot, player, r, c) { if (isOutOfTime(ctx)) return 0; const horizontal = 1 + countDirection(ctx, snapshot, player, r, c, 0, -1) + countDirection(ctx, snapshot, player, r, c, 0, 1); const vertical = 1 + countDirection(ctx, snapshot, player, r, c, -1, 0) + countDirection(ctx, snapshot, player, r, c, 1, 0); return Math.max(horizontal, vertical); }
function measureBlockingValue(ctx, snapshot, player, r, c) { if (isOutOfTime(ctx)) return 0; let best = 0; for (let pid = 1; pid <= 4; pid++) { if (isOutOfTime(ctx)) break; if (pid === player || snapshot.roles[pid] === 'none' || snapshot.player_lost[pid]) continue; const horizontal = 1 + countDirection(ctx, snapshot, pid, r, c, 0, -1) + countDirection(ctx, snapshot, pid, r, c, 0, 1); const vertical = 1 + countDirection(ctx, snapshot, pid, r, c, -1, 0) + countDirection(ctx, snapshot, pid, r, c, 1, 0); best = Math.max(best, horizontal, vertical); } return best; }
function countImmediateEnemyWeaponThreats(ctx, snapshot, player) { let total = 0; for (let pid = 1; pid <= 4; pid++) { if (isOutOfTime(ctx)) break; if (pid === player || snapshot.roles[pid] === 'none' || snapshot.player_lost[pid]) continue; if (getLinePower(ctx, snapshot, pid) >= snapshot.weapon_req - 1) total++; } return total; }
function countReadyShotTargets(ctx, snapshot, player) { if (isOutOfTime(ctx)) return 0; if (getLinePower(ctx, snapshot, player) < snapshot.weapon_req) return 0; return getEnemyStations(ctx, snapshot, player).length; }
function isTacticalPosition(ctx, snapshot, player) { return getLinePower(ctx, snapshot, player) >= snapshot.weapon_req || countImmediateEnemyWeaponThreats(ctx, snapshot, player) > 0; }
function isWeaponCell(ctx, snapshot, player, r, c) { if (isOutOfTime(ctx)) return false; return getWeaponCellsForPlayer(ctx, snapshot, player).some(function (pos) { return pos[0] === r && pos[1] === c; }); }
function isCriticalOwnBridge(ctx, snapshot, player, r, c) { if (isOutOfTime(ctx)) return false; const horizontal = countDirection(ctx, snapshot, player, r, c, 0, -1) + countDirection(ctx, snapshot, player, r, c, 0, 1); const vertical = countDirection(ctx, snapshot, player, r, c, -1, 0) + countDirection(ctx, snapshot, player, r, c, 1, 0); return horizontal >= 2 || vertical >= 2; }
function countDirection(ctx, snapshot, player, r, c, dr, dc) { if (isOutOfTime(ctx)) return 0; let total = 0; let nr = r + dr; let nc = c + dc; while (!isOutOfTime(ctx) && nr >= 0 && nr < snapshot.height && nc >= 0 && nc < snapshot.width && snapshot.grid[nr][nc] === snapshot.players[player].st) { total++; nr += dr; nc += dc; } return total; }
function computeSimpleMove(snapshot) {
  const player = snapshot.turn;
  const unlimited = { deadline: Number.MAX_SAFE_INTEGER, timedOut: false };
  const power = getLinePower(unlimited, snapshot, player);
  if (power >= snapshot.weapon_req) {
    const weaponCells = getWeaponCellsForPlayer(unlimited, snapshot, player);
    if (weaponCells.length > 0) {
      for (let r = 0; r < snapshot.height; r++) {
        for (let c = 0; c < snapshot.width; c++) {
          const owner = getOwnerOfStation(unlimited, snapshot, snapshot.grid[r][c]);
          if (owner !== null && owner !== player) {
            const sacrifice = weaponCells[0];
            return { type: 'L', tr: r, tc: c, sr: sacrifice[0], sc: sacrifice[1] };
          }
        }
      }
    }
  }
  const candidates = [];
  const center = [(snapshot.height - 1) / 2, (snapshot.width - 1) / 2];
  for (let r = 0; r < snapshot.height; r++) {
    for (let c = 0; c < snapshot.width; c++) {
      if (!canBuild(snapshot, r, c, player)) continue;
      const freedom = countOpenNeighbors(unlimited, snapshot, r, c);
      const dist = Math.sqrt(Math.pow(r - center[0], 2) + Math.pow(c - center[1], 2));
      candidates.push({ r: r, c: c, freedom: freedom, dist: dist });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort(function (a, b) {
    if (a.freedom !== b.freedom) return b.freedom - a.freedom;
    return a.dist - b.dist;
  });
  const choice = candidates[0];
  let type = 'S';
  if (choice.freedom === 0) {
    type = power < snapshot.weapon_req ? 'S' : 'M';
  }
  return { type: type, r: choice.r, c: choice.c };
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

function roleToDifficulty(role: AITurnRole): 'simple' | 'warrior' {
    return role === 'warrior_ai' ? 'warrior' : 'simple';
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
    if (Platform.OS === 'web' || runtimeInitFailed) {
        return null;
    }

    if (!runtime) {
        try {
            runtime = createWorkletRuntime({ name: 'ai-runtime' });
        } catch {
            runtimeInitFailed = true;
            return null;
        }
    }

    return runtime;
}

function getWebWarriorWorker(): any | null {
    if (Platform.OS !== 'web' || typeof Worker === 'undefined' || typeof window === 'undefined') {
        return null;
    }

    if (!webWarriorWorker) {
        const blob = new Blob([WEB_WARRIOR_WORKER_SOURCE], { type: 'text/javascript' });
        webWarriorWorkerUrl = URL.createObjectURL(blob);
        webWarriorWorker = new Worker(webWarriorWorkerUrl);
        webWarriorWorker.onmessage = (event: any) => {
            const data = event.data;
            if (!data || data.type !== 'compute-warrior-ai-result') return;
            deliverResult(data.requestId, data.result as AIThinkResult);
        };
        webWarriorWorker.onerror = () => {
            webWarriorWorker?.terminate();
            webWarriorWorker = null;
        };
    }

    return webWarriorWorker;
}

function restartWebWarriorWorker() {
    if (webWarriorWorker) {
        webWarriorWorker.terminate();
        webWarriorWorker = null;
    }
    if (webWarriorWorkerUrl && typeof URL !== 'undefined') {
        URL.revokeObjectURL(webWarriorWorkerUrl);
        webWarriorWorkerUrl = null;
    }
}

function createGameFromSnapshot(snapshot: GameSnapshot): MarsMinersGame {
    const game = {
        width: snapshot.width,
        height: snapshot.height,
        grid: snapshot.grid.map(row => [...row]),
        roles: { ...snapshot.roles },
        weapon_req: snapshot.weapon_req,
        player_lost: { ...snapshot.player_lost },
        turn: snapshot.turn,
        game_over: snapshot.game_over,
        battleLog: [...snapshot.battleLog],
        playerIds: { ...snapshot.playerIds },
        players: {
            1: { ...snapshot.players[1] },
            2: { ...snapshot.players[2] },
            3: { ...snapshot.players[3] },
            4: { ...snapshot.players[4] },
        },
    } as unknown as MarsMinersGame;

    game.getLinePower = ((player: PlayerId) => {
        const st = game.players[player].st;
        let max = 0;
        for (let r = 0; r < game.height; r++) {
            let cur = 0;
            for (let c = 0; c < game.width; c++) {
                cur = game.grid[r][c] === st ? cur + 1 : 0;
                if (cur > max) max = cur;
            }
        }
        for (let c = 0; c < game.width; c++) {
            let cur = 0;
            for (let r = 0; r < game.height; r++) {
                cur = game.grid[r][c] === st ? cur + 1 : 0;
                if (cur > max) max = cur;
            }
        }
        return max;
    }) as MarsMinersGame['getLinePower'];

    game.canBuild = ((r: number, c: number, p: PlayerId) => {
        if (!(r >= 0 && r < game.height && c >= 0 && c < game.width)) return false;
        if (game.grid[r][c] !== '.') return false;
        const targetStation = game.players[p].st;
        const adj = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of adj) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < game.height && nc >= 0 && nc < game.width && game.grid[nr][nc] === targetStation) {
                return true;
            }
        }
        return false;
    }) as MarsMinersGame['canBuild'];

    game.getWeaponCells = (() => {
        const weaponCells = new Set<string>();
        for (let p = 1; p <= 4; p++) {
            const pid = p as PlayerId;
            if (game.roles[pid] === 'none') continue;
            const st = game.players[pid].st;
            for (let r = 0; r < game.height; r++) {
                let line: [number, number][] = [];
                for (let c = 0; c < game.width; c++) {
                    if (game.grid[r][c] === st) {
                        line.push([r, c]);
                    } else {
                        if (line.length >= game.weapon_req) line.forEach(pos => weaponCells.add(pos.toString()));
                        line = [];
                    }
                }
                if (line.length >= game.weapon_req) line.forEach(pos => weaponCells.add(pos.toString()));
            }
            for (let c = 0; c < game.width; c++) {
                let line: [number, number][] = [];
                for (let r = 0; r < game.height; r++) {
                    if (game.grid[r][c] === st) {
                        line.push([r, c]);
                    } else {
                        if (line.length >= game.weapon_req) line.forEach(pos => weaponCells.add(pos.toString()));
                        line = [];
                    }
                }
                if (line.length >= game.weapon_req) line.forEach(pos => weaponCells.add(pos.toString()));
            }
        }
        return weaponCells;
    }) as MarsMinersGame['getWeaponCells'];

    game.getScores = (() => {
        const scores: Partial<Record<PlayerId, number>> = {};
        for (let p = 1; p <= 4; p++) {
            const pid = p as PlayerId;
            if (game.roles[pid] === 'none') continue;
            let total = 0;
            for (const row of game.grid) {
                for (const cell of row) {
                    if (cell === game.players[pid].mi) total++;
                }
            }
            scores[pid] = total;
        }
        return scores as Record<PlayerId, number>;
    }) as MarsMinersGame['getScores'];

    return game;
}

function computeMove(snapshot: GameSnapshot, role: AITurnRole, maxThinkTimeMs: number): AIThinkResult {
    const game = createGameFromSnapshot(snapshot);
    const result = createAIPlayer(roleToDifficulty(role)).getMove(game, { maxThinkTimeMs });
    if (role === 'warrior_ai' && result.finishedBy === 'timeout') {
        const fallback = createAIPlayer('simple').getMove(game, { maxThinkTimeMs: 1 });
        return { move: fallback.move, finishedBy: 'timeout' };
    }
    return result;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void, fallbackValue: T): Promise<T> {
    return new Promise<T>((resolve) => {
        const timer = setTimeout(() => {
            onTimeout();
            resolve(fallbackValue);
        }, timeoutMs);

        promise
            .then(value => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch(error => {
                clearTimeout(timer);
                console.error('AI background execution failed', error);
                resolve(fallbackValue);
            });
    });
}

export async function computeAIMoveInBackground(
    game: MarsMinersGame,
    role: AITurnRole,
    maxThinkTimeMs: number
): Promise<AIThinkResult> {
    const snapshot = makeSnapshot(game);
    const serviceTimeoutMs = Math.max(1, maxThinkTimeMs);

    if (Platform.OS === 'web' && role === 'warrior_ai') {
        const worker = getWebWarriorWorker();
        if (worker) {
            const requestId = nextRequestId++;
            return withTimeout(
                new Promise<AIThinkResult>((resolve) => {
                    pending.set(requestId, { resolve });
                    worker.postMessage({
                        type: 'compute-warrior-ai',
                        requestId,
                        snapshot,
                        maxThinkTimeMs,
                    });
                }),
                serviceTimeoutMs,
                () => {
                    pending.delete(requestId);
                    restartWebWarriorWorker();
                },
                { move: null, finishedBy: 'timeout' }
            );
        }

        return { move: null, finishedBy: 'timeout' };
    }

    const workerRuntime = getRuntime();

    if (!workerRuntime) {
        return withTimeout(
            Promise.resolve().then(() => computeMove(snapshot, role, maxThinkTimeMs)),
            serviceTimeoutMs,
            () => { },
            { move: null, finishedBy: 'timeout' }
        );
    }

    const requestId = nextRequestId++;

    return withTimeout(
        new Promise<AIThinkResult>((resolve) => {
            pending.set(requestId, { resolve });

            try {
                runOnRuntime(
                    workerRuntime,
                    (
                        currentRequestId: number,
                        currentSnapshot: GameSnapshot,
                        currentRole: AITurnRole,
                        currentMaxThinkTimeMs: number
                    ) => {
                        'worklet';
                        try {
                            const move = computeMove(currentSnapshot, currentRole, currentMaxThinkTimeMs);
                            runOnJS(deliverResult)(currentRequestId, move);
                        } catch (error) {
                            const message = error instanceof Error ? error.message : 'AI worker failed';
                            runOnJS(deliverError)(currentRequestId, message);
                        }
                    }
                )(requestId, snapshot, role, maxThinkTimeMs);
            } catch (error) {
                pending.delete(requestId);
                resolve(computeMove(snapshot, role, maxThinkTimeMs));
            }
        }),
        serviceTimeoutMs,
        () => {
            pending.delete(requestId);
        },
        { move: null, finishedBy: 'timeout' }
    );
}

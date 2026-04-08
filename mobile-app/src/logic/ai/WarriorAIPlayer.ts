import { MarsMinersGame, type AIMove, type PlayerId, type PlayerRole } from '../MarsMinersGame';
import type { AIPlayer, AIThinkOptions, AIThinkResult } from './AIPlayer';

type ScoredMove = {
    move: AIMove;
    score: number;
};

const PLAYER_IDS: PlayerId[] = [1, 2, 3, 4];

export class WarriorAIPlayer implements AIPlayer {
    private readonly maxDepth: number;
    private searchDeadline = 0;
    private timedOut = false;

    constructor(maxDepth = 3) {
        this.maxDepth = maxDepth;
    }

    getMove(game: MarsMinersGame, options?: AIThinkOptions): AIThinkResult {
        const player = game.turn;
        const moves = this.generateOrderedMoves(game, player);
        this.searchDeadline = Date.now() + (options?.maxThinkTimeMs ?? 5000);
        this.timedOut = false;

        if (moves.length === 0) {
            return { move: null, finishedBy: 'completed' };
        }

        let bestMove = moves[0].move;
        let bestScore = Number.NEGATIVE_INFINITY;
        let alpha = Number.NEGATIVE_INFINITY;
        const beta = Number.POSITIVE_INFINITY;

        for (const candidate of moves) {
            if (this.isOutOfTime()) {
                break;
            }
            const nextGame = this.applyMove(game, candidate.move);
            const score = -this.negamax(nextGame, this.maxDepth - 1, -beta, -alpha, player);
            if (score > bestScore) {
                bestScore = score;
                bestMove = candidate.move;
            }
            alpha = Math.max(alpha, score);
        }

        return { move: bestMove, finishedBy: this.timedOut ? 'timeout' : 'completed' };
    }

    private negamax(game: MarsMinersGame, depth: number, alpha: number, beta: number, rootPlayer: PlayerId): number {
        if (this.isOutOfTime()) {
            return this.evaluatePosition(game, rootPlayer);
        }

        if (game.game_over) {
            return this.evaluatePosition(game, rootPlayer);
        }

        if (depth <= 0) {
            if (this.isTacticalPosition(game, game.turn)) {
                depth = 1;
            } else {
                return this.evaluatePosition(game, rootPlayer);
            }
        }

        const current = game.turn;
        const moves = this.generateOrderedMoves(game, current);

        if (moves.length === 0) {
            return this.evaluatePosition(game, rootPlayer);
        }

        let best = Number.NEGATIVE_INFINITY;
        let localAlpha = alpha;

        for (const candidate of moves) {
            if (this.isOutOfTime()) {
                break;
            }
            const nextGame = this.applyMove(game, candidate.move);
            const score = -this.negamax(nextGame, depth - 1, -beta, -localAlpha, rootPlayer);
            best = Math.max(best, score);
            localAlpha = Math.max(localAlpha, score);
            if (localAlpha >= beta) {
                break;
            }
        }

        return best;
    }

    private isOutOfTime(): boolean {
        const outOfTime = Date.now() >= this.searchDeadline;
        if (outOfTime) {
            this.timedOut = true;
        }
        return outOfTime;
    }

    private evaluatePosition(game: MarsMinersGame, rootPlayer: PlayerId): number {
        if (game.game_over) {
            return this.evaluateTerminal(game, rootPlayer);
        }

        let total = 0;
        for (const pid of PLAYER_IDS) {
            if (game.roles[pid] === 'none') continue;

            const sign = pid === rootPlayer ? 1 : -0.65;
            total += sign * this.evaluatePlayerState(game, pid);
        }

        if (game.turn === rootPlayer) {
            total += 15;
        }

        return total;
    }

    private evaluateTerminal(game: MarsMinersGame, rootPlayer: PlayerId): number {
        const scores = game.getScores();
        let bestScore = Number.NEGATIVE_INFINITY;
        let winners: PlayerId[] = [];

        for (const pid of PLAYER_IDS) {
            if (game.roles[pid] === 'none') continue;
            const score = scores[pid] || 0;
            if (score > bestScore) {
                bestScore = score;
                winners = [pid];
            } else if (score === bestScore) {
                winners.push(pid);
            }
        }

        if (winners.includes(rootPlayer)) {
            return winners.length === 1 ? 100000 : 10000;
        }

        return -100000;
    }

    private evaluatePlayerState(game: MarsMinersGame, player: PlayerId): number {
        if (game.player_lost[player]) {
            return -50000;
        }

        const mineCount = this.countCells(game, player, 'mi');
        const stationCount = this.countCells(game, player, 'st');
        const linePower = game.getLinePower(player);
        const mobility = this.countBuildMoves(game, player);
        const weaponCells = this.getWeaponCellsForPlayer(game, player).length;
        const attackTargets = this.countEnemyStations(game, player);
        const centerControl = this.computeCenterControl(game, player);
        const frontierQuality = this.computeFrontierQuality(game, player);
        const imminentThreat = this.countImmediateEnemyWeaponThreats(game, player);
        const readyTargets = this.countReadyShotTargets(game, player);

        let score = 0;
        score += mineCount * 160;
        score += stationCount * 28;
        score += mobility * 18;
        score += centerControl * 10;
        score += weaponCells * 18;
        score += frontierQuality * 16;
        score += Math.min(linePower, game.weapon_req) * 35;

        if (linePower >= game.weapon_req) {
            score += 260 + attackTargets * 30 + readyTargets * 40;
        } else {
            score += linePower * 12;
        }

        if (mobility === 0 && linePower < game.weapon_req) {
            score -= 400;
        }

        if (linePower === game.weapon_req - 1) {
            score += 110;
        }

        score -= imminentThreat * 120;

        return score;
    }

    private generateOrderedMoves(game: MarsMinersGame, player: PlayerId): ScoredMove[] {
        const moves = this.generateMoves(game, player);
        return moves
            .map(move => ({ move, score: this.scoreMove(game, player, move) }))
            .sort((a, b) => b.score - a.score);
    }

    private generateMoves(game: MarsMinersGame, player: PlayerId): AIMove[] {
        if (game.player_lost[player] || game.roles[player] === 'none') {
            return [];
        }

        const moves: AIMove[] = [];
        const buildCandidates: Array<{ move: AIMove; score: number }> = [];
        const center: [number, number] = [(game.height - 1) / 2, (game.width - 1) / 2];
        const mobility = this.countBuildMoves(game, player);
        const linePower = game.getLinePower(player);

        for (let r = 0; r < game.height; r++) {
            for (let c = 0; c < game.width; c++) {
                if (!game.canBuild(r, c, player)) continue;

                const openNeighbors = this.countOpenNeighbors(game, r, c);
                const powerGain = this.measureLinePotential(game, player, r, c);
                const blockScore = this.measureBlockingValue(game, player, r, c);
                const enemyAdjacency = this.countAdjacentEnemyStations(game, player, r, c);
                const ownAdjacency = this.countAdjacentOwnStations(game, player, r, c);

                const dist = Math.abs(r - center[0]) + Math.abs(c - center[1]);
                buildCandidates.push({
                    move: { type: 'S', r, c },
                    score: 40 + openNeighbors * 22 + powerGain * 34 + blockScore * 28 + ownAdjacency * 10 + enemyAdjacency * 8 - dist * 4
                });

                const shouldConsiderMine =
                    openNeighbors <= 1 ||
                    (mobility >= 8 && ownAdjacency >= 2) ||
                    linePower >= game.weapon_req;

                if (shouldConsiderMine) {
                    const mineScore =
                        18 +
                        Math.max(0, 2 - openNeighbors) * 35 +
                        (linePower >= game.weapon_req ? 45 : 0) +
                        (mobility >= 8 ? 20 : 0) -
                        powerGain * 18 -
                        dist * 2;
                    buildCandidates.push({ move: { type: 'M', r, c }, score: mineScore });
                }
            }
        }

        buildCandidates.sort((a, b) => b.score - a.score);
        for (const candidate of buildCandidates.slice(0, 10)) {
            moves.push(candidate.move);
        }

        if (linePower >= game.weapon_req) {
            const weaponCells = this.getWeaponCellsForPlayer(game, player);
            const enemyTargets = this.getEnemyStations(game, player);
            const targetLimit = Math.min(5, enemyTargets.length);
            const sacrificeLimit = Math.min(3, weaponCells.length);

            for (const [tr, tc] of enemyTargets.slice(0, targetLimit)) {
                for (const [sr, sc] of weaponCells.slice(0, sacrificeLimit)) {
                    moves.push({ type: 'L', tr, tc, sr, sc });
                }
            }
        }

        return moves;
    }

    private scoreMove(game: MarsMinersGame, player: PlayerId, move: AIMove): number {
        if (move.type === 'L') {
            return this.scoreLaserMove(game, player, move);
        }

        const centerDist = Math.abs(move.r - (game.height - 1) / 2) + Math.abs(move.c - (game.width - 1) / 2);
        const openNeighbors = this.countOpenNeighbors(game, move.r, move.c);
        const mobility = this.countBuildMoves(game, player);
        const linePower = game.getLinePower(player);
        const blockScore = this.measureBlockingValue(game, player, move.r, move.c);
        const ownAdjacency = this.countAdjacentOwnStations(game, player, move.r, move.c);
        const enemyAdjacency = this.countAdjacentEnemyStations(game, player, move.r, move.c);

        if (move.type === 'M') {
            let score = 70 - centerDist * 2;
            score += Math.max(0, 2 - openNeighbors) * 60;
            score -= openNeighbors * 35;
            score -= blockScore * 24;
            if (mobility < 6) score -= 140;
            if (linePower < game.weapon_req) score -= 40;
            return score;
        }

        const powerBoost = this.measureLinePotential(game, player, move.r, move.c);
        return 240 + powerBoost * 42 + openNeighbors * 22 + blockScore * 26 + ownAdjacency * 10 + enemyAdjacency * 8 - centerDist * 5;
    }

    private applyMove(game: MarsMinersGame, move: AIMove): MarsMinersGame {
        const nextGame = this.cloneGame(game);
        if (move.type === 'S') {
            nextGame.addCommand(`S ${move.c} ${move.r}`);
        } else if (move.type === 'M') {
            nextGame.addCommand(`M ${move.c} ${move.r}`);
        } else {
            nextGame.addCommand(`L ${move.tc} ${move.tr} ${move.sc} ${move.sr}`);
        }
        return nextGame;
    }

    private cloneGame(game: MarsMinersGame): MarsMinersGame {
        const emptyRoles: Record<PlayerId, PlayerRole> = { 1: 'none', 2: 'none', 3: 'none', 4: 'none' };
        const clone = new MarsMinersGame(emptyRoles, game.weapon_req);
        clone.replayLog(game.battleLog);
        return clone;
    }

    private countBuildMoves(game: MarsMinersGame, player: PlayerId): number {
        let total = 0;
        for (let r = 0; r < game.height; r++) {
            for (let c = 0; c < game.width; c++) {
                if (game.canBuild(r, c, player)) {
                    total++;
                }
            }
        }
        return total;
    }

    private countOpenNeighbors(game: MarsMinersGame, r: number, c: number): number {
        let total = 0;
        const adj = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of adj) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < game.height && nc >= 0 && nc < game.width && game.grid[nr][nc] === '.') {
                total++;
            }
        }
        return total;
    }

    private countAdjacentOwnStations(game: MarsMinersGame, player: PlayerId, r: number, c: number): number {
        let total = 0;
        const adj = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of adj) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < game.height && nc >= 0 && nc < game.width && game.grid[nr][nc] === game.players[player].st) {
                total++;
            }
        }
        return total;
    }

    private countAdjacentEnemyStations(game: MarsMinersGame, player: PlayerId, r: number, c: number): number {
        let total = 0;
        const adj = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of adj) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr < 0 || nr >= game.height || nc < 0 || nc >= game.width) continue;
            const owner = this.getOwnerOfStation(game, game.grid[nr][nc]);
            if (owner !== null && owner !== player) {
                total++;
            }
        }
        return total;
    }

    private countCells(game: MarsMinersGame, player: PlayerId, type: 'st' | 'mi'): number {
        const symbol = game.players[player][type];
        let total = 0;
        for (const row of game.grid) {
            for (const cell of row) {
                if (cell === symbol) total++;
            }
        }
        return total;
    }

    private getWeaponCellsForPlayer(game: MarsMinersGame, player: PlayerId): [number, number][] {
        return Array.from(game.getWeaponCells())
            .map(s => s.split(',').map(Number) as [number, number])
            .filter(([r, c]) => game.grid[r][c] === game.players[player].st);
    }

    private getEnemyStations(game: MarsMinersGame, player: PlayerId): [number, number][] {
        const targets: Array<{ pos: [number, number]; danger: number }> = [];

        for (let r = 0; r < game.height; r++) {
            for (let c = 0; c < game.width; c++) {
                const owner = this.getOwnerOfStation(game, game.grid[r][c]);
                if (owner === null || owner === player) continue;
                const danger = this.countCells(game, owner, 'mi') * 3 + game.getLinePower(owner) * 8 + this.computeCenterBias(game, r, c);
                targets.push({ pos: [r, c], danger });
            }
        }

        targets.sort((a, b) => b.danger - a.danger);
        return targets.map(target => target.pos);
    }

    private countEnemyStations(game: MarsMinersGame, player: PlayerId): number {
        let total = 0;
        for (let r = 0; r < game.height; r++) {
            for (let c = 0; c < game.width; c++) {
                const owner = this.getOwnerOfStation(game, game.grid[r][c]);
                if (owner !== null && owner !== player) {
                    total++;
                }
            }
        }
        return total;
    }

    private getOwnerOfStation(game: MarsMinersGame, cell: string): PlayerId | null {
        for (const pid of PLAYER_IDS) {
            if (cell === game.players[pid].st) {
                return pid;
            }
        }
        return null;
    }

    private computeCenterControl(game: MarsMinersGame, player: PlayerId): number {
        let control = 0;
        for (let r = 0; r < game.height; r++) {
            for (let c = 0; c < game.width; c++) {
                const cell = game.grid[r][c];
                if (cell !== game.players[player].st && cell !== game.players[player].mi) continue;
                control += this.computeCenterBias(game, r, c);
            }
        }
        return control;
    }

    private computeFrontierQuality(game: MarsMinersGame, player: PlayerId): number {
        let total = 0;
        for (let r = 0; r < game.height; r++) {
            for (let c = 0; c < game.width; c++) {
                if (game.grid[r][c] !== game.players[player].st) continue;
                total += this.countOpenNeighbors(game, r, c);
            }
        }
        return total;
    }

    private computeCenterBias(game: MarsMinersGame, r: number, c: number): number {
        const centerR = (game.height - 1) / 2;
        const centerC = (game.width - 1) / 2;
        return Math.max(0, 6 - (Math.abs(r - centerR) + Math.abs(c - centerC)));
    }

    private measureLinePotential(game: MarsMinersGame, player: PlayerId, r: number, c: number): number {
        const horizontal = 1 + this.countDirection(game, player, r, c, 0, -1) + this.countDirection(game, player, r, c, 0, 1);
        const vertical = 1 + this.countDirection(game, player, r, c, -1, 0) + this.countDirection(game, player, r, c, 1, 0);
        return Math.max(horizontal, vertical);
    }

    private measureBlockingValue(game: MarsMinersGame, player: PlayerId, r: number, c: number): number {
        let best = 0;
        for (const pid of PLAYER_IDS) {
            if (pid === player || game.roles[pid] === 'none' || game.player_lost[pid]) continue;
            const horizontal = 1 + this.countDirection(game, pid, r, c, 0, -1) + this.countDirection(game, pid, r, c, 0, 1);
            const vertical = 1 + this.countDirection(game, pid, r, c, -1, 0) + this.countDirection(game, pid, r, c, 1, 0);
            best = Math.max(best, horizontal, vertical);
        }
        return best;
    }

    private scoreLaserMove(game: MarsMinersGame, player: PlayerId, move: Extract<AIMove, { type: 'L' }>): number {
        const targetCell = game.grid[move.tr][move.tc];
        const targetPlayer = this.getOwnerOfStation(game, targetCell);
        let score = 760;

        if (targetPlayer !== null) {
            const targetLinePower = game.getLinePower(targetPlayer);
            score += this.countCells(game, targetPlayer, 'st') * 14;
            score += this.countCells(game, targetPlayer, 'mi') * 24;
            score += targetLinePower * 60;
            if (targetLinePower >= game.weapon_req) {
                score += 220;
            }
            if (this.isWeaponCell(game, targetPlayer, move.tr, move.tc)) {
                score += 140;
            }
        }

        if (this.isWeaponCell(game, player, move.sr, move.sc)) {
            score -= 40;
        }

        const remainingFrontier = this.countOpenNeighbors(game, move.sr, move.sc);
        score -= remainingFrontier * 20;
        score -= this.isCriticalOwnBridge(game, player, move.sr, move.sc) ? 180 : 0;

        return score;
    }

    private countImmediateEnemyWeaponThreats(game: MarsMinersGame, player: PlayerId): number {
        let total = 0;
        for (const pid of PLAYER_IDS) {
            if (pid === player || game.roles[pid] === 'none' || game.player_lost[pid]) continue;
            if (game.getLinePower(pid) >= game.weapon_req - 1) {
                total++;
            }
        }
        return total;
    }

    private countReadyShotTargets(game: MarsMinersGame, player: PlayerId): number {
        if (game.getLinePower(player) < game.weapon_req) return 0;
        return this.getEnemyStations(game, player).length;
    }

    private isTacticalPosition(game: MarsMinersGame, player: PlayerId): boolean {
        return game.getLinePower(player) >= game.weapon_req || this.countImmediateEnemyWeaponThreats(game, player) > 0;
    }

    private isWeaponCell(game: MarsMinersGame, player: PlayerId, r: number, c: number): boolean {
        return this.getWeaponCellsForPlayer(game, player).some(([wr, wc]) => wr === r && wc === c);
    }

    private isCriticalOwnBridge(game: MarsMinersGame, player: PlayerId, r: number, c: number): boolean {
        const horizontal = this.countDirection(game, player, r, c, 0, -1) + this.countDirection(game, player, r, c, 0, 1);
        const vertical = this.countDirection(game, player, r, c, -1, 0) + this.countDirection(game, player, r, c, 1, 0);
        return horizontal >= 2 || vertical >= 2;
    }

    private countDirection(game: MarsMinersGame, player: PlayerId, r: number, c: number, dr: number, dc: number): number {
        let total = 0;
        let nr = r + dr;
        let nc = c + dc;
        while (nr >= 0 && nr < game.height && nc >= 0 && nc < game.width && game.grid[nr][nc] === game.players[player].st) {
            total++;
            nr += dr;
            nc += dc;
        }
        return total;
    }
}

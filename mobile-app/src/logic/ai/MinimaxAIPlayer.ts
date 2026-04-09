import { MarsMinersGame, type AIMove, type PlayerId } from '../MarsMinersGame';
import type { AIPlayer, AIThinkOptions, AIThinkResult } from './AIPlayer';

type ScoredMove = {
    move: AIMove;
    score: number;
};

const PLAYER_IDS: PlayerId[] = [1, 2, 3, 4];

export class MinimaxAIPlayer implements AIPlayer {
    private readonly maxDepth: number;
    private searchDeadline = 0;
    private timedOut = false;

    constructor(maxDepth = 3) {
        this.maxDepth = maxDepth;
    }

    private isOutOfTime(): boolean {
        if (Date.now() >= this.searchDeadline) {
            this.timedOut = true;
            return true;
        }
        return false;
    }

    getMove(game: MarsMinersGame, options?: AIThinkOptions): AIThinkResult {
        const player = game.turn;
        this.searchDeadline = Date.now() + (options?.maxThinkTimeMs ?? 5000);
        this.timedOut = false;

        const moves = this.generateOrderedMoves(game, player);

        if (moves.length === 0) {
            return { move: null, finishedBy: this.timedOut ? 'timeout' : 'completed' };
        }

        let bestMove = moves[0].move;
        let bestScore = Number.NEGATIVE_INFINITY;
        let alpha = Number.NEGATIVE_INFINITY;
        const beta = Number.POSITIVE_INFINITY;

        for (const candidate of moves) {
            if (this.isOutOfTime()) break;

            const nextGame = this.applyMove(game, candidate.move);
            const score = -this.negamax(nextGame, this.maxDepth - 1, -beta, -alpha, player);
            
            if (score > bestScore) {
                bestScore = score;
                bestMove = candidate.move;
            }
            alpha = Math.max(alpha, score);
        }

        return { 
            move: bestMove, 
            finishedBy: this.timedOut ? 'timeout' : 'completed' 
        };
    }

    private negamax(game: MarsMinersGame, depth: number, alpha: number, beta: number, rootPlayer: PlayerId): number {
        if (this.isOutOfTime() || game.game_over || depth <= 0) {
            return this.evaluatePosition(game, rootPlayer);
        }

        const current = game.turn;
        const moves = this.generateOrderedMoves(game, current);

        if (moves.length === 0) {
            return this.evaluatePosition(game, rootPlayer);
        }

        let best = Number.NEGATIVE_INFINITY;
        let localAlpha = alpha;

        for (const candidate of moves) {
            if (this.isOutOfTime()) break;

            const nextGame = this.applyMove(game, candidate.move);
            const score = -this.negamax(nextGame, depth - 1, -beta, -localAlpha, rootPlayer);
            best = Math.max(best, score);
            localAlpha = Math.max(localAlpha, score);
            if (localAlpha >= beta) break;
        }

        return best;
    }

    private evaluatePosition(game: MarsMinersGame, rootPlayer: PlayerId): number {
        if (game.game_over) {
            const scores = game.getScores();
            let bestScore = -1;
            let winners: PlayerId[] = [];
            for (const pid of PLAYER_IDS) {
                if (game.roles[pid] === 'none') continue;
                const s = scores[pid] || 0;
                if (s > bestScore) { bestScore = s; winners = [pid]; }
                else if (s === bestScore) winners.push(pid);
            }
            if (winners.includes(rootPlayer)) return winners.length === 1 ? 10000 : 1000;
            return -10000;
        }

        let total = 0;
        for (const pid of PLAYER_IDS) {
            if (game.roles[pid] === 'none') continue;
            const score = this.evaluatePlayerState(game, pid);
            total += (pid === rootPlayer ? 1 : -0.5) * score;
        }
        return total;
    }

    private evaluatePlayerState(game: MarsMinersGame, player: PlayerId): number {
        if (game.player_lost[player]) return -5000;

        let score = 0;
        const stSymbol = game.players[player].st;
        const miSymbol = game.players[player].mi;

        for (let r = 0; r < game.height; r++) {
            for (let c = 0; c < game.width; c++) {
                const cell = game.grid[r][c];
                if (cell === stSymbol) {
                    score += 10;
                    // Center preference
                    const distToCenter = Math.abs(r - (game.height - 1) / 2) + Math.abs(c - (game.width - 1) / 2);
                    score += (6 - distToCenter);
                } else if (cell === miSymbol) {
                    score += 50;
                }
            }
        }

        const power = game.getLinePower(player);
        score += power * 20;
        if (power >= game.weapon_req) score += 100;

        return score;
    }

    private generateOrderedMoves(game: MarsMinersGame, player: PlayerId): ScoredMove[] {
        const moves: AIMove[] = [];
        const center = [(game.height - 1) / 2, (game.width - 1) / 2];

        for (let r = 0; r < game.height; r++) {
            if (this.isOutOfTime()) break;
            for (let c = 0; c < game.width; c++) {
                if (this.isOutOfTime()) break;
                if (!game.canBuild(r, c, player)) continue;

                moves.push({ type: 'S', r, c });

                // Only consider mines if we have some space or it looks trapped
                const adj = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                let free = 0;
                for (const [dr, dc] of adj) {
                    const nr = r + dr, nc = c + dc;
                    if (nr >= 0 && nr < game.height && nc >= 0 && nc < game.width && game.grid[nr][nc] === '.') free++;
                }
                if (free <= 1 || Math.random() < 0.2) {
                    moves.push({ type: 'M', r, c });
                }
            }
        }

        // Weapons
        const power = game.getLinePower(player);
        if (power >= game.weapon_req) {
            const weapons = Array.from(game.getWeaponCells())
                .map(s => s.split(',').map(Number) as [number, number])
                .filter(([r, c]) => game.grid[r][c] === game.players[player].st);
            
            if (weapons.length > 0) {
                for (let r = 0; r < game.height; r++) {
                    if (this.isOutOfTime()) break;
                    for (let c = 0; c < game.width; c++) {
                        const cell = game.grid[r][c];
                        let isEnemy = false;
                        for (let pid = 1; pid <= 4; pid++) {
                            const id = pid as PlayerId;
                            if (id !== player && cell === game.players[id].st) {
                                isEnemy = true;
                                break;
                            }
                        }
                        if (isEnemy) {
                            const sacrifice = weapons[Math.floor(Math.random() * weapons.length)];
                            moves.push({ type: 'L', tr: r, tc: c, sr: sacrifice[0], sc: sacrifice[1] });
                        }
                    }
                }
            }
        }

        return moves.map(move => ({
            move,
            score: this.basicScore(game, player, move, center)
        })).sort((a, b) => b.score - a.score).slice(0, 15); // Prune to top 15 candidates
    }

    private basicScore(game: MarsMinersGame, player: PlayerId, move: AIMove, center: number[]): number {
        if (move.type === 'L') return 1000;
        const dist = Math.abs(move.r - center[0]) + Math.abs(move.c - center[1]);
        let base = 100 - dist * 5;
        if (move.type === 'M') base += 20;
        return base;
    }

    private applyMove(game: MarsMinersGame, move: AIMove): MarsMinersGame {
        const next = this.cloneGame(game);
        if (move.type === 'S') next.addCommand(`S ${move.c} ${move.r}`);
        else if (move.type === 'M') next.addCommand(`M ${move.c} ${move.r}`);
        else next.addCommand(`L ${move.tc} ${move.tr} ${move.sc} ${move.sr}`);
        return next;
    }

    private cloneGame(game: MarsMinersGame): MarsMinersGame {
        const clone = new MarsMinersGame({ ...game.roles }, game.weapon_req);
        clone.replayLog(game.battleLog);
        return clone;
    }
}

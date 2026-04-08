import type { AIMove, MarsMinersGame, PlayerId } from '../MarsMinersGame';
import type { AIPlayer, AIThinkOptions, AIThinkResult } from './AIPlayer';

interface Candidate {
    pos: [number, number];
    freedom: number;
    dist: number;
}

export class SimpleAIPlayer implements AIPlayer {
    getMove(game: MarsMinersGame, _options?: AIThinkOptions): AIThinkResult {
        const p = game.turn;
        const power = game.getLinePower(p);

        if (power >= game.weapon_req) {
            const weaponCells = Array.from(game.getWeaponCells()).map(s => s.split(',').map(Number) as [number, number]);
            const myWeaponCells = weaponCells.filter(([r, c]) => game.grid[r][c] === game.players[p].st);

            if (myWeaponCells.length > 0) {
                const enemyTargets: [number, number][] = [];
                for (let r = 0; r < game.height; r++) {
                    for (let c = 0; c < game.width; c++) {
                        const cell = game.grid[r][c];
                        for (let pidStr in game.players) {
                            const pid = parseInt(pidStr) as PlayerId;
                            if (pid !== p && cell === game.players[pid].st) {
                                enemyTargets.push([r, c]);
                                break;
                            }
                        }
                    }
                }

                if (enemyTargets.length > 0) {
                    const [tr, tc] = enemyTargets[Math.floor(Math.random() * enemyTargets.length)];
                    const sacrifice = myWeaponCells[Math.floor(Math.random() * myWeaponCells.length)];
                    return { move: { type: 'L', tr, tc, sr: sacrifice[0], sc: sacrifice[1] }, finishedBy: 'completed' };
                }
            }
        }

        const candidates: Candidate[] = [];
        const centerMap: [number, number] = [(game.height - 1) / 2, (game.width - 1) / 2];

        for (let r = 0; r < game.height; r++) {
            for (let c = 0; c < game.width; c++) {
                if (game.canBuild(r, c, p)) {
                    let openNeighbors = 0;
                    const adj = [[-1, 0], [1, 0], [0, -1], [0, 1]];
                    for (const [dr, dc] of adj) {
                        const nr = r + dr;
                        const nc = c + dc;
                        if (nr >= 0 && nr < game.height && nc >= 0 && nc < game.width) {
                            if (game.grid[nr][nc] === '.') openNeighbors++;
                        }
                    }
                    const dist = Math.sqrt((r - centerMap[0]) ** 2 + (c - centerMap[1]) ** 2);
                    candidates.push({ pos: [r, c], freedom: openNeighbors, dist });
                }
            }
        }

        if (candidates.length === 0) return { move: null, finishedBy: 'completed' };

        candidates.sort((a, b) => {
            if (a.freedom !== b.freedom) return b.freedom - a.freedom;
            return a.dist - b.dist;
        });

        const topN = candidates.slice(0, Math.min(3, Math.max(1, candidates.length)));
        const choice = topN[Math.floor(Math.random() * topN.length)];
        const [r, c] = choice.pos;

        let toBuild: 'S' | 'M' = 'S';
        if (choice.freedom === 0) {
            toBuild = (power < game.weapon_req) ? 'S' : 'M';
        } else if (candidates.length > 5 && Math.random() < 0.2) {
            toBuild = 'M';
        }

        return { move: { type: toBuild, r, c }, finishedBy: 'completed' };
    }
}

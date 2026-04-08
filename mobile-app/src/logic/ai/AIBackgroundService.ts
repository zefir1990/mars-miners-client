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
    reject: (error: unknown) => void;
};

let runtime: WorkletRuntime | null = null;
let runtimeInitFailed = false;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

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
    request.reject(new Error(errorMessage));
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
    return createAIPlayer(roleToDifficulty(role)).getMove(game, { maxThinkTimeMs });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void, fallbackValue: T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
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
                reject(error);
            });
    });
}

export async function computeAIMoveInBackground(
    game: MarsMinersGame,
    role: AITurnRole,
    maxThinkTimeMs: number
): Promise<AIThinkResult> {
    const snapshot = makeSnapshot(game);
    const workerRuntime = getRuntime();
    const serviceTimeoutMs = Math.max(1, maxThinkTimeMs);

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
        new Promise<AIThinkResult>((resolve, reject) => {
            pending.set(requestId, { resolve, reject });

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

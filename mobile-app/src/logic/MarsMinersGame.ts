import { BattlelogWriterDelegate } from './battlelog/BattlelogWriterDelegate';
import { t } from './locales';

export type PlayerRole = 'human' | 'easy_ai' | 'normal_ai' | 'hard_ai' | 'none';
export type Cell = string; // '.', 'X', or player symbols
export type PlayerId = 1 | 2 | 3 | 4;

export interface Player {
    st: string;
    mi: string;
    name: string;
    pos: [number, number];
    color: string;
}


export type AIMove =
    | { type: 'S', r: number, c: number }
    | { type: 'M', r: number, c: number }
    | { type: 'L', tr: number, tc: number, sr: number, sc: number };

export class MarsMinersGame implements BattlelogWriterDelegate {
    width: number;
    height: number;
    grid: Cell[][];
    roles: Record<PlayerId, PlayerRole>;
    weapon_req: number;
    player_lost: Record<PlayerId, boolean>;
    turn: PlayerId;
    game_over: boolean;
    battleLog: string[];
    highlight_weapon: boolean = true;
    playerIds: Record<PlayerId, string>;

    players: Record<PlayerId, Player>;

    private initMap(size: number) {
        this.width = size;
        this.height = size;
        this.grid = Array(this.height).fill(null).map(() => Array(this.width).fill('.'));
        this.players = {
            1: { st: '↑', mi: '○', name: t('player_1', 'en'), pos: [1, 1], color: '#FF0000' },
            2: { st: '↓', mi: '△', name: t('player_2', 'en'), pos: [this.height - 2, this.width - 2], color: '#64FF64' },
            3: { st: '←', mi: '□', name: t('player_3', 'en'), pos: [1, this.width - 2], color: '#00DFFF' },
            4: { st: '→', mi: '◇', name: t('player_4', 'en'), pos: [this.height - 2, 1], color: '#FFC832' }
        };
    }

    constructor(
        roles: Record<PlayerId, PlayerRole>,
        weapon_req = 4,
        size = 10
    ) {
        this.width = size;
        this.height = size;
        this.grid = [];
        this.roles = { 1: 'none', 2: 'none', 3: 'none', 4: 'none' };
        this.weapon_req = weapon_req;
        this.player_lost = { 1: false, 2: false, 3: false, 4: false };
        this.game_over = false;
        this.battleLog = [];
        this.playerIds = { 1: '', 2: '', 3: '', 4: '' };
        this.players = {} as any;

        this.applyCommand(`MAP_SIZE ${size}`);
        this.applyCommand(`WEAPON_REQ ${this.weapon_req}`);

        for (let p_id = 1; p_id <= 4; p_id++) {
            const role = roles[p_id as PlayerId];
            if (role !== 'none') {
                // Original code didn't pass userId, so we'll pass an empty string for now
                this.applyCommand(`JOIN ${role} `);
            }
        }

        // Initialize board for non-players (X)
        for (let p_id = 1; p_id <= 4; p_id++) {
            const id = p_id as PlayerId;
            if (this.roles[id] === 'none') {
                const [r, c] = this.players[id].pos;
                this.grid[r][c] = 'X';
                this.player_lost[id] = true;
            }
        }

        this.turn = 1;
        while (this.roles[this.turn] === 'none' && this.turn < 4) {
            this.turn = (this.turn + 1) as PlayerId;
        }
    }


    replayLog(log: string[]) {
        // Reset state
        this.initMap(10); // Default, might be overwritten by MAP_SIZE
        this.roles = { 1: 'none', 2: 'none', 3: 'none', 4: 'none' };
        this.playerIds = { 1: '', 2: '', 3: '', 4: '' };
        this.turn = 1;
        this.player_lost = { 1: false, 2: false, 3: false, 4: false };
        this.game_over = false;
        this.battleLog = [];

        // Apply moves
        for (const entry of log) {
            this.applyCommand(entry);
        }

        // Post-replay cleanup: Mark non-joined players as lost/X
        let activePlayers = 0;
        for (let i = 1; i <= 4; i++) {
            const pid = i as PlayerId;
            if (this.roles[pid] === 'none') {
                this.player_lost[pid] = true;
                const [r, c] = this.players[pid].pos;
                this.grid[r][c] = 'X';
            } else {
                activePlayers++;
            }
        }

        // Calculate valid turn if we are at start or stuck on invalid player
        if (activePlayers > 0 && !this.game_over) {
            let moves = 0; // Safety break
            while ((this.roles[this.turn] === 'none' || this.player_lost[this.turn]) && moves < 4) {
                this.turn = (this.turn % 4 + 1) as PlayerId;
                moves++;
            }
        }
    }

    applyCommand(entry: string) {
        const parts = entry.split(' ');
        const cmd = parts[0];

        if (cmd === 'MAP_SIZE') {
            const size = parseInt(parts[1]);
            this.initMap(size);
            this.battleLog.push(entry);
        } else if (cmd === 'WEAPON_REQ') {
            this.weapon_req = parseInt(parts[1]);
            this.battleLog.push(entry);
        } else if (cmd === 'JOIN') {
            const role = parts[1] as PlayerRole;
            const userId = parts[2] || '';
            // Find next pid
            let pid: PlayerId = 0 as PlayerId;
            // 1. Try to find slot with SAME role but empty ID (claiming pre-filled slot)
            // Only do this if a userId is provided, otherwise we might overwrite another player of the same role
            if (userId !== "") {
                for (let i = 1; i <= 4; i++) {
                    const id = i as PlayerId;
                    if (this.roles[id] === role && !this.playerIds[id]) {
                        pid = id;
                        break;
                    }
                }
            }
            // 2. If no matching pre-filled slot, find an empty slot
            if ((pid as any) === 0) {
                for (let i = 1; i <= 4; i++) {
                    if (this.roles[i as PlayerId] === 'none') {
                        pid = i as PlayerId;
                        break;
                    }
                }
            }
            // 3. Fallback (should not happen in valid flow, but keep safety)
            if ((pid as any) === 0) pid = 1;
            this.roles[pid] = role;
            this.playerIds[pid] = userId;
            this.player_lost[pid] = false;
            const [r, c] = this.players[pid].pos;
            this.grid[r][c] = this.players[pid].st;
            this.battleLog.push(entry);
        } else if (cmd === 'S' || cmd === 'M') {
            const c = parseInt(parts[1]);
            const r = parseInt(parts[2]);
            const to_build = cmd === 'S' ? 'st' : 'mi';
            this.grid[r][c] = (to_build === 'st') ? this.players[this.turn].st : this.players[this.turn].mi;
            this.battleLog.push(entry);
            this.nextTurnInternal();
        } else if (cmd === 'L') {
            const tc = parseInt(parts[1]);
            const tr = parseInt(parts[2]);
            this.grid[tr][tc] = '█';
            if (parts.length === 5) {
                const sc = parseInt(parts[3]);
                const sr = parseInt(parts[4]);
                this.grid[sr][sc] = '█';
            }
            this.battleLog.push(entry);
            this.nextTurnInternal();
        }
    }

    private nextTurnInternal() {
        // Update lost status
        for (let p_id = 1; p_id <= 4; p_id++) {
            const pid = p_id as PlayerId;
            if (this.roles[pid] !== 'none' && !this.player_lost[pid]) {
                if (!this.canPlayerMove(pid)) {
                    this.player_lost[pid] = true;
                }
            }
        }

        // Check if game over (no active players)
        const activePlayers = [1, 2, 3, 4].filter(pid =>
            this.roles[pid as PlayerId] !== 'none' && !this.player_lost[pid as PlayerId]
        );
        if (activePlayers.length === 0) {
            this.game_over = true;
            return;
        }

        // Check for early win (one player left with more resources than others)
        if (activePlayers.length === 1) {
            const scores = this.getScores();
            const winnerId = activePlayers[0] as PlayerId;
            const winnerScore = scores[winnerId] || 0;

            let maxOtherScore = 0;
            for (let pid = 1; pid <= 4; pid++) {
                const id = pid as PlayerId;
                if (id !== winnerId && this.roles[id] !== 'none') {
                    maxOtherScore = Math.max(maxOtherScore, scores[id] || 0);
                }
            }

            if (winnerScore > maxOtherScore) {
                this.game_over = true;
                return;
            }
        }

        // Advance turn to next valid player
        const startTurn = this.turn;
        do {
            this.turn = (this.turn % 4 + 1) as PlayerId;
        } while ((this.roles[this.turn] === 'none' || this.player_lost[this.turn]) && this.turn !== startTurn);
    }


    nextTurn() {
        this.nextTurnInternal();
    }

    getScores(): Record<PlayerId, number> {
        const scores: any = {};
        for (let p_id_str in this.roles) {
            const p_id = parseInt(p_id_str) as PlayerId;
            if (this.roles[p_id] !== 'none') {
                scores[p_id] = this.grid.reduce((acc, row) => acc + row.filter(c => c === this.players[p_id].mi).length, 0);
            }
        }
        return scores;
    }

    getWeaponCells(): Set<string> {
        const weapon_cells = new Set<string>();
        for (let p_id = 1; p_id <= 4; p_id++) {
            const pid = p_id as PlayerId;
            if (this.roles[pid] === 'none') continue;
            const st = this.players[pid].st;

            // Check Rows
            for (let r = 0; r < this.height; r++) {
                let cur_line: [number, number][] = [];
                for (let c = 0; c < this.width; c++) {
                    if (this.grid[r][c] === st) {
                        cur_line.push([r, c]);
                    } else {
                        if (cur_line.length >= this.weapon_req) {
                            cur_line.forEach(pos => weapon_cells.add(pos.toString()));
                        }
                        cur_line = [];
                    }
                }
                if (cur_line.length >= this.weapon_req) {
                    cur_line.forEach(pos => weapon_cells.add(pos.toString()));
                }
            }

            // Check Columns
            for (let c = 0; c < this.width; c++) {
                let cur_line: [number, number][] = [];
                for (let r = 0; r < this.height; r++) {
                    if (this.grid[r][c] === st) {
                        cur_line.push([r, c]);
                    } else {
                        if (cur_line.length >= this.weapon_req) {
                            cur_line.forEach(pos => weapon_cells.add(pos.toString()));
                        }
                        cur_line = [];
                    }
                }
                if (cur_line.length >= this.weapon_req) {
                    cur_line.forEach(pos => weapon_cells.add(pos.toString()));
                }
            }
        }
        return weapon_cells;
    }

    addCommand(command: string) {
        this.applyCommand(command);
    }

    addLog(command: string, r?: number, c?: number, sr?: number, sc?: number) {
        if (r !== undefined && c !== undefined) {
            if (sr !== undefined && sc !== undefined) {
                this.battleLog.push(`${command} ${c} ${r} ${sc} ${sr}`);
            } else {
                this.battleLog.push(`${command} ${c} ${r}`);
            }
        } else {
            this.battleLog.push(command);
        }
    }

    silentAddLog(entry: string) {
        this.battleLog.push(entry);
    }

    getLinePower(p: PlayerId): number {
        const st = this.players[p].st;
        let max_p = 0;
        // Rows
        for (let r = 0; r < this.height; r++) {
            let cur = 0;
            for (let c = 0; c < this.width; c++) {
                cur = (this.grid[r][c] === st) ? cur + 1 : 0;
                max_p = Math.max(max_p, cur);
            }
        }
        // Cols
        for (let c = 0; c < this.width; c++) {
            let cur = 0;
            for (let r = 0; r < this.height; r++) {
                cur = (this.grid[r][c] === st) ? cur + 1 : 0;
                max_p = Math.max(max_p, cur);
            }
        }
        return max_p;
    }

    canPlayerMove(p: PlayerId): boolean {
        if (this.player_lost[p]) return false;
        
        for (let r = 0; r < this.height; r++) {
            for (let c = 0; c < this.width; c++) {
                if (this.canBuild(r, c, p)) return true;
            }
        }

        // If blocked, they can still move if they have a charged weapon and an enemy to shoot
        if (this.getLinePower(p) >= this.weapon_req) {
            const weaponCells = this.getWeaponCells();
            // Need at least one valid weapon cell (owned by us)
            let hasOwnWeapon = false;
            for (const posStr of weaponCells) {
                const [r, c] = posStr.split(',').map(Number);
                if (this.grid[r][c] === this.players[p].st) {
                    hasOwnWeapon = true;
                    break;
                }
            }

            if (hasOwnWeapon) {
                for (let r = 0; r < this.height; r++) {
                    for (let c = 0; c < this.width; c++) {
                        const cell = this.grid[r][c];
                        // Check if it's an enemy station
                        for (let pid = 1; pid <= 4; pid++) {
                            const id = pid as PlayerId;
                            if (id !== p && this.roles[id] !== 'none' && cell === this.players[id].st) {
                                return true;
                            }
                        }
                    }
                }
            }
        }
        
        return false;
    }

    canBuild(r: number, c: number, p: PlayerId): boolean {
        if (!(r >= 0 && r < this.height && c >= 0 && c < this.width)) return false;
        if (this.grid[r][c] !== '.') return false;
        const target_station = this.players[p].st;
        const adj = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (const [dr, dc] of adj) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < this.height && nc >= 0 && nc < this.width) {
                if (this.grid[nr][nc] === target_station) return true;
            }
        }
        return false;
    }

    shootLaser(r: number, c: number, sacrifice?: [number, number]): boolean {
        // Redundant with applyCommand, but kept for compatibility or AI logic if needed.
        // However, we should probably prefer the command path.
        if (this.grid[r][c] !== '.' && this.grid[r][c] !== '█') {
            return true;
        }
        return false;
    }

    getPlayerId(userId: string): PlayerId | null {
        for (let pidStr in this.playerIds) {
            const pid = parseInt(pidStr) as PlayerId;
            if (this.playerIds[pid] === userId) {
                return pid;
            }
        }
        return null;
    }
}

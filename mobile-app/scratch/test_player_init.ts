import { MarsMinersGame, PlayerRole } from '../src/logic/MarsMinersGame';

// Mock translation function for MarsMinersGame to work standalone
// Usually it uses locales.ts which uses expo-localization, which might fail in node.
// But MarsMinersGame.ts has 'import { t } from "./locales";'

const testPlayerInitialization = () => {
    console.log("--- Testing Player Initialization ---");
    
    const roles: any = {
        1: 'human',
        2: 'easy_ai',
        3: 'easy_ai',
        4: 'easy_ai'
    };
    
    console.log("Input roles:", roles);
    
    const game = new MarsMinersGame(roles, 4);
    
    console.log("Game roles after init:", game.roles);
    
    const playerIds = Object.keys(game.roles).map(Number);
    const activeRoles = playerIds.filter(pid => game.roles[pid as 1|2|3|4] !== 'none');
    
    console.log("Active players count:", activeRoles.length);
    
    if (activeRoles.length === 4) {
        console.log("SUCCESS: All 4 players successfully initialized.");
    } else {
        console.error(`FAILURE: Only ${activeRoles.length} players initialized!`);
        process.exit(1);
    }
    
    // Verify grid positions
    for (const pid of [1, 2, 3, 4] as const) {
        const [r, c] = game.players[pid].pos;
        const cell = game.grid[r][c];
        const expectedSymbol = game.players[pid].st;
        if (cell === expectedSymbol) {
             console.log(`Player ${pid} station placed correctly at [${r}, ${c}]`);
        } else {
             console.error(`FAILURE: Player ${pid} station missing at [${r}, ${c}]! Found: '${cell}'`);
             process.exit(1);
        }
    }
};

try {
    testPlayerInitialization();
} catch (e) {
    console.error("Test execution failed:", e);
    process.exit(1);
}

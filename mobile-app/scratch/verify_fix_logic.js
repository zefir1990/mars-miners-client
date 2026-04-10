// Standalone logic verification script
// Replicates the JOIN logic and constructor loop to verify the fix

const roles = { 1: 'human', 2: 'easy_ai', 3: 'easy_ai', 4: 'easy_ai' };

const state = {
    roles: { 1: 'none', 2: 'none', 3: 'none', 4: 'none' },
    playerIds: { 1: '', 2: '', 3: '', 4: '' }
};

function applyJoinCommand(role, userId) {
    let pid = 0;
    
    // Step 1: Claim pre-filled (FIXED: only if userId is not empty)
    if (userId !== "") {
        for (let i = 1; i <= 4; i++) {
            if (state.roles[i] === role && !state.playerIds[i]) {
                pid = i;
                break;
            }
        }
    }
    
    // Step 2: Next empty slot
    if (pid === 0) {
        for (let i = 1; i <= 4; i++) {
            if (state.roles[i] === 'none') {
                pid = i;
                break;
            }
        }
    }
    
    if (pid !== 0) {
        state.roles[pid] = role;
        state.playerIds[pid] = userId;
        console.log(`Assigned role '${role}' (user:'${userId}') to pid ${pid}`);
    } else {
        console.error(`Failed to assign role '${role}'`);
    }
}

console.log("Starting verification...");
for (let p_id = 1; p_id <= 4; p_id++) {
    const role = roles[p_id];
    if (role !== 'none') {
        applyJoinCommand(role, ""); // Using empty userId as in constructor
    }
}

console.log("Final roles state:", state.roles);

const count = Object.values(state.roles).filter(r => r !== 'none').length;
if (count === 4) {
    console.log("SUCCESS: All 4 players assigned to unique slots.");
} else {
    console.error(`FAILURE: Only ${count} players assigned!`);
    process.exit(1);
}

import type { AIMove, MarsMinersGame } from '../MarsMinersGame';

export interface AIThinkOptions {
    maxThinkTimeMs?: number;
}

export interface AIThinkResult {
    move: AIMove | null;
    finishedBy: 'completed' | 'timeout';
}

export interface AIPlayer {
    getMove(game: MarsMinersGame, options?: AIThinkOptions): AIThinkResult;
}

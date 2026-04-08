import type { AIPlayer } from './AIPlayer';
import { SimpleAIPlayer } from './SimpleAIPlayer';

export type AIDifficulty = 'simple';

export function createAIPlayer(difficulty: AIDifficulty = 'simple'): AIPlayer {
    switch (difficulty) {
        case 'simple':
        default:
            return new SimpleAIPlayer();
    }
}

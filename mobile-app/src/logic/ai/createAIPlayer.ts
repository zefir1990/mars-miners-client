import type { AIPlayer } from './AIPlayer';
import { MinimaxAIPlayer } from './MinimaxAIPlayer';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

export function createAIPlayer(difficulty: AIDifficulty = 'easy'): AIPlayer {
    switch (difficulty) {
        case 'hard':
            return new MinimaxAIPlayer(4);
        case 'normal':
            return new MinimaxAIPlayer(3);
        case 'easy':
        default:
            return new MinimaxAIPlayer(2);
    }
}

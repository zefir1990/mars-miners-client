import type { AIPlayer } from './AIPlayer';
import { SimpleAIPlayer } from './SimpleAIPlayer';
import { WarriorAIPlayer } from './WarriorAIPlayer';

export type AIDifficulty = 'easy' | 'normal' | 'hard';

export function createAIPlayer(difficulty: AIDifficulty = 'easy'): AIPlayer {
    switch (difficulty) {
        case 'hard':
            return new WarriorAIPlayer(3);
        case 'normal':
            return new WarriorAIPlayer(2);
        case 'easy':
        default:
            return new SimpleAIPlayer();
    }
}

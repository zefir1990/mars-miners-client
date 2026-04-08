import type { AIPlayer } from './AIPlayer';
import { SimpleAIPlayer } from './SimpleAIPlayer';
import { WarriorAIPlayer } from './WarriorAIPlayer';

export type AIDifficulty = 'simple' | 'warrior';

export function createAIPlayer(difficulty: AIDifficulty = 'simple'): AIPlayer {
    switch (difficulty) {
        case 'warrior':
            return new WarriorAIPlayer();
        case 'simple':
        default:
            return new SimpleAIPlayer();
    }
}

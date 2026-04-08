import type { AIMove, MarsMinersGame } from '../MarsMinersGame';

export interface AIPlayer {
    getMove(game: MarsMinersGame): AIMove | null;
}

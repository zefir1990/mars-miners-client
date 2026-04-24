import { MarsMinersGame, PlayerId, PlayerRole } from '../src/logic/MarsMinersGame';
import { PlayfieldDelegate } from '../src/logic/PlayfieldDelegate';
import React from 'react';

export interface MapRendererProps {
    game: MarsMinersGame;
    currentTurn: PlayerId;
    turnRole: PlayerRole;
    myPlayerId: PlayerId | null;
    isHumanTurn: boolean;
    isGameOver: boolean;
    isReplayMode: boolean;
    playfieldDelegate: PlayfieldDelegate;
    forceUpdate: () => void;
    children?: React.ReactNode;
    tick: number;
}

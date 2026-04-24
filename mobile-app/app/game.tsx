import * as FileSystem from 'expo-file-system/legacy';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Clipboard, FlatList, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';

import { SafeAreaView } from 'react-native-safe-area-context';
import { MarsMinersGame, PlayerId, PlayerRole } from '../src/logic/MarsMinersGame';
import { computeAIMoveInBackground } from '../src/logic/ai/AIBackgroundService';
import { PlayfieldDelegate } from '../src/logic/PlayfieldDelegate';
import { BattlelogWriter } from '../src/logic/battlelog/BattlelogWriter';
import { SingleplayerBattlelogWriter } from '../src/logic/battlelog/SingleplayerBattlelogWriter';
import { WebsocketsBattlelogWriter } from '../src/logic/battlelog/WebsocketsBattlelogWriter';
import { t } from '../src/logic/locales';
import ThreeMapRenderer from '../components/ThreeMapRenderer';

interface GameViewProps {
    game: MarsMinersGame;
    playfieldDelegate: PlayfieldDelegate;
    battlelogWriter: BattlelogWriter;
    onBack: () => void;
    sessionId?: string;
    userId?: string;
    connectionStatus?: string;
    isReplayMode?: boolean;
    initialLog?: string[];
}

function GameView({ game, playfieldDelegate, battlelogWriter, onBack, sessionId, userId, connectionStatus, isReplayMode, initialLog }: GameViewProps) {
    console.log('GameView Roles:', game.roles);
    // Capture state for Effect dependencies and Render
    const currentTurn = game.turn;
    const isGameOver = game.game_over;
    const turnRole = game.roles[currentTurn];

    const getThinkTime = (role: PlayerRole) => {
        if (role === 'hard_ai') return 10000;
        if (role === 'normal_ai') return 5000;
        if (role === 'easy_ai') return 2000;
        return 5000;
    };
    const maxAIThinkTimeMs = getThinkTime(turnRole);
    const aiRequestSeqRef = useRef(0);

    // Force update helper
    const [tick, setTick] = useState(0);
    const forceUpdate = () => setTick(t => t + 1);
    // In multiplayer (sessionId exists), check if it's OUR turn.
    // In singleplayer, just check if it's a human role.
    const myPlayerId = userId ? game.getPlayerId(userId) : null;
    const isHumanTurn = !isGameOver && turnRole === 'human' && (!sessionId || currentTurn === myPlayerId);

    const [showLog, setShowLog] = useState(false);
    const [showGameOverModal, setShowGameOverModal] = useState(false);
    const [isAIThinking, setIsAIThinking] = useState(false);
    const [isIndicatorVisible, setIsIndicatorVisible] = useState(false);
    const aiOpacity = useRef(new Animated.Value(0)).current;
    const [replayIdx, setReplayIdx] = useState(0);


    // Battlelog Playback
    useEffect(() => {
        if (isReplayMode && initialLog && replayIdx < initialLog.length) {
            const timer = setTimeout(() => {
                const command = initialLog[replayIdx];
                // Skip setup commands as they were likely applied during init or should be applied instantly
                if (command.startsWith('SIZE') || command.startsWith('WEAPON_REQ') || command.startsWith('JOIN')) {
                    // Just skip, but we move to next
                    setReplayIdx(idx => idx + 1);
                } else {
                    game.applyCommand(command);
                    setReplayIdx(idx => idx + 1);
                    forceUpdate();
                }
            }, 1000);
            return () => clearTimeout(timer);
        }
    }, [isReplayMode, replayIdx, initialLog, game]);

    // AI Loop
    useEffect(() => {
        let cancelled = false;
        setIsAIThinking(false);
        if (!isGameOver && thisIsAI(turnRole) && !isReplayMode) {
            const timer = setTimeout(() => {
                const requestId = ++aiRequestSeqRef.current;
                setIsAIThinking(true);
                computeAIMoveInBackground(game, turnRole as any, maxAIThinkTimeMs)
                    .then(result => {
                        if (
                            cancelled ||
                            requestId !== aiRequestSeqRef.current ||
                            game.game_over ||
                            game.turn !== currentTurn ||
                            game.roles[currentTurn] !== turnRole
                        ) {
                            setIsAIThinking(false);
                            return;
                        }

                        console.log(`[AI] background thinking finished turn=${currentTurn} role=${turnRole} finishedBy=${result.finishedBy} hasMove=${result.move ? 'yes' : 'no'}`);

                        if (turnRole === 'normal_ai' || turnRole === 'hard_ai') {
                            console.log(`[SearchAI] turn=${currentTurn} role=${turnRole} finishedBy=${result.finishedBy}`);
                        }

                        const writer = battlelogWriter as any;
                        const move = result.move;
                        if (move) {
                            if (move.type === 'S') {
                                writer.buildStation(move.r, move.c);
                            } else if (move.type === 'M') {
                                writer.buildMine(move.r, move.c);
                            } else if (move.type === 'L') {
                                writer.shootLaser(move.tr, move.tc, move.sr, move.sc);
                            }
                        } else {
                            game.nextTurn();
                        }
                        setIsAIThinking(false);
                        forceUpdate();
                    })
                    .catch(error => {
                        console.error('AI background execution failed', error);
                        if (
                            cancelled ||
                            requestId !== aiRequestSeqRef.current ||
                            game.game_over ||
                            game.turn !== currentTurn ||
                            game.roles[currentTurn] !== turnRole
                        ) {
                            setIsAIThinking(false);
                            return;
                        }

                        setIsAIThinking(false);
                        if (!cancelled) {
                            game.nextTurn();
                            forceUpdate();
                        }
                    });
            }, 500);
            return () => {
                cancelled = true;
                aiRequestSeqRef.current += 1;
                setIsAIThinking(false);
                clearTimeout(timer);
            };
        }
    }, [currentTurn, isGameOver, tick, battlelogWriter, game, isReplayMode, maxAIThinkTimeMs, turnRole]);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        if (isAIThinking) {
            timer = setTimeout(() => {
                setIsIndicatorVisible(true);
                Animated.timing(aiOpacity, {
                    toValue: 1,
                    duration: 500,
                    useNativeDriver: true,
                }).start();
            }, 1000);
        } else {
            Animated.timing(aiOpacity, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
            }).start(() => setIsIndicatorVisible(false));
        }
        return () => {
            if (timer) clearTimeout(timer);
        };
    }, [isAIThinking, aiOpacity]);

    useEffect(() => {
        if (isGameOver) {
            setShowGameOverModal(true);
        }
    }, [isGameOver]);

    useEffect(() => {
        if (Platform.OS === 'web') {
            document.title = sessionId ? 'Mars Miners - Multiplayer Battle' : 'Mars Miners - Battle';
        }
    }, [sessionId]);

    const handleSave = async () => {
        try {
            const fileName = `mars-miners-battle-log.txt`;
            const logText = game.battleLog.join('\n');

            if (Platform.OS === 'web') {
                const blob = new Blob([logText], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
            } else {
                const fileUri = (FileSystem as any).cacheDirectory + fileName;
                await FileSystem.writeAsStringAsync(fileUri, logText);

                if (await Sharing.isAvailableAsync()) {
                    await Sharing.shareAsync(fileUri);
                } else {
                    Alert.alert(t('error', 'en'), t('sharing_not_available', 'en'));
                }
            }
        } catch (e) {
            console.error("Failed to save log", e);
            Alert.alert(t('error', 'en'), t('save_fail', 'en'));
        }
    };

    const copySession = () => {
        if (!sessionId) return;
        Clipboard.setString(sessionId);
        Alert.alert(t('copy_btn', 'en'), sessionId);
    };



    // Handle modal OK button
    const handleModalOk = () => {
        setShowGameOverModal(false);
    };
    // Status Text
    let statusText = "";
    if (isGameOver) {
        const scores = game.getScores();
        const maxScore = Math.max(...Object.values(scores).map(Number));
        const winners = Object.keys(scores).filter(k => scores[parseInt(k) as PlayerId] === maxScore);
        if (winners.length > 1) {
            const namesList = winners.map(w => game.players[parseInt(w) as PlayerId].name).join(', ');
            statusText = t('draw', 'en', { names: namesList, m: maxScore });
        } else {
            const w = parseInt(winners[0]) as PlayerId;
            statusText = t('winner', 'en', { name: game.players[w].name, m: maxScore });
        }
    } else {
        const pName = game.players[currentTurn].name;
        const power = game.getLinePower(currentTurn);
        const req = game.weapon_req;
        const msg = power >= req
            ? t('ready', 'en', { n: power })
            : t('charging', 'en', { n: power, req });

        statusText = `${t('turn', 'en', { name: pName })} (${game.roles[currentTurn]})\n${msg}`;
        if (isAIThinking && thisIsAI(turnRole)) {
            statusText += `\n${t('ai_thinking', 'en')}`;
        }
        if (connectionStatus) {
            statusText += `\n[${connectionStatus}]`;
        }
        if (isReplayMode) {
            statusText = `${t('replaying_status', 'en')}\n${statusText}`;
        }
    }

    return (
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={onBack} style={styles.backBtn}><Text style={styles.btnText}>←</Text></TouchableOpacity>
                <div dir="auto" style={styles.headerInfo as any}>
                    <Text style={styles.headerTitle} numberOfLines={2}>{statusText}</Text>
                    <View style={styles.headerScores}>
                        {[1, 2, 3, 4].map(pid => {
                            const id = pid as PlayerId;
                            if (game.roles[id] === 'none') return null;
                            const score = game.getScores()[id] || 0;
                            const isLost = game.player_lost[id];
                            return (
                                <Text key={id} style={{ color: isLost ? '#666' : game.players[id].color, fontSize: 10, marginHorizontal: 4 }}>
                                    {game.players[id].name}:{score}
                                </Text>
                            );
                        })}
                    </View>
                </div>
                <TouchableOpacity onPress={() => setShowLog(!showLog)} style={styles.logToggle}>
                    <Text style={styles.btnText}>{showLog ? '📋' : '📑'}</Text>
                </TouchableOpacity>
            </View>

            <ThreeMapRenderer
                game={game}
                currentTurn={currentTurn}
                turnRole={turnRole}
                myPlayerId={myPlayerId}
                isHumanTurn={isHumanTurn}
                isGameOver={isGameOver}
                isReplayMode={!!isReplayMode}
                playfieldDelegate={playfieldDelegate}
                forceUpdate={forceUpdate}
                tick={tick}
            >
                {isIndicatorVisible && (
                    <Animated.View style={[styles.aiThinkingOverlay, { opacity: aiOpacity }]}>
                        <ActivityIndicator size="large" color="#ffffff" />
                        <Text style={styles.aiThinkingText}>{t('ai_thinking', 'en')}</Text>
                    </Animated.View>
                )}
            </ThreeMapRenderer>

            {showLog && (
                <>
                    <View style={styles.logContainer}>
                        <ScrollView
                            ref={(ref) => ref?.scrollToEnd({ animated: true })}
                            style={styles.logScrollView}
                            contentContainerStyle={styles.logContent}
                        >
                            {game.battleLog.map((log, i) => (
                                <Text key={i} style={styles.logText}>
                                    {`Turn ${i + 1}: ${log}`}
                                </Text>
                            ))}
                        </ScrollView>
                    </View>

                    <View style={styles.bottomBar}>
                        {sessionId && (
                            <TouchableOpacity
                                style={[styles.bottomBtn, { backgroundColor: '#8e44ad' }]}
                                onPress={copySession}
                            >
                                <Text style={styles.btnLabel}>{t('copy_btn', 'en')}</Text>
                            </TouchableOpacity>
                        )}

                        <TouchableOpacity
                            style={[styles.bottomBtn, styles.saveButtonUI]}
                            onPress={handleSave}
                        >
                            <Text style={styles.btnLabel}>{t('save', 'en')}</Text>
                        </TouchableOpacity>
                    </View>
                </>
            )}

            <Modal
                visible={showGameOverModal}
                transparent={true}
                animationType="fade"
                onRequestClose={() => { }}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>{t('game_over', 'en')}</Text>
                        <Text style={styles.modalMessage}>{statusText}</Text>
                        <TouchableOpacity style={styles.modalButton} onPress={handleModalOk}>
                            <Text style={styles.modalButtonText}>{t('ok', 'en')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}


export default function GameScreen() {
    const router = useRouter();
    const params = useLocalSearchParams();
    const gameRef = useRef<MarsMinersGame | null>(null);
    const battlelogWriterRef = useRef<BattlelogWriter | null>(null);
    const [isInitialized, setIsInitialized] = useState(false);
    const [, setTick] = useState(0); 

    const [connectionStatus, setConnectionStatus] = useState(''); // Initialize empty, update in useEffect

    useEffect(() => {
        if (!isInitialized && params.roles) {
            try {
                const roles = JSON.parse(params.roles as string);
                const weaponReq = parseInt(params.weapon_req as string) || 4;
                const mode = params.mode as string;
                const sessionId = params.session_id as string;
                const userId = params.user_id as string;

                gameRef.current = new MarsMinersGame(roles, weaponReq);

                if (mode === 'multi') {
                    setConnectionStatus('Connecting...'); // Set initial status for multi-mode
                    const connect = () => {
                        setConnectionStatus('Connecting...');
                        const socket = new WebSocket(`wss://mediumdemens.vps.webdock.cloud/mars-miners-battle-server`);

                        const writer = new WebsocketsBattlelogWriter(
                            gameRef.current!,
                            socket,
                            userId,
                            sessionId,
                            () => setTick(t => t + 1)
                        );
                        battlelogWriterRef.current = writer;

                        socket.onopen = () => {
                            setConnectionStatus('Connected');
                            if (params.create_session === 'true') {
                                writer.create();
                                writer.join('human', userId);
                            } else {
                                writer.join('human', userId);
                                writer.readFull();
                            }
                        };

                        socket.onclose = () => {
                            setConnectionStatus('Disconnected (Reconnecting...)');
                            setTimeout(connect, 3000);
                        };

                        socket.onerror = (error) => {
                            console.error("WebSocket error:", error);
                            setConnectionStatus('Error');
                            socket.close(); // Ensure socket is closed on error
                        };
                    };
                    connect();
                } else {
                    const writer = new SingleplayerBattlelogWriter(
                        gameRef.current!,
                        () => setTick(t => t + 1)
                    );
                    battlelogWriterRef.current = writer;

                    setIsInitialized(true);
                }

                if (params.restore_state) {
                    try {
                        const parsed = JSON.parse(params.restore_state as string);
                        const logLines = parsed.battleLog || (typeof params.restore_state === 'string' ? (params.restore_state as string).split('\n').filter(l => l.trim().length > 0) : []);
                        
                        if (params.mode === 'replay') {
                            // Only apply setup commands instantly
                            const setupLines = logLines.filter((l: string) => l.startsWith('WEAPON_REQ') || l.startsWith('JOIN') || l.startsWith('SIZE'));
                            gameRef.current.replayLog(setupLines);
                        } else {
                            if (parsed.battleLog) {
                                gameRef.current.replayLog(parsed.battleLog);
                            } else {
                                gameRef.current.fromDict(parsed);
                            }
                        }
                    } catch {
                        const lines = (params.restore_state as string).split('\n').filter(l => l.trim().length > 0);
                        if (params.mode === 'replay') {
                            const setupLines = lines.filter(l => l.startsWith('WEAPON_REQ') || l.startsWith('JOIN') || l.startsWith('SIZE'));
                            gameRef.current.replayLog(setupLines);
                        } else {
                            gameRef.current.replayLog(lines);
                        }
                    }
                }

                setIsInitialized(true);
            } catch (e) {
                console.error("Failed to parsing params", e);
                router.replace('/');
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [params.roles]);

    const handleBack = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace('/');
        }
    };

    if (!isInitialized || !gameRef.current) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                    <ActivityIndicator size="large" color="#007AFF" />
                </View>
            </SafeAreaView>
        );
    }

    const initialLogLines = params.restore_state ? (() => {
        try {
            const parsed = JSON.parse(params.restore_state as string);
            return parsed.battleLog || [];
        } catch {
            return (params.restore_state as string).split('\n').filter(l => l.trim().length > 0);
        }
    })() : [];

    return (
        <GameView
            game={gameRef.current}
            playfieldDelegate={battlelogWriterRef.current as any}
            battlelogWriter={battlelogWriterRef.current as any}
            onBack={handleBack}
            sessionId={params.session_id as string}
            userId={params.user_id as string}
            connectionStatus={connectionStatus}
            isReplayMode={params.mode === 'replay'}
            initialLog={initialLogLines}
        />
    );
}

function thisIsAI(role: PlayerRole): boolean {
    return role === 'easy_ai' || role === 'normal_ai' || role === 'hard_ai';
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212' },
    header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50, backgroundColor: 'rgba(18, 18, 18, 0.8)', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 70, borderBottomWidth: 1, borderBottomColor: 'rgba(51, 51, 51, 0.8)' },
    backBtn: { padding: 10 },
    logToggle: { padding: 10, width: 50, alignItems: 'center' },
    btnText: { color: '#fff', fontSize: 24 },
    headerInfo: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { color: '#fff', textAlign: 'center', fontSize: 14, marginBottom: 2 },
    headerScores: { flexDirection: 'row', justifyContent: 'center', width: '100%' },


    aiThinkingOverlay: { position: 'absolute', top: 16, zIndex: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 0, 0, 0.65)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
    aiThinkingText: { color: '#fff', marginTop: 8, fontSize: 14, fontWeight: '600' },

    bottomBar: { flexDirection: 'row', height: 80 },
    bottomBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#333', margin: 5, borderRadius: 8 },
    activeBtn: { backgroundColor: '#007AFF' },
    saveButtonUI: { backgroundColor: '#34c759' },
    btnLabel: { color: '#fff', fontSize: 12, fontWeight: 'bold', textAlign: 'center' },



    logContainer: {
        height: 100,
        backgroundColor: '#1a1a1a',
        borderTopWidth: 1,
        borderTopColor: '#333',
        marginHorizontal: 10,
        borderRadius: 8,
        padding: 5
    },
    logScrollView: { flex: 1 },
    logContent: { paddingVertical: 5 },
    logText: { color: '#aaa', fontSize: 12, fontFamily: 'monospace', marginBottom: 2 },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.7)', justifyContent: 'center', alignItems: 'center' },
    modalContent: { backgroundColor: '#2a2a2a', padding: 30, borderRadius: 15, alignItems: 'center', minWidth: 300 },
    modalTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 15 },
    modalMessage: { fontSize: 16, color: '#ccc', textAlign: 'center', marginBottom: 25 },
    modalButton: { backgroundColor: '#007AFF', paddingHorizontal: 30, paddingVertical: 12, borderRadius: 8 },
    modalButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});

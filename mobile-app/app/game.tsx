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

const emptyTile1 = require('../assets/images/empty_tile_1.png');
const emptyTile2 = require('../assets/images/empty_tile_2.png');
const emptyTiles = [emptyTile1, emptyTile2];
const rotations = ['0deg', '90deg', '180deg', '270deg'];

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

    const [selectedCell, setSelectedCell] = useState<{ r: number, c: number } | null>(null);
    const [popupSize, setPopupSize] = useState({ width: 0, height: 0 });
    const [showLog, setShowLog] = useState(false);
    const [highlight] = useState(game.highlight_weapon);
    const [pendingSacrifice, setPendingSacrifice] = useState<[number, number] | null>(null);
    const [showGameOverModal, setShowGameOverModal] = useState(false);
    const [isAIThinking, setIsAIThinking] = useState(false);
    const [isIndicatorVisible, setIsIndicatorVisible] = useState(false);
    const aiOpacity = useRef(new Animated.Value(0)).current;
    const [replayIdx, setReplayIdx] = useState(0);

    // Zoom and Pan state
    const scale = useSharedValue(1);
    const savedScale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const savedTranslateX = useSharedValue(0);
    const savedTranslateY = useSharedValue(0);
    const layoutWidth = useSharedValue(1000);
    const layoutHeight = useSharedValue(1000);

    const pinchGesture = Gesture.Pinch()
        .onUpdate((e) => {
            const newScale = savedScale.value * e.scale;
            scale.value = Math.min(Math.max(newScale, 0.75), 8);
        })
        .onEnd(() => {
            savedScale.value = scale.value;
        });

    const panGesture = Gesture.Pan()
        .minPointers(1)
        .onUpdate((e) => {
            const availableSize = Math.min(layoutWidth.value, layoutHeight.value);
            const scaledMapSize = availableSize * scale.value;
            // The max translation is the amount needed to bring the edge of the scaled map to the edge of the screen, plus a 50px buffer. 
            const limitX = Math.max((scaledMapSize - layoutWidth.value) / 2, 0) + 50;
            const limitY = Math.max((scaledMapSize - layoutHeight.value) / 2, 0) + 50;
            
            let nextX = savedTranslateX.value + e.translationX;
            let nextY = savedTranslateY.value + e.translationY;
            
            nextX = Math.min(Math.max(nextX, -limitX), limitX);
            nextY = Math.min(Math.max(nextY, -limitY), limitY);

            translateX.value = nextX;
            translateY.value = nextY;
        })
        .onEnd(() => {
            savedTranslateX.value = translateX.value;
            savedTranslateY.value = translateY.value;
        });

    const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: translateX.value },
            { translateY: translateY.value },
            { scale: scale.value }
        ]
    }));

    const gridRef = useRef<View>(null);

    useEffect(() => {
        if (Platform.OS === 'web' && gridRef.current) {
            const el = gridRef.current as any;
            const handleWheel = (e: WheelEvent) => {
                e.preventDefault();
                const delta = e.deltaY;
                const scaleChange = delta > 0 ? 0.9 : 1.1;
                const newScale = Math.min(Math.max(scale.value * scaleChange, 0.75), 8);
                scale.value = withSpring(newScale, { damping: 20, stiffness: 200 });
                savedScale.value = newScale;
            };
            el.addEventListener('wheel', handleWheel, { passive: false });
            return () => el.removeEventListener('wheel', handleWheel);
        }
    }, []);

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
                setPendingSacrifice(null);
                setIsAIThinking(true);
                computeAIMoveInBackground(game, turnRole, maxAIThinkTimeMs)
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
        let timer: NodeJS.Timeout;
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

    // Cell Interaction
    const handleCellPress = (r: number, c: number) => {
        if (isReplayMode) return;
        console.log(`Cell press: ${r}, ${c}. Turn: ${currentTurn}, Role: ${turnRole}, MyID: ${myPlayerId}, H: ${isHumanTurn}, GO: ${isGameOver}`);
        if (!isHumanTurn) return;

        const cell = game.grid[r][c];
        const weaponCells = game.getWeaponCells();
        const isWeaponPart = weaponCells.has(`${r},${c}`);

        // Try selecting sacrifice
        if (cell === game.players[currentTurn].st && isWeaponPart) {
            if (pendingSacrifice && pendingSacrifice[0] === r && pendingSacrifice[1] === c) {
                setPendingSacrifice(null);
            } else {
                setPendingSacrifice([r, c]);
            }
            forceUpdate();
            return;
        }

        // Enemy check
        let enemyId: PlayerId | null = null;
        for (let pidStr in game.players) {
            const pid = parseInt(pidStr) as PlayerId;
            if (pid !== currentTurn && cell === game.players[pid].st) {
                enemyId = pid;
                break;
            }
        }

        if (enemyId) {
            if (pendingSacrifice) {
                const [sr, sc] = pendingSacrifice;
                playfieldDelegate.shootLaser(r, c, sr, sc);
                setPendingSacrifice(null);
                forceUpdate();
            }
        } else if (cell === '.') {
            if (game.canBuild(r, c, currentTurn)) {
                if (selectedCell && selectedCell.r === r && selectedCell.c === c) {
                    setSelectedCell(null);
                } else {
                    setSelectedCell({ r, c });
                }
                setPendingSacrifice(null);
                forceUpdate();
            }
        } else {
            setSelectedCell(null);
        }
    };

    // Handle modal OK button
    const handleModalOk = () => {
        setShowGameOverModal(false);
    };

    const [layout, setLayout] = useState({ width: 0, height: 0 });

    const onLayout = (event: any) => {
        const { width, height } = event.nativeEvent.layout;
        setLayout({ width, height });
        layoutWidth.value = width;
        layoutHeight.value = height;
    };

    // Rendering Helpers
    const weaponCells = highlight ? game.getWeaponCells() : new Set();

    // Calculate cell size to fit container
    const availableSize = Math.min(layout.width, layout.height);
    const cellSize = availableSize > 0 ? (Math.floor(availableSize / Math.max(game.width, game.height)) - 2) : 0;

    const renderCell = ({ item, index }: { item: string, index: number }) => {
        if (cellSize <= 0) return null;
        const r = Math.floor(index / game.width);
        const c = index % game.width;

        const isWeaponPart = weaponCells.has(`${r},${c}`);
        const isSelectedForSacrifice = pendingSacrifice && pendingSacrifice[0] === r && pendingSacrifice[1] === c;
        const isAttackTarget = !!pendingSacrifice && isHumanTurn && (() => {
            for (let pidStr in game.players) {
                const pid = parseInt(pidStr) as PlayerId;
                if (pid !== currentTurn && item === game.players[pid].st) {
                    return true;
                }
            }
            return false;
        })();

        let bgColor = '#1e1e1e';
        if (isWeaponPart) {
            const isEnemy = item !== game.players[currentTurn].st;
            bgColor = isEnemy ? '#4a2c1e' : '#504614';
        }
        // Dead cells (destroyed stations) show as grey)
        if (item === '█') bgColor = '#646464';

        const canBuildHighlight = item === '.' && isHumanTurn && game.canBuild(r, c, currentTurn);

        // Determine text color
        let color = '#fff';
        if (item === 'X') color = 'red';
        else {
            for (let pidStr in game.players) {
                const p = game.players[parseInt(pidStr) as PlayerId];
                if (item === p.st || item === p.mi) {
                    color = p.color;
                    break;
                }
            }
        }

        // Don't show symbol for dead cells or empty cells
        const displayText = (item === '.' || item === '█') ? '' : item;

        const isBase = item === 'X' || (() => {
            for (let pidStr in game.players) {
                const p = game.players[parseInt(pidStr) as PlayerId];
                if (item === p.st) return true;
            }
            return false;
        })();

        const isMine = (() => {
            for (let pidStr in game.players) {
                const p = game.players[parseInt(pidStr) as PlayerId];
                if (item === p.mi) return true;
            }
            return false;
        })();

        const isDestroyed = item === '█';

        return (
            <TouchableOpacity
                style={[styles.cell, { width: cellSize, height: cellSize, backgroundColor: bgColor }]}
                onPress={() => handleCellPress(r, c)}
                activeOpacity={0.7}
                testID="game-cell"
            >
                {item === '.' && (() => {
                    const cellHash = (r * 7 + c * 13);
                    const tileIdx = cellHash % 2;
                    const rotationIdx = cellHash % 4;
                    return (
                        <Image
                            source={emptyTiles[tileIdx]}
                            style={{
                                position: 'absolute',
                                width: '100%',
                                height: '100%',
                                opacity: 1.0,
                                transform: [{ rotate: rotations[rotationIdx] }]
                            }}
                            resizeMode="cover"
                        />
                    );
                })()}
                {isBase && (
                    <Image
                        source={require('../assets/images/base_tile.png')}
                        style={{ position: 'absolute', width: '100%', height: '100%', opacity: 1.0 }}
                        resizeMode="cover"
                    />
                )}
                {isMine && (
                    <Image
                        source={require('../assets/images/mine_tile.png')}
                        style={{ position: 'absolute', width: '100%', height: '100%', opacity: 1.0 }}
                        resizeMode="cover"
                    />
                )}
                {isDestroyed && (
                    <Image
                        source={require('../assets/images/crater_tile.png')}
                        style={{ position: 'absolute', width: '100%', height: '100%', opacity: 1.0 }}
                        resizeMode="cover"
                    />
                )}
                {canBuildHighlight && (
                    <View
                        style={{
                            position: 'absolute',
                            width: '100%',
                            height: '100%',
                            backgroundColor: 'rgba(30, 58, 95, 0.6)',
                            borderColor: '#1e3a5f',
                            borderWidth: 1,
                        }}
                        pointerEvents="none"
                    />
                )}
                {displayText !== '' && (
                    <View
                        style={{
                            position: 'absolute',
                            top: 2,
                            right: 2,
                            width: cellSize * 0.5,
                            height: cellSize * 0.5,
                            backgroundColor: 'rgba(0,0,0,0.5)',
                            borderRadius: 4,
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 5,
                        }}
                    >
                        <Text
                            style={{
                                color,
                                fontSize: cellSize * 0.4,
                                fontFamily: 'Inter_900Black',
                                fontWeight: '900',
                                opacity: 0.95,
                                textAlignVertical: 'center',
                                includeFontPadding: false,
                                transform: [{ translateY: 0 }]
                            }}
                        >
                            {displayText}
                        </Text>
                    </View>
                )}
                {isWeaponPart && (
                    <View
                        style={{
                            position: 'absolute',
                            width: '100%',
                            height: '100%',
                            backgroundColor: (item !== game.players[currentTurn].st) ? 'rgba(255, 100, 0, 0.4)' : 'rgba(255, 255, 0, 0.4)',
                            borderColor: (item !== game.players[currentTurn].st) ? '#ff6400' : '#ffff00',
                            borderWidth: 2,
                        }}
                        pointerEvents="none"
                    />
                )}
                {isSelectedForSacrifice && (
                    <View
                        style={{
                            position: 'absolute',
                            width: '100%',
                            height: '100%',
                            backgroundColor: 'rgba(255, 59, 48, 0.4)',
                            borderColor: '#ff3b30',
                            borderWidth: 3,
                        }}
                        pointerEvents="none"
                    />
                )}
                {isAttackTarget && (
                    <View
                        style={{
                            position: 'absolute',
                            width: '100%',
                            height: '100%',
                            backgroundColor: 'rgba(95, 30, 30, 0.5)',
                            borderColor: '#ff0000',
                            borderWidth: 2,
                            borderStyle: 'dashed',
                        }}
                        pointerEvents="none"
                    />
                )}
            </TouchableOpacity>
        );
    };

    const flatGrid = game.grid.flat();

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

            <GestureDetector gesture={composedGesture}>
                <View style={styles.gridContainer} onLayout={onLayout} ref={gridRef as any}>
                    {isIndicatorVisible && (
                        <Animated.View style={[styles.aiThinkingOverlay, { opacity: aiOpacity }]}>
                            <ActivityIndicator size="large" color="#ffffff" />
                            <Text style={styles.aiThinkingText}>{t('ai_thinking', 'en')}</Text>
                        </Animated.View>
                    )}
                    <Reanimated.View style={[{ alignItems: 'center', justifyContent: 'center' }, animatedStyle]}>
                        {cellSize > 0 && (
                            <View style={{ width: cellSize * game.width, height: cellSize * game.height }}>
                                <FlatList
                                    data={flatGrid}
                                    renderItem={renderCell}
                                    keyExtractor={(_, i) => i.toString()}
                                    numColumns={game.width}
                                    key={game.width}
                                    scrollEnabled={false}
                                />
                                {selectedCell && (
                                    <Pressable
                                        style={{
                                            position: 'absolute',
                                            width: 4000,
                                            height: 4000,
                                            left: -2000,
                                            top: -2000,
                                            backgroundColor: 'rgba(0,0,0,0.3)',
                                        }}
                                        onPress={() => setSelectedCell(null)}
                                    />
                                )}
                                {selectedCell && (() => {
                                    const idealLeft = selectedCell.c * cellSize + cellSize / 2 - popupSize.width / 2;
                                    const idealTop = selectedCell.r * cellSize + cellSize / 2 - popupSize.height / 2;

                                    const left = Math.max(0, Math.min(idealLeft, game.width * cellSize - popupSize.width));
                                    const top = Math.max(0, Math.min(idealTop, game.height * cellSize - popupSize.height));

                                    return (
                                        <Pressable
                                            style={[styles.buildOverlay, { left, top, opacity: popupSize.width > 0 ? 1 : 0 }]}
                                            onLayout={(e) => {
                                                const { width, height } = e.nativeEvent.layout;
                                                if (width !== popupSize.width || height !== popupSize.height) {
                                                    setPopupSize({ width, height });
                                                }
                                            }}
                                            onPress={(e) => e.stopPropagation()}
                                        >
                                            <TouchableOpacity
                                                style={styles.buildOverlayBtn}
                                                onPress={() => {
                                                    playfieldDelegate.buildStation(selectedCell.r, selectedCell.c);
                                                    setSelectedCell(null);
                                                    forceUpdate();
                                                }}
                                            >
                                                <Text style={styles.buildOverlayBtnText}>{t('base_btn', 'en')}</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={[styles.buildOverlayBtn, { backgroundColor: '#e67e22' }]}
                                                onPress={() => {
                                                    playfieldDelegate.buildMine(selectedCell.r, selectedCell.c);
                                                    setSelectedCell(null);
                                                    forceUpdate();
                                                }}
                                            >
                                                <Text style={styles.buildOverlayBtnText}>{t('mine_btn', 'en')}</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                style={[styles.buildOverlayBtn, { backgroundColor: '#444' }]}
                                                onPress={() => setSelectedCell(null)}
                                            >
                                                <Text style={styles.buildOverlayBtnText}>×</Text>
                                            </TouchableOpacity>
                                        </Pressable>
                                    );
                                })()}
                            </View>
                        )}
                    </Reanimated.View>
                </View>
            </GestureDetector>

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
                            gameRef.current,
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
                        gameRef.current,
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
                <View style={styles.gridContainer}>
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

    gridContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    cell: { borderWidth: 1, borderColor: '#333', alignItems: 'center', justifyContent: 'center' },
    aiThinkingOverlay: { position: 'absolute', top: 16, zIndex: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 0, 0, 0.65)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
    aiThinkingText: { color: '#fff', marginTop: 8, fontSize: 14, fontWeight: '600' },

    bottomBar: { flexDirection: 'row', height: 80 },
    bottomBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#333', margin: 5, borderRadius: 8 },
    activeBtn: { backgroundColor: '#007AFF' },
    saveButtonUI: { backgroundColor: '#34c759' },
    btnLabel: { color: '#fff', fontSize: 12, fontWeight: 'bold', textAlign: 'center' },

    buildOverlay: {
        position: 'absolute',
        flexDirection: 'row',
        backgroundColor: 'rgba(0,0,0,0.85)',
        padding: 8,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
    },
    buildOverlayBtn: {
        backgroundColor: '#007AFF',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 10,
        marginHorizontal: 5,
    },
    buildOverlayBtnText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16,
    },

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

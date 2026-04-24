import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { MapRendererProps } from './MapRenderer';
import { PlayerId } from '../src/logic/MarsMinersGame';
import { t } from '../src/logic/locales';

const emptyTile1 = require('../assets/images/empty_tile_1.png');
const emptyTile2 = require('../assets/images/empty_tile_2.png');
const emptyTiles = [emptyTile1, emptyTile2];
const rotations = ['0deg', '90deg', '180deg', '270deg'];

const baseTile = require('../assets/images/base_tile.png');
const mineTile = require('../assets/images/mine_tile.png');
const craterTile = require('../assets/images/crater_tile.png');

export default function NativeMapRenderer({
    game,
    currentTurn,
    turnRole,
    myPlayerId,
    isHumanTurn,
    isGameOver,
    isReplayMode,
    playfieldDelegate,
    forceUpdate,
    children,
    tick
}: MapRendererProps) {
    const [selectedCell, setSelectedCell] = useState<{ r: number, c: number } | null>(null);
    const [popupSize, setPopupSize] = useState({ width: 0, height: 0 });
    const [highlight] = useState(game.highlight_weapon);
    const [pendingSacrifice, setPendingSacrifice] = useState<[number, number] | null>(null);
    const [layout, setLayout] = useState({ width: 0, height: 0 });

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

    const onLayout = (event: any) => {
        const { width, height } = event.nativeEvent.layout;
        setLayout({ width, height });
        layoutWidth.value = width;
        layoutHeight.value = height;
    };

    const handleCellPress = (r: number, c: number) => {
        if (isReplayMode) return;
        if (!isHumanTurn) return;

        const cell = game.grid[r][c];
        const weaponCells = game.getWeaponCells();
        const isWeaponPart = weaponCells.has(`${r},${c}`);

        if (cell === game.players[currentTurn].st && isWeaponPart) {
            if (pendingSacrifice && pendingSacrifice[0] === r && pendingSacrifice[1] === c) {
                setPendingSacrifice(null);
            } else {
                setPendingSacrifice([r, c]);
            }
            forceUpdate();
            return;
        }

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

    const weaponCells = highlight ? game.getWeaponCells() : new Set();
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
        if (item === '█') bgColor = '#646464';

        const canBuildHighlight = item === '.' && isHumanTurn && game.canBuild(r, c, currentTurn);

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
                        source={baseTile}
                        style={{ position: 'absolute', width: '100%', height: '100%', opacity: 1.0 }}
                        resizeMode="cover"
                    />
                )}
                {isMine && (
                    <Image
                        source={mineTile}
                        style={{ position: 'absolute', width: '100%', height: '100%', opacity: 1.0 }}
                        resizeMode="cover"
                    />
                )}
                {isDestroyed && (
                    <Image
                        source={craterTile}
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

    // Re-compute flatGrid whenever tick changes so FlatList sees new data reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const flatGrid = useMemo(() => game.grid.flat(), [tick, game]);

    return (
        <GestureDetector gesture={composedGesture}>
            <View style={styles.gridContainer} onLayout={onLayout} ref={gridRef as any}>
                {children}
                <Reanimated.View style={[{ alignItems: 'center', justifyContent: 'center' }, animatedStyle]}>
                    {cellSize > 0 && (
                        <View style={{ width: cellSize * game.width, height: cellSize * game.height }}>
                            <FlatList
                                data={flatGrid}
                                renderItem={renderCell}
                                extraData={{ tick, highlight, pendingSacrifice }}
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
    );
}

const styles = StyleSheet.create({
    gridContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    cell: { borderWidth: 1, borderColor: '#333', alignItems: 'center', justifyContent: 'center' },
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
});

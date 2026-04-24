import { GLView } from 'expo-gl';
import React, { useCallback, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as THREE from 'three';
import { MapRendererProps } from './MapRenderer';
import { PlayerId } from '../src/logic/MarsMinersGame';
import { t } from '../src/logic/locales';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Asset } from 'expo-asset';

// ─── Cell type helpers ───────────────────────────────────────────────────────

function getCellInfo(item: string, game: MapRendererProps['game'], currentTurn: PlayerId) {
    let isBase = false;
    let isMine = false;
    let isDestroyed = item === '█';
    let isEmpty = item === '.';
    let color = new THREE.Color('#1e1e1e');
    let height = 0.1;

    if (isEmpty || isDestroyed) {
        color = isDestroyed ? new THREE.Color('#464646') : new THREE.Color('#1a1a2e');
        height = 0.05;
    } else {
        for (const pidStr in game.players) {
            const pid = parseInt(pidStr) as PlayerId;
            const p = game.players[pid];
            if (item === p.st) {
                isBase = true;
                color = new THREE.Color(p.color);
                height = 0.5;
                break;
            }
            if (item === p.mi) {
                isMine = true;
                color = new THREE.Color(p.color).multiplyScalar(0.6);
                height = 0.25;
                break;
            }
        }
    }

    return { isBase, isMine, isDestroyed, isEmpty, color, height };
}

// ─── Three.js scene held in a ref (imperative, like threeSceneController.js) ─

interface ThreeScene {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    cellMeshes: Map<string, THREE.Mesh>;
    weaponHighlights: Map<string, THREE.Mesh>;
    animFrameId: number;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ThreeMapRenderer({
    game,
    currentTurn,
    isHumanTurn,
    isGameOver,
    isReplayMode,
    playfieldDelegate,
    forceUpdate,
    tick,
    children,
}: MapRendererProps) {
    const sceneRef = useRef<ThreeScene | null>(null);
    const [selectedCell, setSelectedCell] = useState<{ r: number; c: number } | null>(null);
    const [pendingSacrifice, setPendingSacrifice] = useState<[number, number] | null>(null);
    const [glSize, setGlSize] = useState({ width: 0, height: 0 });

    // Grid sizing: each cell is 1 unit. Grid is centered at (0, 0, 0).
    const CELL = 1.0;
    const GAP = 0.05;
    const gridW = game.width;
    const gridH = game.height;
    const offsetX = -(gridW * (CELL + GAP)) / 2 + CELL / 2;
    const offsetZ = -(gridH * (CELL + GAP)) / 2 + CELL / 2;

    const cameraState = useRef({
        panX: 0,
        panZ: 0,
        zoom: 1,
        startPanX: 0,
        startPanZ: 0,
        startZoom: 1
    });

    // Build / rebuild the grid meshes whenever tick changes
    const rebuildGrid = useCallback((scene: ThreeScene) => {
        // Remove old cell meshes
        scene.cellMeshes.forEach(mesh => {
            scene.scene.remove(mesh);
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
        });
        scene.cellMeshes.clear();

        scene.weaponHighlights.forEach(mesh => {
            scene.scene.remove(mesh);
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
        });
        scene.weaponHighlights.clear();

        const weaponCells = game.highlight_weapon ? game.getWeaponCells() : new Set<string>();

        for (let r = 0; r < gridH; r++) {
            for (let c = 0; c < gridW; c++) {
                const item = game.grid[r][c];
                const key = `${r},${c}`;
                const { color, height } = getCellInfo(item, game, currentTurn);

                const isWeaponPart = weaponCells.has(key);
                const isSelectedSacrifice = pendingSacrifice && pendingSacrifice[0] === r && pendingSacrifice[1] === c;

                // Determine effective color with highlights
                let effectiveColor = color.clone();
                if (isWeaponPart) {
                    const isEnemyWeapon = (() => {
                        for (const pidStr in game.players) {
                            const pid = parseInt(pidStr) as PlayerId;
                            if (pid !== currentTurn && item === game.players[pid].st) return true;
                        }
                        return false;
                    })();
                    effectiveColor = isEnemyWeapon
                        ? new THREE.Color('#ff6400')
                        : new THREE.Color('#ffff00');
                }
                if (isSelectedSacrifice) {
                    effectiveColor = new THREE.Color('#ff3b30');
                }

                const geo = new THREE.BoxGeometry(CELL, height, CELL);
                const mat = new THREE.MeshStandardMaterial({
                    color: effectiveColor,
                    roughness: 0.7,
                    metalness: 0.2,
                });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.set(
                    offsetX + c * (CELL + GAP),
                    height / 2,
                    offsetZ + r * (CELL + GAP)
                );
                mesh.receiveShadow = true;
                mesh.castShadow = true;
                scene.scene.add(mesh);
                scene.cellMeshes.set(key, mesh);
            }
        }
    }, [tick, pendingSacrifice, currentTurn, game, gridW, gridH, offsetX, offsetZ, CELL, GAP]);

    // ── expo-gl context created ───────────────────────────────────────────────
    const onContextCreate = useCallback((gl: any) => {
        const w = gl.drawingBufferWidth;
        const h = gl.drawingBufferHeight;

        // Renderer
        const renderer = new THREE.WebGLRenderer({
            // @ts-ignore – expo-gl passes a WebGL-compatible context
            context: gl,
            antialias: true,
        });
        renderer.setSize(w, h);
        renderer.setPixelRatio(1);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 0.9;

        // Scene
        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#0d0d1a');

        // Camera – isometric-ish perspective looking down
        const aspect = w / h;
        const camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 200);
        const camDist = Math.max(gridW, gridH) * 1.1;
        camera.position.set(0, camDist * 1.0, camDist * 0.7);
        camera.lookAt(0, 0, 0);

        // Lights
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambient);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        dirLight.position.set(5, 10, 5);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 1024;
        dirLight.shadow.mapSize.height = 1024;
        scene.add(dirLight);

        // Ground plane
        const groundGeo = new THREE.PlaneGeometry(gridW * (CELL + GAP) + 1, gridH * (CELL + GAP) + 1);
        const groundMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 });
        const ground = new THREE.Mesh(groundGeo, groundMat);
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);

        // Load ground texture asynchronously
        (async () => {
            try {
                const asset = Asset.fromModule(require('../assets/images/empty_tile_1.png'));
                await asset.downloadAsync();
                const uri = asset.localUri || asset.uri;
                if (uri) {
                    const textureLoader = new THREE.TextureLoader();
                    textureLoader.load(uri, (texture) => {
                        texture.wrapS = THREE.RepeatWrapping;
                        texture.wrapT = THREE.RepeatWrapping;
                        texture.repeat.set(gridW, gridH);
                        groundMat.map = texture;
                        groundMat.color = new THREE.Color('#333333'); // Darken it slightly so it looks like ground
                        groundMat.needsUpdate = true;
                    });
                }
            } catch (e) {
                console.warn('Failed to load ground texture', e);
            }
        })();

        const threeScene: ThreeScene = {
            renderer,
            scene,
            camera,
            cellMeshes: new Map(),
            weaponHighlights: new Map(),
            animFrameId: 0,
        };
        sceneRef.current = threeScene;

        rebuildGrid(threeScene);

        // Render loop
        const render = () => {
            threeScene.animFrameId = requestAnimationFrame(render);

            const camDist = Math.max(gridW, gridH) * 1.1 / cameraState.current.zoom;
            camera.position.set(
                cameraState.current.panX,
                camDist * 1.0,
                cameraState.current.panZ + camDist * 0.7
            );
            camera.lookAt(cameraState.current.panX, 0, cameraState.current.panZ);

            renderer.render(scene, camera);
            gl.endFrameEXP();
        };
        render();
    }, [gridW, gridH, CELL, GAP]); // Recreate context logic only if grid size drastically changes

    // Rebuild grid whenever tick/state changes
    React.useEffect(() => {
        if (sceneRef.current) {
            rebuildGrid(sceneRef.current);
        }
    }, [tick, pendingSacrifice, rebuildGrid]);

    // ── Touch / tap handling ──────────────────────────────────────────────────
    const handleTap = useCallback((e: any) => {
        if (!sceneRef.current || isReplayMode || !isHumanTurn) return;

        const locationX = e.x;
        const locationY = e.y;
        const { width, height } = glSize;
        if (width === 0 || height === 0) return;

        // Normalize device coords
        const ndcX = (locationX / width) * 2 - 1;
        const ndcY = -(locationY / height) * 2 + 1;

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), sceneRef.current.camera);

        const meshes = Array.from(sceneRef.current.cellMeshes.values());
        const hits = raycaster.intersectObjects(meshes);

        if (hits.length === 0) {
            setSelectedCell(null);
            return;
        }

        const hitMesh = hits[0].object;
        let hitKey: string | null = null;
        sceneRef.current.cellMeshes.forEach((mesh, key) => {
            if (mesh === hitMesh) hitKey = key;
        });
        if (!hitKey) return;

        const [r, c] = (hitKey as string).split(',').map(Number);
        const cell = game.grid[r][c];
        const weaponCells = game.getWeaponCells();
        const isWeaponPart = weaponCells.has(`${r},${c}`);

        // Sacrifice selection
        if (cell === game.players[currentTurn].st && isWeaponPart) {
            if (pendingSacrifice && pendingSacrifice[0] === r && pendingSacrifice[1] === c) {
                setPendingSacrifice(null);
            } else {
                setPendingSacrifice([r, c]);
            }
            forceUpdate();
            return;
        }

        // Laser attack
        let enemyId: PlayerId | null = null;
        for (const pidStr in game.players) {
            const pid = parseInt(pidStr) as PlayerId;
            if (pid !== currentTurn && cell === game.players[pid].st) {
                enemyId = pid;
                break;
            }
        }
        if (enemyId !== null) {
            if (pendingSacrifice) {
                const [sr, sc] = pendingSacrifice;
                playfieldDelegate.shootLaser(r, c, sr, sc);
                setPendingSacrifice(null);
                forceUpdate();
            }
            return;
        }

        // Build selection
        if (cell === '.' && game.canBuild(r, c, currentTurn)) {
            if (selectedCell && selectedCell.r === r && selectedCell.c === c) {
                setSelectedCell(null);
            } else {
                setSelectedCell({ r, c });
            }
            setPendingSacrifice(null);
            forceUpdate();
        } else {
            setSelectedCell(null);
        }
    }, [game, currentTurn, isHumanTurn, isReplayMode, pendingSacrifice, selectedCell, playfieldDelegate, forceUpdate, glSize]);

    const panGesture = Gesture.Pan()
        .runOnJS(true)
        .onStart(() => {
            cameraState.current.startPanX = cameraState.current.panX;
            cameraState.current.startPanZ = cameraState.current.panZ;
        })
        .onUpdate((e) => {
            const scale = (Math.max(gridW, gridH) / 300) / cameraState.current.zoom;
            cameraState.current.panX = cameraState.current.startPanX - e.translationX * scale;
            cameraState.current.panZ = cameraState.current.startPanZ - e.translationY * scale;
        });

    const pinchGesture = Gesture.Pinch()
        .runOnJS(true)
        .onStart(() => {
            cameraState.current.startZoom = cameraState.current.zoom;
        })
        .onUpdate((e) => {
            cameraState.current.zoom = Math.max(0.5, Math.min(3.0, cameraState.current.startZoom * e.scale));
        });

    const tapGesture = Gesture.Tap()
        .runOnJS(true)
        .onEnd((e) => {
            handleTap(e);
        });

    const composedGesture = Gesture.Simultaneous(panGesture, pinchGesture, tapGesture);

    return (
        <View style={styles.container}>
            {/* Three.js GL canvas */}
            <GestureDetector gesture={composedGesture}>
                <View
                    style={styles.glContainer}
                    onLayout={e => setGlSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
                >
                    <GLView
                        style={StyleSheet.absoluteFill}
                        onContextCreate={onContextCreate}
                    />
                </View>
            </GestureDetector>

            {/* Children (e.g. AI thinking overlay) */}
            {children}

            {/* Dismiss overlay when cell selected */}
            {selectedCell && (
                <Pressable
                    style={styles.dismissOverlay}
                    onPress={() => setSelectedCell(null)}
                />
            )}

            {/* Build popup */}
            {selectedCell && (
                <View style={styles.buildPopup} pointerEvents="box-none">
                    <TouchableOpacity
                        style={styles.buildBtn}
                        onPress={() => {
                            playfieldDelegate.buildStation(selectedCell.r, selectedCell.c);
                            setSelectedCell(null);
                            forceUpdate();
                        }}
                    >
                        <Text style={styles.buildBtnText}>{t('base_btn', 'en')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.buildBtn, { backgroundColor: '#e67e22' }]}
                        onPress={() => {
                            playfieldDelegate.buildMine(selectedCell.r, selectedCell.c);
                            setSelectedCell(null);
                            forceUpdate();
                        }}
                    >
                        <Text style={styles.buildBtnText}>{t('mine_btn', 'en')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.buildBtn, { backgroundColor: '#444' }]}
                        onPress={() => setSelectedCell(null)}
                    >
                        <Text style={styles.buildBtnText}>×</Text>
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#0d0d1a',
    },
    glContainer: {
        flex: 1,
    },
    dismissOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 5,
    },
    buildPopup: {
        position: 'absolute',
        bottom: 40,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'center',
        zIndex: 20,
    },
    buildBtn: {
        backgroundColor: '#007AFF',
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 10,
        marginHorizontal: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.4,
        shadowRadius: 4,
        elevation: 5,
    },
    buildBtnText: {
        color: '#fff',
        fontWeight: 'bold',
        fontSize: 16,
    },
});

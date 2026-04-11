import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { getLocales } from 'expo-localization';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Clipboard, Modal, Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { t } from '../src/logic/locales';

const menuVideo = require('../assets/videos/menu.mp4');

export default function MainMenu() {
    const router = useRouter();
    const { width, height } = useWindowDimensions();
    const [lang, setLang] = useState<'en' | 'ru'>('en');
    const [showTrainingRules, setShowTrainingRules] = useState(false);
    const [showSingleplayerModal, setShowSingleplayerModal] = useState(false);
    const [showMultiplayerModal, setShowMultiplayerModal] = useState(false);
    const [showSessionIdModal, setShowSessionIdModal] = useState(false);
    const [generatedSessionId, setGeneratedSessionId] = useState('');
    const [generatedUserId, setGeneratedUserId] = useState('');

    const player = useVideoPlayer(menuVideo, player => {
        player.loop = true;
        player.muted = true;
    });

    useEffect(() => {
        if (player) {
            player.play();
        }
    }, [player]);

    const startTraining = () => {
        setShowTrainingRules(false);
        router.push({
            pathname: '/game',
            params: {
                roles: JSON.stringify({ 1: 'human', 2: 'easy_ai', 3: 'none', 4: 'none' }),
                grid_width: '10',
                grid_height: '10',
                weapon_req: '4'
            }
        });
    };

    useEffect(() => {
        const deviceLang = getLocales()[0]?.languageCode?.startsWith('ru') ? 'ru' : 'en';
        setLang(deviceLang);
    }, []);

    useEffect(() => {
        if (Platform.OS === 'web') {
            document.title = 'Mars Miners';
        }
    }, []);

    const startNewGame = () => {
        router.push('/setup');
    };

    const loadGame = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: ['application/json', 'text/plain'],
                copyToCacheDirectory: true
            });

            if (result.canceled) return;

            let fileContent: string;
            if (Platform.OS === 'web') {
                const response = await fetch(result.assets[0].uri);
                fileContent = await response.text();
            } else {
                fileContent = await FileSystem.readAsStringAsync(result.assets[0].uri);
            }

            const lines = fileContent.split('\n').filter(l => l.trim().length > 0);
            const weaponLine = lines.find(l => l.startsWith('WEAPON_REQ '));
            const joinLines = lines.filter(l => l.startsWith('JOIN '));

            if (!weaponLine || joinLines.length === 0) {
                // Fallback to JSON if it's an old save
                try {
                    const state = JSON.parse(fileContent);
                    router.push({
                        pathname: '/game',
                        params: {
                            roles: JSON.stringify(state.roles || { 1: 'human', 2: 'normal_ai', 3: 'none', 4: 'none' }),
                            grid_width: '10',
                            grid_height: '10',
                            weapon_req: (state.weapon_req || 4).toString(),
                            restore_state: fileContent
                        }
                    });
                    return;
                } catch {
                    throw new Error("Invalid log file: Missing standard configurations");
                }
            }

            const weaponReq = parseInt(weaponLine.split(' ')[1]) || 4;
            const roles: Record<number, string> = { 1: 'none', 2: 'none', 3: 'none', 4: 'none' };
            joinLines.forEach((l, i) => {
                roles[i + 1] = l.split(' ')[1];
            });

            router.push({
                pathname: '/game',
                params: {
                    roles: JSON.stringify(roles),
                    grid_width: '10',
                    grid_height: '10',
                    weapon_req: weaponReq.toString(),
                    restore_state: JSON.stringify({ battleLog: lines })
                }
            });
        } catch (e) {
            console.error("Failed to load game", e);
            Alert.alert("Error", "Failed to load save file. Please ensure it's a valid Mars Miners save.");
        }
    };

    const playBattlelog = async () => {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: ['application/json', 'text/plain'],
                copyToCacheDirectory: true
            });

            if (result.canceled) return;

            let fileContent: string;
            if (Platform.OS === 'web') {
                const response = await fetch(result.assets[0].uri);
                fileContent = await response.text();
            } else {
                fileContent = await FileSystem.readAsStringAsync(result.assets[0].uri);
            }

            const lines = fileContent.split('\n').filter(l => l.trim().length > 0);
            const weaponLine = lines.find(l => l.startsWith('WEAPON_REQ '));
            const joinLines = lines.filter(l => l.startsWith('JOIN '));

            if (joinLines.length === 0) {
                try {
                    // Try to parse as old JSON format if it's not a text log
                    const state = JSON.parse(fileContent);
                    if (state.roles) {
                        router.push({
                            pathname: '/game',
                            params: {
                                roles: JSON.stringify(state.roles),
                                grid_width: '10',
                                grid_height: '10',
                                weapon_req: (state.weapon_req || 4).toString(),
                                restore_state: fileContent,
                                mode: 'replay'
                            }
                        });
                        return;
                    }
                } catch {
                    throw new Error("Invalid log file");
                }
            }

            const weaponReq = parseInt(weaponLine ? weaponLine.split(' ')[1] : '4') || 4;
            const roles: Record<number, string> = { 1: 'none', 2: 'none', 3: 'none', 4: 'none' };
            joinLines.forEach((l, i) => {
                roles[i + 1] = l.split(' ')[1];
            });

            router.push({
                pathname: '/game',
                params: {
                    roles: JSON.stringify(roles),
                    grid_width: '10',
                    grid_height: '10',
                    weapon_req: weaponReq.toString(),
                    restore_state: JSON.stringify({ battleLog: lines }),
                    mode: 'replay'
                }
            });
        } catch (e) {
            console.error("Failed to load battle record", e);
            Alert.alert("Error", "Failed to load battle record");
        }
    };

    const createMultiplayerGame = () => {
        const sessionId = Math.random().toString(36).substring(2, 10);
        const userId = Math.random().toString(36).substring(2, 10);
        setGeneratedSessionId(sessionId);
        setGeneratedUserId(userId);
        setShowMultiplayerModal(false);
        setShowSessionIdModal(true);
    };

    const proceedToGame = () => {
        setShowSessionIdModal(false);
        router.push({
            pathname: '/game',
            params: {
                roles: JSON.stringify({ 1: 'human', 2: 'none', 3: 'none', 4: 'none' }),
                grid_width: '10',
                grid_height: '10',
                weapon_req: '4',
                mode: 'multi',
                session_id: generatedSessionId,
                user_id: generatedUserId,
                create_session: 'true'
            }
        });
    };

    const copySessionId = () => {
        Clipboard.setString(generatedSessionId);
        Alert.alert(t('copy_btn', lang), generatedSessionId);
    };

    const joinMultiplayerGame = () => {
        setShowMultiplayerModal(false);
        router.push('/multiplayer');
    };

    const handleSingleplayerTraining = () => {
        setShowSingleplayerModal(false);
        setShowTrainingRules(true);
    };

    const handleSingleplayerNewGame = () => {
        setShowSingleplayerModal(false);
        router.push('/setup');
    };

    const handleSingleplayerLoad = () => {
        setShowSingleplayerModal(false);
        loadGame();
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', zIndex: -1 }]}>
                <VideoView 
                    style={{
                        width: Math.max(width, height),
                        height: Math.max(width, height),
                        position: 'absolute'
                    }} 
                    player={player} 
                    contentFit="cover"
                    nativeControls={false}
                />
            </View>
            <View style={styles.content}>
                <Text style={styles.title}>MARS MINERS</Text>

                <View style={styles.buttonContainer}>
                    <TouchableOpacity 
                        onPress={() => setShowSingleplayerModal(true)} 
                        style={styles.button}
                        testID="singleplayer-button"
                    >
                        <Text style={styles.buttonText}>{t('singleplayer', lang)}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                        onPress={() => setShowMultiplayerModal(true)} 
                        style={[styles.button, styles.multiButton]}
                        testID="multiplayer-button"
                    >
                        <Text style={styles.buttonText}>{t('multiplayer', lang)}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity onPress={playBattlelog} style={[styles.button, { backgroundColor: '#5856d6' }]}>
                        <Text style={styles.buttonText}>{t('battlelog_player_btn', lang)}</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <Modal
                visible={showSingleplayerModal}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setShowSingleplayerModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>{t('singleplayer', lang)}</Text>
                        
                        <TouchableOpacity 
                            style={[styles.modalButton, { backgroundColor: '#8a2be2', width: '100%', marginBottom: 15 }]} 
                            onPress={handleSingleplayerTraining}
                            testID="training-button"
                        >
                            <Text style={styles.modalButtonText}>{t('training_btn', lang)}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity 
                            style={[styles.modalButton, { backgroundColor: '#4a9eff', width: '100%', marginBottom: 15 }]} 
                            onPress={handleSingleplayerNewGame}
                            testID="new-game-button"
                        >
                            <Text style={styles.modalButtonText}>{t('new_game_btn', lang)}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity 
                            style={[styles.modalButton, { backgroundColor: '#34c759', width: '100%', marginBottom: 15 }]} 
                            onPress={handleSingleplayerLoad}
                            testID="load-game-button"
                        >
                            <Text style={styles.modalButtonText}>{t('load_game_btn', lang)}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity 
                            style={[styles.modalButton, styles.modalCancelButton, { width: '100%' }]} 
                            onPress={() => setShowSingleplayerModal(false)}
                        >
                            <Text style={styles.modalButtonText}>{lang === 'ru' ? 'Отмена' : 'Cancel'}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
            <Modal
                visible={showTrainingRules}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setShowTrainingRules(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>{t('training_rules_title', lang)}</Text>
                        <Text style={styles.modalMessage}>{t('training_rules_text', lang)}</Text>
                        <View style={styles.modalButtons}>
                            <TouchableOpacity style={[styles.modalButton, styles.modalCancelButton]} onPress={() => setShowTrainingRules(false)}>
                                <Text style={styles.modalButtonText}>{lang === 'ru' ? 'Отмена' : 'Cancel'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity 
                                style={styles.modalButton} 
                                onPress={startTraining}
                                testID="start-training-confirm"
                            >
                                <Text style={styles.modalButtonText}>{t('start_training_btn', lang)}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            <Modal
                visible={showMultiplayerModal}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setShowMultiplayerModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>{t('multiplayer', lang)}</Text>
                        <Text style={styles.modalMessage}>{lang === 'ru' ? 'Выберите режим сетевой игры' : 'Choose multiplayer mode'}</Text>
                        
                        <TouchableOpacity 
                            style={[styles.modalButton, { backgroundColor: '#34c759', width: '100%', marginBottom: 15 }]} 
                            onPress={createMultiplayerGame}
                            testID="create-battle-button"
                        >
                            <Text style={styles.modalButtonText}>{t('create_session', lang)}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity 
                            style={[styles.modalButton, { backgroundColor: '#007AFF', width: '100%', marginBottom: 15 }]} 
                            onPress={joinMultiplayerGame}
                            testID="join-battle-button"
                        >
                            <Text style={styles.modalButtonText}>{t('join_game_btn', lang)}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity 
                            style={[styles.modalButton, styles.modalCancelButton, { width: '100%' }]} 
                            onPress={() => setShowMultiplayerModal(false)}
                        >
                            <Text style={styles.modalButtonText}>{lang === 'ru' ? 'Отмена' : 'Cancel'}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>

            <Modal
                visible={showSessionIdModal}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setShowSessionIdModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <Text style={styles.modalTitle}>{lang === 'ru' ? 'Сессия создана' : 'Session Created'}</Text>
                        <Text style={styles.modalMessage}>{t('session_id', lang)}: {generatedSessionId}</Text>
                        
                        <TouchableOpacity 
                            style={[styles.modalButton, { backgroundColor: '#34c759', width: '100%', marginBottom: 15 }]} 
                            onPress={copySessionId}
                            testID="copy-session-button"
                        >
                            <Text style={styles.modalButtonText}>{t('copy_btn', lang)}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity 
                            style={[styles.modalButton, { backgroundColor: '#007AFF', width: '100%' }]} 
                            onPress={proceedToGame}
                            testID="session-modal-ok"
                        >
                            <Text style={styles.modalButtonText}>{t('ok', lang)}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#121212' },
    content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
    title: { fontSize: 40, fontWeight: 'bold', color: '#ff4d4d', letterSpacing: 5, marginBottom: 60, textAlign: 'center' },
    buttonContainer: { width: '100%', maxWidth: 300 },
    button: {
        backgroundColor: '#4a9eff',
        paddingVertical: 15,
        borderRadius: 12,
        alignItems: 'center',
        marginBottom: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 5,
        elevation: 8
    },
    loadButton: { backgroundColor: '#34c759' },
    multiButton: { backgroundColor: '#ff9500' },
    trainingButton: { backgroundColor: '#8a2be2' },
    buttonText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.7)', justifyContent: 'center', alignItems: 'center' },
    modalContent: { backgroundColor: '#2a2a2a', padding: 30, borderRadius: 15, alignItems: 'center', minWidth: 300, maxWidth: '90%' },
    modalTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff', marginBottom: 15, textAlign: 'center' },
    modalMessage: { fontSize: 16, color: '#ccc', textAlign: 'center', marginBottom: 25, lineHeight: 24 },
    modalButtons: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', marginTop: 10 },
    modalButton: { backgroundColor: '#007AFF', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8, flex: 1, marginHorizontal: 5, alignItems: 'center' },
    modalCancelButton: { backgroundColor: '#555' },
    modalButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' }
});

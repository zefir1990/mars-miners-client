import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { getLocales } from 'expo-localization';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t } from '../src/logic/locales';

export default function MainMenu() {
    const router = useRouter();
    const [lang, setLang] = useState<'en' | 'ru'>('en');

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
                } catch (e) {
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

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.content}>
                <Text style={styles.title}>MARS MINERS</Text>

                <View style={styles.buttonContainer}>
                    <TouchableOpacity onPress={startNewGame} style={styles.button}>
                        <Text style={styles.buttonText}>{t('new_game_btn', lang) || "New Game"}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity onPress={loadGame} style={[styles.button, styles.loadButton]}>
                        <Text style={styles.buttonText}>{t('load_game_btn', lang)}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity onPress={() => router.push('/multiplayer')} style={[styles.button, styles.multiButton]}>
                        <Text style={styles.buttonText}>{t('multiplayer', lang)}</Text>
                    </TouchableOpacity>
                </View>
            </View>
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
    buttonText: { color: '#fff', fontSize: 20, fontWeight: 'bold' }
});

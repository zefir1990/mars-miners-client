import { getLocales } from 'expo-localization';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert, Clipboard, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t } from '../src/logic/locales';

export default function MultiplayerScreen() {
    const router = useRouter();
    const [lang, setLang] = useState<'en' | 'ru'>('en');

    useEffect(() => {
        const detected = getLocales()[0]?.languageCode?.startsWith('ru') ? 'ru' : 'en';
        setLang(detected);
    }, []);

    useEffect(() => {
        document.title = 'Mars Miners - Multiplayer';
    }, []);
    const [sessionId, setSessionId] = useState('');
    const generateId = () => Math.random().toString(36).substring(2, 10);
    const [userId, setUserId] = useState("");

    useEffect(() => {
        setUserId(generateId());
    }, []);

    const startGame = (isCreate: boolean, idOverride?: string) => {
        const targetId = idOverride || sessionId;
        if (!targetId) return;

        router.push({
            pathname: '/game',
            params: {
                roles: JSON.stringify({ 1: 'human', 2: 'none', 3: 'none', 4: 'none' }), // Multi logic: join as human
                grid_width: '10',
                grid_height: '10',
                weapon_req: '4',
                mode: 'multi',
                session_id: targetId,
                user_id: userId,
                create_session: isCreate ? 'true' : 'false'
            }
        });
    };

    const handleBack = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace('/');
        }
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
                    <Text style={styles.btnText}>←</Text>
                </TouchableOpacity>
                <Text style={styles.title}>{t('multiplayer', lang)}</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView style={styles.content}>
                <View style={styles.inputGroup}>
                    <Text style={styles.label}>{t('user_id', lang)}: {userId}</Text>
                </View>

                <View style={styles.inputGroup}>
                    <Text style={styles.label}>{t('session_id', lang)}:</Text>
                    <View style={styles.sessionInputRow}>
                        <TextInput
                            style={styles.textInput}
                            value={sessionId}
                            onChangeText={setSessionId}
                            placeholder="Enter Session ID"
                            placeholderTextColor="#666"
                        />
                    </View>
                </View>


                <View style={styles.spacer} />

                <TouchableOpacity
                    onPress={() => startGame(false)}
                    style={[styles.startButton, !sessionId && styles.disabledButton]}
                    disabled={!sessionId}
                    testID="join-game-final-button"
                >
                    <Text style={styles.startButtonText}>{t('join_game_btn', lang)}</Text>
                </TouchableOpacity>

                <View style={{ height: 20 }} />

            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#1e1e1e' },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, height: 60, borderBottomWidth: 1, borderBottomColor: '#333' },
    backBtn: { padding: 10 },
    btnText: { color: '#fff', fontSize: 24 },
    title: { flex: 1, fontSize: 20, fontWeight: 'bold', color: '#fff', textAlign: 'center' },
    content: { padding: 20 },
    inputGroup: { marginBottom: 20 },
    label: { color: '#fff', fontSize: 16, marginBottom: 8 },
    sessionInputRow: { flexDirection: 'row', alignItems: 'center' },
    textInput: { flex: 1, backgroundColor: '#333', color: '#fff', padding: 12, borderRadius: 8, marginRight: 10 },
    inlineButton: { backgroundColor: '#444', padding: 12, borderRadius: 8 },
    inlineButtonText: { color: '#fff', fontSize: 14 },
    shareBtn: { backgroundColor: '#28a745', padding: 15, borderRadius: 10, alignItems: 'center', marginTop: 10 },
    buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
    spacer: { height: 40 },
    startButton: { backgroundColor: '#4a9eff', padding: 18, borderRadius: 12, alignItems: 'center' },
    disabledButton: { backgroundColor: '#333' },
    startButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' }
});

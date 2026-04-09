import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PlayerId, PlayerRole } from '../src/logic/MarsMinersGame';
import { t } from '../src/logic/locales';

export default function SetupScreen() {
    const router = useRouter();
    const [lang, setLang] = useState<'en' | 'ru'>('en');

    useEffect(() => {
        const deviceLang = getLocales()[0]?.languageCode?.startsWith('ru') ? 'ru' : 'en';
        setLang(deviceLang);
    }, []);

    useEffect(() => {
        if (Platform.OS === 'web') {
            document.title = 'Mars Miners - Setup';
        }
    }, []);
    const [roles, setRoles] = useState<Record<PlayerId, PlayerRole>>({
        1: 'human', 2: 'normal_ai', 3: 'none', 4: 'none'
    });
    const [weaponReq, setWeaponReq] = useState(4);
    const [loaded, setLoaded] = useState(false);

    const normalizeRole = (role: string): PlayerRole => {
        switch (role) {
            case 'easy_ai':
            case 'normal_ai':
            case 'hard_ai':
            case 'human':
            case 'none':
                return role;
            case 'ai':
                return 'easy_ai';
            case 'warrior_ai':
                return 'hard_ai';
            default:
                return 'none';
        }
    };

    const normalizeRoles = (input: Record<string, string>): Record<PlayerId, PlayerRole> => ({
        1: normalizeRole(input[1] ?? input['1'] ?? 'human'),
        2: normalizeRole(input[2] ?? input['2'] ?? 'normal_ai'),
        3: normalizeRole(input[3] ?? input['3'] ?? 'none'),
        4: normalizeRole(input[4] ?? input['4'] ?? 'none'),
    });

    const cycleRole = (pid: PlayerId) => {
        const opts: PlayerRole[] = ['human', 'easy_ai', 'normal_ai', 'hard_ai', 'none'];
        setRoles(prev => ({
            ...prev,
            [pid]: opts[(opts.indexOf(prev[pid]) + 1) % opts.length]
        }));
    };

    const cycleWeaponReq = () => {
        const reqs = [3, 4, 5];
        setWeaponReq(r => reqs[(reqs.indexOf(r) + 1) % reqs.length]);
    };

    // Load defaults
    useEffect(() => {
        (async () => {
            try {
                const saved = await AsyncStorage.getItem('mm_setup_config');
                if (saved) {
                    const config = JSON.parse(saved);
                    if (config.roles) setRoles(normalizeRoles(config.roles));
                    if (config.weaponReq) setWeaponReq(config.weaponReq);
                }
            } catch (e) {
                console.log('Failed to load settings', e);
            } finally {
                setLoaded(true);
            }
        })();
    }, []);

    // Auto-save on change
    useEffect(() => {
        if (!loaded) return;
        const config = { roles, weaponReq };
        AsyncStorage.setItem('mm_setup_config', JSON.stringify(config)).catch(e => {
            console.log('Failed to save settings', e);
        });
    }, [loaded, roles, weaponReq]);

    const startGame = () => {
        router.push({
            pathname: '/game',
            params: {
                roles: JSON.stringify(roles),
                grid_width: '10',
                grid_height: '10',
                weapon_req: weaponReq.toString(),
                mode: 'single'
            }
        });
    };

    const handleBack = () => {
        router.back();
    };

    return (
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right', 'bottom']}>
            <View style={styles.header}>
                <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
                    <Text style={styles.btnText}>←</Text>
                </TouchableOpacity>
                <Text style={styles.title}>{t('setup_title', lang)}</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
                <Text style={styles.sectionHeader}>{t('assign_roles', lang)}</Text>
                {[1, 2, 3, 4].map(i => {
                    const pid = i as PlayerId;
                    const role = roles[pid];
                    let roleLabel = t(role, lang);

                    return (
                        <View key={pid} style={styles.playerCard}>
                            <View style={styles.row}>
                                <Text style={styles.label}>{t('player', lang)} {pid}:</Text>
                                <TouchableOpacity onPress={() => cycleRole(pid)} style={[styles.button, styles.roleButton]}>
                                    <Text style={styles.buttonText}>{roleLabel}</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    );
                })}

                <View style={styles.divider} />

                <View style={styles.row}>
                    <Text style={styles.label}>{t('weapon_req', lang)}</Text>
                    <TouchableOpacity onPress={cycleWeaponReq} style={styles.button}>
                        <Text style={styles.buttonText}>{weaponReq} {t('stations', lang)}</Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.spacer} />

                <TouchableOpacity onPress={startGame} style={styles.startButton}>
                    <Text style={styles.startButtonText}>{t('start_btn', lang)}</Text>
                </TouchableOpacity>
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
    scrollView: { flex: 1 },
    content: { padding: 20, paddingBottom: 50 },
    sectionHeader: { fontSize: 18, color: '#aaa', marginTop: 15, marginBottom: 10 },
    playerCard: { marginBottom: 12, backgroundColor: '#242424', borderRadius: 10, padding: 12 },
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    label: { color: '#fff', fontSize: 16 },
    button: { backgroundColor: '#333', padding: 10, borderRadius: 8, minWidth: 100, alignItems: 'center' },
    roleButton: { minWidth: 120 },
    buttonText: { color: '#fff', fontSize: 16 },
    divider: { height: 1, backgroundColor: '#444', marginVertical: 15 },
    spacer: { height: 30 },
    startButton: { backgroundColor: '#4a9eff', padding: 15, borderRadius: 10, alignItems: 'center' },
    startButtonText: { color: '#fff', fontSize: 18, fontWeight: 'bold' }
});

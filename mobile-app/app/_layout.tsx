import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts, RobotoMono_700Bold } from '@expo-google-fonts/roboto-mono';
import { Inter_900Black } from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';

import { GestureHandlerRootView } from 'react-native-gesture-handler';

const menuMusic = require('../assets/music/main.mp3');

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const interactionListenerRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const audio = new Audio(menuMusic);
    audio.loop = true;
    audio.volume = 0.5;
    audioRef.current = audio;

    const tryPlay = () => {
        const promise = audio.play();
        if (promise !== undefined) {
            promise.catch(() => {
                // Autoplay blocked — start on first user interaction
                const onInteraction = () => {
                    audio.play();
                    document.removeEventListener('click', onInteraction);
                    document.removeEventListener('touchstart', onInteraction);
                    document.removeEventListener('keydown', onInteraction);
                    interactionListenerRef.current = null;
                };
                interactionListenerRef.current = onInteraction;
                document.addEventListener('click', onInteraction, { once: false });
                document.addEventListener('touchstart', onInteraction, { once: false });
                document.addEventListener('keydown', onInteraction, { once: false });
            });
        }
    };

    tryPlay();

    return () => {
        audio.pause();
        audio.src = '';
        audioRef.current = null;
        if (interactionListenerRef.current) {
            document.removeEventListener('click', interactionListenerRef.current);
            document.removeEventListener('touchstart', interactionListenerRef.current);
            document.removeEventListener('keydown', interactionListenerRef.current);
            interactionListenerRef.current = null;
        }
    };
  }, []);

  const [loaded, error] = useFonts({
    RobotoMono_700Bold,
    Inter_900Black,
  });

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  useEffect(() => {
    if (Platform.OS === 'web') {
      document.body.style.backgroundColor = '#121212';
      // Prevent browser from automatically translating the page
      document.documentElement.setAttribute('translate', 'no');
      const meta = document.createElement('meta');
      meta.name = 'google';
      meta.content = 'notranslate';
      document.head.appendChild(meta);
    }
  }, []);

  if (!loaded && !error) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="index" options={{ title: 'Setup' }} />
            <Stack.Screen name="game" options={{ title: 'Mars Miners' }} />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

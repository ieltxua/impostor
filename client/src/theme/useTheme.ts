import { useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark';

const STORAGE_KEY = 'impostor-theme-preference';

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'light' || value === 'dark';
}

function getDefaultTheme(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return 'light';
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : getDefaultTheme();
  } catch {
    return getDefaultTheme();
  }
}

function writeStoredPreference(preference: ThemePreference) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Ignore storage write failures (e.g., private mode restrictions).
  }
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(() => readStoredPreference());

  useEffect(() => {
    writeStoredPreference(preference);
  }, [preference]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', preference);
  }, [preference]);

  return {
    preference,
    setPreference
  };
}

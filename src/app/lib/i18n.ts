import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { en } from './locales/en';
import { es } from './locales/es';
import { pt } from './locales/pt';
import { fr } from './locales/fr';
import { de } from './locales/de';
import { ru } from './locales/ru';

// French completion parts
import { frCompletionPart1 } from './locales/fr-completion-part1';
import { frCompletionPart2 } from './locales/fr-completion-part2';
import { frCompletionPart3 } from './locales/fr-completion-part3';
import { frCompletionPart4 } from './locales/fr-completion-part4';
import { frCompletionPart5 } from './locales/fr-completion-part5';
import { frCompletionPart6 } from './locales/fr-completion-part6';
import { frCompletionPart7 } from './locales/fr-completion-part7';
import { frCompletionPart8 } from './locales/fr-completion-part8';

// German completion parts
import { deCompletionPart1 } from './locales/de-completion-part1';
import { deCompletionPart2 } from './locales/de-completion-part2';
import { deCompletionPart3 } from './locales/de-completion-part3';
import { deCompletionPart4 } from './locales/de-completion-part4';
import { deCompletionPart5 } from './locales/de-completion-part5';
import { deCompletionPart6 } from './locales/de-completion-part6';
import { deCompletionPart7 } from './locales/de-completion-part7';
import { deCompletionPart8 } from './locales/de-completion-part8';

// Russian completion parts
import { ruCompletionPart1 } from './locales/ru-completion-part1';
import { ruCompletionPart2 } from './locales/ru-completion-part2';
import { ruCompletionPart3 } from './locales/ru-completion-part3';
import { ruCompletionPart4 } from './locales/ru-completion-part4';
import { ruCompletionPart5 } from './locales/ru-completion-part5';
import { ruCompletionPart6 } from './locales/ru-completion-part6';
import { ruCompletionPart7 } from './locales/ru-completion-part7';
import { ruCompletionPart8 } from './locales/ru-completion-part8';

// Deep merge utility
function deepMerge(target: any, ...sources: any[]): any {
  const result = { ...target };
  for (const source of sources) {
    if (!source) continue;
    for (const key of Object.keys(source)) {
      if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        result[key] &&
        typeof result[key] === 'object' &&
        !Array.isArray(result[key])
      ) {
        result[key] = deepMerge(result[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
  }
  return result;
}

// Merge all completion parts into base translations
const frComplete = {
  translation: deepMerge(
    fr.translation,
    frCompletionPart1,
    frCompletionPart2,
    frCompletionPart3,
    frCompletionPart4,
    frCompletionPart5,
    frCompletionPart6,
    frCompletionPart7,
    frCompletionPart8
  )
};

const deComplete = {
  translation: deepMerge(
    de.translation,
    deCompletionPart1,
    deCompletionPart2,
    deCompletionPart3,
    deCompletionPart4,
    deCompletionPart5,
    deCompletionPart6,
    deCompletionPart7,
    deCompletionPart8
  )
};

const ruComplete = {
  translation: deepMerge(
    ru.translation,
    ruCompletionPart1,
    ruCompletionPart2,
    ruCompletionPart3,
    ruCompletionPart4,
    ruCompletionPart5,
    ruCompletionPart6,
    ruCompletionPart7,
    ruCompletionPart8
  )
};

// Supported languages
const SUPPORTED_LANGS = ['en', 'es', 'pt', 'fr', 'de', 'ru'];

// Detect browser/system language and map to supported language
function detectBrowserLanguage(): string {
  try {
    const browserLangs = navigator.languages || [navigator.language];
    for (const lang of browserLangs) {
      const base = lang.split('-')[0].toLowerCase();
      if (SUPPORTED_LANGS.includes(base)) return base;
    }
  } catch {
    // navigator may not be available (SSR)
  }
  return 'en'; // fallback
}

// Retrieve saved language from localStorage, or detect from browser, fallback to English
let savedLanguage = 'en';
try {
  const stored = localStorage.getItem('contndr.language');
  if (stored && SUPPORTED_LANGS.includes(stored)) {
    savedLanguage = stored;
  } else {
    // No saved preference — use browser/system language
    savedLanguage = detectBrowserLanguage();
    // Persist detected language so it sticks
    localStorage.setItem('contndr.language', savedLanguage);
  }
} catch {
  // localStorage may not be available (SSR, privacy mode, etc.)
  savedLanguage = detectBrowserLanguage();
}

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en,
      es,
      pt,
      fr: frComplete,
      de: deComplete,
      ru: ruComplete
    },
    lng: savedLanguage,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;

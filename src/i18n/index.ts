/**
 * The interface's words, in the language the visitor reads. `t` holds the
 * current language's messages; `setLanguage` swaps them and tells the app,
 * which rebuilds itself with the new words.
 */
import { en } from './en';

/** The shape every language fills: the English messages with the words widened to `string`. */
export type Messages = Widen<typeof en>;
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => string
    ? (...args: A) => string
    : T extends readonly [infer A, infer B]
      ? readonly [Widen<A>, Widen<B>]
      : T extends readonly (infer E)[]
        ? readonly Widen<E>[]
        : { readonly [K in keyof T]: Widen<T[K]> };

export type Language = 'en' | 'zh' | 'ja' | 'de';
export const LANGUAGES: readonly Language[] = ['en', 'zh', 'ja', 'de'];
const LANGUAGE_KEY = 'origamio.lang';

const loaders: Record<Language, () => Promise<Messages>> = {
  en: () => Promise.resolve(en),
  zh: () => import('./zh').then((m) => m.zh),
  ja: () => import('./ja').then((m) => m.ja),
  de: () => import('./de').then((m) => m.de),
};

/** The current language's messages. The object is reused; its contents are swapped. */
export const t: Messages = { ...en };

let current: Language = 'en';
export const language = (): Language => current;

const listeners = new Set<(lang: Language) => void>();
/** Hear of every language change, after the words were swapped. */
export function onLanguageChange(listener: (lang: Language) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const isLanguage = (value: string | null | undefined): value is Language =>
  LANGUAGES.includes(value as Language);

/** The language to start in: the URL's `lang`, then the remembered one, then the browser's. */
export function detectLanguage(): Language {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (isLanguage(fromUrl)) return fromUrl;
  const remembered = ((): string | null => {
    try {
      return localStorage.getItem(LANGUAGE_KEY);
    } catch {
      return null;
    }
  })();
  if (isLanguage(remembered)) return remembered;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const primary = tag.toLowerCase().split('-')[0];
    if (isLanguage(primary)) return primary;
  }
  return 'en';
}

/** Switch the words; resolves once they are in place and the listeners have run. */
export async function setLanguage(lang: Language, remember = true): Promise<void> {
  const messages = await loaders[lang]();
  current = lang;
  Object.assign(t, messages);
  document.documentElement.lang = messages.tag;
  if (remember) {
    try {
      localStorage.setItem(LANGUAGE_KEY, lang);
    } catch {
      // The choice simply does not persist.
    }
  }
  for (const listener of listeners) listener(lang);
}

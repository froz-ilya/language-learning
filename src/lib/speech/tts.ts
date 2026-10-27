import { settings } from '../settings.svelte';
import { isAndroid } from '../platform';
import { showToast } from '../ui/dialogs.svelte';

/**
 * German text-to-speech through the browser's Web Speech API (works offline on iOS
 * with the built-in voices). iOS only plays speech started from a user gesture, so
 * call speak() from click handlers (autoplay after a tap in the same session is fine).
 */

const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
let voices: SpeechSynthesisVoice[] = [];

function loadVoices() {
  voices = synth?.getVoices() ?? [];
}
loadVoices();
synth?.addEventListener?.('voiceschanged', loadVoices);

export function isSpeechSupported(): boolean {
  return !!synth;
}

export type VoiceQuality = 'premium' | 'enhanced' | '';

/**
 * Quality tier of a voice. iOS/macOS often give an enhanced voice the same name as the compact
 * one ("Anna"), so the tier is only visible in the voiceURI (com.apple.voice.enhanced.de-DE.Anna).
 */
export function voiceQuality(v: SpeechSynthesisVoice): VoiceQuality {
  const id = `${v.name} ${v.voiceURI}`;
  if (/premium/i.test(id)) return 'premium';
  if (/enhanced|erweitert|verbessert|neural|natural/i.test(id)) return 'enhanced';
  return '';
}

/** Name shown in the voice picker, with the quality tier so same-named voices can be told apart. */
export function voiceLabel(v: SpeechSynthesisVoice): string {
  const q = voiceQuality(v);
  const tier = q === 'premium' ? 'Premium' : q === 'enhanced' ? 'Enhanced' : '';
  const name = tier && !new RegExp(tier, 'i').test(v.name) ? `${v.name} · ${tier}` : v.name;
  return `${name} (${v.lang})`;
}

/** German voices, best first (enhanced/premium voices are much more natural). */
export function germanVoices(): SpeechSynthesisVoice[] {
  if (!voices.length) loadVoices();
  const score = (v: SpeechSynthesisVoice) => {
    const q = voiceQuality(v);
    return (
      (v.lang.replace('_', '-') === 'de-DE' ? 4 : 0) +
      (q === 'premium' ? 3 : q === 'enhanced' ? 2 : 0) +
      (v.localService ? 1 : 0) -
      // Apple's novelty voices (Grandma, Rocko, …) sound robotic.
      (/eloquence|speech\.synthesis\.voice/i.test(v.voiceURI) ? 2 : 0)
    );
  };
  // Some browsers list a voice twice; the picker needs unique ids.
  const seen = new Set<string>();
  return voices
    .filter((v) => v.lang.toLowerCase().startsWith('de') && !seen.has(v.voiceURI) && seen.add(v.voiceURI))
    .sort((a, b) => score(b) - score(a));
}

export const ANDROID_VOICE_TIP =
  'Install a German voice: Android Settings → Text-to-speech → Google → Install voice data → Deutsch';
export const IOS_VOICE_TIP = 'Better voices: iOS Settings → Accessibility → Spoken Content → Voices → German.';
/**
 * iOS gives web apps only some of the installed voices: many downloaded Enhanced/Premium voices
 * and all Siri voices never reach getVoices() (WebKit bug 290497).
 */
export const IOS_VOICE_NOTE =
  'iOS shares only some voices with web apps. After downloading a German voice (Settings → Accessibility → Spoken Content → Voices), close this app fully and reopen it. If the voice still isn\'t listed here, iOS doesn\'t let web apps use it; Siri voices never work.';

/** Where to get a (better) German voice on this device. */
export function voiceTip(): string {
  return isAndroid() ? ANDROID_VOICE_TIP : IOS_VOICE_TIP;
}

const VOICE_TIP_KEY = 'voiceTipShown';
let voiceTipChecked = false;

/**
 * The first time speech is used without any German voice, say how to install one (once ever).
 * Voice lists load late (Chrome on Android), so look again a moment after the first speak().
 */
function checkGermanVoice() {
  if (voiceTipChecked) return;
  voiceTipChecked = true;
  try {
    if (localStorage.getItem(VOICE_TIP_KEY)) return;
  } catch {
    // storage blocked: show it once per launch
  }
  setTimeout(() => {
    if (germanVoices().length) return;
    showToast(voiceTip(), { timeout: 9000 });
    try {
      localStorage.setItem(VOICE_TIP_KEY, '1');
    } catch {
      // see above
    }
  }, 1200);
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const list = germanVoices();
  return list.find((v) => v.voiceURI === settings.voiceURI) ?? list[0];
}

export function speak(text: string, opts: { slow?: boolean } = {}): void {
  if (!synth || !text.trim()) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE';
  const voice = pickVoice();
  if (voice) u.voice = voice;
  else checkGermanVoice();
  u.rate = opts.slow ? 0.6 : settings.rate;
  synth.speak(u);
}

export function stopSpeaking(): void {
  synth?.cancel();
}

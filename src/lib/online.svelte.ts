/** Reactive online/offline flag: `online.value`. */
export const online = $state({ value: typeof navigator === 'undefined' ? true : navigator.onLine });

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => (online.value = true));
  window.addEventListener('offline', () => (online.value = false));
}

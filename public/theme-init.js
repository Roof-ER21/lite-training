// Runs before CSS to prevent a light flash for returning dark-mode readers.
// Keep the existing key and system default; storage may be unavailable.
(() => {
  let preference = 'system';
  try {
    preference = localStorage.getItem('roof-er.themePreference') || 'system';
  } catch {}
  const dark = preference === 'dark' ||
    (preference !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();

const DEFAULTS = {
  subfolder: false,
  toasts: true,
  sniffer: true,
  detectFonts: true,
  detectBackgrounds: true,
  detectSvg: true,
  detectCanvas: true,
  detectComponents: true,
  convertImages: 'png',
};

chrome.storage.sync.get(DEFAULTS).then((s) => {
  for (const key of Object.keys(DEFAULTS)) {
    const el = document.getElementById(key);
    if (!el) continue;
    if (el.tagName === 'SELECT') {
      el.value = s[key];
      el.addEventListener('change', () => chrome.storage.sync.set({ [key]: el.value }));
    } else {
      el.checked = !!s[key];
      el.addEventListener('change', () => chrome.storage.sync.set({ [key]: el.checked }));
    }
  }
});

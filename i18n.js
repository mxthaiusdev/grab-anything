// Applies translations to extension pages. Elements opt in via
// data-i18n="key" (textContent) or data-i18n-html="key" (innerHTML — only
// our own authored locale strings ever land here, never page content).
for (const el of document.querySelectorAll('[data-i18n]')) {
  const m = chrome.i18n.getMessage(el.dataset.i18n);
  if (m) el.textContent = m;
}
for (const el of document.querySelectorAll('[data-i18n-html]')) {
  const m = chrome.i18n.getMessage(el.dataset.i18nHtml);
  if (m) el.innerHTML = m;
}

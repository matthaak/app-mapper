// On Windows, `data-os="windows"` on the root element: Modern draws its title buttons the
// Windows way there (see modern.css).
if (/^Win/.test(navigator.platform)) document.documentElement.dataset.os = 'windows';

/** The widgets' look: Classic (NeXTSTEP, the default) or Modern (flat, light, rounded). */
export type NxTheme = 'classic' | 'modern';

/** The theme now in use. */
export function nxTheme(): NxTheme {
  return document.documentElement.dataset.theme === 'modern' ? 'modern' : 'classic';
}

/**
 * Puts the whole page in a theme: `data-theme="modern"` on the root element (Classic has none),
 * which every module's stylesheet keys its Modern rules on. Widgets that lay themselves out
 * from their CSS (scrollers) are told, by an `nx-theme` event on the window.
 */
export function setNxTheme(theme: NxTheme): void {
  if (theme === nxTheme()) return;
  if (theme === 'modern') document.documentElement.dataset.theme = 'modern';
  else delete document.documentElement.dataset.theme;
  window.dispatchEvent(new Event('nx-theme'));
}

// QROK · inline SVG icon generator
// 24×24 viewBox, 1.8px stroke, currentColor — matches bottom-nav icon style.
// Pure: name → SVG markup string. No DOM mutation, no state.

/** Registry of SVG path data keyed by icon name. */
export const ICO_PATHS = {
  scale:       '<rect x="3" y="14" width="18" height="6" rx="1.5"/><path d="M8 14v-2a4 4 0 0 1 8 0v2"/><circle cx="12" cy="18" r=".9" fill="currentColor"/>',
  drop:        '<path d="M12 3s7 7 7 12a7 7 0 0 1-14 0c0-5 7-12 7-12z"/>',
  leaf:        '<path d="M4 20C4 10 10 4 20 4c0 10-6 16-16 16z"/><path d="M4 20L13 11"/>',
  dumbbell:    '<path d="M3 10v4M7 7v10M17 7v10M21 10v4"/><path d="M7 12h10"/>',
  target:      '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
  checkSq:     '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-5"/>',
  chart:       '<path d="M4 20h16"/><path d="M7 20v-6"/><path d="M12 20V8"/><path d="M17 20v-3"/>',
  repeat:      '<path d="M20 7H8a4 4 0 0 0-4 4"/><path d="M7 4L4 7l3 3"/><path d="M4 17h12a4 4 0 0 0 4-4"/><path d="M17 20l3-3-3-3"/>'
};

/**
 * Render an inline SVG string by registry name.
 * @param {string} name
 * @param {number} [size=14]
 * @returns {string} SVG markup
 */
export function ico(name, size) {
  const d = ICO_PATHS[name] || '';
  const s = size || 14;
  return (
    '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '"' +
    ' fill="none" stroke="currentColor" stroke-width="1.8"' +
    ' stroke-linecap="round" stroke-linejoin="round"' +
    ' style="flex-shrink:0;vertical-align:-2px;">' +
    d +
    '</svg>'
  );
}

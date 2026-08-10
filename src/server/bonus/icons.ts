/**
 * Icons the UI can actually render. Kept in lockstep with ICON_MAP in
 * LetterBanner.tsx — anything outside this list falls back to Sparkles, so a
 * model is only ever offered icons that exist.
 */
export const RENDERABLE_ICONS = [
  'Sparkles',
  'Flag',
  'Utensils',
  'Globe',
  'TreePine',
  'Layers',
  'Award',
] as const;

import { BonusChallenge } from './contract';

/**
 * The daily puzzle derivation, shared because both tiers run it.
 *
 * The client derives the puzzle optimistically so it can render before the
 * network answers, and the server derives it to serve /api/daily-challenge.
 * Both must agree exactly, so the hash lives here and is imported, never copied.
 */
/**
 * The bonus challenges the game ships with, used when no model is configured
 * and whenever an AI generation fails.
 *
 * ⚠️ The first DETERMINISTIC_CHALLENGE_COUNT entries are FROZEN, in this order.
 * The daily derivation indexes into that prefix, so reordering or removing any
 * of them retroactively rewrites every past puzzle. Add new challenges by
 * APPENDING below the marker — the extras are drawn by practice mode and by the
 * random fallback, neither of which has to agree with history.
 */
export const BONUS_CHALLENGES: BonusChallenge[] = [
  {
    id: 'long_words',
    title: 'Super Size Words',
    description: 'All 4 answers must be at least 5 letters long.',
    icon: 'Sparkles',
    ruleHint: 'Words must contain 5+ letters.',
    rule: { scope: 'all', checkKind: 'minLength', checkValue: '5' },
  },
  {
    id: 'india_focus',
    title: 'India Connection',
    description: 'At least 2 answers must have a connection to India or South Asia.',
    icon: 'Flag',
    ruleHint: 'Indian names, places, wildlife or cultural items.',
    rule: { scope: 'some', checkKind: 'none', checkValue: '' },
  },
  {
    id: 'edible_thing',
    title: 'Foodie Delight',
    description: 'The "Thing" must be something edible or drinks/ingredients.',
    icon: 'Utensils',
    ruleHint: 'Thing must be food or drink.',
    rule: { scope: 'thing', checkKind: 'none', checkValue: '' },
  },
  {
    id: 'world_place',
    title: 'Global Traveler',
    description: 'The "Place" must be a recognized country or capital city.',
    icon: 'Globe',
    ruleHint: 'Country or Capital City for Place.',
    rule: { scope: 'place', checkKind: 'none', checkValue: '' },
  },
  {
    id: 'wildlife_expert',
    title: 'Wildlife Enthusiast',
    description: 'The "Animal" must be a wild animal (mammal, bird, or ocean creature).',
    icon: 'TreePine',
    ruleHint: 'Wild mammal, bird, or sea creature.',
    rule: { scope: 'animal', checkKind: 'none', checkValue: '' },
  },
  {
    id: 'vowel_rich',
    title: 'Vowel Harmony',
    description: 'Every answer must contain at least 2 vowels (A, E, I, O, U).',
    icon: 'Layers',
    ruleHint: 'At least 2 vowels per word.',
    rule: { scope: 'all', checkKind: 'minVowels', checkValue: '2' },
  },
  {
    id: 'famous_name',
    title: 'Famous Persona',
    description: 'The "Name" must belong to a well-known historical or famous figure.',
    icon: 'Award',
    ruleHint: 'Famous/Historical person name.',
    rule: { scope: 'name', checkKind: 'none', checkValue: '' },
  },

  // ── End of the frozen prefix. Append only below this line. ──
  {
    id: 'adjacent_vowels',
    title: 'Side By Side',
    description: 'Every answer must contain two vowels next to each other, like "ea" or "oo".',
    icon: 'Layers',
    ruleHint: 'Two vowels touching, e.g. "oo".',
    rule: { scope: 'all', checkKind: 'adjacentVowels', checkValue: '' },
  },
  {
    id: 'double_letter',
    title: 'Seeing Double',
    description: 'Every answer must contain the same letter twice in a row, like "ll" or "ss".',
    icon: 'Layers',
    ruleHint: 'A repeated letter pair in each word.',
    rule: { scope: 'all', checkKind: 'doubleLetter', checkValue: '' },
  },
  {
    id: 'ends_with_vowel',
    title: 'Soft Landing',
    description: 'Every answer must end with a vowel (A, E, I, O or U).',
    icon: 'Sparkles',
    ruleHint: 'Last letter must be a vowel.',
    rule: { scope: 'all', checkKind: 'endsWithVowel', checkValue: '' },
  },
  {
    id: 'very_long_words',
    title: 'The Long Haul',
    description: 'All 4 answers must be at least 7 letters long.',
    icon: 'Sparkles',
    ruleHint: 'Words must contain 7+ letters.',
    rule: { scope: 'all', checkKind: 'minLength', checkValue: '7' },
  },
  {
    id: 'long_thing',
    title: 'Big Thing Energy',
    description: 'The "Thing" must be at least 6 letters long.',
    icon: 'Layers',
    ruleHint: 'Thing needs 6+ letters.',
    rule: { scope: 'thing', checkKind: 'minLength', checkValue: '6' },
  },
  {
    id: 'flying_animal',
    title: 'Wings Required',
    description: 'The "Animal" must be one that can fly.',
    icon: 'TreePine',
    ruleHint: 'Animal must be able to fly.',
    rule: { scope: 'animal', checkKind: 'none', checkValue: '' },
  },
  {
    id: 'natural_place',
    title: 'Force Of Nature',
    description: 'The "Place" must be a natural feature: a river, mountain, lake or desert.',
    icon: 'TreePine',
    ruleHint: 'River, mountain, lake or desert.',
    rule: { scope: 'place', checkKind: 'none', checkValue: '' },
  },
  {
    id: 'wearable_thing',
    title: 'Dress Code',
    description: 'The "Thing" must be something you can wear.',
    icon: 'Sparkles',
    ruleHint: 'Thing must be wearable.',
    rule: { scope: 'thing', checkKind: 'none', checkValue: '' },
  },
  {
    id: 'kitchen_thing',
    title: 'Kitchen Business',
    description: 'The "Thing" must be something you would find in a kitchen.',
    icon: 'Utensils',
    ruleHint: 'Thing belongs in a kitchen.',
    rule: { scope: 'thing', checkKind: 'none', checkValue: '' },
  },
  {
    id: 'fictional_name',
    title: 'Straight From Fiction',
    description: 'The "Name" must be a character from a book, film or myth.',
    icon: 'Award',
    ruleHint: 'Fictional or mythological character.',
    rule: { scope: 'name', checkKind: 'none', checkValue: '' },
  },
  {
    id: 'water_theme',
    title: 'Deep Water',
    description: 'At least 2 answers must be connected to the sea, rivers or lakes.',
    icon: 'Globe',
    ruleHint: 'Two answers linked to water.',
    rule: { scope: 'some', checkKind: 'none', checkValue: '' },
  },
  {
    id: 'space_theme',
    title: 'Written In The Stars',
    description: 'At least 2 answers must be connected to space, stars or astronomy.',
    icon: 'Sparkles',
    ruleHint: 'Two answers linked to space.',
    rule: { scope: 'some', checkKind: 'none', checkValue: '' },
  },
  {
    id: 'music_theme',
    title: 'In Good Rhythm',
    description: 'At least 2 answers must be connected to music or dance.',
    icon: 'Layers',
    ruleHint: 'Two answers linked to music.',
    rule: { scope: 'some', checkKind: 'none', checkValue: '' },
  },
  {
    id: 'history_theme',
    title: 'Ancient Records',
    description: 'At least 2 answers must be connected to history or the ancient world.',
    icon: 'Award',
    ruleHint: 'Two answers linked to history.',
    rule: { scope: 'some', checkKind: 'none', checkValue: '' },
  },
  {
    id: 'winter_theme',
    title: 'Chill Factor',
    description: 'At least 2 answers must be connected to ice, cold or winter.',
    icon: 'Globe',
    ruleHint: 'Two answers linked to the cold.',
    rule: { scope: 'some', checkKind: 'none', checkValue: '' },
  },
];

/**
 * How many of BONUS_CHALLENGES the daily derivation may choose from.
 *
 * Pinned to the original seven so appending a challenge cannot change which one
 * a past date resolves to. The daily bonus is normally AI-generated and stored
 * per date anyway; this list is its fallback, and a fallback that rewrites
 * history the moment someone adds an entry is worse than a small one.
 */
export const DETERMINISTIC_CHALLENGE_COUNT = 7;

const AVAILABLE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T', 'V', 'W'];

/**
 * Deterministically generate daily puzzle details based on date string YYYY-MM-DD
 */
export function getDailyPuzzleData(dateStr?: string) {
  const today = dateStr || new Date().toISOString().split('T')[0];
  
  // Simple seed generator from date string
  let hash = 0;
  for (let i = 0; i < today.length; i++) {
    hash = (hash << 5) - hash + today.charCodeAt(i);
    hash |= 0;
  }
  const positiveHash = Math.abs(hash);

  const letterIndex = positiveHash % AVAILABLE_LETTERS.length;
  // Indexes the frozen prefix, never the whole array — see the comment on
  // DETERMINISTIC_CHALLENGE_COUNT. Widening this rewrites every past puzzle.
  const challengeIndex = (positiveHash >> 3) % DETERMINISTIC_CHALLENGE_COUNT;
  
  // Calculate Day Number from Epoch (e.g., 2026-01-01)
  const epoch = new Date('2026-01-01').getTime();
  const currentDate = new Date(today).getTime();
  const diffDays = Math.max(1, Math.floor((currentDate - epoch) / (1000 * 60 * 60 * 24)) + 1);

  return {
    dayNumber: diffDays,
    dateString: today,
    letter: AVAILABLE_LETTERS[letterIndex],
    bonusChallenge: BONUS_CHALLENGES[challengeIndex],
    timeLimitSeconds: 60,
  };
}

/**
 * Generate a random puzzle for Practice / Replay Mode
 */
export function getRandomPuzzleData(excludeLetter?: string) {
  const filtered = AVAILABLE_LETTERS.filter((l) => l !== excludeLetter);
  const letter = filtered[Math.floor(Math.random() * filtered.length)];
  const bonusChallenge = BONUS_CHALLENGES[Math.floor(Math.random() * BONUS_CHALLENGES.length)];
  
  return {
    dayNumber: Math.floor(Math.random() * 500) + 1,
    dateString: 'practice',
    letter,
    bonusChallenge,
    timeLimitSeconds: 60,
  };
}


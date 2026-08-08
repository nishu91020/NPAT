import { BonusChallenge, CategoryInfo, CategoryKey } from '../types';

export const CATEGORIES: CategoryInfo[] = [
  {
    key: 'name',
    label: 'Name',
    placeholder: 'e.g., Sarah, Sam, Sid...',
    iconName: 'User',
    example: 'A person\'s first name',
  },
  {
    key: 'place',
    label: 'Place',
    placeholder: 'e.g., Spain, Sydney, Seattle...',
    iconName: 'MapPin',
    example: 'City, Country, State, River, Mountain',
  },
  {
    key: 'animal',
    label: 'Animal',
    placeholder: 'e.g., Shark, Snake, Squirrel...',
    iconName: 'Dog',
    example: 'Mammal, Bird, Fish, Insect, Reptile',
  },
  {
    key: 'thing',
    label: 'Thing',
    placeholder: 'e.g., Spoon, Scissors, Sword...',
    iconName: 'Package',
    example: 'Object, Item, Tool, Food, Vehicle',
  },
];

export const BONUS_CHALLENGES: BonusChallenge[] = [
  {
    id: 'long_words',
    title: 'Super Size Words',
    description: 'All 4 answers must be at least 5 letters long.',
    icon: 'Sparkles',
    ruleHint: 'Words must contain 5+ letters.',
  },
  {
    id: 'india_focus',
    title: 'India Connection',
    description: 'At least 2 answers must have a connection to India or South Asia.',
    icon: 'Flag',
    ruleHint: 'Indian names, places, wildlife or cultural items.',
  },
  {
    id: 'edible_thing',
    title: 'Foodie Delight',
    description: 'The "Thing" must be something edible or drinks/ingredients.',
    icon: 'Utensils',
    ruleHint: 'Thing must be food or drink.',
  },
  {
    id: 'world_place',
    title: 'Global Traveler',
    description: 'The "Place" must be a recognized country or capital city.',
    icon: 'Globe',
    ruleHint: 'Country or Capital City for Place.',
  },
  {
    id: 'wildlife_expert',
    title: 'Wildlife Enthusiast',
    description: 'The "Animal" must be a wild animal (mammal, bird, or ocean creature).',
    icon: 'TreePine',
    ruleHint: 'Wild mammal, bird, or sea creature.',
  },
  {
    id: 'vowel_rich',
    title: 'Vowel Harmony',
    description: 'Every answer must contain at least 2 vowels (A, E, I, O, U).',
    icon: 'Layers',
    ruleHint: 'At least 2 vowels per word.',
  },
  {
    id: 'famous_name',
    title: 'Famous Persona',
    description: 'The "Name" must belong to a well-known historical or famous figure.',
    icon: 'Award',
    ruleHint: 'Famous/Historical person name.',
  },
];

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
  const challengeIndex = (positiveHash >> 3) % BONUS_CHALLENGES.length;
  
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

/**
 * Format share card string for Wordle-style copying
 */
export function generateShareCard(
  dayNumber: number,
  letter: string,
  totalScore: number,
  streak: number,
  validation: Record<CategoryKey, { valid: boolean; bonusMatched: boolean }>
) {
  const getEmoji = (item: { valid: boolean; bonusMatched: boolean }) => {
    if (item.valid && item.bonusMatched) return '🌟';
    if (item.valid) return '🟩';
    return '🟥';
  };

  const nameEmoji = getEmoji(validation.name);
  const placeEmoji = getEmoji(validation.place);
  const animalEmoji = getEmoji(validation.animal);
  const thingEmoji = getEmoji(validation.thing);

  return `Letters Daily #${dayNumber} (Letter "${letter}")
Score: ${totalScore} pts | Streak: 🔥 ${streak}

Name: ${nameEmoji}
Place: ${placeEmoji}
Animal: ${animalEmoji}
Thing: ${thingEmoji}

Play daily at Letters Daily!`;
}

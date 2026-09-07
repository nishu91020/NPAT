import { BONUS_CHALLENGES, DETERMINISTIC_CHALLENGE_COUNT } from './bonusChallenges';

const AVAILABLE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T', 'V', 'W'];

const LETTER_LOOKBACK_DAYS = 5;

function hashOf(dateStr: string): number {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = (hash << 5) - hash + dateStr.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function dayBefore(dateStr: string): string | null {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;

  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().split('T')[0];
}

function letterIndexFor(dateStr: string, lookback: number = LETTER_LOOKBACK_DAYS): number {
  const hash = hashOf(dateStr);
  const index = hash % AVAILABLE_LETTERS.length;
  if (lookback === 0) return index;

  const previous = dayBefore(dateStr);
  if (previous === null) return index;

  if (index !== letterIndexFor(previous, lookback - 1)) return index;

  const shift = 1 + ((hash >> 11) % (AVAILABLE_LETTERS.length - 1));
  return (index + shift) % AVAILABLE_LETTERS.length;
}

export function getDailyPuzzleData(dateStr?: string) {
  const today = dateStr || new Date().toISOString().split('T')[0];

  const positiveHash = hashOf(today);

  const challengeIndex = (positiveHash >> 3) % DETERMINISTIC_CHALLENGE_COUNT;

  const epoch = new Date('2026-01-01').getTime();
  const currentDate = new Date(today).getTime();
  const diffDays = Math.max(1, Math.floor((currentDate - epoch) / (1000 * 60 * 60 * 24)) + 1);

  return {
    dayNumber: diffDays,
    dateString: today,
    letter: AVAILABLE_LETTERS[letterIndexFor(today)],
    bonusChallenge: BONUS_CHALLENGES[challengeIndex],
    timeLimitSeconds: 60,
  };
}

export function getRandomPuzzleData(excludeLetter?: string) {
  const filtered = AVAILABLE_LETTERS.filter((l) => l !== excludeLetter);
  const letter = filtered[Math.floor(Math.random() * filtered.length)];
  const bonusChallenge = BONUS_CHALLENGES[Math.floor(Math.random() * BONUS_CHALLENGES.length)];

  return {
    dayNumber: Math.floor(Math.random() * 500) + 1,
    dateString: 'random',
    letter,
    bonusChallenge,
    timeLimitSeconds: 60,
  };
}

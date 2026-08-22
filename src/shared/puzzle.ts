import { BONUS_CHALLENGES, DETERMINISTIC_CHALLENGE_COUNT } from './bonusChallenges';

const AVAILABLE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T', 'V', 'W'];

export function getDailyPuzzleData(dateStr?: string) {
  const today = dateStr || new Date().toISOString().split('T')[0];

  let hash = 0;
  for (let i = 0; i < today.length; i++) {
    hash = (hash << 5) - hash + today.charCodeAt(i);
    hash |= 0;
  }
  const positiveHash = Math.abs(hash);

  const letterIndex = positiveHash % AVAILABLE_LETTERS.length;

  const challengeIndex = (positiveHash >> 3) % DETERMINISTIC_CHALLENGE_COUNT;

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

import { CategoryKey } from '../shared/contract';

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

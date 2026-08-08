import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';
import { getDailyPuzzleData, getRandomPuzzleData, validateAnswersLocally, BONUS_CHALLENGES } from './src/utils/puzzleData';
import { BonusChallenge } from './src/types';

// Load environment variables for server runtime.
// Prefer .env.local when present, then fallback to .env.
dotenv.config({ path: '.env' });
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini Client Lazily & Safely
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

/**
 * Generate a real-time dynamic Bonus Challenge using Gemini AI (gemini-3.6-flash)
 */
async function generateRealtimeBonusChallenge(letter: string): Promise<BonusChallenge> {
  const ai = getGeminiClient();
  const targetLetter = letter.toUpperCase();

  if (!ai) {
    // Dynamic fallback from built-in challenges
    const randomIndex = Math.floor(Math.random() * BONUS_CHALLENGES.length);
    return BONUS_CHALLENGES[randomIndex];
  }

  const prompt = `You are an expert game designer for the word puzzle "Name, Place, Animal, Thing".
Generate ONE unique, creative, real-time Bonus Challenge rule for the target letter "${targetLetter}".
The bonus challenge must give players a fun extra objective (e.g., words related to nature, food/drinks, travel/geography, science/space, history, double vowels, 5+ letters, or specific themes).

Return JSON matching the schema:
- id: a short slug string (e.g. "space_twist_${targetLetter}")
- title: catchy title max 25 characters (e.g. "Stellar Explorer")
- description: clear rule instruction max 85 characters (e.g. "At least 2 answers must relate to space, science, or stars.")
- icon: must be one of ['Sparkles', 'Globe', 'TreePine', 'Utensils', 'Award', 'Flag', 'Layers', 'Compass', 'Zap', 'Feather']
- ruleHint: ultra concise hint max 35 characters`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        temperature: 0.8,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            icon: { type: Type.STRING },
            ruleHint: { type: Type.STRING },
          },
          required: ['id', 'title', 'description', 'icon', 'ruleHint'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    if (parsed.title && parsed.description) {
      return {
        id: parsed.id || `realtime_${targetLetter}_${Date.now()}`,
        title: parsed.title,
        description: parsed.description,
        icon: parsed.icon || 'Sparkles',
        ruleHint: parsed.ruleHint || parsed.title,
      };
    }
  } catch (err) {
    console.error('Gemini real-time bonus generation failed, using fallback:', err);
  }

  const randomIndex = Math.floor(Math.random() * BONUS_CHALLENGES.length);
  return BONUS_CHALLENGES[randomIndex];
}

// Health API
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Real-time Daily Challenge API (Generates real-time bonus challenge)
app.get('/api/daily-challenge', async (req, res) => {
  const dateStr = (req.query.date as string) || new Date().toISOString().split('T')[0];
  const basePuzzle = getDailyPuzzleData(dateStr);
  
  // Generate real-time Gemini bonus challenge for today's letter
  const realtimeBonus = await generateRealtimeBonusChallenge(basePuzzle.letter);

  res.json({
    ...basePuzzle,
    bonusChallenge: realtimeBonus,
    isRealtimeBonus: true,
  });
});

// Real-time Practice Challenge API (Generates real-time bonus challenge)
app.get('/api/practice-challenge', async (req, res) => {
  const excludeLetter = req.query.exclude as string;
  const basePuzzle = getRandomPuzzleData(excludeLetter);

  // Generate real-time Gemini bonus challenge for practice letter
  const realtimeBonus = await generateRealtimeBonusChallenge(basePuzzle.letter);

  res.json({
    ...basePuzzle,
    bonusChallenge: realtimeBonus,
    isRealtimeBonus: true,
  });
});

// Direct Real-time Bonus Challenge Generation API
app.post('/api/generate-bonus', async (req, res) => {
  const { letter } = req.body;
  const bonus = await generateRealtimeBonusChallenge(letter || 'S');
  res.json(bonus);
});

// Answer Validation API with Gemini Server-Side AI (LLM Validation)
app.post('/api/validate', async (req, res) => {
  try {
    const { letter, answers, bonusChallenge, timeTakenSeconds } = req.body;

    if (!letter || !answers) {
      return res.status(400).json({ error: 'Missing letter or answers' });
    }

    const ai = getGeminiClient();

    // Fallback to local validator if Gemini key is missing
    if (!ai) {
      console.log('Gemini API key missing, using smart local validation');
      const fallback = validateAnswersLocally(letter, answers, bonusChallenge, timeTakenSeconds || 30);
      return res.json({ ...fallback, isAiValidated: false });
    }

    const prompt = `You are the ultimate fun, fair, and precise AI referee for the classic word puzzle game "Name, Place, Animal, Thing".
Target letter: "${letter.toUpperCase()}".
Active Bonus Challenge: "${bonusChallenge?.title || 'Bonus'}: ${bonusChallenge?.description || 'Extra points for valid entries'}".

User Answers to evaluate:
- Name: "${answers.name || ''}"
- Place: "${answers.place || ''}"
- Animal: "${answers.animal || ''}"
- Thing: "${answers.thing || ''}"

Evaluation Rules:
1. Target Letter: Does the word strictly start with "${letter.toUpperCase()}" (case-insensitive)? If not or if empty, valid = false, points = 0, bonusMatched = false.
2. Category Validity: Is the word a real, recognized item fitting the category?
   - "Name": Genuine human first name or famous character.
   - "Place": Real city, country, state, river, mountain, or landmark.
   - "Animal": Real animal species, bird, fish, reptile, insect, etc.
   - "Thing": Real physical object, item, tool, food, vehicle, element, etc.
3. Bonus Match: Does this entry fulfill the active bonus rule ("${bonusChallenge?.description}")?
4. Scoring:
   - Valid answer = 10 points
   - Valid answer + Bonus rule matched = 15 points
   - Invalid or wrong letter = 0 points
5. Provide witty, concise feedback (max 10 words) for each category.

Return JSON adhering strictly to the response schema.`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
      config: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            categories: {
              type: Type.OBJECT,
              properties: {
                name: {
                  type: Type.OBJECT,
                  properties: {
                    valid: { type: Type.BOOLEAN },
                    points: { type: Type.INTEGER },
                    bonusMatched: { type: Type.BOOLEAN },
                    feedback: { type: Type.STRING },
                  },
                  required: ['valid', 'points', 'bonusMatched', 'feedback'],
                },
                place: {
                  type: Type.OBJECT,
                  properties: {
                    valid: { type: Type.BOOLEAN },
                    points: { type: Type.INTEGER },
                    bonusMatched: { type: Type.BOOLEAN },
                    feedback: { type: Type.STRING },
                  },
                  required: ['valid', 'points', 'bonusMatched', 'feedback'],
                },
                animal: {
                  type: Type.OBJECT,
                  properties: {
                    valid: { type: Type.BOOLEAN },
                    points: { type: Type.INTEGER },
                    bonusMatched: { type: Type.BOOLEAN },
                    feedback: { type: Type.STRING },
                  },
                  required: ['valid', 'points', 'bonusMatched', 'feedback'],
                },
                thing: {
                  type: Type.OBJECT,
                  properties: {
                    valid: { type: Type.BOOLEAN },
                    points: { type: Type.INTEGER },
                    bonusMatched: { type: Type.BOOLEAN },
                    feedback: { type: Type.STRING },
                  },
                  required: ['valid', 'points', 'bonusMatched', 'feedback'],
                },
              },
              required: ['name', 'place', 'animal', 'thing'],
            },
            overallFeedback: { type: Type.STRING },
            bonusChallengeMet: { type: Type.BOOLEAN },
          },
          required: ['categories', 'overallFeedback', 'bonusChallengeMet'],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');

    // Calculate speed bonus
    const speed = timeTakenSeconds || 40;
    const speedBonus = speed <= 20 ? 20 : speed <= 35 ? 10 : speed <= 50 ? 5 : 0;
    const baseScore =
      (parsed.categories.name?.points || 0) +
      (parsed.categories.place?.points || 0) +
      (parsed.categories.animal?.points || 0) +
      (parsed.categories.thing?.points || 0);

    const totalScore = baseScore + speedBonus;

    res.json({
      categories: parsed.categories,
      totalScore,
      speedBonus,
      bonusChallengeMet: parsed.bonusChallengeMet,
      overallFeedback: parsed.overallFeedback || 'Great effort!',
      isAiValidated: true,
    });
  } catch (err: any) {
    console.error('LLM Validation error, falling back to local evaluation:', err);
    const { letter, answers, bonusChallenge, timeTakenSeconds } = req.body;
    const fallback = validateAnswersLocally(letter, answers, bonusChallenge, timeTakenSeconds || 30);
    res.json({ ...fallback, isAiValidated: false });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

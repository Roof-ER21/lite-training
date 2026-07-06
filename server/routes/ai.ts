import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import { GoogleGenAI, Modality } from '@google/genai';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';

const router = Router();

// These endpoints spend real OpenAI/Gemini quota — logged-in users only,
// and capped per IP so a single client can't burn through credits.
const aiLimiter = rateLimit({ windowMs: 60_000, max: 30, name: 'ai' });

// Initialize Google GenAI client for ephemeral tokens
const geminiApiKey = process.env.GEMINI_API_KEY;
let geminiClient: GoogleGenAI | null = null;
if (geminiApiKey) {
  geminiClient = new GoogleGenAI({ apiKey: geminiApiKey });
}

// Initialize OpenAI client (will use OPENAI_API_KEY from environment)
let openai: OpenAI | null = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
}

// Check if OpenAI is configured
function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

// Scoring request interface
interface ScoreRequest {
  prompt: string;
  userAnswer: string;
  sampleAnswer: string;
  maxPoints: number;
  rubric?: {
    keywords?: string[];
    criteria?: string[];
  };
  context?: string; // e.g., "exam" or "roleplay"
}

// Scoring response interface
interface ScoreResponse {
  score: number;
  percentage: number;
  feedback: string;
  strengths: string[];
  improvements: string[];
  keyPointsHit?: string[];
  keyPointsMissed?: string[];
  aiScored: boolean;
}

// Fallback keyword-based scoring
function keywordScore(userAnswer: string, keywords: string[], maxPoints: number): ScoreResponse {
  const answerLower = userAnswer.toLowerCase();
  const matchedKeywords = keywords.filter(kw => answerLower.includes(kw.toLowerCase()));
  const missedKeywords = keywords.filter(kw => !answerLower.includes(kw.toLowerCase()));
  const ratio = keywords.length > 0 ? matchedKeywords.length / keywords.length : 0;
  const score = Math.round(ratio * maxPoints * 10) / 10;
  const percentage = Math.round(ratio * 100);

  return {
    score,
    percentage,
    feedback: `Found ${matchedKeywords.length} of ${keywords.length} key concepts.`,
    strengths: matchedKeywords.length > 0 ? [`Mentioned: ${matchedKeywords.slice(0, 3).join(', ')}`] : [],
    improvements: missedKeywords.length > 0 ? [`Consider including: ${missedKeywords.slice(0, 3).join(', ')}`] : [],
    keyPointsHit: matchedKeywords,
    keyPointsMissed: missedKeywords,
    aiScored: false
  };
}

// Build the lenient grading prompt shared by every provider.
function buildScoringPrompt(r: ScoreRequest): { systemPrompt: string; userPrompt: string } {
  const { prompt, userAnswer, sampleAnswer, maxPoints = 2, rubric = {} } = r;

  const criteriaText = rubric?.criteria?.length
    ? rubric.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
    : '1. Completeness - addresses all key points\n2. Accuracy - information is correct\n3. Professionalism - appropriate tone\n4. Persuasiveness - would be effective';

  const systemPrompt = `You are a generous and encouraging sales trainer scoring exam responses.
Focus ONLY on whether the trainee understands the core sales concepts.
DO NOT deduct points for:
- Grammar mistakes
- Spelling errors
- Minor wording differences
- Missing "nice to have" details

Only deduct points if the response:
- Completely misses the main concept
- Contains incorrect information
- Would harm the sales interaction

Be encouraging and give full credit (2 points) for any response that shows understanding of the key concept, even if worded differently than the sample answer. Judge the MEANING of the answer, not whether it contains specific keywords.
Always return valid JSON only, no markdown formatting.`;

  const userPrompt = `Evaluate this trainee's response:

QUESTION/SCENARIO:
${prompt}

${sampleAnswer ? `IDEAL RESPONSE EXAMPLE:\n${sampleAnswer}\n` : ''}
EVALUATION CRITERIA:
${criteriaText}

${rubric?.keywords?.length ? `KEY CONCEPTS TO LOOK FOR (2 out of ${rubric.keywords.length} is sufficient — these are concepts, NOT required exact words):\n${rubric.keywords.join(', ')}\n` : ''}
TRAINEE'S RESPONSE:
${userAnswer}

IMPORTANT: Give full credit (${maxPoints}/${maxPoints}) if the response demonstrates understanding of the sales concept, even if grammar/spelling isn't perfect or wording is different from the sample answer. Only use partial credit (${maxPoints / 2}/${maxPoints}) if significant content is missing. Only give 0 if the answer is completely wrong or missing.

Be encouraging and focus on what they got RIGHT. Be specific about what was good and what could improve.

Return JSON only (no markdown):
{
  "score": <number 0-${maxPoints}, can use decimals like 1.5>,
  "percentage": <0-100>,
  "feedback": "<1-2 sentence summary emphasizing the positive>",
  "strengths": ["<specific strength 1>", "<specific strength 2>"],
  "improvements": ["<specific improvement 1>", "<specific improvement 2>"]
}`;

  return { systemPrompt, userPrompt };
}

// Score via Gemini (primary — its key is the one that's funded in prod).
async function scoreWithGemini(r: ScoreRequest): Promise<any> {
  if (!geminiClient) throw new Error('Gemini not configured');
  const { systemPrompt, userPrompt } = buildScoringPrompt(r);
  const resp = await geminiClient.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.3,
      responseMimeType: 'application/json',
    },
  });
  return JSON.parse(resp.text || '');
}

// Score via OpenAI (fallback if Gemini is down/unfunded).
async function scoreWithOpenAI(r: ScoreRequest): Promise<any> {
  if (!openai) throw new Error('OpenAI not configured');
  const { systemPrompt, userPrompt } = buildScoringPrompt(r);
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 500,
    response_format: { type: 'json_object' },
  });
  return JSON.parse(completion.choices[0]?.message?.content || '');
}

// POST /api/ai/score-response - Score a short answer using AI
router.post('/score-response', requireAuth, aiLimiter, async (req: Request, res: Response) => {
  const { userAnswer, maxPoints = 2, rubric = {} }: ScoreRequest = req.body;
  const keywords = rubric?.keywords || [];

  // Validate required fields
  if (!req.body.prompt || !userAnswer) {
    return res.status(400).json({ error: 'prompt and userAnswer are required' });
  }

  // Try each configured AI provider in order. The keyword matcher is a LAST
  // resort only — it grades by literal string presence, so a well-worded answer
  // that avoids the exact keywords scores 0. That was silently happening to
  // everyone while OpenAI was over quota; Gemini (funded) is now primary.
  const providers: Array<{ name: string; run: () => Promise<any> }> = [];
  if (geminiClient) providers.push({ name: 'gemini', run: () => scoreWithGemini(req.body) });
  if (openai) providers.push({ name: 'openai', run: () => scoreWithOpenAI(req.body) });

  for (const provider of providers) {
    try {
      const aiResult = await provider.run();

      const score = Math.min(Math.max(Number(aiResult.score) || 0, 0), maxPoints);
      const percentage = Math.min(Math.max(Number(aiResult.percentage) || Math.round((score / maxPoints) * 100), 0), 100);

      const response: ScoreResponse = {
        score,
        percentage,
        feedback: aiResult.feedback || 'Response evaluated.',
        strengths: Array.isArray(aiResult.strengths) ? aiResult.strengths : [],
        improvements: Array.isArray(aiResult.improvements) ? aiResult.improvements : [],
        aiScored: true,
      };

      // Keyword hit/miss is display-only context; the score itself is the AI's.
      if (keywords.length) {
        const answerLower = userAnswer.toLowerCase();
        response.keyPointsHit = keywords.filter(kw => answerLower.includes(kw.toLowerCase()));
        response.keyPointsMissed = keywords.filter(kw => !answerLower.includes(kw.toLowerCase()));
      }

      return res.json(response);
    } catch (error: any) {
      console.error(`AI scoring via ${provider.name} failed:`, error?.message || error);
      // try the next provider
    }
  }

  // Every AI provider failed (or none configured) — fall back to keyword scoring.
  console.warn('All AI scoring providers failed; using keyword fallback');
  return res.json(keywordScore(userAnswer, keywords, maxPoints));
});

// GET /api/ai/status - Check if AI scoring is available
router.get('/status', (req: Request, res: Response) => {
  // AI grading works if EITHER provider is configured (Gemini is primary).
  res.json({
    aiScoringEnabled: !!geminiApiKey || isOpenAIConfigured(),
    primaryProvider: geminiApiKey ? 'gemini' : (isOpenAIConfigured() ? 'openai' : 'none'),
    geminiConfigured: !!geminiApiKey,
    openaiConfigured: isOpenAIConfigured(),
    model: geminiApiKey ? 'gemini-2.5-flash' : 'gpt-4o-mini'
  });
});

// POST /api/ai/tts - Text-to-Speech using Gemini's high-quality voices (Kore, Aoede, etc.)
router.post('/tts', requireAuth, aiLimiter, async (req: Request, res: Response) => {
  try {
    const { text, voice = 'Kore' } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    if (!geminiClient) {
      return res.status(503).json({
        error: 'Gemini not configured',
        message: 'GEMINI_API_KEY environment variable is not set'
      });
    }

    // Valid Gemini voices: Kore (male), Aoede (female), Charon, Fenrir, Puck
    const validVoices = ['Kore', 'Aoede', 'Charon', 'Fenrir', 'Puck'];
    const selectedVoice = validVoices.includes(voice) ? voice : 'Kore';

    console.log(`Generating Gemini TTS with voice: ${selectedVoice}, text length: ${text.length}`);

    // Use Gemini TTS model
    const response = await geminiClient.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: selectedVoice } }
        }
      }
    });

    // Extract audio data from response
    const audioData = (response as any).candidates?.[0]?.content?.parts?.[0]?.inlineData;

    if (!audioData?.data) {
      console.error('No audio data in Gemini response:', JSON.stringify(response, null, 2));
      throw new Error('No audio generated from Gemini');
    }

    // Convert base64 audio to buffer
    const audioBuffer = Buffer.from(audioData.data, 'base64');

    console.log(`Gemini TTS generated: ${audioBuffer.length} bytes, mime: ${audioData.mimeType}`);

    // Set headers for audio response
    res.set({
      'Content-Type': audioData.mimeType || 'audio/wav',
      'Content-Length': audioBuffer.length.toString(),
      'Cache-Control': 'public, max-age=3600',
    });

    res.send(audioBuffer);

  } catch (error: any) {
    console.error('Gemini TTS error:', error);
    res.status(500).json({
      error: 'TTS generation failed',
      details: error?.message || 'Unknown error'
    });
  }
});

// POST /api/ai/gemini-token - Generate ephemeral token for Gemini Live API
router.post('/gemini-token', requireAuth, aiLimiter, async (req: Request, res: Response) => {
  try {
    if (!geminiClient || !geminiApiKey) {
      return res.status(503).json({
        error: 'Gemini API not configured',
        message: 'GEMINI_API_KEY environment variable is not set'
      });
    }

    const { systemInstruction } = req.body;

    // Calculate expiration times
    const now = new Date();
    const expireTime = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes for session
    const newSessionExpireTime = new Date(now.getTime() + 2 * 60 * 1000); // 2 minutes to start session

    // Create ephemeral token using the SDK
    console.log('Creating ephemeral token...');
    const tokenResponse = await geminiClient.authTokens.create({
      config: {
        uses: 1, // Single use token
        expireTime: expireTime.toISOString(),
        newSessionExpireTime: newSessionExpireTime.toISOString(),
        liveConnectConstraints: {
          model: 'gemini-2.5-flash-native-audio-preview-09-2025',
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
            },
            systemInstruction: systemInstruction || 'You are a helpful AI assistant.',
          }
        },
        httpOptions: { apiVersion: 'v1alpha' }
      }
    });

    console.log('Token response structure:', JSON.stringify(tokenResponse, null, 2));

    // Extract the token - the SDK returns { name: "auth_tokens/..." }
    // According to Google docs, token.name is the full token value to use as API key
    const tokenValue = (tokenResponse as any).name;

    if (!tokenValue) {
      console.error('Failed to extract token from response');
      return res.status(500).json({ error: 'Failed to extract token' });
    }

    console.log('Ephemeral token generated successfully');

    res.json({
      token: tokenValue,  // Full token.name value to use as API key
      expireTime: expireTime.toISOString(),
      model: 'gemini-2.5-flash-native-audio-preview-09-2025'
    });

  } catch (error: any) {
    console.error('Gemini token generation error:', error);
    res.status(500).json({
      error: 'Failed to generate token',
      details: error?.message || 'Unknown error'
    });
  }
});

export default router;

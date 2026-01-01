import { Router, Request, Response } from 'express';
import OpenAI from 'openai';
import { GoogleGenAI, Modality } from '@google/genai';

const router = Router();

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

// POST /api/ai/score-response - Score a short answer using AI
router.post('/score-response', async (req: Request, res: Response) => {
  try {
    const {
      prompt,
      userAnswer,
      sampleAnswer,
      maxPoints = 2,
      rubric = {},
      context = 'training'
    }: ScoreRequest = req.body;

    // Validate required fields
    if (!prompt || !userAnswer) {
      return res.status(400).json({ error: 'prompt and userAnswer are required' });
    }

    // If OpenAI is not configured, fall back to keyword scoring
    if (!isOpenAIConfigured()) {
      console.log('OpenAI not configured, using keyword fallback');
      const keywords = rubric?.keywords || [];
      return res.json(keywordScore(userAnswer, keywords, maxPoints));
    }

    // Build criteria string
    const criteriaText = rubric?.criteria?.length
      ? rubric.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
      : '1. Completeness - addresses all key points\n2. Accuracy - information is correct\n3. Professionalism - appropriate tone\n4. Persuasiveness - would be effective';

    // Build the AI prompt
    const systemPrompt = `You are an expert roofing sales trainer evaluating a trainee's response.
Be fair but thorough in your assessment. Score based on how well the response would work in a real sales situation.
Always return valid JSON only, no markdown formatting.`;

    const userPrompt = `Evaluate this trainee's response:

QUESTION/SCENARIO:
${prompt}

${sampleAnswer ? `IDEAL RESPONSE EXAMPLE:\n${sampleAnswer}\n` : ''}
EVALUATION CRITERIA:
${criteriaText}

${rubric?.keywords?.length ? `KEY CONCEPTS TO LOOK FOR:\n${rubric.keywords.join(', ')}\n` : ''}
TRAINEE'S RESPONSE:
${userAnswer}

Score from 0 to ${maxPoints} points. Be specific about what was good and what could improve.

Return JSON only (no markdown):
{
  "score": <number 0-${maxPoints}, can use decimals like 1.5>,
  "percentage": <0-100>,
  "feedback": "<1-2 sentence summary of the response quality>",
  "strengths": ["<specific strength 1>", "<specific strength 2>"],
  "improvements": ["<specific improvement 1>", "<specific improvement 2>"]
}`;

    // Call OpenAI API (openai is guaranteed non-null here due to isOpenAIConfigured check)
    const completion = await openai!.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3, // Lower temp for more consistent scoring
      max_tokens: 500,
      response_format: { type: 'json_object' }
    });

    const responseText = completion.choices[0]?.message?.content || '';

    // Parse the JSON response
    let aiResult: any;
    try {
      aiResult = JSON.parse(responseText);
    } catch (parseError) {
      console.error('Failed to parse AI response:', responseText);
      // Fall back to keyword scoring
      const keywords = rubric?.keywords || [];
      return res.json(keywordScore(userAnswer, keywords, maxPoints));
    }

    // Validate and normalize the response
    const score = Math.min(Math.max(Number(aiResult.score) || 0, 0), maxPoints);
    const percentage = Math.min(Math.max(Number(aiResult.percentage) || Math.round((score / maxPoints) * 100), 0), 100);

    const response: ScoreResponse = {
      score,
      percentage,
      feedback: aiResult.feedback || 'Response evaluated.',
      strengths: Array.isArray(aiResult.strengths) ? aiResult.strengths : [],
      improvements: Array.isArray(aiResult.improvements) ? aiResult.improvements : [],
      aiScored: true
    };

    // If keywords were provided, check which were hit (for display purposes)
    if (rubric?.keywords?.length) {
      const answerLower = userAnswer.toLowerCase();
      response.keyPointsHit = rubric.keywords.filter(kw => answerLower.includes(kw.toLowerCase()));
      response.keyPointsMissed = rubric.keywords.filter(kw => !answerLower.includes(kw.toLowerCase()));
    }

    res.json(response);

  } catch (error: any) {
    console.error('AI scoring error:', error);

    // Fall back to keyword scoring on any error
    const { rubric = {}, maxPoints = 2, userAnswer = '' } = req.body;
    const keywords = rubric?.keywords || [];

    if (keywords.length > 0 && userAnswer) {
      return res.json(keywordScore(userAnswer, keywords, maxPoints));
    }

    res.status(500).json({
      error: 'AI scoring failed',
      details: error?.message || 'Unknown error'
    });
  }
});

// GET /api/ai/status - Check if AI is configured
router.get('/status', (req: Request, res: Response) => {
  res.json({
    configured: isOpenAIConfigured(),
    geminiConfigured: !!geminiApiKey,
    model: 'gpt-4o-mini'
  });
});

// POST /api/ai/tts - Text-to-Speech using Gemini's high-quality voices (Kore, Aoede, etc.)
router.post('/tts', async (req: Request, res: Response) => {
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
router.post('/gemini-token', async (req: Request, res: Response) => {
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

import { GoogleGenAI, Type } from "@google/genai";

const getApiKey = () => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('sai_gemini_key');
    if (stored) return stored;
  }
  return '';
};

const getAI = () => {
  const key = getApiKey();
  if (!key) return null;
  return new GoogleGenAI({ apiKey: key, httpOptions: { apiVersion: 'v1' } });
};

const compressImage = (base64Str: string, maxWidth = 800, quality = 0.7): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64Str;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } else {
        resolve(base64Str);
      }
    };
    img.onerror = () => resolve(base64Str);
  });
};

export const generateSocialPost = async (
  topic: string,
  platform: 'Facebook' | 'Instagram',
  businessName: string,
  businessType: string,
  tone: string
) => {
  const ai = getAI();
  if (!ai) return { content: "API Key missing. Go to Settings to configure.", hashtags: [] };

  try {
    const prompt = `
      You are an expert social media manager for "${businessName}", a ${businessType}.
      Tone: ${tone}.
      Write a catchy, engaging ${platform} post about: "${topic}".
      Include relevant emojis and 5-10 relevant hashtags.
      Return JSON with "content" (the post text) and "hashtags" (array of strings).
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            content: { type: Type.STRING },
            hashtags: { type: Type.ARRAY, items: { type: Type.STRING } }
          }
        }
      }
    });

    return response.text ? JSON.parse(response.text) : { content: "Error generating content.", hashtags: [] };
  } catch (error: any) {
    console.error("Gemini Text Error:", error);
    const msg = error?.message || error?.statusText || String(error);
    if (msg.includes('API_KEY_INVALID') || msg.includes('401')) {
      return { content: "Invalid API Key. Check your key in Settings.", hashtags: [] };
    }
    return { content: `AI Error: ${msg.substring(0, 120)}`, hashtags: [] };
  }
};

export const generateMarketingImage = async (prompt: string): Promise<string | null> => {
  const ai = getAI();
  if (!ai) return null;

  const models = ['gemini-2.5-flash-image', 'gemini-2.0-flash-exp-image-generation'];
  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: `Professional marketing image: ${prompt}. High quality, vibrant, cinematic lighting, no text or watermarks.`,
        config: { responseModalities: ['IMAGE', 'TEXT'] } as any,
      });

      const parts = (response as any)?.candidates?.[0]?.content?.parts;
      if (parts) {
        for (const part of parts) {
          if (part.inlineData?.data) {
            const mimeType = part.inlineData.mimeType || 'image/png';
            const raw = `data:${mimeType};base64,${part.inlineData.data}`;
            return await compressImage(raw, 700, 0.65);
          }
        }
      }
    } catch (error) {
      console.warn(`Gemini Image (${model}):`, error);
      continue;
    }
  }
  return null;
};

export const analyzePostTimes = async (businessType: string, location: string) => {
  const ai = getAI();
  if (!ai) return "API Key missing.";

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `What are the best times to post on Instagram and Facebook for a ${businessType} in ${location}? Give a concise bulleted list of 3 best time slots for the upcoming week.`
    });
    return response.text;
  } catch (error) {
    return "Could not analyze times.";
  }
};

export const generateRecommendations = async (businessName: string, businessType: string, stats: any) => {
  const ai = getAI();
  if (!ai) return "API Key missing.";

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `
        You are a social media strategist for "${businessName}", a ${businessType}.
        Stats: Followers: ${stats.followers}, Reach: ${stats.reach}, Engagement: ${stats.engagement}%, Posts: ${stats.postsLast30Days}.
        Provide 3 specific, high-impact recommendations. Format as a concise bulleted list.
      `
    });
    return response.text || "No recommendations generated.";
  } catch (error) {
    return "Unable to analyze stats at this time.";
  }
};

export const getPostingAdvice = async (platform: string) => {
  const ai = getAI();
  if (!ai) return "API Key missing.";
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `Best times to post on ${platform} for a small business to maximize engagement. Keep it brief and return a short 1-sentence tip.`
    });
    return response.text;
  } catch {
    return "Could not retrieve advice.";
  }
};

export const researchSocialTopic = async (query: string) => {
  const ai = getAI();
  if (!ai) return "API Key missing.";
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `
        As a social media expert for a small business brand, research and provide specific advice on: "${query}".
        Provide 3 actionable bullet points.
        Keep the tone professional yet creative.
      `
    });
    return response.text;
  } catch {
    return "Could not research topic.";
  }
};

export const analyzeSocialMetrics = async (metricName: string, value: string | number, businessType: string) => {
  const ai = getAI();
  if (!ai) return "API Key missing.";
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: `
        I run a ${businessType}. My social media page has a ${metricName} of ${value}.
        1. Is this good, average, or poor for this type of business?
        2. Give me 2 specific strategies to improve this number next week.
        Keep the answer concise and encouraging.
      `
    });
    return response.text;
  } catch {
    return "Could not analyze metric.";
  }
};

export interface SmartScheduledPost {
  platform: 'Instagram' | 'Facebook';
  scheduledFor: string;
  topic: string;
  content: string;
  hashtags: string[];
  imagePrompt: string;
  reasoning: string;
  pillar: string;
}

export const generateSmartSchedule = async (
  businessName: string,
  businessType: string,
  tone: string,
  stats: any,
  postsToGenerate: number = 7,
  location: string = 'Australia',
  platforms: { facebook: boolean; instagram: boolean } = { facebook: true, instagram: true },
  saturationMode: boolean = false
): Promise<{ posts: SmartScheduledPost[]; strategy: string }> => {
  const ai = getAI();
  if (!ai) return { posts: [], strategy: "API Key missing." };

  try {
    const now = new Date();
    const windowDays = saturationMode ? 7 : 14;
    const windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

    const researchPrompt = saturationMode ? `
You are an expert social media growth hacker specialising in HIGH-FREQUENCY SATURATION posting strategies.
Research the optimal saturation posting plan for:
- Business: "${businessName}" — ${businessType}
- Location: ${location}
- Goal: Maximum algorithmic reach and traction through sheer posting volume
- Current stats: ${stats.followers} followers, ${stats.engagement}% engagement

Saturation posting means 3-5 posts per day across platforms. Research how to do this without audience fatigue.

Respond with ONLY a raw JSON object — no markdown, no code fences:
{
  "dailyPostingWindows": ["07:00", "10:00", "12:30", "16:00", "19:30"],
  "contentVarietyStrategy": "how to vary content across 5 daily posts to avoid fatigue",
  "contentPillars": ["pillar1", "pillar2", "pillar3", "pillar4", "pillar5", "pillar6", "pillar7"],
  "hashtagThemes": ["theme1", "theme2", "theme3", "theme4"],
  "imageStyle": "description of ideal image aesthetic",
  "platformSplit": { "facebook": 40, "instagram": 60 },
  "saturationTactics": "2-sentence tactical description",
  "bestContentMix": "ratio/description of promo vs value vs entertainment vs story posts"
}` : `
You are an expert social media researcher. Research the optimal social media strategy for:
- Business: "${businessName}" — ${businessType}
- Location: ${location}
- Audience: local customers and online shoppers
- Current stats: ${stats.followers} followers, ${stats.engagement}% engagement

Respond with ONLY a raw JSON object — no markdown, no code fences:
{
  "bestPostingTimes": ["HH:MM", "HH:MM", "HH:MM"],
  "bestDays": ["Monday", "Wednesday", "Friday"],
  "contentPillars": ["pillar1", "pillar2", "pillar3", "pillar4", "pillar5"],
  "hashtagThemes": ["theme1", "theme2", "theme3"],
  "imageStyle": "description of ideal image aesthetic for this business type",
  "platformSplit": { "facebook": 40, "instagram": 60 },
  "engagementTips": "one sentence of the most impactful tactic for this business type"
}`;

    const saturationFallback = {
      dailyPostingWindows: ['07:00', '10:00', '12:30', '16:00', '19:30'],
      contentVarietyStrategy: 'Rotate promo, value, story, entertainment, and UGC each day',
      contentPillars: ['Product Showcase', 'Behind the Scenes', 'Customer Stories', 'Educational', 'Flash Deals', 'Trending/Seasonal', 'Community Engagement'],
      hashtagThemes: ['small business', 'local community', 'daily deals', 'behind the scenes'],
      imageStyle: 'vibrant, clean background with natural lighting',
      platformSplit: { facebook: 40, instagram: 60 },
      saturationTactics: 'Post at every peak window daily, alternating content types so each post feels fresh.',
      bestContentMix: '30% promotional, 30% value/educational, 20% entertainment, 20% behind-the-scenes/story'
    };
    const normalFallback = {
      bestPostingTimes: ['09:00', '12:00', '18:00'],
      bestDays: ['Tuesday', 'Thursday', 'Saturday'],
      contentPillars: ['Product Showcase', 'Behind the Scenes', 'Customer Stories', 'Educational', 'Seasonal/Trending'],
      hashtagThemes: ['small business', 'local community', 'industry tips'],
      imageStyle: 'vibrant, clean background with natural lighting',
      platformSplit: { facebook: 40, instagram: 60 },
      engagementTips: 'Post consistently and respond to every comment within 2 hours.'
    };

    let research: any = {};
    try {
      const researchRes = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: researchPrompt,
      });
      const researchRaw = (researchRes.text || '').trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      if (researchRaw) research = JSON.parse(researchRaw);
    } catch {
      research = saturationMode ? saturationFallback : normalFallback;
    }

    let fbCount: number;
    let igCount: number;
    if (platforms.facebook && !platforms.instagram) {
      fbCount = postsToGenerate; igCount = 0;
    } else if (platforms.instagram && !platforms.facebook) {
      igCount = postsToGenerate; fbCount = 0;
    } else {
      igCount = Math.round(postsToGenerate * (research.platformSplit?.instagram || 60) / 100);
      fbCount = postsToGenerate - igCount;
    }

    const postsPerDay = saturationMode ? Math.ceil(postsToGenerate / windowDays) : null;
    const postingWindows = saturationMode
      ? (research.dailyPostingWindows || saturationFallback.dailyPostingWindows)
      : (research.bestPostingTimes || normalFallback.bestPostingTimes);

    const prompt = saturationMode ? `
You are an aggressive social media growth strategist running a SATURATION CAMPAIGN for "${businessName}", a ${businessType}. Tone: ${tone}.
Location: ${location}. Current date: ${now.toISOString().split('T')[0]}.
Campaign window: ${now.toISOString().split('T')[0]} to ${windowEnd.toISOString().split('T')[0]} (${windowDays} days).
Stats: Followers ${stats.followers}, Engagement ${stats.engagement}%, Reach ${stats.reach}.

SATURATION RESEARCH INSIGHTS:
- Daily posting windows: ${postingWindows.join(', ')}
- Content variety strategy: ${research.contentVarietyStrategy || saturationFallback.contentVarietyStrategy}
- Content pillars (rotate ALL of them): ${(research.contentPillars || saturationFallback.contentPillars).join(', ')}
- Hashtag themes: ${(research.hashtagThemes || saturationFallback.hashtagThemes).join(', ')}
- Image aesthetic: ${research.imageStyle || saturationFallback.imageStyle}
- Saturation tactics: ${research.saturationTactics || saturationFallback.saturationTactics}
- Content mix: ${research.bestContentMix || saturationFallback.bestContentMix}
- Platform split: ${fbCount} Facebook posts, ${igCount} Instagram posts

SATURATION RULES:
1. Generate exactly ${postsToGenerate} posts (${fbCount} facebook, ${igCount} instagram).
2. Spread ~${postsPerDay} posts per day across the ${windowDays}-day window.
3. Use ALL ${postingWindows.length} daily time windows — never schedule two posts at the same time on the same day.
4. Each day must have DIFFERENT content pillars — NO two consecutive posts from the same pillar.
5. Vary the format: some posts are punchy 1-liners, some are storytelling, some are questions/polls.
6. Hashtags must be highly relevant and varied per post (8-12 per post, mix broad and niche).
7. Every post needs a unique, specific imagePrompt for AI image generation.

Respond with ONLY a valid JSON object — no markdown, no code fences, no explanation:
{
  "strategy": "2-sentence saturation strategy summary",
  "posts": [
    {
      "platform": "Facebook",
      "scheduledFor": "${now.toISOString().split('T')[0]}T07:00:00",
      "topic": "short topic label",
      "content": "full post caption with emojis",
      "hashtags": ["#tag1", "#tag2"],
      "imagePrompt": "detailed image description",
      "reasoning": "which content pillar + time window this uses and why",
      "pillar": "content pillar name"
    }
  ]
}` : `
You are a social media strategist for "${businessName}", a ${businessType}. Tone: ${tone}.
Location: ${location}. Current date: ${now.toISOString().split('T')[0]}.
Window: ${now.toISOString().split('T')[0]} to ${windowEnd.toISOString().split('T')[0]}.
Stats: Followers ${stats.followers}, Engagement ${stats.engagement}%, Reach ${stats.reach}.

RESEARCH INSIGHTS (use these to inform every decision):
- Best posting times: ${postingWindows.join(', ')}
- Best days: ${(research.bestDays || normalFallback.bestDays).join(', ')}
- Content pillars to use: ${(research.contentPillars || normalFallback.contentPillars).join(', ')}
- Hashtag themes: ${(research.hashtagThemes || normalFallback.hashtagThemes).join(', ')}
- Image aesthetic: ${research.imageStyle || 'vibrant and engaging'}
- Platform split: ${fbCount} Facebook posts, ${igCount} Instagram posts
- Key engagement tip: ${research.engagementTips || ''}

Generate exactly ${postsToGenerate} posts (${fbCount} facebook, ${igCount} instagram).
Spread them across the 2-week window. Use the researched best times and days.
Rotate through ALL content pillars. Each post needs a specific imagePrompt matching the image aesthetic above.
Hashtags must be relevant to the hashtag themes researched above (8-12 per post).

Respond with ONLY a valid JSON object — no markdown, no code fences, no explanation:
{
  "strategy": "2-sentence strategy summary referencing the research insights",
  "posts": [
    {
      "platform": "Facebook",
      "scheduledFor": "${now.toISOString().split('T')[0]}T09:00:00",
      "topic": "short topic label",
      "content": "full post caption with emojis",
      "hashtags": ["#tag1", "#tag2"],
      "imagePrompt": "detailed image description",
      "reasoning": "why this content pillar + time was chosen based on research",
      "pillar": "content pillar name from the researched list"
    }
  ]
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const raw = (response.text || '').trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const data = raw ? JSON.parse(raw) : { posts: [], strategy: '' };
    return { posts: Array.isArray(data.posts) ? data.posts : [], strategy: data.strategy || '' };
  } catch (error: any) {
    console.error("Smart Schedule Error:", error);
    return { posts: [], strategy: `Error: ${error?.message || 'Unknown'}` };
  }
};

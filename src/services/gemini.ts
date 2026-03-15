import { GoogleGenAI } from "@google/genai";
import { ClaudeService } from './claudeService';

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
  return new GoogleGenAI({ apiKey: key });
};

const FLASH_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro'];

/** Try generateContent across model fallbacks on 429/quota errors. */
const generateWithFallback = async (
  ai: GoogleGenAI,
  contents: string,
  config?: Record<string, unknown>
): Promise<{ text: string }> => {
  let lastErr: unknown;
  for (const model of FLASH_MODELS) {
    try {
      const res = await ai.models.generateContent({ model, contents, config } as any);
      return { text: res.text || '' };
    } catch (e: any) {
      const msg: string = e?.message || String(e);
      if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
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
  tone: string,
  profile?: {
    description?: string;
    targetAudience?: string;
    uniqueValue?: string;
    productsServices?: string;
    socialGoal?: string;
    location?: string;
  },
  contentFormat?: string
) => {
  const profileContext = profile ? [
    profile.description && `About: ${profile.description}`,
    profile.targetAudience && `Target audience: ${profile.targetAudience}`,
    profile.uniqueValue && `Differentiator: ${profile.uniqueValue}`,
    profile.productsServices && `Products/services: ${profile.productsServices}`,
    profile.socialGoal && `Primary social goal: ${profile.socialGoal}`,
    profile.location && `Location: ${profile.location}`,
  ].filter(Boolean).join('\n') : '';

  // Pick a random content angle so repeated generations feel fresh
  const angles = [
    'Tell a micro-story or anecdote that connects emotionally',
    'Share a surprising fact, stat, or counterintuitive insight',
    'Ask a thought-provoking question that invites comments',
    'Give a quick actionable tip the audience can use today',
    'Show a behind-the-scenes moment or honest reflection',
    'Create urgency or FOMO around the topic',
    'Use a bold opinion or hot take to spark conversation',
    'Celebrate a win, milestone, or customer success',
  ];
  const angle = angles[Math.floor(Math.random() * angles.length)];

  // Content format instructions
  const formatGuide: Record<string, string> = {
    standard: '',
    question: 'FORMAT: Write as an engaging question post — pose a thought-provoking question to drive comments. The entire post should revolve around sparking a conversation.',
    tip: 'FORMAT: Write as a "Quick Tip" post — share one specific, actionable piece of advice. Start with a hook like "Pro tip:" or "Did you know?" and deliver real value.',
    story: 'FORMAT: Write as a micro-story — use a brief narrative arc (situation → tension → resolution). Make it personal and relatable. First-person preferred.',
    behindscenes: 'FORMAT: Write as a behind-the-scenes peek — show the human side of the business. Raw, authentic, not polished. Let the audience feel like an insider.',
    poll: 'FORMAT: Write as a poll/this-or-that post — present two options and ask the audience to vote in comments. Keep it fun and low-friction to respond to.',
    carousel: 'FORMAT: Write as a carousel/list post — structure content as a numbered list (3–5 points). Each point should be a standalone insight. Great for saves.',
    promotional: 'FORMAT: Write as a soft promotional post — highlight a product/service without being salesy. Lead with the problem it solves or the outcome it delivers. CTA at end.',
  };
  const formatInstr = formatGuide[contentFormat || 'standard'] || '';

  // Platform-specific rules (research-backed)
  const platformRules = platform === 'Facebook'
    ? `FACEBOOK POST RULES (2025/26 algorithm — follow strictly):
- Body: 80–150 characters is the engagement sweet spot. Max 300 for storytelling. NEVER exceed 400.
- Structure: attention-grabbing hook first line → 1–2 body lines → CTA last.
- Voice: conversational, human, first-person. Not a brand announcement. Write like a real person talking to a friend.
- Hashtags: EXACTLY 3–5 niche-relevant hashtags. More than 5 actively reduces reach.
- Emojis: 2–4 placed naturally mid-sentence or at line breaks. Not at the end of every line.
- CTA: end with a comment-driving question OR a soft "DM us" / "tap the link". Never hard-sell.
- Line breaks: use short paragraphs (1–2 sentences each) with blank lines between them for readability.
- Avoid: pasting links in the post body (kills reach), all-caps words, "link in bio" on Facebook, generic filler, corporate jargon.`
    : `INSTAGRAM POST RULES (2025/26 Reels-first algorithm — follow strictly):
- Hook: the first 125 characters must stop the scroll — bold claim, intriguing question, or surprising fact.
- Body: 150–280 characters total. Reels-era captions are shorter; save-worthy value drives shares.
- Hashtags: EXACTLY 5–8. Mix tiers: 1 mega (1M+ posts), 2 large (100k–1M), 3 medium (10k–100k), 2 niche (<10k).
- Emojis: 3–5 used to break lines and add rhythm. Not filler.
- CTA: prioritise saves ("Save this ✓"), shares ("Tag someone"), or comments (open question).
- Avoid: hashtag dumps >10 (penalised), generic captions, posting without a scroll-stopping hook.`;

  const prompt = `You are a senior social media strategist managing ${platform} for "${businessName}" (${businessType}).
Your writing voice: ${tone}. You write like a real human — never generic, never corporate, never AI-sounding.
${profileContext ? `\nBRAND CONTEXT:\n${profileContext}` : ''}

CREATIVE ANGLE FOR THIS POST: ${angle}
${formatInstr ? `\n${formatInstr}` : ''}

${platformRules}

ANTI-GENERIC RULES:
- Never start with "Exciting news!" or "We're thrilled to announce"
- Never use filler phrases like "In today's fast-paced world" or "As a business owner"
- Every sentence must earn its place — if it could apply to any business, rewrite it
- Reference specific details about this business (products, location, audience) when relevant
- Write like you're texting a smart friend, not writing a press release

Write a ${platform} post about: "${topic}".
Return JSON: {"content": "post body text — NO hashtags in content", "hashtags": ["tag1", "tag2", ...]}
Content must respect the character limits above. No padding. No filler.`;

  const parseRaw = (raw: string) => {
    const trimmed = raw.trim();
    try {
      return trimmed ? JSON.parse(trimmed) : { content: 'Error generating content.', hashtags: [] };
    } catch {
      const stripped = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
      const match = stripped.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : { content: stripped || 'Could not parse AI response.', hashtags: [] };
    }
  };

  // ── Claude first ────────────────────────────────────────────────────────
  let claudeError: string | null = null;
  if (ClaudeService.isConfigured()) {
    try {
      const text = await ClaudeService.generate(prompt, { temperature: 0.8, maxTokens: 512 });
      return parseRaw(text);
    } catch (e: any) {
      claudeError = e?.message || 'Unknown Claude error';
      console.warn('Claude generateSocialPost failed, falling back to Gemini:', claudeError);
    }
  }

  // ── Gemini fallback ─────────────────────────────────────────────────────
  const ai = getAI();
  if (!ai) throw new Error(claudeError ? `Claude failed: ${claudeError}` : 'No AI configured. Set a Claude or Gemini API key in Settings.');
  try {
    const response = await generateWithFallback(ai, prompt, { responseMimeType: 'application/json', temperature: 0.8 });
    return parseRaw(response.text);
  } catch (error: any) {
    console.error('Gemini Text Error:', error);
    // If Claude also failed, surface both errors so the user can see what went wrong
    if (claudeError) {
      throw new Error(`Claude error: ${claudeError} | Gemini error: ${error?.message || error}`);
    }
    throw error;
  }
};

export const generateMarketingImage = async (prompt: string): Promise<string | null> => {
  const key = getApiKey();
  const imagePrompt = `Professional social media marketing photograph: ${prompt}. Shot on high-end DSLR, cinematic lighting, vibrant colours, sharp focus, depth of field, commercial quality. No text, no watermarks, no logos.`;

  // ── 1. Gemini Imagen (if key available) ──────────────────────────────
  if (key) {
    const ai = new GoogleGenAI({ apiKey: key });
    const imagenModels = ['imagen-4.0-fast-generate-001', 'imagen-4.0-generate-001'];
    for (const model of imagenModels) {
      try {
        const response = await (ai.models as any).generateImages({
          model,
          prompt: imagePrompt,
          config: { numberOfImages: 1, outputMimeType: 'image/jpeg' },
        });
        const imgBytes: string | undefined = response?.generatedImages?.[0]?.image?.imageBytes;
        if (imgBytes) {
          const raw = `data:image/jpeg;base64,${imgBytes}`;
          return await compressImage(raw, 700, 0.65);
        }
      } catch (error: any) {
        console.warn(`Imagen (${model}):`, error?.message ?? error);
      }
    }

    // Gemini native image generation via v1beta responseModalities
    try {
      const betaAI = new GoogleGenAI({ apiKey: key, httpOptions: { apiVersion: 'v1beta' } });
      const response = await betaAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: imagePrompt,
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
    } catch (error: any) {
      console.warn('Gemini image fallback:', error?.message ?? error);
    }
  }

  // ── 2. Pollinations.ai — free, no key needed ────────────────────────
  const pollinationsFetch = async (shortPrompt: string): Promise<string | null> => {
    const encoded = encodeURIComponent(shortPrompt);
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;
    console.log('Pollinations.ai →', shortPrompt.substring(0, 60));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    console.log('Pollinations.ai:', res.status, res.headers.get('content-type'));
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size < 1000 || !blob.type.startsWith('image')) return null;
    const dataUrl: string | null = await new Promise(r => {
      const reader = new FileReader();
      reader.onloadend = () => r(reader.result as string);
      reader.onerror = () => r(null);
      reader.readAsDataURL(blob);
    });
    return dataUrl ? await compressImage(dataUrl, 700, 0.65) : null;
  };

  // Extract just the core topic — keep prompt SHORT to avoid 500 errors
  const corePrompt = prompt.replace(/^.*?:\s*/, '').substring(0, 80).trim();
  try {
    const img = await pollinationsFetch(`${corePrompt}, professional photo, vibrant`);
    if (img) return img;
  } catch (e: any) { console.warn('Pollinations attempt 1:', e?.message); }

  // Retry with even simpler prompt
  try {
    const simplePrompt = corePrompt.split(/[,\-–—.]/).slice(0, 2).join(' ').trim().substring(0, 40);
    const img = await pollinationsFetch(`${simplePrompt} photo`);
    if (img) return img;
  } catch (e: any) { console.warn('Pollinations attempt 2:', e?.message); }

  // ── 3. Picsum — random quality photo as absolute last resort ────────
  try {
    console.log('Falling back to Picsum (random stock photo)…');
    const seed = encodeURIComponent(corePrompt.substring(0, 20));
    const picRes = await fetch(`https://picsum.photos/seed/${seed}/1024/1024`);
    if (picRes.ok) {
      const blob = await picRes.blob();
      if (blob.size > 1000) {
        const dataUrl: string | null = await new Promise(r => {
          const reader = new FileReader();
          reader.onloadend = () => r(reader.result as string);
          reader.onerror = () => r(null);
          reader.readAsDataURL(blob);
        });
        if (dataUrl) return await compressImage(dataUrl, 700, 0.65);
      }
    }
  } catch (e: any) { console.warn('Picsum fallback:', e?.message); }

  return null;
};

export interface VideoScript {
  script: string;
  shots: string[];
  mood: string;
  duration: string;
  hook: string;
}

export const generateVideoScript = async (
  topic: string,
  platform: 'Facebook' | 'Instagram',
  businessName: string,
  businessType: string,
  tone: string,
  caption: string
): Promise<VideoScript> => {
  const ai = getAI();
  if (!ai) return { script: 'API Key missing.', shots: [], mood: '', duration: '', hook: '' };
  try {
    const prompt = `You are a video content strategist for "${businessName}", a ${businessType}.
Create a short-form video brief for a ${platform} Reel/video post about: "${topic}".
The accompanying caption is: "${caption}"
Tone: ${tone}.

Return ONLY raw JSON, no markdown:
{
  "hook": "Opening 1-2 seconds hook line — the very first thing said or shown on screen",
  "script": "Full spoken script / voiceover (30–60 seconds when read aloud). Natural, conversational tone.",
  "shots": ["Scene 1 description (what camera sees, action, angle)", "Scene 2...", "Scene 3...", "Scene 4...", "Scene 5..."],
  "mood": "Music mood — e.g. Upbeat & energetic, Calm & trustworthy, Inspirational",
  "duration": "Recommended video length, e.g. 30 seconds, 45 seconds"
}`;
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.85 } as any,
    });
    const raw = (response.text || '').trim();
    return raw ? JSON.parse(raw) : { script: 'Error generating brief.', shots: [], mood: '', duration: '', hook: '' };
  } catch (error: any) {
    return { script: `AI Error: ${error?.message?.substring(0, 100) || 'Unknown'}`, shots: [], mood: '', duration: '', hook: '' };
  }
};

export const rewritePost = async (
  draft: string,
  instruction: string,
  platform: 'Facebook' | 'Instagram',
  businessName: string,
  businessType: string,
  tone: string
): Promise<{ content: string; hashtags: string[] }> => {
  const ai = getAI();
  if (!ai) return { content: 'API Key missing. Go to Settings to configure.', hashtags: [] };
  try {
    const prompt = `You are an expert social media manager for "${businessName}", a ${businessType}. Tone: ${tone}.
The user wants to post on ${platform}.
Their draft or idea: "${draft}"
Instruction: ${instruction}
Rewrite or improve the post based on the instruction. Include relevant emojis and 5-10 relevant hashtags.
Return ONLY raw JSON with no markdown or code fences: {"content": "...", "hashtags": ["..."]}`;
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.8 } as any,
    });
    const raw = (response.text || '').trim();
    return raw ? JSON.parse(raw) : { content: 'Error rewriting post.', hashtags: [] };
  } catch (error: any) {
    const msg = error?.message || String(error);
    return { content: `AI Error: ${msg.substring(0, 120)}`, hashtags: [] };
  }
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

export interface InsightReport {
  summary: string;
  score: number;
  recommendations: Array<{ title: string; detail: string; priority: 'high' | 'medium' | 'low' }>;
  bestTimes: Array<{ platform: string; slots: string[] }>;
  contentFocus: Array<{ topic: string; reason: string }>;
  quickWin: string;
  generatedAt: string;
}

const parseInsightJson = (raw: string): InsightReport => {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const match = trimmed.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : trimmed) as InsightReport;
  parsed.generatedAt = new Date().toISOString();
  return parsed;
};

export const generateInsightReport = async (
  businessName: string,
  businessType: string,
  location: string,
  stats: { followers: number; reach: number; engagement: number; postsLast30Days: number },
  recentTopics: string[]
): Promise<InsightReport | null> => {
  if (!ClaudeService.isConfigured() && !getAI()) throw new Error('No AI configured. Set a Claude or Gemini API key in Settings.');
  try {
    const prompt = `You are a senior social media strategist. Analyse this business and return a structured JSON insight report.

Business: "${businessName}" — ${businessType} based in ${location}.
Stats: ${stats.followers} followers, ${stats.reach} monthly reach, ${stats.engagement}% engagement rate, ${stats.postsLast30Days} posts last 30 days.
Recent post topics: ${recentTopics.length ? recentTopics.slice(0, 8).join(', ') : 'none yet'}.

Return ONLY this exact JSON structure, no markdown:
{
  "summary": "2-3 sentence plain-English overview of their current social media health and biggest opportunity",
  "score": <integer 1-100 representing overall social media health>,
  "recommendations": [
    { "title": "short action title", "detail": "1-2 sentence specific explanation", "priority": "high" },
    { "title": "...", "detail": "...", "priority": "medium" },
    { "title": "...", "detail": "...", "priority": "low" }
  ],
  "bestTimes": [
    { "platform": "Facebook", "slots": ["Tuesday 12–1pm", "Thursday 7–8pm", "Sunday 9–10am"] },
    { "platform": "Instagram", "slots": ["Wednesday 11am–12pm", "Friday 5–6pm", "Saturday 8–9am"] }
  ],
  "contentFocus": [
    { "topic": "topic name", "reason": "why this will perform well for this business" },
    { "topic": "...", "reason": "..." },
    { "topic": "...", "reason": "..." }
  ],
  "quickWin": "One single action they can do TODAY to immediately improve engagement"
}`;

    let claudeError: string | null = null;
    if (ClaudeService.isConfigured()) {
      try {
        const text = await ClaudeService.generate(prompt, { temperature: 0.4, maxTokens: 1500 });
        return parseInsightJson(text);
      } catch (e: any) {
        claudeError = e?.message || 'Unknown Claude error';
        console.warn('Claude generateInsightReport failed, falling back to Gemini:', claudeError);
      }
    }
    const ai = getAI();
    if (!ai) throw new Error(claudeError ? `Claude failed: ${claudeError}` : 'No AI configured.');
    try {
      const response = await generateWithFallback(ai, prompt, { responseMimeType: 'application/json', temperature: 0.4 });
      return parseInsightJson(response.text);
    } catch (e: any) {
      const geminiMsg = e?.message || String(e);
      if (claudeError) throw new Error(`Claude error: ${claudeError} | Gemini error: ${geminiMsg}`);
      throw new Error(geminiMsg);
    }
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.warn('generateInsightReport failed:', msg);
    throw new Error(msg);
  }
};

export const generateInsightReportFromPosts = async (
  businessName: string,
  businessType: string,
  location: string,
  posts: Array<{ message: string; created_time: string; likes: number; comments: number; shares: number }>
): Promise<InsightReport | null> => {
  if (!ClaudeService.isConfigured() && !getAI()) throw new Error('No AI configured. Set a Claude or Gemini API key in Settings.');
  try {
    const totalLikes = posts.reduce((s, p) => s + p.likes, 0);
    const totalComments = posts.reduce((s, p) => s + p.comments, 0);
    const totalShares = posts.reduce((s, p) => s + p.shares, 0);
    const avgLikes = posts.length ? Math.round(totalLikes / posts.length) : 0;
    const avgComments = posts.length ? Math.round(totalComments / posts.length) : 0;
    const topPosts = [...posts].sort((a, b) => (b.likes + b.comments * 2 + b.shares * 3) - (a.likes + a.comments * 2 + a.shares * 3)).slice(0, 5);
    const worstPosts = [...posts].sort((a, b) => (a.likes + a.comments * 2 + a.shares * 3) - (b.likes + b.comments * 2 + b.shares * 3)).slice(0, 3);

    const postSummaries = topPosts.map(p => `"${p.message.substring(0, 120)}" — ${p.likes} likes, ${p.comments} comments, ${p.shares} shares`).join('\n');
    const worstSummaries = worstPosts.map(p => `"${p.message.substring(0, 80)}" — ${p.likes} likes, ${p.comments} comments`).join('\n');

    const prompt = `You are a senior social media analyst. You have been given REAL data from the Facebook page of "${businessName}" (${businessType} in ${location}).

ACTUAL PAGE DATA:
- Total posts analysed: ${posts.length}
- Average likes per post: ${avgLikes}
- Average comments per post: ${avgComments}
- Total shares: ${totalShares}
- Date range: ${posts[posts.length - 1]?.created_time?.split('T')[0] || 'unknown'} to ${posts[0]?.created_time?.split('T')[0] || 'unknown'}

TOP 5 PERFORMING POSTS (by engagement score):
${postSummaries}

3 LOWEST PERFORMING POSTS:
${worstSummaries}

Based on this REAL data, identify patterns: what content gets the most engagement, what falls flat, what topics resonate, and give specific actionable advice.

Return ONLY this exact JSON, no markdown:
{
  "summary": "2-3 sentence plain-English overview of their actual social media performance based on the real data, mentioning specific numbers",
  "score": <integer 1-100 representing overall social media health based on real engagement>,
  "recommendations": [
    { "title": "short action title based on real patterns found", "detail": "specific 1-2 sentence advice citing the actual data", "priority": "high" },
    { "title": "...", "detail": "...", "priority": "medium" },
    { "title": "...", "detail": "...", "priority": "low" }
  ],
  "bestTimes": [
    { "platform": "Facebook", "slots": ["inferred from post timestamps of top performing posts"] },
    { "platform": "Instagram", "slots": ["recommended times based on their audience patterns"] }
  ],
  "contentFocus": [
    { "topic": "topic pattern found in top posts", "reason": "why this is working for this business based on the data" },
    { "topic": "...", "reason": "..." },
    { "topic": "...", "reason": "..." }
  ],
  "quickWin": "One specific action based on the data patterns — e.g. replicate the approach of the top post"
}`;

    let claudeError: string | null = null;
    if (ClaudeService.isConfigured()) {
      try {
        const text = await ClaudeService.generate(prompt, { temperature: 0.3, maxTokens: 1500 });
        return parseInsightJson(text);
      } catch (e: any) {
        claudeError = e?.message || 'Unknown Claude error';
        console.warn('Claude generateInsightReportFromPosts failed, falling back to Gemini:', claudeError);
      }
    }
    const ai = getAI();
    if (!ai) throw new Error(claudeError ? `Claude failed: ${claudeError}` : 'No AI configured.');
    try {
      const response = await generateWithFallback(ai, prompt, { responseMimeType: 'application/json', temperature: 0.3 });
      return parseInsightJson(response.text);
    } catch (e: any) {
      const geminiMsg = e?.message || String(e);
      if (claudeError) throw new Error(`Claude error: ${claudeError} | Gemini error: ${geminiMsg}`);
      throw new Error(geminiMsg);
    }
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.warn('generateInsightReportFromPosts failed:', msg);
    throw new Error(msg);
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

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`AI response timed out after ${ms / 1000}s — try again or check your API key.`)), ms))]);

export const generateSmartSchedule = async (
  businessName: string,
  businessType: string,
  tone: string,
  stats: any,
  postsToGenerate: number = 7,
  location: string = 'Australia',
  platforms: { facebook: boolean; instagram: boolean } = { facebook: true, instagram: true },
  saturationMode: boolean = false,
  richProfile?: {
    description?: string;
    targetAudience?: string;
    uniqueValue?: string;
    productsServices?: string;
    socialGoal?: string;
    contentTopics?: string;
  },
  includeVideos: boolean = false,
  scheduleMode: 'smart' | 'saturation' | 'quick24h' | 'highlights' = 'smart',
  onPhase?: (phase: 'researching' | 'writing') => void
): Promise<{ posts: SmartScheduledPost[]; strategy: string }> => {
  const ai = getAI();
  if (!ai) return { posts: [], strategy: "API Key missing." };

  try {
    const now = new Date();
    const isQuick24h = scheduleMode === 'quick24h';
    const isHighlights = scheduleMode === 'highlights';
    const windowDays = saturationMode ? 7 : isQuick24h ? 1 : 14;
    const effectivePosts = isQuick24h ? Math.min(postsToGenerate, 5) : isHighlights ? Math.min(postsToGenerate, 5) : postsToGenerate;
    const windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

    const profileBlock = [
      richProfile?.description && `Business description: ${richProfile.description}`,
      richProfile?.targetAudience && `Target audience: ${richProfile.targetAudience}`,
      richProfile?.uniqueValue && `Unique value proposition: ${richProfile.uniqueValue}`,
      richProfile?.productsServices && `Products/services: ${richProfile.productsServices}`,
      richProfile?.socialGoal && `Social media goal: ${richProfile.socialGoal}`,
      richProfile?.contentTopics && `Preferred content topics: ${richProfile.contentTopics}`,
    ].filter(Boolean).join('\n');

    const researchPrompt = saturationMode ? `
You are a world-class social media growth strategist and data analyst specialising in HIGH-FREQUENCY SATURATION posting for small businesses.

BUSINESS PROFILE:
- Name: "${businessName}" — ${businessType}
- Location: ${location} (use the correct local timezone for scheduling)
- Current stats: ${stats.followers} followers, ${stats.engagement}% engagement rate, ${stats.reach} monthly reach
${profileBlock ? profileBlock : ''}

YOUR RESEARCH TASK: Analyse this exact business type and location to determine the absolute best saturation campaign strategy. Consider:
1. INDUSTRY-SPECIFIC peak engagement windows for ${businessType} businesses — when are their customers most active on Facebook vs Instagram?
2. LOCAL TIMING: Adjust all times for the ${location} timezone and local lifestyle patterns (work commute, lunch, evening routines)
3. CONTENT FATIGUE PREVENTION: How to post 3-5x/day without alienating followers — what variety rules prevent unfollows?
4. ALGORITHM MAXIMISATION: What content mix (Reels vs static vs Stories vs carousels) performs best for rapid reach growth for this business type?
5. HASHTAG STRATEGY: Research the top-performing hashtag tiers (mega 1M+, large 100k-1M, medium 10k-100k, niche <10k) specifically for ${businessType} businesses in ${location}. Mix all four tiers per post.
6. ENGAGEMENT BAIT TACTICS: What question formats, CTAs and content hooks generate the most comments/shares for this industry?

Respond with ONLY a raw JSON object — no markdown, no code fences:
{
  "dailyPostingWindows": ["07:00", "10:00", "12:30", "16:00", "19:30"],
  "contentVarietyStrategy": "detailed strategy for varying content across 5 daily posts to prevent fatigue",
  "contentPillars": ["Pillar 1 (with description)", "Pillar 2", "Pillar 3", "Pillar 4", "Pillar 5", "Pillar 6", "Pillar 7"],
  "hashtagTiers": {
    "mega": ["#tag1", "#tag2"],
    "large": ["#tag1", "#tag2", "#tag3"],
    "medium": ["#tag1", "#tag2", "#tag3", "#tag4"],
    "niche": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"]
  },
  "imageStyle": "specific description of ideal image aesthetic for this business type and audience",
  "videoStyle": "description of ideal Reel/short video style if applicable",
  "platformSplit": { "facebook": 40, "instagram": 60 },
  "saturationTactics": "2-3 sentence tactical description specific to this business type",
  "bestContentMix": "exact ratio e.g. 30% promotional, 25% educational, 25% entertainment, 20% behind-the-scenes — with reasoning",
  "engagementHooks": ["hook1", "hook2", "hook3"],
  "localHashtags": ["#localTag1", "#localTag2", "#localTag3"]
}` : `
You are a world-class social media strategist, data analyst and content researcher for small businesses.

BUSINESS PROFILE:
- Name: "${businessName}" — ${businessType}
- Location: ${location} (use the correct local timezone for ALL scheduled times)
- Current stats: ${stats.followers} followers, ${stats.engagement}% engagement rate, ${stats.reach} monthly reach, ${stats.postsLast30Days} posts last 30 days
${profileBlock ? profileBlock : ''}

YOUR RESEARCH TASK: Using your knowledge of social media algorithms, industry benchmarks, and audience behaviour data, produce a precise strategy for this business. Research:

1. OPTIMAL POSTING TIMES: Based on data for ${businessType} businesses in ${location} — when are their specific customers (${richProfile?.targetAudience || 'local consumers'}) most active? Consider work schedules, commute times, lunch breaks, and evening patterns for this location.

2. BEST DAYS: Which days of the week consistently produce highest engagement for ${businessType} businesses? Factor in local events, pay cycles, and industry patterns.

3. CONTENT PILLARS: What are the 5 most effective content categories for ${businessType} businesses to build authority, trust and sales? Be specific to this industry.

4. HASHTAG RESEARCH: Produce a 4-tier hashtag strategy (mega/large/medium/niche) tailored to ${businessType} in ${location}. Include local area hashtags. Research which hashtags are actively used by the target audience.

5. POST FORMAT MIX: What ratio of image posts vs video/Reels vs text posts performs best for this business type on Facebook and Instagram currently?

6. CAPTION STYLE: What caption length, structure, and call-to-action format produces highest engagement for this industry? (e.g. question at end, story format, list format, etc.)

7. PLATFORM SPLIT: Based on where ${richProfile?.targetAudience || 'this audience'} is most active, what % of posts should go to Facebook vs Instagram?

Respond with ONLY a raw JSON object — no markdown, no code fences:
{
  "bestPostingTimes": ["HH:MM", "HH:MM", "HH:MM", "HH:MM"],
  "bestDays": ["Day1", "Day2", "Day3", "Day4"],
  "worstDays": ["Day1", "Day2"],
  "contentPillars": [
    {"name": "Pillar Name", "description": "why this pillar works for this business", "postFrequency": "2x/week"},
    {"name": "Pillar Name", "description": "...", "postFrequency": "1x/week"}
  ],
  "hashtagTiers": {
    "mega": ["#tag1", "#tag2"],
    "large": ["#tag1", "#tag2", "#tag3"],
    "medium": ["#tag1", "#tag2", "#tag3", "#tag4"],
    "niche": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
    "local": ["#locationTag1", "#locationTag2", "#locationTag3"]
  },
  "imageStyle": "specific description of the ideal image aesthetic, lighting, composition for this business type",
  "videoStyle": "ideal Reel format, length, style, and hooks for this business type",
  "captionStyle": "optimal caption length, structure, CTA format for this industry",
  "platformSplit": { "facebook": 40, "instagram": 60 },
  "postFormatMix": { "image": 50, "video": 30, "text": 20 },
  "engagementTips": "the single most impactful engagement tactic proven for this business type",
  "localHashtags": ["#localTag1", "#localTag2", "#localTag3"],
  "contentTopicsToAvoid": ["topic1", "topic2"]
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
    onPhase?.('researching');
    try {
      const researchRes = await withTimeout(ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: researchPrompt,
        config: { responseMimeType: 'application/json', temperature: 0.5 } as any,
      }), 90000);
      const researchRaw = (researchRes.text || '').trim()
        .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
      if (researchRaw) research = JSON.parse(researchRaw);
    } catch {
      research = saturationMode ? saturationFallback : normalFallback;
    }

    let fbCount: number;
    let igCount: number;
    if (platforms.facebook && !platforms.instagram) {
      fbCount = effectivePosts; igCount = 0;
    } else if (platforms.instagram && !platforms.facebook) {
      igCount = effectivePosts; fbCount = 0;
    } else {
      igCount = Math.round(effectivePosts * (research.platformSplit?.instagram || 60) / 100);
      fbCount = effectivePosts - igCount;
    }

    const postsPerDay = saturationMode ? Math.ceil(effectivePosts / windowDays) : null;
    const postingWindows = saturationMode
      ? (research.dailyPostingWindows || saturationFallback.dailyPostingWindows)
      : (research.bestPostingTimes || normalFallback.bestPostingTimes);

    const buildHashtagPool = (r: any) => {
      const tiers = r.hashtagTiers;
      if (!tiers) return (r.hashtagThemes || []).join(', ');
      return [
        tiers.mega?.join(' ') || '',
        tiers.large?.join(' ') || '',
        tiers.medium?.join(' ') || '',
        tiers.niche?.join(' ') || '',
        tiers.local?.join(' ') || '',
        (r.localHashtags || []).join(' '),
      ].filter(Boolean).join(' | ');
    };

    const hashtagPool = buildHashtagPool(research);
    const pillarsForPrompt = saturationMode
      ? (research.contentPillars || saturationFallback.contentPillars)
      : (research.contentPillars?.map((p: any) => typeof p === 'object' ? p.name : p) || normalFallback.contentPillars);

    const videoCount = includeVideos ? Math.max(1, Math.round(effectivePosts * 0.3)) : 0;
    const videoInstructions = includeVideos ? `
VIDEO POST RULES (${videoCount} posts should be "video" type Reels):
- Set "postType": "video" for these posts
- Provide "videoScript": a punchy 30-60 second spoken script with hook, body, CTA
- Provide "videoShots": numbered shot list (e.g. "1. Close-up of product being used, 3 seconds...")
- Provide "videoMood": music mood/genre recommendation (e.g. "Upbeat pop, 120BPM, energetic")
- Ideal Reel style: ${research.videoStyle || 'fast-paced, trending audio, product/service in action'}
- "imagePrompt" should describe the thumbnail/cover frame for the Reel
For image posts, set "postType": "image". For pure text posts, set "postType": "text".` : '';

    const quick24hExtra = isQuick24h ? `
MODE: QUICK 24HR BURST — schedule ALL posts within the next 24 hours ONLY (${now.toISOString().split('T')[0]}T${now.getHours().toString().padStart(2,'0')}:00 to ${windowEnd.toISOString().split('T')[0]}T${now.getHours().toString().padStart(2,'0')}:59). Use only the top researched time slots that fall within the next 24 hours. Generate punchy, high-engagement content designed for immediate interaction.` : '';
    const highlightsExtra = isHighlights ? `
MODE: HIGHLIGHTS ONLY — schedule posts ONLY at the absolute top 3 researched time slots across the 14-day window. Quality over quantity. Each post must be polished, pillar-defining, and perfectly timed. No filler — every post must be your single best recommendation for that pillar.` : '';

    const prompt = saturationMode ? `
You are an elite social media growth operator running a SATURATION CAMPAIGN for "${businessName}", a ${businessType}.
Tone: ${tone}. Location: ${location}. Current date: ${now.toISOString().split('T')[0]}.
Campaign window: ${now.toISOString().split('T')[0]} to ${windowEnd.toISOString().split('T')[0]} (${windowDays} days).
Audience stats: ${stats.followers} followers, ${stats.engagement}% engagement, ${stats.reach} monthly reach.
${profileBlock ? `\nBusiness context:\n${profileBlock}\n` : ''}
SATURATION RESEARCH (apply precisely):
- Daily time windows: ${postingWindows.join(', ')} — use ALL of them, never repeat same time on same day
- Content variety strategy: ${research.contentVarietyStrategy || saturationFallback.contentVarietyStrategy}
- Content pillars — ROTATE ALL: ${pillarsForPrompt.join(' | ')}
- Hashtag pool (mix ALL tiers per post, 10-15 per post): ${hashtagPool || (saturationFallback as any).hashtagThemes?.join(', ')}
- Local hashtags to include: ${(research.localHashtags || []).join(', ')}
- Image aesthetic: ${research.imageStyle || saturationFallback.imageStyle}
- Saturation tactics: ${research.saturationTactics || saturationFallback.saturationTactics}
- Content mix: ${research.bestContentMix || saturationFallback.bestContentMix}
- Engagement hooks to use: ${(research.engagementHooks || []).join(' | ')}
- Platform split: ${fbCount} Facebook posts, ${igCount} Instagram posts
${videoInstructions}
ABSOLUTE RULES:
1. Exactly ${postsToGenerate} posts total (${fbCount} Facebook, ${igCount} Instagram${videoCount > 0 ? `, ${videoCount} Reels/Videos` : ''}).
2. Spread ~${postsPerDay} posts per day. Distribute evenly across all ${windowDays} days.
3. NEVER schedule two posts at the same time on the same day.
4. Each day: different pillars AND different post styles. Rotate through these styles across posts: question, quick-tip, micro-story, behind-the-scenes, poll/this-or-that, list/carousel, soft-promo, bold-opinion.
5. Every caption must use a strong hook in the FIRST LINE (question, bold statement, or shocking stat). NEVER start with "Exciting news!" or generic filler.
6. Hashtags: 10-15 per post, mix mega+large+medium+niche+local tiers. NO generic or repeated sets.
7. imagePrompt: specific, vivid, production-quality description of the visual for this exact post.
8. ANTI-GENERIC: Every sentence must earn its place. Reference specific products, location, or audience. Write like a human, not a press release.

Respond with ONLY a valid JSON object — no markdown, no code fences:
{
  "strategy": "3-sentence saturation strategy summary citing specific research findings",
  "posts": [
    {
      "platform": "Facebook",
      "postType": "image",
      "scheduledFor": "${now.toISOString().split('T')[0]}T07:00:00",
      "topic": "short topic label",
      "content": "full post caption with hook, body, CTA, emojis",
      "hashtags": ["#mega", "#large", "#medium", "#niche", "#local"],
      "imagePrompt": "vivid, specific image description matching the aesthetic",
      "reasoning": "content pillar used + time window chosen + why this format at this time",
      "pillar": "exact content pillar name"
    }
  ]
}` : `
You are an elite social media strategist writing a data-driven content calendar for "${businessName}", a ${businessType}.
Tone: ${tone}. Location: ${location}. Current date: ${now.toISOString().split('T')[0]}.
Schedule window: ${now.toISOString().split('T')[0]} to ${windowEnd.toISOString().split('T')[0]}.
Audience stats: ${stats.followers} followers, ${stats.engagement}% engagement, ${stats.reach} monthly reach.
${profileBlock ? `\nBusiness context:\n${profileBlock}\n` : ''}${quick24hExtra}${highlightsExtra}
RESEARCH INSIGHTS — apply every finding precisely:
- Peak posting times: ${postingWindows.join(', ')} (researched for this business type + location)
- Best days: ${(research.bestDays || normalFallback.bestDays).join(', ')} | Avoid: ${(research.worstDays || []).join(', ')}
- Content pillars: ${pillarsForPrompt.join(' | ')}
- Caption style: ${research.captionStyle || 'conversational, question at end, 3-4 sentences max'}
- Image aesthetic: ${research.imageStyle || 'vibrant, natural lighting, authentic'} 
- Hashtag pool (mix ALL tiers, 8-12 per post): ${hashtagPool || (normalFallback as any).hashtagThemes?.join(', ')}
- Local hashtags to include: ${(research.localHashtags || []).join(', ')}
- Platform split: ${fbCount} Facebook, ${igCount} Instagram
- Post format mix: ${JSON.stringify(research.postFormatMix || { image: 60, video: 25, text: 15 })}
- Key engagement tactic: ${research.engagementTips || 'Ask a question every post'}
${videoInstructions}
RULES:
1. Exactly ${effectivePosts} posts (${fbCount} Facebook, ${igCount} Instagram${videoCount > 0 ? `, ${videoCount} Reels` : ''}).
2. Schedule ONLY on the best days listed above, at the researched peak times.
3. Rotate through ALL content pillars — no pillar used more than twice in a row.
4. VARY POST STYLES: Rotate through these across the calendar: question, quick-tip, micro-story, behind-the-scenes, poll/this-or-that, list/carousel, soft-promo, bold-opinion. No two consecutive posts should use the same style.
5. Each caption: strong hook first line, body matching the caption style, specific CTA last line. NEVER start with "Exciting news!" or generic corporate filler.
6. Hashtags: 8-12 per post, mix all 4 tiers + local. Vary the set per post — no identical hashtag lists.
7. imagePrompt: ultra-specific, production-quality visual description tailored to this exact post topic.
8. reasoning: cite the exact research finding that informed this post's time, day, pillar, and format choice.
9. ANTI-GENERIC: Every sentence must earn its place. Reference specific products, services, location details, or audience insights. Write like a real human talking to friends, not a corporate press release.

Respond with ONLY a valid JSON object — no markdown, no code fences:
{
  "strategy": "3-sentence strategy summary citing the key research findings (times, pillars, hashtag approach)",
  "posts": [
    {
      "platform": "Facebook",
      "postType": "image",
      "scheduledFor": "${now.toISOString().split('T')[0]}T09:00:00",
      "topic": "short topic label",
      "content": "full post caption with hook, body, CTA, relevant emojis",
      "hashtags": ["#mega", "#large", "#medium", "#niche", "#local"],
      "imagePrompt": "vivid, specific, production-quality image description",
      "reasoning": "exact research insight that drove this: pillar + time + day + format choice",
      "pillar": "content pillar name from researched list"
    }
  ]
}`;

    onPhase?.('writing');
    const response = await withTimeout(ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json', temperature: 0.75 } as any,
    }), 90000);

    const raw = (response.text || '').trim();
    const data = raw ? JSON.parse(raw) : { posts: [], strategy: '' };
    return { posts: Array.isArray(data.posts) ? data.posts : [], strategy: data.strategy || '' };
  } catch (error: any) {
    console.error("Smart Schedule Error:", error);
    return { posts: [], strategy: `Error: ${error?.message || 'Unknown'}` };
  }
};

import { getIndustryBenchmarks, formatBenchmarksForPrompt, HASHTAG_LIMITS } from '../data/socialMediaResearch';

// Sanitise raw AI JSON output — fixes common issues that cause JSON.parse to fail
// IMPORTANT: Do NOT replace smart double quotes with straight quotes here — that breaks
// JSON parsing by prematurely ending string values. Smart double quotes (U+201C/201D)
// are valid Unicode inside JSON strings; only U+0022 is a JSON string delimiter.
const sanitizeJson = (raw: string): string => {
  let s = raw;
  // Strip BOM and zero-width characters
  s = s.replace(/[\uFEFF\u200B\u200C\u200D\u2060]/g, '');
  // Replace smart SINGLE quotes with straight apostrophe (safe — apostrophes don't delimit JSON strings)
  s = s.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");
  // Replace en-dash/em-dash with hyphen
  s = s.replace(/[\u2013\u2014]/g, '-');
  // Replace ellipsis character with three dots
  s = s.replace(/\u2026/g, '...');
  // Strip problematic control characters — but KEEP \n \r \t which are valid JSON whitespace
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001f\u007f]/g, '');
  return s;
};

// Extract valid JSON from a string that may contain markdown fences or extra text
const extractJson = (raw: string): string => {
  let s = raw.trim();
  // Strip markdown code fences
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // If it doesn't start with { or [, find the first one
  if (s && !s.startsWith('{') && !s.startsWith('[')) {
    const braceIdx = s.indexOf('{');
    const bracketIdx = s.indexOf('[');
    const idx = braceIdx >= 0 && bracketIdx >= 0 ? Math.min(braceIdx, bracketIdx) : braceIdx >= 0 ? braceIdx : bracketIdx;
    if (idx >= 0) s = s.slice(idx);
  }
  // Find matching closing brace/bracket
  if (s.startsWith('{') || s.startsWith('[')) {
    const open = s[0];
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inString) { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) { s = s.slice(0, i + 1); break; } }
    }
  }
  return s;
};

// Escape literal newlines/tabs inside JSON string values AND fix invalid escape sequences
// AI models sometimes return JSON with unescaped newlines or JS-style escapes like \'
const escapeJsonStrings = (s: string): string => {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) {
      // Fix invalid JSON escapes: \' is valid JS but NOT valid JSON — just output the char
      if (c === "'") { out += c; esc = false; continue; }
      // All other escapes (\n, \", \\, \t, \/, \b, \f, \r, \uXXXX) are valid — pass through
      out += c; esc = false; continue;
    }
    if (c === '\\' && inStr) { out += c; esc = true; continue; }
    if (c === '"') { inStr = !inStr; out += c; continue; }
    if (inStr) {
      if (c === '\n') { out += '\\n'; continue; }
      if (c === '\r') { out += '\\r'; continue; }
      if (c === '\t') { out += '\\t'; continue; }
    }
    out += c;
  }
  return out;
};

// Parse raw AI JSON response robustly — handles newlines, markdown fences, invalid escapes
const parseAiJson = (raw: string): any => {
  const cleaned = extractJson(raw);
  if (!cleaned) return null;
  const fixed = escapeJsonStrings(cleaned);
  try {
    return JSON.parse(sanitizeJson(fixed));
  } catch {
    // Second attempt: strip all backslash-escapes that aren't valid JSON
    const stripped = fixed.replace(/\\(?!["\\/bfnrtu])/g, '');
    return JSON.parse(sanitizeJson(stripped));
  }
};

const AI_WORKER = (import.meta.env as Record<string, string>).VITE_AI_WORKER_URL
  || 'https://socialai-api.steve-700.workers.dev';

/** Generate business-specific image prompt examples based on business type */
const getImagePromptExamples = (businessType: string): string => {
  const t = businessType.toLowerCase();
  if (t.includes('butcher') || t.includes('meat') || t.includes('agriculture'))
    return "e.g. 'raw beef ribeye steak on dark wooden cutting board, warm lighting, overhead shot' or 'lamb cutlets on butcher paper with rosemary, natural light'";
  if (t.includes('bbq') || t.includes('barbeque') || t.includes('food truck'))
    return "e.g. 'smoked brisket sliced on butcher paper with pickles, golden hour light' or 'pulled pork burger with coleslaw, close-up shot'";
  if (t.includes('bakery') || t.includes('café') || t.includes('cafe') || t.includes('coffee'))
    return "e.g. 'sourdough loaf on marble counter, morning light, overhead' or 'flat white coffee with latte art, rustic wooden table'";
  if (t.includes('pickle') || t.includes('deli') || t.includes('ferment'))
    return "e.g. 'jar of bread and butter pickles with fresh cucumbers, natural light' or 'cheese board with artisan pickles, overhead shot'";
  if (t.includes('web') || t.includes('software') || t.includes('tech') || t.includes('it') || t.includes('digital') || t.includes('saas'))
    return "e.g. 'laptop screen showing social media dashboard with analytics, soft desk lighting' or 'phone displaying content calendar app, clean white desk'";
  if (t.includes('festival') || t.includes('event'))
    return "e.g. 'outdoor festival crowd scene from behind, golden sunset light' or 'BBQ competition trophies on display table, dramatic lighting'";
  if (t.includes('surf') || t.includes('sport') || t.includes('outdoor'))
    return "e.g. 'surfboard standing in sand with ocean background, golden hour' or 'row of surfboards in shop rack, natural light'";
  return `e.g. 'the main product/service of ${businessType} in its natural setting, professional lighting, close-up shot'`;
};

const callAI = async (
  prompt: string,
  options?: { temperature?: number; maxTokens?: number; responseFormat?: 'json' | 'text' }
): Promise<string> => {
  const res = await fetch(`${AI_WORKER}/api/ai/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      temperature: options?.temperature ?? 0.8,
      maxTokens: options?.maxTokens ?? 2048,
      responseFormat: options?.responseFormat ?? 'text',
    }),
  });
  const data = await res.json() as { text?: string; error?: string };
  if (!res.ok || data.error) throw new Error(data.error || `AI request failed (${res.status})`);
  return data.text || '';
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
    contentTopics?: string;
  },
  contentFormat?: string
): Promise<{ content: string; hashtags: string[]; imagePrompt?: string }> => {
  // Sanity check: detect corrupted profile data (e.g. agency profile leaked into client workspace)
  const isSinglePostProfileCorrupted = (() => {
    if (!profile) return false;
    const profileText = [profile.description, profile.contentTopics, profile.productsServices].filter(Boolean).join(' ').toLowerCase();
    const bizLower = businessType.toLowerCase();
    const foodKeywords = ['bbq', 'restaurant', 'food', 'catering', 'deli', 'pickle', 'butcher', 'meat', 'café', 'cafe', 'bakery', 'bar', 'pub'];
    const techKeywords = ['web design', 'website builder', 'ai technology', 'social ai studio', 'social media intergration', 'social media integration'];
    const isFood = foodKeywords.some(k => bizLower.includes(k));
    const hasTechContent = techKeywords.some(k => profileText.includes(k));
    if (isFood && hasTechContent) {
      console.warn(`[Profile Sanity] Corrupted profile for "${businessName}" (${businessType}) — ignoring stale profile data.`);
      return true;
    }
    return false;
  })();
  const safeProfile = isSinglePostProfileCorrupted ? undefined : profile;

  const profileContext = safeProfile ? [
    safeProfile.description && `About: ${safeProfile.description}`,
    safeProfile.targetAudience && `Target audience: ${safeProfile.targetAudience}`,
    safeProfile.uniqueValue && `Differentiator: ${safeProfile.uniqueValue}`,
    safeProfile.productsServices && `Products/services: ${safeProfile.productsServices}`,
    safeProfile.socialGoal && `Primary social goal: ${safeProfile.socialGoal}`,
    safeProfile.location && `Location: ${safeProfile.location}`,
    safeProfile.contentTopics && `Content topics & themes to focus on: ${safeProfile.contentTopics}`,
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
- Hashtags: EXACTLY 1–3 niche-relevant hashtags. More than 3 actively reduces reach on Facebook.
- Emojis: 2–4 placed naturally mid-sentence or at line breaks. Not at the end of every line.
- CTA: end with a comment-driving question OR a soft "DM us" / "tap the link". Never hard-sell.
- Line breaks: use short paragraphs (1–2 sentences each) with blank lines between them for readability.
- Avoid: pasting links in the post body (kills reach), all-caps words, "link in bio" on Facebook, generic filler, corporate jargon.`
    : `INSTAGRAM POST RULES (2025/26 Reels-first algorithm — follow strictly):
- Hook: the first 125 characters must stop the scroll — bold claim, intriguing question, or surprising fact.
- Body: 150–280 characters total. Reels-era captions are shorter; save-worthy value drives shares.
- Hashtags: EXACTLY 3–5 relevant hashtags. Mix: 1 branded/niche + 2-3 industry + 1 location. Do NOT use more than 5.
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
- MUST reference specific details from the BRAND CONTEXT above — mention actual products, services, location, or audience by name
- If content topics are provided above, the post MUST relate to one of those topics or themes
- Write like you're texting a smart friend, not writing a press release
- Do NOT invent events, locations, or facts that aren't in the brand context — stay true to what the business actually does

Write a ${platform} post about: "${topic}".
Return JSON: {"content": "post body text — NO hashtags in content", "hashtags": ["tag1", "tag2", ...], "imagePrompt": "Name the EXACT product — ${getImagePromptExamples(businessType)}. NEVER say 'produce', 'items', 'food', 'goods' — name the specific item. NO people, NO hands, NO faces."}
Content must respect the character limits above. No padding. No filler.`;

  const parseRaw = (raw: string) => {
    // Attempt 0: Direct JSON.parse — works if AI returns valid JSON (expected with responseFormat: 'json')
    try {
      const direct = JSON.parse(raw);
      if (direct?.content) return direct;
    } catch { /* not valid JSON as-is */ }

    // Attempt 1: parseAiJson — handles markdown fences, newlines in strings, invalid escapes
    try {
      const result = parseAiJson(raw);
      if (result?.content) return result;
    } catch { /* fall through */ }

    // Attempt 2: Pre-process newlines then parse — handles literal newlines in JSON string values
    try {
      const noNewlines = raw.replace(/\r?\n/g, '\\n');
      const result = JSON.parse(noNewlines);
      if (result?.content) {
        result.content = result.content.replace(/\\n/g, '\n');
        return result;
      }
    } catch { /* fall through */ }

    // Attempt 3: Manual character-by-character extraction
    try {
      const cIdx = raw.indexOf('"content"');
      if (cIdx >= 0) {
        const colonIdx = raw.indexOf(':', cIdx + 9);
        let valStart = -1;
        for (let i = colonIdx + 1; i < raw.length; i++) {
          if (raw[i] === '"') { valStart = i + 1; break; }
        }
        if (valStart > 0) {
          let valEnd = -1;
          let esc = false;
          for (let i = valStart; i < raw.length; i++) {
            if (esc) { esc = false; continue; }
            if (raw[i] === '\\') { esc = true; continue; }
            if (raw[i] === '"') { valEnd = i; break; }
          }
          if (valEnd > valStart) {
            const content = raw.substring(valStart, valEnd)
              .replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\t/g, '\t');
            const hashMatch = raw.match(/"hashtags"\s*:\s*\[([\s\S]*?)\]/);
            const hashtags = hashMatch
              ? (hashMatch[1].match(/"([^"]+)"/g) || []).map(h => h.replace(/"/g, ''))
              : [];
            const imgMatch = raw.match(/"imagePrompt"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            const imagePrompt = imgMatch ? imgMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n') : undefined;
            return { content, hashtags, imagePrompt };
          }
        }
      }
    } catch { /* fall through */ }
    // Last resort: strip JSON wrapper
    const stripped = raw
      .replace(/^\s*\{?\s*"content"\s*:\s*"?/i, '')
      .replace(/"?\s*,?\s*"hashtags"[\s\S]*$/i, '')
      .replace(/\\n/g, '\n').replace(/\\"/g, '"')
      .trim();
    return { content: stripped || 'Could not parse AI response.', hashtags: [] };
  };

  const text = await callAI(prompt, { temperature: 0.8, maxTokens: 512, responseFormat: 'json' });
  return parseRaw(text);
};

export const generateMarketingImage = async (prompt: string, businessType: string = 'small business'): Promise<string | null> => {
  // Helper: convert a remote image URL to a compressed data URL
  const urlToDataUrl = async (imageUrl: string): Promise<string | null> => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 30000);
      const res = await fetch(imageUrl, { signal: ctrl.signal });
      clearTimeout(t);
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
    } catch { return null; }
  };

  // Validate the AI's image prompt — reject titles, pillar names, and vague descriptions
  const isBadPrompt = !prompt || prompt.length < 15 || !/\s/.test(prompt.trim()) || /^(N\/A|none|null|undefined)$/i.test(prompt.trim());
  const looksLikeTitle = /^[A-Z][a-z]+ [A-Z&]/.test(prompt.trim()) && prompt.trim().split(' ').length <= 5;
  const tooVague = /\b(produce|items|products|goods|things|stuff|showcase|journey|tips|stories)\b/i.test(prompt) && prompt.split(' ').length < 8;

  // If the AI wrote a title instead of a visual description, generate a type-specific fallback
  const effectivePrompt = (isBadPrompt || looksLikeTitle || tooVague)
    ? getImagePromptExamples(businessType).replace(/^e\.g\. '/, '').replace(/' or '.*/, '').replace(/'$/, '')
    : prompt;

  // Strip people/portrait/human descriptions — AI images of people always look fake
  const cleanPrompt = effectivePrompt
    .replace(/\b(woman|women|man|men|person|people|portrait|face|faces|facial|smiling|smile|looking|standing|sitting|holding|posing|gazing|wearing|chef|farmer|barista|customer|owner|team|staff|employee|worker|girl|boy|lady|guy|couple|family|child|children|hand|hands|finger|fingers|happy|customers|interior shot)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Structure: subject first, then style, then negative — per prompt engineering best practices
  const imagePrompt = `${cleanPrompt || effectivePrompt}, product photography, natural window light, shallow depth of field, overhead angle, 1:1 square format, clean composition, no text, no watermarks, no people, no faces, no hands`;

  // ── 1. fal.ai FLUX Dev — primary, high-quality, photorealistic ────
  try {
    console.log('fal.ai FLUX →', prompt.substring(0, 80));
    const res = await fetch(`${AI_WORKER}/api/fal-proxy?action=generate-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: imagePrompt }),
    });
    const data = await res.json() as { imageUrl?: string; error?: string };
    if (res.ok && data.imageUrl) {
      console.log('fal.ai FLUX: success →', data.imageUrl.substring(0, 60));
      const img = await urlToDataUrl(data.imageUrl);
      if (img) return img;
    } else {
      console.warn('fal.ai FLUX failed:', data.error || res.status);
    }
  } catch (e: any) { console.warn('fal.ai FLUX error:', e?.message); }

  // ── 2. Pollinations.ai — free fallback ────────────────────────────
  const pollinationsFetch = async (shortPrompt: string): Promise<string | null> => {
    const encoded = encodeURIComponent(shortPrompt);
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true&seed=${Math.floor(Math.random() * 100000)}&model=flux`;
    console.log('Pollinations.ai fallback →', shortPrompt.substring(0, 80));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return await urlToDataUrl(url);
  };

  try {
    const shortPrompt = prompt.substring(0, 120).trim();
    const img = await pollinationsFetch(`${shortPrompt}, professional photography, sharp focus`);
    if (img) return img;
  } catch (e: any) { console.warn('Pollinations fallback:', e?.message); }

  return null;
};

export interface VideoScript {
  script: string;
  shots: string[];
  mood: string;
  duration: string;
  hook: string;
  thumbnailPrompt: string;
  videoPrompt: string;
}

const DEFAULT_VIDEO_SCRIPT: VideoScript = { script: '', shots: [], mood: '', duration: '', hook: '', thumbnailPrompt: '', videoPrompt: '' };

export const generateVideoScript = async (
  topic: string,
  platform: 'Facebook' | 'Instagram',
  businessName: string,
  businessType: string,
  tone: string,
  caption: string,
  profile?: {
    description?: string;
    targetAudience?: string;
    uniqueValue?: string;
    productsServices?: string;
    socialGoal?: string;
    contentTopics?: string;
    location?: string;
  },
  hashtags?: string[],
  contentFormat?: string
): Promise<VideoScript> => {
  // Build rich business context
  const profileLines: string[] = [];
  if (profile?.description) profileLines.push(`Business description: ${profile.description}`);
  if (profile?.targetAudience) profileLines.push(`Target audience: ${profile.targetAudience}`);
  if (profile?.productsServices) profileLines.push(`Products/services: ${profile.productsServices}`);
  if (profile?.uniqueValue) profileLines.push(`Unique value: ${profile.uniqueValue}`);
  if (profile?.socialGoal) profileLines.push(`Social media goal: ${profile.socialGoal}`);
  if (profile?.location) profileLines.push(`Location: ${profile.location}`);
  if (profile?.contentTopics) profileLines.push(`Content topics & themes: ${profile.contentTopics}`);
  const profileContext = profileLines.length > 0 ? `\nBUSINESS CONTEXT:\n${profileLines.join('\n')}` : '';
  const hashtagContext = hashtags?.length ? `\nHashtags for this post: ${hashtags.join(', ')}` : '';
  const formatContext = contentFormat && contentFormat !== 'standard' ? `\nPost style: ${contentFormat} (match the video energy to this style)` : '';

  try {
    const prompt = `You are a senior video content strategist and creative director for "${businessName}", a ${businessType}.
Your job: create a COMPELLING short-form video brief for a ${platform} Reel that will stop the scroll and drive engagement.
${profileContext}

TOPIC: "${topic}"
ACCOMPANYING CAPTION: "${caption}"
TONE: ${tone}${hashtagContext}${formatContext}

DEEP THINKING REQUIRED:
- WHO is watching this? Consider the target audience and what visually grabs their attention
- WHAT action/scene would make this topic feel real, not abstract?
- WHERE should this video feel like it's set? (office, café, workshop, outdoors — pick something specific to this business)
- WHY would someone watch past the first 2 seconds? The hook must be irresistible
- Reference specific products, services, or scenarios from the business context above

ANTI-GENERIC RULES:
- NEVER include people, team members, staff, customers, or faces in any shot description — AI video of people looks terrible
- Focus on PRODUCTS, FOOD, SCREENS, TOOLS, ENVIRONMENTS — things that look good in AI video
- No stock-video-looking scenes. Every shot must feature a SPECIFIC product or item from this business
- The hook must provoke curiosity or emotion — not just state the topic
- Shots should show close-ups of products, smooth camera moves over scenes, timelapses, or screen recordings — NOT talking heads or people working
- ${getImagePromptExamples(businessType)} — use similar subjects for video shots

Return ONLY raw JSON, no markdown:
{
  "hook": "Opening 1-2 second hook — bold text overlay or dramatic visual that stops the scroll. Be specific.",
  "script": "Full spoken script / voiceover (30-60 seconds). Natural, conversational, matches the ${tone} tone. Reference specific products/services.",
  "shots": ["Shot 1: precise visual — camera angle, subject, action, setting, lighting", "Shot 2...", "Shot 3...", "Shot 4...", "Shot 5..."],
  "mood": "Music mood — specific genre + energy level, e.g. 'Lo-fi chill beats, medium tempo' or 'Upbeat indie pop, high energy'",
  "duration": "Recommended length, e.g. '30 seconds' or '45 seconds'",
  "thumbnailPrompt": "A 15-20 word vivid description of the perfect FIRST FRAME of this video. Must be visually striking, set the scene, and be specific to this business. Describe: subject, action, setting, lighting, colors, camera angle.",
  "videoPrompt": "A 20-30 word cinematic motion description for AI video generation. Describe: what moves, camera motion (pan/zoom/track), lighting changes, the key visual transition. Must match the first shot and be specific to this business topic."
}`;
    const raw = (await callAI(prompt, { temperature: 0.85, responseFormat: 'json' })).trim();
    const parsed = parseAiJson(raw);
    return parsed ? { ...DEFAULT_VIDEO_SCRIPT, ...parsed } : { ...DEFAULT_VIDEO_SCRIPT, script: 'Error generating brief.' };
  } catch (error: any) {
    return { ...DEFAULT_VIDEO_SCRIPT, script: `AI Error: ${error?.message?.substring(0, 100) || 'Unknown'}` };
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
  try {
    const prompt = `You are an expert social media manager for "${businessName}", a ${businessType}. Tone: ${tone}.
The user wants to post on ${platform}.
Their draft or idea: "${draft}"
Instruction: ${instruction}
Rewrite or improve the post based on the instruction. Include relevant emojis and 5-10 relevant hashtags.
Return ONLY raw JSON with no markdown or code fences: {"content": "...", "hashtags": ["..."]}`;
    const raw = (await callAI(prompt, { temperature: 0.8, responseFormat: 'json' })).trim();
    return parseAiJson(raw) || { content: 'Error rewriting post.', hashtags: [] };
  } catch (error: any) {
    const msg = error?.message || String(error);
    return { content: `AI Error: ${msg.substring(0, 120)}`, hashtags: [] };
  }
};

export const analyzePostTimes = async (businessType: string, location: string) => {
  try {
    return await callAI(`What are the best times to post on Instagram and Facebook for a ${businessType} in ${location}? Give a concise bulleted list of 3 best time slots for the upcoming week.`);
  } catch {
    return "Could not analyze times.";
  }
};

export const generateRecommendations = async (businessName: string, businessType: string, stats: any) => {
  try {
    return (await callAI(`
        You are a social media strategist for "${businessName}", a ${businessType}.
        Stats: Followers: ${stats.followers}, Reach: ${stats.reach}, Engagement: ${stats.engagement}%, Posts: ${stats.postsLast30Days}.
        Provide 3 specific, high-impact recommendations. Format as a concise bulleted list.
      `)) || "No recommendations generated.";
  } catch {
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
  const parsed = JSON.parse(sanitizeJson(match ? match[0] : trimmed)) as InsightReport;
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

    const text = await callAI(prompt, { temperature: 0.4, maxTokens: 1500, responseFormat: 'json' });
    return parseInsightJson(text);
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

    const text = await callAI(prompt, { temperature: 0.3, maxTokens: 1500, responseFormat: 'json' });
    return parseInsightJson(text);
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.warn('generateInsightReportFromPosts failed:', msg);
    throw new Error(msg);
  }
};

export const getPostingAdvice = async (platform: string) => {
  try {
    return await callAI(`Best times to post on ${platform} for a small business to maximize engagement. Keep it brief and return a short 1-sentence tip.`);
  } catch {
    return "Could not retrieve advice.";
  }
};

export const researchSocialTopic = async (query: string) => {
  try {
    return await callAI(`
        As a social media expert for a small business brand, research and provide specific advice on: "${query}".
        Provide 3 actionable bullet points.
        Keep the tone professional yet creative.
      `);
  } catch {
    return "Could not research topic.";
  }
};

export const analyzeSocialMetrics = async (metricName: string, value: string | number, businessType: string) => {
  try {
    return await callAI(`
        I run a ${businessType}. My social media page has a ${metricName} of ${value}.
        1. Is this good, average, or poor for this type of business?
        2. Give me 2 specific strategies to improve this number next week.
        Keep the answer concise and encouraging.
      `);
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
  postType?: 'image' | 'video' | 'text';
  videoScript?: string;
  videoShots?: string;
  videoMood?: string;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`AI response timed out after ${ms / 1000}s — try again or check your API key.`)), ms))]);

/**
 * Fetch a URL's text content via the Worker proxy for AI research.
 */
const fetchUrlContent = async (url: string): Promise<string> => {
  try {
    const res = await fetch(`${AI_WORKER}/api/web-fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json() as { text?: string; error?: string };
    if (data.text) return data.text;
    console.warn('[Web Fetch] Failed:', data.error);
    return '';
  } catch (e) {
    console.warn('[Web Fetch] Error:', e);
    return '';
  }
};

/**
 * Pre-research the campaign focus before generating posts.
 * If a URL is mentioned, actually fetches the page content and feeds it
 * to the AI so it can write posts based on real product data.
 */
const researchCampaignFocus = async (
  campaignFocus: string,
  businessName: string,
  businessType: string,
  profileDescription?: string,
  productsServices?: string,
): Promise<string> => {
  // Extract URLs from the campaign focus and fetch their content
  const urlMatch = campaignFocus.match(/https?:\/\/[^\s,]+|www\.[^\s,]+/gi);
  let websiteContent = '';
  if (urlMatch) {
    const urls = urlMatch.map(u => u.startsWith('www.') ? `https://${u}` : u);
    const fetched = await Promise.all(urls.slice(0, 2).map(fetchUrlContent));
    websiteContent = fetched.filter(Boolean).join('\n\n---\n\n');
    if (websiteContent) {
      console.log(`[Campaign Research] Fetched ${urls.length} URL(s), got ${websiteContent.length} chars`);
    }
  }

  const prompt = `You are a direct-response copywriter researching a campaign. NO fluff. NO vague marketing speak. Every sentence must contain a SPECIFIC fact, feature name, number, or concrete detail.

BUSINESS: "${businessName}" (${businessType})
${profileDescription ? `DESCRIPTION: ${profileDescription}` : ''}
${productsServices ? `PRODUCTS/SERVICES: ${productsServices}` : ''}

CAMPAIGN BRIEF FROM USER:
"${campaignFocus}"

${websiteContent ? `WEBSITE CONTENT (real data from the URL — use this as primary source):\n---\n${websiteContent}\n---\n` : ''}
RULES:
- Use ONLY facts from the business description, products/services, and website content above
- Name specific features (e.g. "AI Content Autopilot" not "our AI tool")
- Include specific numbers (e.g. "$29/mo" not "affordable pricing", "7-14 posts/week" not "regular posts")
- If the description mentions a URL, include it in CTAs
- NEVER write generic phrases like "boost your engagement", "take your business to the next level", "in today's digital world"

PRODUCE THIS BRIEF:

1. PRODUCT NAME & DESCRIPTION (2 sentences max — what is it, what does it do)
2. SPECIFIC FEATURES (list each by name with one-line description):
   - Feature 1: [name] — [what it does]
   - Feature 2: [name] — [what it does]
   - (list ALL features mentioned in the profile/website data)
3. PRICING: Exact prices and plan names if available
4. TARGET AUDIENCE: Who specifically + their #1 pain point
5. COMPETITOR COMPARISON: What's the alternative? (doing it manually, hiring a social media manager, etc.) How is this better?
6. POST ANGLES (7-10, each must spotlight a DIFFERENT specific feature):
   For each angle provide:
   - ANGLE NAME: e.g. "Feature: AI Content Autopilot"
   - HOOK (first line of the post): Must be a question or bold claim with a specific detail
   - KEY FACT to include in the post body
   - CTA: specific action (visit URL, sign up, try free, etc.)
   - IMAGE: describe a concrete visual — product screenshot, dashboard view, before/after, device mockup. NO people, NO stock photos.`;

  try {
    return await withTimeout(callAI(prompt, { temperature: 0.5, maxTokens: 3000 }), 45000);
  } catch (e) {
    console.warn('[Campaign Research] Failed:', e);
    return `Campaign focus: ${campaignFocus}`;
  }
};

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
  onPhase?: (phase: 'researching' | 'writing') => void,
  campaignFocus?: string,
  activeCampaigns?: { name: string; type: string; startDate: string; endDate: string; rules: string; postsPerDay: number }[],
): Promise<{ posts: SmartScheduledPost[]; strategy: string }> => {
  try {
    const now = new Date();
    const isQuick24h = scheduleMode === 'quick24h';
    const isHighlights = scheduleMode === 'highlights';
    const windowDays = saturationMode ? 7 : isQuick24h ? 1 : 14;
    const effectivePosts = isQuick24h ? Math.min(postsToGenerate, 5) : isHighlights ? Math.min(postsToGenerate, 5) : postsToGenerate;
    const windowEnd = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

    // Sanity check: detect corrupted profile data (e.g. agency profile leaked into client workspace)
    // If the rich profile description/topics mention completely unrelated industries, discard it
    const isProfileCorrupted = (() => {
      if (!richProfile) return false;
      const profileText = [richProfile.description, richProfile.contentTopics, richProfile.productsServices].filter(Boolean).join(' ').toLowerCase();
      const bizLower = businessType.toLowerCase();
      // If the business is food/restaurant/catering but the profile talks about web design, AI, technology — it's corrupted
      const foodKeywords = ['bbq', 'restaurant', 'food', 'catering', 'deli', 'pickle', 'butcher', 'meat', 'café', 'cafe', 'bakery', 'bar', 'pub'];
      const techKeywords = ['web design', 'website builder', 'ai technology', 'social ai studio', 'social media intergration', 'social media integration'];
      const isFood = foodKeywords.some(k => bizLower.includes(k));
      const hasTechContent = techKeywords.some(k => profileText.includes(k));
      if (isFood && hasTechContent) {
        console.warn(`[Profile Sanity] Corrupted profile detected for "${businessName}" (${businessType}) — profile mentions tech/AI but business is food. Ignoring profile data.`);
        return true;
      }
      return false;
    })();
    const safeProfile = isProfileCorrupted ? undefined : richProfile;

    // Forward-declare campaignBrief so the prompt template can reference it
    let campaignBrief = '';

    // Build campaign injection block
    const campaignBlock = activeCampaigns?.length ? activeCampaigns.map(c => {
      const start = new Date(c.startDate);
      const end = new Date(c.endDate);
      const daysToGo = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (86400000)));
      const daysIn = Math.max(0, Math.ceil((now.getTime() - start.getTime()) / (86400000)));
      const countdown = daysToGo <= 14 ? ` (${daysToGo} days to go!)` : daysIn <= 7 ? ` (just launched ${daysIn} days ago!)` : '';
      const imageLine = (c as any).imageNotes ? `\nCampaign image direction: ${(c as any).imageNotes}` : '';
      return `ACTIVE CAMPAIGN: "${c.name}" runs ${c.startDate} to ${c.endDate}${countdown}\nCampaign rules: ${c.rules}${imageLine}`;
    }).join('\n\n') : '';

    const profileBlock = [
      safeProfile?.description && `Business description: ${safeProfile.description}`,
      safeProfile?.targetAudience && `Target audience: ${safeProfile.targetAudience}`,
      safeProfile?.uniqueValue && `Unique value proposition: ${safeProfile.uniqueValue}`,
      safeProfile?.productsServices && `Products/services: ${safeProfile.productsServices}`,
      safeProfile?.socialGoal && `Social media goal: ${safeProfile.socialGoal}`,
      safeProfile?.contentTopics && `Preferred content topics: ${safeProfile.contentTopics}`,
      campaignBlock && `\n${campaignBlock}\nIMPORTANT: Weave the active campaign themes into your posts. Use countdown language where appropriate ("X days to go!", "Only X days left!", "Coming soon!"). At least 30% of posts should reference the campaign.`,
    ].filter(Boolean).join('\n');

    // ── Inject real research data ──
    const benchmarks = getIndustryBenchmarks(businessType, location);
    const benchmarkBlock = formatBenchmarksForPrompt(benchmarks.data, benchmarks.timezone);

    const researchPrompt = saturationMode ? `
You are a world-class social media growth strategist specialising in HIGH-FREQUENCY SATURATION posting for small businesses.

BUSINESS PROFILE:
- Name: "${businessName}" — ${businessType}
- Location: ${location}
- Current stats: ${stats.followers} followers, ${stats.engagement}% engagement rate, ${stats.reach} monthly reach
${profileBlock ? profileBlock : ''}

${benchmarkBlock}
${campaignFocus ? `\n🎯 CAMPAIGN FOCUS (HIGHEST PRIORITY — OVERRIDES ALL OTHER TOPIC RULES):\nThe user has explicitly requested ALL posts focus on: "${campaignFocus}"\n\n${campaignBrief ? `CAMPAIGN RESEARCH BRIEF (use this data to write specific, detailed posts):\n${campaignBrief}\n` : ''}\nRULES:\n- Every single post MUST be about "${campaignFocus}" — no exceptions\n- Use the CAMPAIGN RESEARCH BRIEF above as your primary source of facts, features, benefits, and angles\n- Each post must take a DIFFERENT angle from the brief (feature spotlight, success story, pain point, comparison, FAQ, behind-the-scenes, etc.)\n- Image prompts MUST show the product/service in action — screenshots, dashboards, devices showing the product, real scenarios. NOT generic stock photo people at desks\n- Hashtags must be relevant to "${campaignFocus}" specifically\n- DO NOT generate generic "visit our website" posts — each post must teach, show, or prove something specific\n- Include specific details, numbers, features — NOT vague marketing fluff\n` : `\nCRITICAL: ALL content pillars and topics MUST be about THIS ${businessType} business. NEVER suggest content about social media marketing, AI tools, web design, or technology. Every pillar must be something a ${businessType} business would actually post about.\n`}
YOUR TASK: Using the VERIFIED RESEARCH DATA above as your foundation, build a saturation campaign strategy for this specific ${businessType} business. You MUST use the researched posting times and days — do NOT invent different times. Adapt the content pillars and hashtags to this specific business while staying within the research guidelines.
1. Use the researched posting times from the data above — spread posts across those windows
2. CONTENT FATIGUE PREVENTION: How to post 3-5x/day without alienating followers
3. ALGORITHM MAXIMISATION: What content mix performs best for rapid reach growth
4. Hashtag counts: Facebook ${HASHTAG_LIMITS.facebook.optimal} (max ${HASHTAG_LIMITS.facebook.max}), Instagram ${HASHTAG_LIMITS.instagram.optimal} (max ${HASHTAG_LIMITS.instagram.max})
5. ENGAGEMENT HOOKS: What question formats and CTAs generate the most comments for this industry?

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
You are a world-class social media strategist and content researcher for small businesses.

BUSINESS PROFILE:
- Name: "${businessName}" — ${businessType}
- Location: ${location}
- Current stats: ${stats.followers} followers, ${stats.engagement}% engagement rate, ${stats.reach} monthly reach, ${stats.postsLast30Days} posts last 30 days
${profileBlock ? profileBlock : ''}

${benchmarkBlock}
${campaignFocus ? `\n🎯 CAMPAIGN FOCUS (HIGHEST PRIORITY — OVERRIDES ALL OTHER TOPIC RULES):\nThe user has explicitly requested ALL posts focus on: "${campaignFocus}"\n\nRULES:\n- Every single post MUST be about "${campaignFocus}" — no exceptions\n- Describe what "${campaignFocus}" is, its benefits, features, pricing, use cases, success stories, comparisons, how-to guides, testimonials\n- If you don't know details about "${campaignFocus}", use the business profile description and products/services above to fill in specifics\n- Image prompts MUST show the product/service in action — screenshots, dashboards, devices showing the product, happy customers using it. NOT generic stock photo people at desks\n- Hashtags must be relevant to "${campaignFocus}" specifically\n- DO NOT generate generic "visit our website" posts — each post must teach, show, or prove something specific about "${campaignFocus}"\n` : `\nCRITICAL: You are creating content for "${businessName}", which is a ${businessType}. ALL content pillars, topics, and posts MUST be about THIS business. NEVER generate content about social media marketing, AI tools, web design, or technology.\n`}
YOUR TASK: Using the VERIFIED RESEARCH DATA above as your foundation, refine the strategy for this specific ${businessType} business. You MUST use the researched posting times and best days — do NOT invent different times. Adapt content pillars to this specific business.

1. POSTING TIMES: Use the researched times from the data above. Do NOT change them unless you have a strong, specific reason for this exact business.
2. BEST DAYS: Use the researched days from the data above.
3. CONTENT PILLARS: Adapt the recommended pillars to this specific business — use their products, services, and audience.
4. Hashtag counts: Facebook ${HASHTAG_LIMITS.facebook.optimal} (max ${HASHTAG_LIMITS.facebook.max}), Instagram ${HASHTAG_LIMITS.instagram.optimal} (max ${HASHTAG_LIMITS.instagram.max}). Do NOT exceed these limits.

4. HASHTAG RESEARCH: Produce a 4-tier hashtag strategy (mega/large/medium/niche) tailored to ${businessType} in ${location}. Include local area hashtags. Research which hashtags are actively used by the target audience.

5. POST FORMAT MIX: What ratio of image posts vs text posts performs best for this business type on Facebook and Instagram currently?

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

    // Fallbacks use REAL research data instead of arbitrary defaults
    const bd = benchmarks.data;
    const saturationFallback = {
      dailyPostingWindows: bd.bestPostingTimes.facebook,
      contentVarietyStrategy: bd.contentMix.description,
      contentPillars: bd.contentMix.pillars,
      hashtagThemes: bd.hashtagStrategy.sampleHashtags.industry.slice(0, 5),
      imageStyle: 'vibrant, clean background with natural lighting',
      platformSplit: { facebook: 40, instagram: 60 },
      saturationTactics: 'Post at every peak window daily, alternating content types so each post feels fresh.',
      bestContentMix: bd.contentMix.ratio
    };
    const normalFallback = {
      bestPostingTimes: bd.bestPostingTimes.facebook,
      bestDays: bd.bestDays.facebook,
      contentPillars: bd.contentMix.pillars,
      hashtagThemes: bd.hashtagStrategy.sampleHashtags.industry.slice(0, 5),
      imageStyle: 'vibrant, clean background with natural lighting',
      platformSplit: { facebook: 40, instagram: 60 },
      engagementTips: bd.engagementNotes
    };

    // ── Campaign Focus deep research (if provided) ──
    if (campaignFocus) {
      onPhase?.('researching');
      campaignBrief = await researchCampaignFocus(
        campaignFocus, businessName, businessType,
        safeProfile?.description, safeProfile?.productsServices
      );
      console.log('[Campaign Research] Brief generated:', campaignBrief.substring(0, 200));
    }

    // ── Build structured campaign rules block (from Campaigns feature) ──
    let structuredCampaignBlock = '';
    if (activeCampaigns && activeCampaigns.length > 0) {
      const today = new Date();
      structuredCampaignBlock = '\n🎯 ACTIVE CAMPAIGNS (weave these into the content calendar):\n' +
        activeCampaigns.map(c => {
          const end = new Date(c.endDate);
          const daysLeft = Math.max(0, Math.ceil((end.getTime() - today.getTime()) / 86400000));
          const countdownNote = c.type === 'countdown' ? ` — ${daysLeft} days to go! Include countdown language.` : '';
          return `• ${c.name} (${c.type}${countdownNote})\n  Dates: ${c.startDate} to ${c.endDate}\n  Rules: ${(c.rules || '').substring(0, 500)}\n  Target: ${c.postsPerDay} post(s) per day about this campaign`;
        }).join('\n') +
        '\nIMPORTANT: Campaign posts should feel natural alongside regular content — not every post needs to be about the campaign, but ' +
        `at least ${activeCampaigns.reduce((sum, c) => sum + c.postsPerDay, 0)} post(s) per day MUST reference active campaigns.\n`;
      console.log('[Campaigns] Injecting', activeCampaigns.length, 'active campaign(s) into prompt');
    }

    let research: any = {};
    onPhase?.('researching');
    try {
      const researchText = await withTimeout(callAI(researchPrompt, { temperature: 0.5, maxTokens: 4096, responseFormat: 'json' }), 90000);
      const researchParsed = parseAiJson(researchText);
      if (researchParsed) research = researchParsed;
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

    // Validate posting times — reject anything outside 6:00 AM – 9:30 PM
    const isReasonableTime = (t: string): boolean => {
      const m = t.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return false;
      const h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      const totalMins = h * 60 + min;
      return totalMins >= 360 && totalMins <= 1290; // 6:00 AM to 9:30 PM
    };
    const rawWindows = saturationMode
      ? (research.dailyPostingWindows || saturationFallback.dailyPostingWindows)
      : (research.bestPostingTimes || normalFallback.bestPostingTimes);
    const postingWindows = (rawWindows as string[]).filter(isReasonableTime);
    // If ALL researched times were unreasonable, use safe defaults
    if (postingWindows.length === 0) {
      postingWindows.push(...(saturationMode
        ? saturationFallback.dailyPostingWindows
        : normalFallback.bestPostingTimes));
    }

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

    const nowTimeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
    const quick24hExtra = isQuick24h ? `
MODE: QUICK 24HR BURST — Current time is ${nowTimeStr} on ${now.toISOString().split('T')[0]}. Schedule ALL posts at least 30 minutes from now, within the next 24 hours. Do NOT schedule anything at or before ${nowTimeStr} today — those times have already passed. Use only researched time slots that are still in the future. Generate punchy, high-engagement content designed for immediate interaction.` : '';
    const highlightsExtra = isHighlights ? `
MODE: HIGHLIGHTS ONLY — schedule posts ONLY at the absolute top 3 researched time slots across the 14-day window. Quality over quantity. Each post must be polished, pillar-defining, and perfectly timed. No filler — every post must be your single best recommendation for that pillar.` : '';

    const prompt = saturationMode ? `
You are an elite social media growth operator running a SATURATION CAMPAIGN for "${businessName}", a ${businessType}.
Tone: ${tone}. Location: ${location}. Current date/time: ${now.toISOString().split('T')[0]} ${nowTimeStr} — do NOT schedule any post before this time today.
Campaign window: ${now.toISOString().split('T')[0]} to ${windowEnd.toISOString().split('T')[0]} (${windowDays} days).
Audience stats: ${stats.followers} followers, ${stats.engagement}% engagement, ${stats.reach} monthly reach.
${profileBlock ? `\nBusiness context:\n${profileBlock}\n` : ''}${structuredCampaignBlock}
CRITICAL: ALL posts must be about "${businessName}" and its ${businessType} business. NEVER write posts about social media marketing, AI tools, web design, software platforms, or any topic unrelated to ${businessType}. Every post must be something a ${businessType} business would actually share with their customers.${!includeVideos ? '\nIMPORTANT: Do NOT generate any video/Reel posts. All posts must be "image" or "text" type only.' : ''}
SATURATION RESEARCH (apply precisely):
- Daily time windows: ${postingWindows.join(', ')} — use ALL of them, never repeat same time on same day
- Content variety strategy: ${research.contentVarietyStrategy || saturationFallback.contentVarietyStrategy}
- Content pillars — ROTATE ALL: ${pillarsForPrompt.join(' | ')}
- Hashtag pool (mix ALL tiers per post, Facebook: ${HASHTAG_LIMITS.facebook.optimal}, Instagram: ${HASHTAG_LIMITS.instagram.optimal}): ${hashtagPool || (saturationFallback as any).hashtagThemes?.join(', ')}
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
6. Hashtags: Facebook: ${HASHTAG_LIMITS.facebook.optimal}, Instagram: ${HASHTAG_LIMITS.instagram.optimal}, mix mega+large+medium+niche+local tiers. NO generic or repeated sets.
7. imagePrompt: MUST name the EXACT product from this post — ${getImagePromptExamples(businessType)}. Format: "[exact product name] on [specific surface], [lighting], [camera angle]". NEVER use vague words like "produce", "items", "products", "goods", "delicious food". NEVER include people, hands, faces. ${bd.imagePromptAvoid}
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
      "pillar": "exact content pillar name",
      "videoScript": "(only for video postType) 30-60 second spoken script with hook, body, CTA",
      "videoShots": "(only for video postType) numbered shot list e.g. 1. Close-up of product, 3s...",
      "videoMood": "(only for video postType) music mood/genre e.g. Upbeat pop, 120BPM"
    }
  ]
}` : `
You are an elite social media strategist writing a data-driven content calendar for "${businessName}", a ${businessType}.
Tone: ${tone}. Location: ${location}. Current date/time: ${now.toISOString().split('T')[0]} ${nowTimeStr} — do NOT schedule any post before this time today.
Schedule window: ${now.toISOString().split('T')[0]} to ${windowEnd.toISOString().split('T')[0]}.
Audience stats: ${stats.followers} followers, ${stats.engagement}% engagement, ${stats.reach} monthly reach.
${profileBlock ? `\nBusiness context:\n${profileBlock}\n` : ''}${structuredCampaignBlock}${quick24hExtra}${highlightsExtra}
CRITICAL: ALL posts must be about "${businessName}" and its ${businessType} business. NEVER write posts about social media marketing, AI tools, web design, software platforms, or any topic unrelated to ${businessType}. Every post must be something a ${businessType} business would actually share with their customers.${!includeVideos ? '\nIMPORTANT: Do NOT generate any video/Reel posts. All posts must be "image" or "text" type only. Set "postType" to "image" or "text" — never "video".' : ''}
RESEARCH INSIGHTS — apply every finding precisely:
- Peak posting times: ${postingWindows.join(', ')} (researched for this business type + location)
- Best days: ${(research.bestDays || normalFallback.bestDays).join(', ')} | Avoid: ${(research.worstDays || []).join(', ')}
- Content pillars: ${pillarsForPrompt.join(' | ')}
- Caption style: ${research.captionStyle || 'conversational, question at end, 3-4 sentences max'}
- Image aesthetic: ${research.imageStyle || 'vibrant, natural lighting, authentic'} 
- Hashtag pool (mix ALL tiers, Facebook: ${HASHTAG_LIMITS.facebook.optimal}, Instagram: ${HASHTAG_LIMITS.instagram.optimal}): ${hashtagPool || (normalFallback as any).hashtagThemes?.join(', ')}
- Local hashtags to include: ${(research.localHashtags || []).join(', ')}
- Platform split: ${fbCount} Facebook, ${igCount} Instagram
- Post format mix: ${JSON.stringify(includeVideos ? (research.postFormatMix || { image: 50, video: 30, text: 20 }) : { image: 70, text: 30 })}
- Key engagement tactic: ${research.engagementTips || 'Ask a question every post'}
${videoInstructions}
RULES:
1. Exactly ${effectivePosts} posts (${fbCount} Facebook, ${igCount} Instagram${videoCount > 0 ? `, ${videoCount} Reels` : ''}).
2. Schedule ONLY on the best days listed above, at the researched peak times.
3. Rotate through ALL content pillars — no pillar used more than twice in a row.
4. VARY POST STYLES: Rotate through these across the calendar: question, quick-tip, micro-story, behind-the-scenes, poll/this-or-that, list/carousel, soft-promo, bold-opinion. No two consecutive posts should use the same style.
5. Each caption: strong hook first line, body matching the caption style, specific CTA last line. NEVER start with "Exciting news!" or generic corporate filler.
6. Hashtags: Facebook posts get EXACTLY ${HASHTAG_LIMITS.facebook.optimal} hashtags (max ${HASHTAG_LIMITS.facebook.max}). Instagram posts get EXACTLY ${HASHTAG_LIMITS.instagram.optimal} hashtags (max ${HASHTAG_LIMITS.instagram.max}). DO NOT exceed these limits. Vary per post.
7. imagePrompt: MUST name the EXACT product from this post — ${getImagePromptExamples(businessType)}. Format: "[exact product name] on [specific surface], [lighting], [camera angle]". NEVER use vague words like "produce", "items", "products", "goods", "delicious food". NEVER include people, hands, faces. ${bd.imagePromptAvoid}
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
      "pillar": "content pillar name from researched list",
      "videoScript": "(only for video postType) 30-60 second spoken script with hook, body, CTA",
      "videoShots": "(only for video postType) numbered shot list e.g. 1. Close-up of product, 3s...",
      "videoMood": "(only for video postType) music mood/genre e.g. Upbeat pop, 120BPM"
    }
  ]
}`;

    onPhase?.('writing');
    // Video posts with scripts/shots need much more output tokens than the default 2048
    const outputTokens = includeVideos ? 8192 : (effectivePosts > 7 ? 6144 : 4096);
    const scheduleText = await withTimeout(callAI(prompt, { temperature: 0.75, maxTokens: outputTokens, responseFormat: 'json' }), 120000);
    const data = parseAiJson(scheduleText) || { posts: [], strategy: '' };
    let posts: SmartScheduledPost[] = Array.isArray(data.posts) ? data.posts : [];

    // Format a Date as local time string (NOT UTC) — "YYYY-MM-DDTHH:MM:SS"
    const toLocalISO = (d: Date): string => {
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    };

    // Ensure no post is scheduled in the past or at unreasonable hours.
    const thirtyMinsFromNow = new Date(now.getTime() + 30 * 60 * 1000);
    posts = posts.map((post) => {
      if (!post.scheduledFor) return post;

      // Parse the scheduledFor — treat as local time (no Z suffix)
      const raw = post.scheduledFor.replace('Z', '');
      const t = new Date(raw);

      // Fix unreasonable hours (before 6 AM or after 9:30 PM) — move to nearest sensible time
      const h = t.getHours();
      const totalMins = h * 60 + t.getMinutes();
      if (totalMins < 360) { // before 6:00 AM → move to 9:00 AM same day
        t.setHours(9, 0, 0, 0);
      } else if (totalMins > 1290) { // after 9:30 PM → move to 9:00 AM next day
        t.setDate(t.getDate() + 1);
        t.setHours(9, 0, 0, 0);
      }

      if (t >= thirtyMinsFromNow) {
        return { ...post, scheduledFor: toLocalISO(t) };
      }
      // Keep the same HH:MM:SS but advance by whole days until it clears the threshold
      const msPerDay = 24 * 60 * 60 * 1000;
      const daysToAdd = Math.ceil((thirtyMinsFromNow.getTime() - t.getTime()) / msPerDay);
      const bumped = new Date(t.getTime() + daysToAdd * msPerDay);
      return { ...post, scheduledFor: toLocalISO(bumped) };
    });

    return { posts, strategy: data.strategy || '' };
  } catch (error: any) {
    console.error("Smart Schedule Error:", error);
    return { posts: [], strategy: `Error: ${error?.message || 'Unknown'}` };
  }
};

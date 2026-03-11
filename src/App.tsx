import React, { useState, useEffect, useRef } from 'react';
import { CLIENT } from './client.config';
import { ToastProvider, useToast } from './components/Toast';
import { SocialPost, BusinessProfile, ContentCalendarStats } from './types';
import { generateSocialPost, generateMarketingImage, analyzePostTimes, generateRecommendations, generateSmartSchedule, SmartScheduledPost } from './services/gemini';
import { FacebookService } from './services/facebookService';
import {
  Sparkles, Settings, Calendar, BarChart3, Wand2, Image as ImageIcon,
  Send, Loader2, Plus, Edit2, Trash2, Facebook, Instagram, Clock,
  CheckCircle, ChevronDown, ChevronUp, Zap, Save, Eye, X, Brain, Upload,
  RefreshCw, Link2, Link2Off, TrendingUp, Users, Activity
} from 'lucide-react';

const DEFAULT_PROFILE: BusinessProfile = {
  name: CLIENT.defaultBusinessName,
  type: CLIENT.defaultBusinessType,
  description: CLIENT.defaultDescription,
  tone: CLIENT.defaultTone,
  location: CLIENT.defaultLocation,
  logoUrl: '',
  facebookAppId: '',
  facebookPageId: '',
  facebookPageAccessToken: '',
  facebookConnected: false,
  instagramBusinessAccountId: '',
  geminiApiKey: ''
};

const DEFAULT_STATS: ContentCalendarStats = {
  followers: 500,
  reach: 2000,
  engagement: 4.5,
  postsLast30Days: 8
};

// ── Main Dashboard ──────────────────────────────────────
const Dashboard: React.FC = () => {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'create' | 'calendar' | 'smart' | 'insights' | 'settings'>('create');

  useEffect(() => { document.title = CLIENT.appName; }, []);

  // Profile & Posts
  const [profile, setProfile] = useState<BusinessProfile>(() => {
    const saved = localStorage.getItem('sai_profile');
    return saved ? { ...DEFAULT_PROFILE, ...JSON.parse(saved) } : DEFAULT_PROFILE;
  });
  const [posts, setPosts] = useState<SocialPost[]>(() => {
    const saved = localStorage.getItem('sai_posts');
    return saved ? JSON.parse(saved) : [];
  });
  const [stats, setStats] = useState<ContentCalendarStats>(() => {
    const saved = localStorage.getItem('sai_stats');
    return saved ? { ...DEFAULT_STATS, ...JSON.parse(saved) } : DEFAULT_STATS;
  });

  // Persist
  useEffect(() => { localStorage.setItem('sai_posts', JSON.stringify(posts)); }, [posts]);
  useEffect(() => { localStorage.setItem('sai_profile', JSON.stringify(profile)); }, [profile]);
  useEffect(() => { localStorage.setItem('sai_stats', JSON.stringify(stats)); }, [stats]);

  // Content Generator State
  const [topic, setTopic] = useState('');
  const [platform, setPlatform] = useState<'Facebook' | 'Instagram'>('Instagram');
  const [generatedContent, setGeneratedContent] = useState('');
  const [generatedHashtags, setGeneratedHashtags] = useState<string[]>([]);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');

  // Smart Schedule State
  const [smartPosts, setSmartPosts] = useState<SmartScheduledPost[]>([]);
  const [smartStrategy, setSmartStrategy] = useState('');
  const [isSmartGenerating, setIsSmartGenerating] = useState(false);
  const [saturationMode, setSaturationMode] = useState(false);
  const [smartCount, setSmartCount] = useState(7);

  // Smart post image generation
  const [smartPostImages, setSmartPostImages] = useState<Record<number, string>>({});
  const [autoGenSet, setAutoGenSet] = useState<Set<number>>(new Set());
  const [currentGenIdx, setCurrentGenIdx] = useState<number | null>(null);
  const [imgGenDone, setImgGenDone] = useState(0);
  const uploadFileRef = useRef<HTMLInputElement>(null);
  const [uploadTargetIdx, setUploadTargetIdx] = useState<number | null>(null);

  // Generation ticker
  const TICKER_STEPS_NORMAL = [
    { label: 'Analysing your brand profile & location...', pct: 5 },
    { label: 'Researching best posting times for your audience...', pct: 15 },
    { label: 'Identifying top content pillars for your industry...', pct: 25 },
    { label: 'Studying hashtag themes & trending topics...', pct: 35 },
    { label: 'Determining ideal platform mix & image aesthetic...', pct: 45 },
    { label: 'Building strategy from research insights...', pct: 55 },
    { label: 'Writing post captions with your brand tone...', pct: 65 },
    { label: 'Scheduling at researched peak engagement times...', pct: 75 },
    { label: 'Crafting image prompts for each post...', pct: 83 },
    { label: 'Weaving in researched hashtags...', pct: 90 },
    { label: 'Almost there — finalising your calendar...', pct: 96 },
  ];
  const TICKER_STEPS_SATURATION = [
    { label: 'Activating saturation mode — maximum volume campaign...', pct: 5 },
    { label: 'Researching peak intra-day posting windows...', pct: 12 },
    { label: 'Mapping 7-day blitz schedule (3-5 posts/day)...', pct: 22 },
    { label: 'Building 7-pillar content variety matrix...', pct: 32 },
    { label: 'Calculating platform saturation split...', pct: 42 },
    { label: 'Engineering anti-fatigue content rotation...', pct: 52 },
    { label: 'Writing high-frequency captions with varied formats...', pct: 63 },
    { label: 'Spacing posts across all daily time windows...', pct: 73 },
    { label: 'Crafting unique image prompts for every post...', pct: 82 },
    { label: 'Loading niche + broad hashtag mix per post...', pct: 90 },
    { label: 'Finalising your 7-day saturation campaign...', pct: 96 },
  ];
  const TICKER_STEPS = saturationMode ? TICKER_STEPS_SATURATION : TICKER_STEPS_NORMAL;
  const [tickerIdx, setTickerIdx] = useState(0);
  useEffect(() => {
    if (!isSmartGenerating) { setTickerIdx(0); return; }
    const id = setInterval(() => {
      setTickerIdx(prev => (prev < TICKER_STEPS.length - 1 ? prev + 1 : prev));
    }, 2800);
    return () => clearInterval(id);
  }, [isSmartGenerating]);

  // Insights State
  const [recommendations, setRecommendations] = useState('');
  const [bestTimes, setBestTimes] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const hasApiKey = !!localStorage.getItem('sai_gemini_key');
  const fbConnected = !!(profile.facebookPageId && profile.facebookPageAccessToken);

  // Live Facebook Stats
  interface LiveFbStats { fanCount: number; followersCount: number; reach28d: number; engagedUsers28d: number; engagementRate: number; }
  const [liveStats, setLiveStats] = useState<LiveFbStats | null>(null);
  const [isPullingStats, setIsPullingStats] = useState(false);
  const [lastPulled, setLastPulled] = useState<Date | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const handlePullStats = async () => {
    if (!profile.facebookPageId || !profile.facebookPageAccessToken) {
      toast('Connect a Facebook page in Settings first.', 'warning'); return;
    }
    setIsPullingStats(true);
    try {
      const data = await FacebookService.getPageStats(profile.facebookPageId, profile.facebookPageAccessToken);
      setLiveStats(data);
      setLastPulled(new Date());
      setStats(prev => ({ ...prev, followers: data.followersCount || data.fanCount, reach: data.reach28d, engagement: data.engagementRate }));
      toast('Live stats updated from Facebook!', 'success');
    } catch (e: any) {
      toast(`Stats pull failed: ${e?.message?.substring(0, 100) || 'Unknown error'}`, 'error');
    }
    setIsPullingStats(false);
  };

  const handlePublishToFacebook = async () => {
    if (!profile.facebookPageId || !profile.facebookPageAccessToken) {
      toast('Facebook page not connected. Go to Settings to connect.', 'warning'); return;
    }
    setIsPublishing(true);
    try {
      const fullText = generatedHashtags.length > 0 ? `${generatedContent}\n\n${generatedHashtags.join(' ')}` : generatedContent;
      await FacebookService.postToPageDirect(profile.facebookPageId, profile.facebookPageAccessToken, fullText, generatedImage || undefined);
      toast('Published to Facebook!', 'success');
    } catch (e: any) {
      toast(`Publish failed: ${e?.message?.substring(0, 100) || 'Unknown error'}`, 'error');
    }
    setIsPublishing(false);
  };

  // ── Content Generation ──
  const handleGenerate = async () => {
    if (!topic.trim()) { toast('Enter a topic first.', 'warning'); return; }
    if (!hasApiKey) { toast('Set your Gemini API key in Settings first.', 'warning'); return; }
    setIsGenerating(true);
    const result = await generateSocialPost(topic, platform, profile.name, profile.type, profile.tone);
    setGeneratedContent(result.content);
    setGeneratedHashtags(result.hashtags || []);
    setIsGenerating(false);
  };

  const handleGenerateImage = async () => {
    if (!topic.trim()) { toast('Enter a topic first.', 'warning'); return; }
    if (!hasApiKey) { toast('Set your Gemini API key in Settings first.', 'warning'); return; }
    setIsGeneratingImage(true);
    const img = await generateMarketingImage(`${profile.type}: ${topic}`);
    if (img) setGeneratedImage(img);
    else toast('Image generation failed. Try again.', 'error');
    setIsGeneratingImage(false);
  };

  const handleSavePost = () => {
    if (!generatedContent) { toast('Generate content first.', 'warning'); return; }
    const post: SocialPost = {
      id: `sp_${Date.now()}`,
      platform,
      content: generatedContent,
      hashtags: generatedHashtags,
      scheduledFor: scheduleDate || new Date().toISOString(),
      status: scheduleDate ? 'Scheduled' : 'Draft',
      image: generatedImage || undefined,
      topic
    };
    setPosts(prev => [post, ...prev]);
    toast(`Post ${scheduleDate ? 'scheduled' : 'saved as draft'}!`);
    setGeneratedContent('');
    setGeneratedHashtags([]);
    setGeneratedImage(null);
    setTopic('');
    setScheduleDate('');
  };

  // ── Auto-generate images for all smart posts ──
  const autoGenerateAllImages = async (posts: SmartScheduledPost[]) => {
    if (!localStorage.getItem('sai_gemini_key')) return;
    const allIdxs = new Set(posts.map((_, i) => i));
    setAutoGenSet(allIdxs);
    setImgGenDone(0);
    for (let i = 0; i < posts.length; i++) {
      const prompt = posts[i].imagePrompt || posts[i].topic;
      setCurrentGenIdx(i);
      if (!prompt) {
        setAutoGenSet(prev => { const s = new Set(prev); s.delete(i); return s; });
        setImgGenDone(d => d + 1);
        continue;
      }
      try {
        const img = await generateMarketingImage(prompt);
        if (img) setSmartPostImages(prev => ({ ...prev, [i]: img }));
      } catch { /* silently skip */ }
      setAutoGenSet(prev => { const s = new Set(prev); s.delete(i); return s; });
      setImgGenDone(d => d + 1);
    }
    setCurrentGenIdx(null);
  };

  const handleUploadImage = (idx: number) => {
    setUploadTargetIdx(idx);
    uploadFileRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || uploadTargetIdx === null) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      if (dataUrl) setSmartPostImages(prev => ({ ...prev, [uploadTargetIdx]: dataUrl }));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
    setUploadTargetIdx(null);
  };

  // ── Smart Schedule ──
  const handleSmartSchedule = async () => {
    if (!hasApiKey) { toast('Set your Gemini API key in Settings first.', 'warning'); return; }
    setIsSmartGenerating(true);
    setSmartPostImages({});
    setAutoGenSet(new Set());
    try {
      const result = await generateSmartSchedule(
        profile.name, profile.type, profile.tone, stats, smartCount,
        profile.location || 'Australia',
        { facebook: true, instagram: true },
        saturationMode
      );
      setSmartPosts(result.posts);
      setSmartStrategy(result.strategy);
      autoGenerateAllImages(result.posts);
    } catch (e: any) {
      toast(`Smart schedule failed: ${e?.message?.substring(0, 80) || 'Unknown'}`, 'error');
    }
    setIsSmartGenerating(false);
  };

  const handleAcceptSmartPosts = () => {
    const newPosts: SocialPost[] = smartPosts.map((sp, i) => ({
      id: `sp_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`,
      platform: sp.platform,
      content: sp.content,
      hashtags: sp.hashtags,
      scheduledFor: sp.scheduledFor,
      status: 'Scheduled' as const,
      image: smartPostImages[i] || undefined,
      imagePrompt: sp.imagePrompt,
      reasoning: sp.reasoning,
      pillar: sp.pillar,
      topic: sp.topic
    }));
    setPosts(prev => [...newPosts, ...prev]);
    toast(`${newPosts.length} posts added to calendar!`);
    setSmartPosts([]);
    setSmartStrategy('');
    setSmartPostImages({});
    setAutoGenSet(new Set());
    setCurrentGenIdx(null);
  };

  // ── Insights ──
  const handleAnalyze = async () => {
    if (!hasApiKey) { toast('Set your Gemini API key in Settings first.', 'warning'); return; }
    setIsAnalyzing(true);
    const [recs, times] = await Promise.all([
      generateRecommendations(profile.name, profile.type, stats),
      analyzePostTimes(profile.type, profile.location)
    ]);
    setRecommendations(recs || '');
    setBestTimes(times || '');
    setIsAnalyzing(false);
  };

  // ── Delete Post ──
  const deletePost = (id: string) => {
    setPosts(prev => prev.filter(p => p.id !== id));
    toast('Post deleted.');
  };

  // ── Tab Rendering ──
  const tabs = [
    { id: 'create' as const, label: 'Create', icon: Wand2 },
    { id: 'calendar' as const, label: 'Calendar', icon: Calendar },
    { id: 'smart' as const, label: 'Smart AI', icon: Brain },
    { id: 'insights' as const, label: 'Insights', icon: BarChart3 },
    { id: 'settings' as const, label: 'Settings', icon: Settings }
  ];

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-white/10 bg-black/20 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Sparkles className="text-amber-400" size={28} />
            <div>
              <h1 className="text-xl font-bold text-white">{CLIENT.appName}</h1>
              <p className="text-xs text-gray-400">{profile.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs flex-wrap justify-end">
            {fbConnected ? (
              <span className="flex items-center gap-1.5 text-blue-400 bg-blue-500/10 px-2.5 py-1 rounded-full border border-blue-500/20">
                <Link2 size={12} /> Facebook Connected
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-gray-500 bg-white/5 px-2.5 py-1 rounded-full border border-white/10">
                <Link2Off size={12} /> Facebook Not Connected
              </span>
            )}
            {hasApiKey ? (
              <span className="flex items-center gap-1.5 text-green-400 bg-green-500/10 px-2.5 py-1 rounded-full border border-green-500/20">
                <CheckCircle size={12} /> AI Active
              </span>
            ) : (
              <span className="text-yellow-400 bg-yellow-500/10 px-2.5 py-1 rounded-full border border-yellow-500/20">No API Key</span>
            )}
            {fbConnected && (
              <button
                onClick={handlePullStats}
                disabled={isPullingStats}
                className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white px-2.5 py-1 rounded-full transition disabled:opacity-40 text-xs"
                title="Pull live stats from Facebook"
              >
                <RefreshCw size={11} className={isPullingStats ? 'animate-spin' : ''} />
                {isPullingStats ? 'Pulling...' : 'Refresh Stats'}
              </button>
            )}
          </div>
        </div>
        {/* Live Stats Bar */}
        {liveStats && (
          <div className="border-t border-white/5 bg-black/10">
            <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-6 text-xs overflow-x-auto">
              <span className="flex items-center gap-1.5 text-gray-400 whitespace-nowrap"><Users size={11} className="text-blue-400" /> <span className="text-white font-bold">{liveStats.followersCount.toLocaleString()}</span> followers</span>
              <span className="flex items-center gap-1.5 text-gray-400 whitespace-nowrap"><Activity size={11} className="text-purple-400" /> <span className="text-white font-bold">{liveStats.reach28d.toLocaleString()}</span> reach (28d)</span>
              <span className="flex items-center gap-1.5 text-gray-400 whitespace-nowrap"><TrendingUp size={11} className="text-amber-400" /> <span className="text-white font-bold">{liveStats.engagementRate}%</span> engagement</span>
              {lastPulled && <span className="text-gray-600 whitespace-nowrap">Updated {lastPulled.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
            </div>
          </div>
        )}
      </header>

      {/* Tab Nav */}
      <nav className="border-b border-white/10 bg-black/10 sticky top-[73px] z-30">
        <div className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-amber-400 text-amber-400'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">

        {/* ═══ CREATE TAB ═══ */}
        {activeTab === 'create' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold flex items-center gap-2"><Wand2 className="text-amber-400" /> AI Content Generator</h2>

            <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
              <div>
                <label className="text-sm text-gray-400 block mb-1">Topic / Prompt</label>
                <textarea
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  placeholder="e.g., Weekend sale, new product launch, behind the scenes..."
                  className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white resize-y min-h-[80px]"
                />
              </div>

              <div className="flex flex-wrap gap-3 items-center">
                <select
                  value={platform}
                  onChange={e => setPlatform(e.target.value as any)}
                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white"
                  title="Platform"
                >
                  <option value="Instagram">Instagram</option>
                  <option value="Facebook">Facebook</option>
                </select>
                <button onClick={handleGenerate} disabled={isGenerating} className="bg-amber-500 hover:bg-amber-600 text-black font-bold px-6 py-2 rounded-lg transition flex items-center gap-2">
                  {isGenerating ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}
                  Generate Text
                </button>
                <button onClick={handleGenerateImage} disabled={isGeneratingImage} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2 rounded-lg transition flex items-center gap-2">
                  {isGeneratingImage ? <Loader2 className="animate-spin" size={16} /> : <ImageIcon size={16} />}
                  Image
                </button>
              </div>
            </div>

            {/* Generated Output */}
            {generatedContent && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-white flex items-center gap-2">
                    {platform === 'Instagram' ? <Instagram size={18} className="text-pink-400" /> : <Facebook size={18} className="text-blue-400" />}
                    Generated Post
                  </h3>
                </div>
                <div className="bg-black/30 rounded-lg p-4 text-gray-200 whitespace-pre-wrap">{generatedContent}</div>
                {generatedHashtags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {generatedHashtags.map((tag, i) => (
                      <span key={i} className="text-xs bg-amber-500/20 text-amber-300 px-2 py-1 rounded-full">{tag.startsWith('#') ? tag : `#${tag}`}</span>
                    ))}
                  </div>
                )}
                {generatedImage && (
                  <img src={generatedImage} alt="Generated" className="w-full max-w-sm rounded-lg border border-white/10" />
                )}
                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Schedule (optional)</label>
                    <input type="datetime-local" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className="bg-black/40 border border-white/10 rounded px-3 py-2 text-white text-sm" />
                  </div>
                  <button onClick={handleSavePost} className="bg-green-600 hover:bg-green-700 text-white font-bold px-6 py-2 rounded-lg flex items-center gap-2">
                    <Save size={16} /> {scheduleDate ? 'Schedule' : 'Save Draft'}
                  </button>
                  {fbConnected && (
                    <button
                      onClick={handlePublishToFacebook}
                      disabled={isPublishing}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 py-2 rounded-lg flex items-center gap-2 disabled:opacity-60 transition"
                    >
                      {isPublishing ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                      Publish to Facebook
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ CALENDAR TAB ═══ */}
        {activeTab === 'calendar' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold flex items-center gap-2"><Calendar className="text-amber-400" /> Content Calendar</h2>
              <span className="text-sm text-gray-400">{posts.length} posts</span>
            </div>

            {posts.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <Calendar size={48} className="mx-auto mb-4 opacity-30" />
                <p>No posts yet. Create one in the Create tab or use Smart AI.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {posts.map(post => (
                  <div key={post.id} className="bg-white/5 border border-white/10 rounded-lg p-4 flex gap-4">
                    {post.image && <img src={post.image} alt="" className="w-16 h-16 rounded object-cover shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {post.platform === 'Instagram' ? <Instagram size={14} className="text-pink-400" /> : <Facebook size={14} className="text-blue-400" />}
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          post.status === 'Posted' ? 'bg-green-900/50 text-green-300' :
                          post.status === 'Scheduled' ? 'bg-blue-900/50 text-blue-300' :
                          'bg-gray-800 text-gray-400'
                        }`}>{post.status}</span>
                        <span className="text-xs text-gray-500">{new Date(post.scheduledFor).toLocaleDateString()} {new Date(post.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {post.pillar && <span className="text-[10px] bg-purple-900/50 text-purple-300 px-1.5 rounded">{post.pillar}</span>}
                      </div>
                      <p className="text-sm text-gray-300 line-clamp-2">{post.content}</p>
                      {post.hashtags?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {post.hashtags.slice(0, 5).map((t, i) => <span key={i} className="text-[10px] text-amber-400">{t}</span>)}
                        </div>
                      )}
                    </div>
                    <button onClick={() => deletePost(post.id)} className="text-red-500 hover:text-red-300 p-2 shrink-0" title="Delete">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ SMART AI TAB ═══ */}
        {activeTab === 'smart' && (
          <div className="space-y-6">
            {/* Hidden file input for image upload */}
            <input ref={uploadFileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

            {/* Hero Banner */}
            <div className="bg-gradient-to-br from-black via-gray-900 to-black rounded-2xl p-7 relative overflow-hidden border border-white/10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_50%,rgba(245,158,11,0.12),transparent_60%)]" />
              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/20">
                    <Zap size={20} className="text-white" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">AI Autopilot</h2>
                    <p className="text-white/40 text-xs">Powered by Gemini — researches & writes your entire content calendar</p>
                  </div>
                </div>

                {/* Saturation Mode Toggle */}
                <div
                  onClick={() => { const next = !saturationMode; setSaturationMode(next); setSmartCount(next ? 21 : 7); }}
                  className={`cursor-pointer rounded-xl border px-4 py-3 flex items-start gap-3 transition mb-4 max-w-lg ${
                    saturationMode ? 'bg-red-500/10 border-red-500/30' : 'bg-white/5 border-white/15 hover:bg-white/10'
                  }`}
                >
                  <div className={`mt-0.5 w-9 h-5 rounded-full flex items-center transition-all flex-shrink-0 ${saturationMode ? 'bg-red-500 justify-end' : 'bg-white/20 justify-start'}`}>
                    <div className="w-4 h-4 rounded-full bg-white mx-0.5 shadow" />
                  </div>
                  <div>
                    <p className={`text-sm font-bold ${saturationMode ? 'text-red-300' : 'text-white/80'}`}>
                      {saturationMode ? '🔥 Saturation Mode ON' : 'Saturation Mode'}
                    </p>
                    <p className="text-xs text-white/40 mt-0.5">
                      {saturationMode ? '3-5 posts/day over 7 days — maximum algorithmic reach' : 'Enable for a high-frequency blitz campaign (3-5 posts/day)'}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <label className="text-xs text-white/40 block mb-1">Posts to Generate</label>
                    <select
                      value={smartCount}
                      onChange={e => setSmartCount(Number(e.target.value))}
                      className="bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
                      title="Post count"
                    >
                      {saturationMode
                        ? [<option key={14} value={14}>14 posts (2/day)</option>, <option key={21} value={21}>21 posts (3/day)</option>, <option key={28} value={28}>28 posts (4/day)</option>, <option key={35} value={35}>35 posts (5/day)</option>]
                        : [<option key={5} value={5}>5 posts</option>, <option key={7} value={7}>7 posts</option>, <option key={10} value={10}>10 posts</option>, <option key={14} value={14}>14 posts</option>]
                      }
                    </select>
                  </div>
                  <button
                    onClick={handleSmartSchedule}
                    disabled={isSmartGenerating}
                    className={`font-bold px-6 py-2.5 rounded-xl transition flex items-center gap-2 text-sm shadow-lg disabled:opacity-60 ${
                      saturationMode
                        ? 'bg-gradient-to-r from-red-500 to-orange-600 hover:from-red-600 hover:to-orange-700 text-white'
                        : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black'
                    }`}
                  >
                    {isSmartGenerating ? <Loader2 className="animate-spin" size={16} /> : <Zap size={16} />}
                    {saturationMode ? 'Launch Saturation Campaign' : 'Generate Schedule'}
                  </button>
                </div>
              </div>
            </div>

            {/* Generation Ticker */}
            {isSmartGenerating && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin text-amber-400" />
                  <span className="text-sm text-amber-300 font-medium">{TICKER_STEPS[tickerIdx]?.label}</span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-1.5">
                  <div
                    className="bg-gradient-to-r from-amber-400 to-orange-500 h-1.5 rounded-full transition-all duration-700"
                    style={{ width: `${TICKER_STEPS[tickerIdx]?.pct ?? 0}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500">This uses two AI calls for better results — usually 20-40s</p>
              </div>
            )}

            {/* Strategy */}
            {smartStrategy && !isSmartGenerating && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
                <h4 className="font-bold text-amber-300 text-sm mb-1">Strategy</h4>
                <p className="text-sm text-gray-300">{smartStrategy}</p>
              </div>
            )}

            {/* Generated Posts */}
            {smartPosts.length > 0 && !isSmartGenerating && (
              <div className="space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div>
                    <h3 className="font-bold text-white">{smartPosts.length} Posts Generated</h3>
                    {autoGenSet.size > 0 && (
                      <p className="text-xs text-amber-400 mt-0.5 flex items-center gap-1">
                        <Loader2 size={11} className="animate-spin" />
                        Auto-generating images… {imgGenDone}/{smartPosts.length}
                      </p>
                    )}
                  </div>
                  <button onClick={handleAcceptSmartPosts} className="bg-green-600 hover:bg-green-700 text-white font-bold px-4 py-2 rounded-lg flex items-center gap-2 text-sm">
                    <CheckCircle size={16} /> Accept All & Add to Calendar
                  </button>
                </div>
                {smartPosts.map((sp, i) => (
                  <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 flex gap-4">
                    {/* Image area */}
                    <div className="w-20 h-20 rounded-lg shrink-0 overflow-hidden bg-black/30 border border-white/10 flex items-center justify-center relative">
                      {smartPostImages[i] ? (
                        <img src={smartPostImages[i]} alt="" className="w-full h-full object-cover" />
                      ) : autoGenSet.has(i) ? (
                        <div className="flex flex-col items-center gap-1">
                          <Loader2 size={18} className="animate-spin text-amber-400" />
                          <span className="text-[9px] text-white/40">Generating</span>
                        </div>
                      ) : (
                        <ImageIcon size={20} className="text-white/20" />
                      )}
                      <button
                        onClick={() => handleUploadImage(i)}
                        className="absolute bottom-0 right-0 bg-black/70 hover:bg-black p-1 rounded-tl"
                        title="Upload image"
                      >
                        <Upload size={11} className="text-white/60" />
                      </button>
                    </div>
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        {(sp.platform === 'Instagram' || sp.platform?.toLowerCase() === 'instagram')
                          ? <Instagram size={13} className="text-pink-400" />
                          : <Facebook size={13} className="text-blue-400" />}
                        <span className="text-xs text-gray-400">
                          {new Date(sp.scheduledFor).toLocaleDateString()} {new Date(sp.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {sp.pillar && <span className="text-[10px] bg-purple-900/50 text-purple-300 px-1.5 py-0.5 rounded">{sp.pillar}</span>}
                      </div>
                      <p className="text-sm text-gray-200 mb-2 leading-relaxed">{sp.content}</p>
                      <div className="flex flex-wrap gap-1">
                        {sp.hashtags.map((t, j) => <span key={j} className="text-[10px] text-amber-400">{t.startsWith('#') ? t : `#${t}`}</span>)}
                      </div>
                      {sp.reasoning && <p className="text-xs text-gray-600 mt-2 italic">{sp.reasoning}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ═══ INSIGHTS TAB ═══ */}
        {activeTab === 'insights' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold flex items-center gap-2"><BarChart3 className="text-amber-400" /> AI Insights</h2>

            <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
              <h3 className="font-bold text-white">Your Stats</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Followers', key: 'followers' as const },
                  { label: 'Monthly Reach', key: 'reach' as const },
                  { label: 'Engagement %', key: 'engagement' as const },
                  { label: 'Posts (30d)', key: 'postsLast30Days' as const }
                ].map(s => (
                  <div key={s.key}>
                    <label className="text-xs text-gray-400 block mb-1">{s.label}</label>
                    <input
                      type="number"
                      value={stats[s.key]}
                      onChange={e => setStats(prev => ({ ...prev, [s.key]: Number(e.target.value) }))}
                      className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white text-sm"
                    />
                  </div>
                ))}
              </div>
              <button onClick={handleAnalyze} disabled={isAnalyzing} className="bg-amber-500 hover:bg-amber-600 text-black font-bold px-6 py-2 rounded-lg flex items-center gap-2">
                {isAnalyzing ? <Loader2 className="animate-spin" size={16} /> : <BarChart3 size={16} />}
                Analyze & Recommend
              </button>
            </div>

            {recommendations && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                <h3 className="font-bold text-amber-300 mb-3">Recommendations</h3>
                <div className="text-sm text-gray-300 whitespace-pre-wrap">{recommendations}</div>
              </div>
            )}

            {bestTimes && (
              <div className="bg-white/5 border border-white/10 rounded-xl p-6">
                <h3 className="font-bold text-amber-300 mb-3">Best Posting Times</h3>
                <div className="text-sm text-gray-300 whitespace-pre-wrap">{bestTimes}</div>
              </div>
            )}
          </div>
        )}

        {/* ═══ SETTINGS TAB ═══ */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold flex items-center gap-2"><Settings className="text-amber-400" /> Settings</h2>

            {/* API Key */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
              <h3 className="font-bold text-white flex items-center gap-2"><Sparkles size={18} className="text-amber-400" /> Gemini API Key</h3>
              <p className="text-xs text-gray-400">Powers all AI features. Get a free key from <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline">Google AI Studio</a>.</p>
              <div className="flex gap-2 max-w-lg">
                <input
                  type="password"
                  value={profile.geminiApiKey}
                  onChange={e => setProfile(prev => ({ ...prev, geminiApiKey: e.target.value }))}
                  placeholder="Paste your API key..."
                  className="flex-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-white font-mono text-sm"
                />
                <button
                  onClick={() => {
                    localStorage.setItem('sai_gemini_key', profile.geminiApiKey);
                    toast('API Key saved! AI features are now active.');
                  }}
                  className="bg-amber-500 hover:bg-amber-600 text-black font-bold px-4 py-2 rounded text-sm"
                >
                  Save
                </button>
              </div>
              {hasApiKey && <p className="text-xs text-green-400 flex items-center gap-1"><CheckCircle size={12} /> Key configured</p>}
            </div>

            {/* Business Profile */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
              <h3 className="font-bold text-white">Business Profile</h3>
              <p className="text-xs text-gray-400">AI uses this to tailor content to your brand.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Business Name</label>
                  <input value={profile.name} onChange={e => setProfile(prev => ({ ...prev, name: e.target.value }))} className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Business Type</label>
                  <input value={profile.type} onChange={e => setProfile(prev => ({ ...prev, type: e.target.value }))} placeholder="e.g., cafe, gym, retail store" className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Location</label>
                  <input value={profile.location} onChange={e => setProfile(prev => ({ ...prev, location: e.target.value }))} className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white" />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Tone / Voice</label>
                  <input value={profile.tone} onChange={e => setProfile(prev => ({ ...prev, tone: e.target.value }))} placeholder="e.g., Casual and fun, Professional, Edgy" className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Business Description (optional — helps AI understand your brand)</label>
                <textarea value={profile.description} onChange={e => setProfile(prev => ({ ...prev, description: e.target.value }))} placeholder="We're a family-run coffee shop specializing in..." className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white min-h-[60px]" />
              </div>
            </div>

            {/* Facebook Page */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
              <h3 className="font-bold text-white flex items-center gap-2"><Facebook size={18} className="text-blue-400" /> Facebook Page</h3>
              <p className="text-xs text-gray-400">Connect your Facebook page to publish posts and pull live stats.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Page ID</label>
                  <input
                    value={profile.facebookPageId}
                    onChange={e => setProfile(prev => ({ ...prev, facebookPageId: e.target.value }))}
                    placeholder="Your Facebook Page ID"
                    className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Page Access Token</label>
                  <input
                    type="password"
                    value={profile.facebookPageAccessToken}
                    onChange={e => setProfile(prev => ({ ...prev, facebookPageAccessToken: e.target.value }))}
                    placeholder="Page access token"
                    className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-white font-mono text-sm"
                  />
                </div>
              </div>
              {fbConnected && (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle size={12} /> Connected</span>
                  <button onClick={handlePullStats} disabled={isPullingStats} className="text-xs bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/20 px-3 py-1.5 rounded flex items-center gap-1.5 transition disabled:opacity-50">
                    <RefreshCw size={12} className={isPullingStats ? 'animate-spin' : ''} />
                    {isPullingStats ? 'Pulling...' : 'Pull Live Stats'}
                  </button>
                </div>
              )}
            </div>

            {/* Data */}
            <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
              <h3 className="font-bold text-white">Data</h3>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    const data = JSON.stringify({ posts, profile, stats }, null, 2);
                    const blob = new Blob([data], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = `socialai-export-${new Date().toISOString().split('T')[0]}.json`;
                    a.click(); URL.revokeObjectURL(url);
                    toast('Data exported!');
                  }}
                  className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm"
                >
                  Export All Data
                </button>
                <button
                  onClick={() => {
                    if (confirm('Delete all posts? This cannot be undone.')) {
                      setPosts([]);
                      toast('All posts cleared.');
                    }
                  }}
                  className="bg-red-900/50 hover:bg-red-800 text-red-300 px-4 py-2 rounded text-sm"
                >
                  Clear All Posts
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {CLIENT.poweredBy && (
        <footer className="text-center py-4 border-t border-white/10">
          <a
            href={CLIENT.poweredByUrl || '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-600 hover:text-gray-400 transition"
          >
            {CLIENT.poweredBy}
          </a>
        </footer>
      )}
    </div>
  );
};

// ── App Wrapper ──
const App: React.FC = () => (
  <ToastProvider>
    <Dashboard />
  </ToastProvider>
);

export default App;

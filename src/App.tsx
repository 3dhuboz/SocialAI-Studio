import React, { useState, useEffect } from 'react';
import { CLIENT } from './client.config';
import { ToastProvider, useToast } from './components/Toast';
import { SocialPost, BusinessProfile, ContentCalendarStats } from './types';
import { generateSocialPost, generateMarketingImage, analyzePostTimes, generateRecommendations, generateSmartSchedule, SmartScheduledPost } from './services/gemini';
import {
  Sparkles, Settings, Calendar, BarChart3, Wand2, Image as ImageIcon,
  Send, Loader2, Plus, Edit2, Trash2, Facebook, Instagram, Clock,
  CheckCircle, ChevronDown, ChevronUp, Zap, Save, Eye, X, Brain
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
  const [smartCount, setSmartCount] = useState(7);

  // Insights State
  const [recommendations, setRecommendations] = useState('');
  const [bestTimes, setBestTimes] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const hasApiKey = !!localStorage.getItem('sai_gemini_key');

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

  // ── Smart Schedule ──
  const handleSmartSchedule = async () => {
    if (!hasApiKey) { toast('Set your Gemini API key in Settings first.', 'warning'); return; }
    setIsSmartGenerating(true);
    const result = await generateSmartSchedule(profile.name, profile.type, profile.tone, stats, smartCount);
    setSmartPosts(result.posts);
    setSmartStrategy(result.strategy);
    setIsSmartGenerating(false);
  };

  const handleAcceptSmartPosts = () => {
    const newPosts: SocialPost[] = smartPosts.map(sp => ({
      id: `sp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      platform: sp.platform,
      content: sp.content,
      hashtags: sp.hashtags,
      scheduledFor: sp.scheduledFor,
      status: 'Scheduled' as const,
      imagePrompt: sp.imagePrompt,
      reasoning: sp.reasoning,
      pillar: sp.pillar,
      topic: sp.topic
    }));
    setPosts(prev => [...newPosts, ...prev]);
    toast(`${newPosts.length} posts added to calendar!`);
    setSmartPosts([]);
    setSmartStrategy('');
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
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="text-amber-400" size={28} />
            <div>
              <h1 className="text-xl font-bold text-white">{CLIENT.appName}</h1>
              <p className="text-xs text-gray-400">{profile.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {hasApiKey ? (
              <span className="flex items-center gap-1 text-green-400"><CheckCircle size={14} /> AI Active</span>
            ) : (
              <span className="text-yellow-400">No API Key</span>
            )}
          </div>
        </div>
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
            <h2 className="text-2xl font-bold flex items-center gap-2"><Brain className="text-amber-400" /> Smart AI Scheduler</h2>
            <p className="text-gray-400">Let AI plan your entire content calendar for the next 2 weeks — optimized for engagement, timing, and variety.</p>

            <div className="bg-white/5 border border-white/10 rounded-xl p-6 space-y-4">
              <div className="flex flex-wrap gap-4 items-end">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Posts to Generate</label>
                  <select value={smartCount} onChange={e => setSmartCount(Number(e.target.value))} className="bg-black/40 border border-white/10 rounded px-3 py-2 text-white" title="Post count">
                    <option value={5}>5 posts</option>
                    <option value={7}>7 posts</option>
                    <option value={10}>10 posts</option>
                    <option value={14}>14 posts</option>
                  </select>
                </div>
                <button onClick={handleSmartSchedule} disabled={isSmartGenerating} className="bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-black font-bold px-6 py-2 rounded-lg transition flex items-center gap-2">
                  {isSmartGenerating ? <Loader2 className="animate-spin" size={16} /> : <Zap size={16} />}
                  Generate Schedule
                </button>
              </div>

              {smartStrategy && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                  <h4 className="font-bold text-amber-300 text-sm mb-1">Strategy</h4>
                  <p className="text-sm text-gray-300">{smartStrategy}</p>
                </div>
              )}
            </div>

            {smartPosts.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-white">{smartPosts.length} Posts Generated</h3>
                  <button onClick={handleAcceptSmartPosts} className="bg-green-600 hover:bg-green-700 text-white font-bold px-4 py-2 rounded-lg flex items-center gap-2">
                    <CheckCircle size={16} /> Accept All & Add to Calendar
                  </button>
                </div>
                {smartPosts.map((sp, i) => (
                  <div key={i} className="bg-white/5 border border-white/10 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      {sp.platform === 'Instagram' ? <Instagram size={14} className="text-pink-400" /> : <Facebook size={14} className="text-blue-400" />}
                      <span className="text-xs text-gray-400">{new Date(sp.scheduledFor).toLocaleDateString()} {new Date(sp.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {sp.pillar && <span className="text-[10px] bg-purple-900/50 text-purple-300 px-1.5 rounded">{sp.pillar}</span>}
                    </div>
                    <p className="text-sm text-gray-200 mb-2">{sp.content}</p>
                    <div className="flex flex-wrap gap-1">
                      {sp.hashtags.map((t, j) => <span key={j} className="text-[10px] text-amber-400">{t}</span>)}
                    </div>
                    {sp.reasoning && <p className="text-xs text-gray-500 mt-2 italic">{sp.reasoning}</p>}
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

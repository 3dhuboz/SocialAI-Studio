import React, { useState, useEffect, useRef } from 'react';
import { CLIENT } from './client.config';
import { ToastProvider, useToast } from './components/Toast';
import { SocialPost, BusinessProfile, ContentCalendarStats, PlanTier, SetupStatus, ClientWorkspace } from './types';
import { LandingPage } from './components/LandingPage';
import { SetupBanner } from './components/SetupBanner';
import { AuthScreen } from './components/AuthScreen';
import { AppLogo } from './components/AppLogo';
import { useAuth } from './contexts/AuthContext';
import { db } from './firebase';
import { doc, getDoc, updateDoc, setDoc, collection, getDocs, addDoc, deleteDoc, query, orderBy } from 'firebase/firestore';
import { ClientSwitcher } from './components/ClientSwitcher';
import { AccountPanel } from './components/AccountPanel';
import { PricingTable } from './components/PricingTable';
import { DashboardStats } from './components/DashboardStats';
import { AnimatedReelPreview } from './components/AnimatedReelPreview';
import { FacebookConnectButton } from './components/FacebookConnectButton';
import { OnboardingWizard } from './components/OnboardingWizard';
import { ClientIntakeForm } from './components/ClientIntakeForm';
import { generateSocialPost, generateMarketingImage, analyzePostTimes, generateRecommendations, generateSmartSchedule, rewritePost, generateInsightReport, generateInsightReportFromPosts, InsightReport, SmartScheduledPost } from './services/gemini';
import { FacebookService } from './services/facebookService';
import { LateService } from './services/lateService';
import { SotrendService } from './services/sotrendService';
import { LateConnectButton } from './components/LateConnectButton';
import { CalendarGrid } from './components/CalendarGrid';
import {
  Sparkles, Settings, Calendar, BarChart3, Wand2, Image as ImageIcon,
  Send, Loader2, Plus, Edit2, Trash2, Facebook, Instagram, Clock,
  CheckCircle, ChevronDown, ChevronUp, Zap, Save, Eye, X, Brain, Upload,
  RefreshCw, Link2, Link2Off, TrendingUp, Users, Activity,
  Lightbulb, ArrowRight, MessageSquare, Info, LogOut, ClipboardList, ShoppingCart, Pencil
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
  geminiApiKey: '',
  targetAudience: '',
  uniqueValue: '',
  productsServices: '',
  socialGoal: '',
  contentTopics: '',
  videoEnabled: false,
  sotrendPageId: '',
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
  const { user, userDoc, logOut, refreshUserDoc } = useAuth();
  const [activeTab, setActiveTab] = useState<'create' | 'calendar' | 'smart' | 'insights' | 'settings'>('smart');
  const [showLanding, setShowLanding] = useState(false);

  useEffect(() => { document.title = CLIENT.appName; }, []);

  // Handle Stripe post-payment redirect
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  useEffect(() => {
    const handle = async () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('checkout') === 'success') {
        const planParam = params.get('plan') as PlanTier | null;
        if (planParam && ['starter', 'growth', 'pro'].includes(planParam)) {
          setActivePlan(planParam);
          setSetupStatus('ordered');
          if (user) await updateDoc(doc(db, 'users', user.uid), { plan: planParam, setupStatus: 'ordered' });
        } else {
          setShowPlanPicker(true);
        }
        window.history.replaceState({}, '', window.location.pathname);
      }
    };
    handle();
  }, [user]);

  // Profile & Posts — init from localStorage cache for instant render
  const [profile, setProfile] = useState<BusinessProfile>(() => {
    try { const s = localStorage.getItem('sai_profile'); return s ? { ...DEFAULT_PROFILE, ...JSON.parse(s) } : DEFAULT_PROFILE; } catch { return DEFAULT_PROFILE; }
  });
  const [posts, setPosts] = useState<SocialPost[]>(() => {
    try { const s = localStorage.getItem('sai_posts'); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [stats, setStats] = useState<ContentCalendarStats>(() => {
    try { const s = localStorage.getItem('sai_stats'); return s ? { ...DEFAULT_STATS, ...JSON.parse(s) } : DEFAULT_STATS; } catch { return DEFAULT_STATS; }
  });
  const [firestoreLoaded, setFirestoreLoaded] = useState(true);

  // Onboarding wizard — auto-show for new users who haven't set up their profile
  const [showOnboarding, setShowOnboarding] = useState(false);
  const isProfileBlank = (
    (profile.name === CLIENT.defaultBusinessName || !profile.name) &&
    !profile.description &&
    !localStorage.getItem('sai_gemini_key') &&
    !localStorage.getItem('sai_onboarding_done')
  );

  const [showAccount, setShowAccount] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [showIntakeForm, setShowIntakeForm] = useState(false);
  const [intakeFormDone, setIntakeFormDone] = useState(false);
  const [fbTokenNeverExpires, setFbTokenNeverExpires] = useState<boolean | undefined>(undefined);
  const [videoScriptModal, setVideoScriptModal] = useState<{ hookText: string; script?: string; shots?: string; mood?: string } | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptProgress, setAcceptProgress] = useState(0);
  const [isScanningPosts, setIsScanningPosts] = useState(false);
  const [lateProfileId, setLateProfileId] = useState<string>('');
  const [lateConnectedPlatforms, setLateConnectedPlatforms] = useState<string[]>([]);

  // Agency client workspaces
  const [clients, setClients] = useState<ClientWorkspace[]>([]);
  const [activeClientId, setActiveClientId] = useState<string | null>(null);

  // Returns the Firestore doc ref for the active workspace (own or client)
  const dataRef = () => activeClientId && user
    ? doc(db, 'users', user.uid, 'clients', activeClientId)
    : doc(db, 'users', user!.uid);
  const postsCol = () => activeClientId && user
    ? collection(db, 'users', user.uid, 'clients', activeClientId, 'posts')
    : collection(db, 'users', user!.uid, 'posts');

  // Sync Firestore in background (non-blocking)
  useEffect(() => {
    if (!user) return;
    const sync = async () => {
      try {
        const isAdmin = !!user.email && CLIENT.adminEmails.some(e => e === user.email);
        if (isAdmin) {
          localStorage.setItem('sai_admin', '1');
          setActivePlan('agency');
          setSetupStatus('live');
          updateDoc(doc(db, 'users', user.uid), { plan: 'agency', setupStatus: 'live', isAdmin: true }).catch(() => {});
        }
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) {
          const d = snap.data();
          if (d.profile) { const p = { ...DEFAULT_PROFILE, ...d.profile }; setProfile(p); localStorage.setItem('sai_profile', JSON.stringify(p)); }
          if (d.stats) { const st = { ...DEFAULT_STATS, ...d.stats }; setStats(st); localStorage.setItem('sai_stats', JSON.stringify(st)); }
          if (!isAdmin && d.plan) setActivePlan(d.plan);
          if (!isAdmin && d.setupStatus) setSetupStatus(d.setupStatus);
          if (d.geminiApiKey) localStorage.setItem('sai_gemini_key', d.geminiApiKey);
          if (d.isAdmin) localStorage.setItem('sai_admin', '1');
          if (d.onboardingDone) localStorage.setItem('sai_onboarding_done', '1');
          if (d.intakeFormDone) setIntakeFormDone(true);
          if (typeof d.fbTokenNeverExpires === 'boolean') setFbTokenNeverExpires(d.fbTokenNeverExpires);
          if (d.lateProfileId) setLateProfileId(d.lateProfileId);
          if (d.lateConnectedPlatforms) setLateConnectedPlatforms(d.lateConnectedPlatforms);
          if (d.insightReport) {
            setInsightReport(d.insightReport as InsightReport);
            const ageMs = Date.now() - new Date(d.insightReport.generatedAt).getTime();
            if (ageMs > 24 * 60 * 60 * 1000) setInsightStale(true);
          } else {
            setInsightStale(true);
          }
        }
        // Check for pending Stripe activation — webhook stores by UID (preferred) or email
        if (!isAdmin && !(snap.exists() && snap.data()?.plan)) {
          const byUid = await getDoc(doc(db, 'pending_activations', user.uid));
          const byEmail = user.email ? await getDoc(doc(db, 'pending_activations', user.email)) : null;
          const pendingSnap = byUid.exists() ? byUid : (byEmail?.exists() ? byEmail : null);
          if (pendingSnap) {
            const p = pendingSnap.data()!;
            if (!p.consumed) {
              setActivePlan(p.plan);
              setSetupStatus('live');
              await setDoc(doc(db, 'users', user.uid), { plan: p.plan, setupStatus: 'live', email: user.email, stripeCustomerId: p.stripeCustomerId || null }, { merge: true });
              await updateDoc(pendingSnap.ref, { consumed: true });
            }
          }
        }
        // Load agency clients
        const clientsSnap = await getDocs(collection(db, 'users', user.uid, 'clients'));
        const loadedClients: ClientWorkspace[] = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() } as ClientWorkspace));
        setClients(loadedClients);
        // Load posts for own workspace
        const pSnap = await getDocs(query(collection(db, 'users', user.uid, 'posts'), orderBy('scheduledFor', 'asc')));
        const loaded: SocialPost[] = pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SocialPost));
        setPosts(loaded);
        localStorage.setItem('sai_posts', JSON.stringify(loaded));
      } catch (e) {
        console.warn('Firestore sync error:', e);
      } finally {
        // Auto-show onboarding for brand-new users after sync completes
        const done = !!localStorage.getItem('sai_onboarding_done');
        const hasProfile = !!localStorage.getItem('sai_profile');
        const hasKey = !!localStorage.getItem('sai_gemini_key');
        if (!done && !hasKey && !hasProfile) setShowOnboarding(true);
      }
    };
    sync();
  }, [user]);

  // Reload profile+posts when switching client workspace
  useEffect(() => {
    if (!user || activeClientId === null) return;
    const loadClient = async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid, 'clients', activeClientId));
        if (snap.exists()) {
          const d = snap.data();
          if (d.profile) setProfile({ ...DEFAULT_PROFILE, ...d.profile });
          else setProfile(DEFAULT_PROFILE);
          if (d.stats) setStats({ ...DEFAULT_STATS, ...d.stats });
          else setStats(DEFAULT_STATS);
        } else {
          setProfile(DEFAULT_PROFILE);
          setStats(DEFAULT_STATS);
        }
        const pSnap = await getDocs(query(collection(db, 'users', user.uid, 'clients', activeClientId, 'posts'), orderBy('scheduledFor', 'asc')));
        setPosts(pSnap.docs.map(d => ({ id: d.id, ...d.data() } as SocialPost)));
      } catch (e) { console.warn('Client load error:', e); }
    };
    loadClient();
  }, [activeClientId, user]);

  // Add a new client workspace
  const addClient = async (name: string, businessType: string) => {
    if (!user) return;
    if (activePlan !== 'agency') { toast('Client workspaces require an Agency plan.', 'warning'); return; }
    if (clients.length >= CLIENT.agencyClientLimit) {
      toast(`You have reached the ${CLIENT.agencyClientLimit}-client limit on the Agency plan.`, 'warning'); return;
    }
    const newClient: Omit<ClientWorkspace, 'id'> = { name, businessType, createdAt: new Date().toISOString() };
    const ref = await addDoc(collection(db, 'users', user.uid, 'clients'), newClient);
    const created: ClientWorkspace = { id: ref.id, ...newClient };
    setClients(prev => [...prev, created]);
    setActiveClientId(ref.id);
    toast(`Client "${name}" added!`, 'success');
  };

  // Rename a client workspace
  const renameClient = async (clientId: string, name: string, businessType: string) => {
    if (!user) return;
    await updateDoc(doc(db, 'users', user.uid, 'clients', clientId), { name, businessType });
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, name, businessType } : c));
    toast('Client updated.', 'success');
  };

  // Delete a client workspace (including all posts)
  const deleteClient = async (clientId: string) => {
    if (!user) return;
    try {
      const postsSnap = await getDocs(collection(db, 'users', user.uid, 'clients', clientId, 'posts'));
      await Promise.all(postsSnap.docs.map(d => deleteDoc(d.ref)));
      await deleteDoc(doc(db, 'users', user.uid, 'clients', clientId));
      setClients(prev => prev.filter(c => c.id !== clientId));
      if (activeClientId === clientId) { setActiveClientId(null); setPosts([]); }
      toast('Client and all their data removed.', 'success');
    } catch (e) { toast('Failed to delete client.', 'error'); }
  };

  // Persist profile to Firestore (debounced)
  useEffect(() => {
    if (!user || !firestoreLoaded) return;
    const t = setTimeout(() => updateDoc(dataRef(), { profile }).catch(() => setDoc(dataRef(), { profile }, { merge: true })), 1000);
    return () => clearTimeout(t);
  }, [profile, user, firestoreLoaded, activeClientId]);

  // Persist stats to Firestore
  useEffect(() => {
    if (!user || !firestoreLoaded) return;
    updateDoc(dataRef(), { stats }).catch(() => setDoc(dataRef(), { stats }, { merge: true }));
  }, [stats, user, firestoreLoaded, activeClientId]);

  // Content Generator State
  const [topic, setTopic] = useState('');
  const [platform, setPlatform] = useState<'Facebook' | 'Instagram'>('Instagram');
  const [generatedContent, setGeneratedContent] = useState('');
  const [generatedHashtags, setGeneratedHashtags] = useState<string[]>([]);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [scheduleDate, setScheduleDate] = useState('');
  const [createMode, setCreateMode] = useState<'generate' | 'write'>('generate');
  const [draftText, setDraftText] = useState('');
  const [rewriteInstruction, setRewriteInstruction] = useState('');
  const [isRewriting, setIsRewriting] = useState(false);

  // Smart Schedule State
  const [smartPosts, setSmartPosts] = useState<SmartScheduledPost[]>([]);
  const [smartStrategy, setSmartStrategy] = useState('');
  const [isSmartGenerating, setIsSmartGenerating] = useState(false);
  const [saturationMode, setSaturationMode] = useState(false);
  const [smartCount, setSmartCount] = useState(7);
  const [includeVideos, setIncludeVideos] = useState(false);

  // Smart post image generation
  const [smartPostImages, setSmartPostImages] = useState<Record<number, string>>({});
  const [autoGenSet, setAutoGenSet] = useState<Set<number>>(new Set());
  const [currentGenIdx, setCurrentGenIdx] = useState<number | null>(null);
  const [imgGenDone, setImgGenDone] = useState(0);
  const uploadFileRef = useRef<HTMLInputElement>(null);
  const [uploadTargetIdx, setUploadTargetIdx] = useState<number | null>(null);

  // Calendar post image generation (keyed by post ID)
  const [calendarImages, setCalendarImages] = useState<Record<string, string>>({});
  const [calendarGenSet, setCalendarGenSet] = useState<Set<string>>(new Set());
  const calendarUploadRef = useRef<HTMLInputElement>(null);
  const [calendarUploadId, setCalendarUploadId] = useState<string | null>(null);

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
  const [insightReport, setInsightReport] = useState<InsightReport | null>(null);
  const [insightStale, setInsightStale] = useState(false);

  const hasApiKey = !!localStorage.getItem('sai_gemini_key');
  const fbConnected = !!(profile.facebookPageId && profile.facebookPageAccessToken) || !!lateProfileId;

  // Auto-run daily insight analysis when stale
  useEffect(() => {
    if (insightStale && hasApiKey && user) {
      runInsightReport(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insightStale, user]);

  // Plan & setup state (sourced from Firestore via userDoc)
  const [activePlan, setActivePlan] = useState<PlanTier | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatus>('ordered');
  const [isAdminMode] = useState(() => localStorage.getItem('sai_admin') === '1');

  // Persist plan/setupStatus to Firestore
  useEffect(() => {
    if (!user || !activePlan) return;
    updateDoc(doc(db, 'users', user.uid), { plan: activePlan });
  }, [activePlan, user]);
  useEffect(() => {
    if (!user) return;
    updateDoc(doc(db, 'users', user.uid), { setupStatus });
  }, [setupStatus, user]);

  const planCfg = CLIENT.plans.find(p => p.id === activePlan);
  const canUseImages = activePlan === 'growth' || activePlan === 'pro' || activePlan === 'agency';
  const canUseSaturation = activePlan === 'pro' || activePlan === 'agency';
  const maxPostsPerWeek = planCfg?.postsPerWeek ?? 7;

  // Live Facebook Stats
  interface LiveFbStats { fanCount: number; followersCount: number; reach28d: number; engagedUsers28d: number; engagementRate: number; }
  const [liveStats, setLiveStats] = useState<LiveFbStats | null>(null);
  const [isPullingStats, setIsPullingStats] = useState(false);
  const [lastPulled, setLastPulled] = useState<Date | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const handlePullStats = async (silent = false) => {
    setIsPullingStats(true);
    try {
      // Path 1 — Late analytics (preferred: no token needed, uses connected account)
      if (lateProfileId) {
        try {
          const raw = await LateService.getAnalytics(lateProfileId);
          const d = (raw as any);
          const followers = d.followers ?? d.followersCount ?? d.fans ?? d.fanCount ?? 0;
          const reach = d.reach ?? d.reach28d ?? d.impressions ?? 0;
          const engagement = d.engagementRate ?? d.engagement_rate ?? d.engagement ?? 0;
          const posts = d.postsCount ?? d.posts ?? d.postsLast30Days ?? 0;
          if (followers > 0 || reach > 0) {
            const mapped: LiveFbStats = { fanCount: followers, followersCount: followers, reach28d: reach, engagedUsers28d: 0, engagementRate: engagement };
            setLiveStats(mapped);
            setLastPulled(new Date());
            setStats(prev => ({ ...prev, followers, reach, engagement: engagement || prev.engagement, postsLast30Days: posts || prev.postsLast30Days }));
            if (!silent) toast('Stats updated from Late analytics!', 'success');
            setIsPullingStats(false);
            return;
          }
        } catch { /* fall through to FB Graph */ }
      }

      // Path 2 — Direct FB Graph API fallback
      if (profile.facebookPageId && profile.facebookPageAccessToken) {
        const data = await FacebookService.getPageStats(profile.facebookPageId, profile.facebookPageAccessToken);
        setLiveStats(data);
        setLastPulled(new Date());
        setStats(prev => ({ ...prev, followers: data.followersCount || data.fanCount, reach: data.reach28d, engagement: data.engagementRate }));
        const hasData = data.fanCount > 0 || data.followersCount > 0 || data.reach28d > 0;
        if (!silent) toast(hasData ? 'Live stats updated from Facebook!' : 'Connected — page stats require Facebook App Review to display.', hasData ? 'success' : 'info');
      } else if (!silent) {
        toast('Connect your social accounts in Settings to pull live stats.', 'warning');
      }
    } catch (e: any) {
      const msg = e?.message || '';
      if (!silent) {
        if (msg.includes('#10') || msg.includes('#200') || msg.includes('permission')) {
          toast('Stats unavailable — Facebook requires App Review for insights access.', 'info');
        } else {
          toast(`Stats pull failed: ${msg.substring(0, 100) || 'Unknown error'}`, 'error');
        }
      }
    }
    setIsPullingStats(false);
  };

  // Auto-fetch stats on login when Late is connected
  useEffect(() => {
    if (lateProfileId && user) handlePullStats(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lateProfileId, user]);

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

  const handlePublishViaLate = async (platforms: ('facebook' | 'instagram')[] = ['facebook']) => {
    if (!lateProfileId) { toast('Connect your social accounts in Settings first.', 'warning'); return; }
    setIsPublishing(true);
    try {
      const fullText = generatedHashtags.length > 0 ? `${generatedContent}\n\n${generatedHashtags.join(' ')}` : generatedContent;
      await LateService.post(lateProfileId, platforms, fullText);
      toast(`Published to ${platforms.join(' & ')} successfully!`, 'success');
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
    const result = await generateSocialPost(topic, platform, profile.name, profile.type, profile.tone, profile);
    setGeneratedContent(result.content);
    setGeneratedHashtags(result.hashtags || []);
    setIsGenerating(false);
  };

  const handleGenerateImage = async () => {
    if (!topic.trim()) { toast('Enter a topic first.', 'warning'); return; }
    if (!hasApiKey) { toast('Set your Gemini API key in Settings first.', 'warning'); return; }
    setIsGeneratingImage(true);
    try {
      const img = await generateMarketingImage(`${profile.type}: ${topic}`);
      if (img) setGeneratedImage(img);
      else toast('Image generation failed — check browser console for details.', 'error');
    } catch (e: any) {
      toast(`Image error: ${e?.message?.substring(0, 100) || 'Unknown error'}`, 'error');
    }
    setIsGeneratingImage(false);
  };

  const handleSavePost = async () => {
    if (!generatedContent) { toast('Generate content first.', 'warning'); return; }
    if (!user) return;
    const postData = {
      platform,
      content: generatedContent,
      hashtags: generatedHashtags,
      scheduledFor: scheduleDate || new Date().toISOString(),
      status: (scheduleDate ? 'Scheduled' : 'Draft') as SocialPost['status'],
      image: generatedImage || undefined,
      topic
    };
    const ref = await addDoc(postsCol(), postData);
    setPosts(prev => [{ id: ref.id, ...postData } as SocialPost, ...prev]);
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
        saturationMode,
        profile,
        includeVideos
      );
      setSmartPosts(result.posts);
      setSmartStrategy(result.strategy);
      autoGenerateAllImages(result.posts);
    } catch (e: any) {
      toast(`Smart schedule failed: ${e?.message?.substring(0, 80) || 'Unknown'}`, 'error');
    }
    setIsSmartGenerating(false);
  };

  const handleRewrite = async () => {
    if (!draftText.trim()) { toast('Write your draft first.', 'warning'); return; }
    if (!hasApiKey) { toast('Set your Gemini API key in Settings first.', 'warning'); return; }
    setIsRewriting(true);
    try {
      const instruction = rewriteInstruction.trim() || 'Improve this post — make it more engaging with emojis and hashtags';
      const result = await rewritePost(draftText, instruction, platform, profile.name, profile.type, profile.tone);
      setGeneratedContent(result.content);
      setGeneratedHashtags(result.hashtags || []);
    } catch (e: any) {
      toast(`AI error: ${e?.message?.substring(0, 80) || 'Unknown'}`, 'error');
    }
    setIsRewriting(false);
  };

  const handleRegenImage = async (idx: number) => {
    const prompt = smartPosts[idx]?.imagePrompt || smartPosts[idx]?.topic;
    if (!prompt) return;
    setAutoGenSet(prev => new Set(prev).add(idx));
    try {
      const img = await generateMarketingImage(prompt);
      if (img) setSmartPostImages(prev => ({ ...prev, [idx]: img }));
      else toast('Image generation failed — check console for details, or upload an image instead.', 'warning');
    } catch (e: any) { toast(`Image error: ${e?.message?.substring(0, 80) || 'Unknown'}`, 'error'); }
    setAutoGenSet(prev => { const s = new Set(prev); s.delete(idx); return s; });
  };

  // ── Auto-generate images for calendar posts that have imagePrompt but no image ──
  useEffect(() => {
    if (!hasApiKey) return;
    const missing = posts.filter(p =>
      p.imagePrompt &&
      !p.image &&
      !calendarImages[p.id] &&
      !calendarGenSet.has(p.id) &&
      (p as any).postType !== 'video'
    );
    if (missing.length === 0) return;
    const run = async () => {
      for (const post of missing) {
        setCalendarGenSet(prev => new Set(prev).add(post.id));
        try {
          const img = await generateMarketingImage(post.imagePrompt!);
          if (img) setCalendarImages(prev => ({ ...prev, [post.id]: img }));
        } catch { /* silently skip */ }
        setCalendarGenSet(prev => { const s = new Set(prev); s.delete(post.id); return s; });
      }
    };
    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts]);

  const handleCalendarRegenImage = async (postId: string, prompt: string) => {
    setCalendarGenSet(prev => new Set(prev).add(postId));
    try {
      const img = await generateMarketingImage(prompt);
      if (img) setCalendarImages(prev => ({ ...prev, [postId]: img }));
      else toast('Image generation failed — try uploading instead.', 'warning');
    } catch (e: any) { toast(`Image error: ${e?.message?.substring(0, 80) || 'Unknown'}`, 'error'); }
    setCalendarGenSet(prev => { const s = new Set(prev); s.delete(postId); return s; });
  };

  const handleCalendarUpload = (postId: string) => {
    setCalendarUploadId(postId);
    calendarUploadRef.current?.click();
  };

  const handleCalendarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !calendarUploadId) return;
    const reader = new FileReader();
    const id = calendarUploadId;
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      if (dataUrl) setCalendarImages(prev => ({ ...prev, [id]: dataUrl }));
    };
    reader.readAsDataURL(file);
    e.target.value = '';
    setCalendarUploadId(null);
  };

  const handleUpdatePost = async (id: string, updates: Partial<SocialPost>) => {
    if (!user) return;
    const ref = doc(postsCol(), id);
    const { content, hashtags, scheduledFor, status, image } = updates;
    const patch: Record<string, string | string[] | undefined> = {};
    if (content !== undefined) patch.content = content;
    if (hashtags !== undefined) patch.hashtags = hashtags;
    if (scheduledFor !== undefined) patch.scheduledFor = scheduledFor;
    if (status !== undefined) patch.status = status;
    if (image !== undefined) patch.image = image;
    await updateDoc(ref, patch);
    setPosts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    toast('Post updated!', 'success');
  };

  const handleAcceptSmartPosts = async () => {
    if (!user) return;
    setIsAccepting(true);
    setAcceptProgress(0);
    const saved: SocialPost[] = [];
    for (let i = 0; i < smartPosts.length; i++) {
      const sp = smartPosts[i];
      const postData = {
        platform: sp.platform,
        content: sp.content,
        hashtags: sp.hashtags,
        scheduledFor: sp.scheduledFor,
        status: 'Scheduled' as const,
        image: smartPostImages[i] || undefined,
        imagePrompt: sp.imagePrompt || undefined,
        reasoning: sp.reasoning || undefined,
        pillar: sp.pillar || undefined,
        topic: sp.topic
      };
      const ref = await addDoc(postsCol(), postData);
      saved.push({ id: ref.id, ...postData });
      setAcceptProgress(Math.round(((i + 1) / smartPosts.length) * 100));
    }
    setPosts(prev => [...saved, ...prev]);
    toast(`${saved.length} posts added to your calendar! 🎉`, 'success');
    setSmartPosts([]);
    setSmartStrategy('');
    setSmartPostImages({});
    setAutoGenSet(new Set());
    setCurrentGenIdx(null);
    setIsAccepting(false);
    setAcceptProgress(0);
    setActiveTab('calendar');
  };

  // ── Insights ──
  const runInsightReport = async (forceRefresh = false) => {
    if (!hasApiKey) return;
    if (!forceRefresh && insightReport) return;
    setIsAnalyzing(true);
    const recentTopics = posts.slice(0, 10).map(p => p.topic || p.content.substring(0, 40));
    const report = await generateInsightReport(profile.name, profile.type, profile.location || 'Australia', stats, recentTopics);
    if (report) {
      setInsightReport(report);
      setInsightStale(false);
      if (user) {
        updateDoc(dataRef(), { insightReport: report }).catch(() =>
          setDoc(dataRef(), { insightReport: report }, { merge: true })
        );
      }
    }
    setIsAnalyzing(false);
  };

  const handleScanPastPosts = async () => {
    if (!hasApiKey) { toast('Set your Gemini API key in Settings first.', 'warning'); return; }
    setIsScanningPosts(true);
    try {
      let posts: Array<{ message: string; created_time: string; likes: number; comments: number; shares: number }> = [];

      // Path 1 — Sotrender (no client token needed, uses their approved FB app)
      const sotrendId = profile.sotrendPageId || profile.facebookPageId;
      if (sotrendId) {
        try {
          await SotrendService.addProfile(sotrendId);
          posts = await SotrendService.getPosts(sotrendId, 30);
        } catch {
          // Sotrender not configured — fall through to direct FB
        }
      }

      // Path 2 — Direct Facebook Graph API (requires stored page access token)
      if (!posts.length && profile.facebookPageId && profile.facebookPageAccessToken) {
        posts = await FacebookService.getRecentPosts(profile.facebookPageId, profile.facebookPageAccessToken, 30);
      }

      if (!posts.length) {
        toast('No posts found. Connect your Facebook page in Settings first.', 'warning');
        setIsScanningPosts(false);
        return;
      }

      const report = await generateInsightReportFromPosts(profile.name, profile.type, profile.location || 'Australia', posts);
      if (report) {
        setInsightReport(report);
        setInsightStale(false);
        if (user) updateDoc(dataRef(), { insightReport: report }).catch(() => setDoc(dataRef(), { insightReport: report }, { merge: true }));
        toast(`Scanned ${posts.length} posts — insights updated!`, 'success');
      }
    } catch (e: any) {
      toast(`Scan failed: ${e?.message?.substring(0, 80) || 'Unknown error'}`, 'error');
    }
    setIsScanningPosts(false);
  };

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

  // ── Settings Save Handlers ──
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingFacebook, setIsSavingFacebook] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [fbPages, setFbPages] = useState<import('./services/facebookService').FacebookPage[]>([]);
  const [isFindingPages, setIsFindingPages] = useState(false);
  const [fbLookupError, setFbLookupError] = useState('');

  const handleDismissOnboarding = async () => {
    setShowOnboarding(false);
    localStorage.setItem('sai_onboarding_done', '1');
    if (user) {
      await updateDoc(doc(db, 'users', user.uid), { onboardingDone: true }).catch(() =>
        setDoc(doc(db, 'users', user.uid), { onboardingDone: true }, { merge: true })
      );
    }
    await handleSaveProfile().catch(() => {});
  };

  const handleSaveApiKey = async () => {
    if (!profile.geminiApiKey.trim()) { toast('Enter an API key first.', 'warning'); return; }
    setIsSavingKey(true);
    try {
      localStorage.setItem('sai_gemini_key', profile.geminiApiKey);
      if (user) await updateDoc(doc(db, 'users', user.uid), { geminiApiKey: profile.geminiApiKey });
      toast('API key saved — AI features are now active!', 'success');
    } catch { toast('Failed to save API key.', 'error'); }
    setIsSavingKey(false);
  };

  const handleSaveProfile = async () => {
    setIsSavingProfile(true);
    try {
      localStorage.setItem('sai_profile', JSON.stringify(profile));
      await updateDoc(dataRef(), { profile }).catch(() => setDoc(dataRef(), { profile }, { merge: true }));
      toast('Business profile saved!', 'success');
    } catch { toast('Failed to save profile.', 'error'); }
    setIsSavingProfile(false);
  };

  const handleFindPages = async () => {
    const token = profile.facebookPageAccessToken.trim();
    if (!token) { toast('Paste your Access Token first, then click Find My Pages.', 'warning'); return; }
    setIsFindingPages(true);
    setFbLookupError('');
    setFbPages([]);
    try {
      // Try the Netlify exchange first — gives permanent page tokens
      try {
        const result = await FacebookService.exchangeForLongLivedPages(token);
        setFbPages(result.pages);
        setFbTokenNeverExpires(true);
        // Store the long-lived user token for future use
        if (user) {
          updateDoc(doc(db, 'users', user.uid), { fbTokenNeverExpires: true, fbLongLivedUserToken: result.longLivedUserToken }).catch(() => {});
        }
        setIsFindingPages(false);
        return;
      } catch {
        // Netlify function not configured — fall back to direct lookup
      }
      const pages = await FacebookService.getPagesByToken(token);
      setFbPages(pages);
      // Status unknown for manual tokens without exchange — don't mark as short-lived
      setFbTokenNeverExpires(undefined);
    } catch (e: any) {
      setFbLookupError(e?.message || 'Could not fetch pages.');
    }
    setIsFindingPages(false);
  };

  const handleSaveFacebook = async () => {
    setIsSavingFacebook(true);
    try {
      localStorage.setItem('sai_profile', JSON.stringify(profile));
      await updateDoc(dataRef(), { profile }).catch(() => setDoc(dataRef(), { profile }, { merge: true }));
      toast('Facebook credentials saved!', 'success');
    } catch { toast('Failed to save Facebook credentials.', 'error'); }
    setIsSavingFacebook(false);
  };

  const handleSaveAll = async () => {
    setIsSavingAll(true);
    try {
      localStorage.setItem('sai_profile', JSON.stringify(profile));
      if (profile.geminiApiKey) localStorage.setItem('sai_gemini_key', profile.geminiApiKey);
      await updateDoc(dataRef(), { profile, ...(profile.geminiApiKey ? { geminiApiKey: profile.geminiApiKey } : {}) }).catch(() =>
        setDoc(dataRef(), { profile, ...(profile.geminiApiKey ? { geminiApiKey: profile.geminiApiKey } : {}) }, { merge: true })
      );
      if (user && profile.geminiApiKey) {
        await updateDoc(doc(db, 'users', user.uid), { geminiApiKey: profile.geminiApiKey }).catch(() => {});
      }
      toast('All settings saved!', 'success');
    } catch { toast('Failed to save settings.', 'error'); }
    setIsSavingAll(false);
  };

  // ── Delete Post ──
  const deletePost = async (id: string) => {
    if (!user) return;
    const colPath = activeClientId
      ? doc(db, 'users', user.uid, 'clients', activeClientId, 'posts', id)
      : doc(db, 'users', user.uid, 'posts', id);
    await deleteDoc(colPath);
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

  // Auth gate
  if (!user) {
    if (showLanding) {
      return <LandingPage onActivate={() => setShowLanding(false)} onSignIn={() => setShowLanding(false)} />;
    }
    return <AuthScreen onShowLanding={() => setShowLanding(true)} />;
  }

  // Show landing page (logged-in user without a plan, or explicitly navigated)
  if (showLanding || (!activePlan && !showPlanPicker && firestoreLoaded)) {
    return <LandingPage
      onActivate={async plan => {
        setActivePlan(plan);
        setShowLanding(false);
        if (user) await updateDoc(doc(db, 'users', user.uid), { plan, setupStatus: 'ordered' });
      }}
      onSignIn={() => setShowLanding(false)}
    />;
  }

  // Still loading Firestore data
  if (!firestoreLoaded) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-white/30">
          <Loader2 size={28} className="animate-spin text-amber-400" />
          <p className="text-sm">Loading your dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      {/* Onboarding Wizard */}
      {showIntakeForm && user && (
        <ClientIntakeForm
          userEmail={user.email || ''}
          onClose={() => setShowIntakeForm(false)}
          onSubmitted={() => {
            setIntakeFormDone(true);
            setShowIntakeForm(false);
            updateDoc(doc(db, 'users', user.uid), { intakeFormDone: true }).catch(() =>
              setDoc(doc(db, 'users', user.uid), { intakeFormDone: true }, { merge: true })
            );
          }}
        />
      )}

      {/* Video Script Lightbox */}
      {videoScriptModal && (
        <div
          className="fixed inset-0 z-[999] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(14px)' }}
          onClick={() => setVideoScriptModal(null)}
        >
          <div
            className="relative w-full max-w-2xl bg-[#0f0f1a] border border-purple-500/25 rounded-3xl overflow-hidden shadow-2xl shadow-purple-900/30"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-purple-500/15 bg-purple-950/30">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black bg-purple-500/70 text-white px-2 py-0.5 rounded-full">REEL</span>
                <span className="text-sm font-bold text-white">Video Script &amp; Brief</span>
              </div>
              <button onClick={() => setVideoScriptModal(null)} className="text-white/30 hover:text-white transition p-1 rounded-lg hover:bg-white/8">
                <X size={16} />
              </button>
            </div>

            <div className="flex gap-5 p-6">
              {/* Animated preview — larger */}
              <AnimatedReelPreview
                hookText={videoScriptModal.hookText}
                mood={videoScriptModal.mood}
                size="md"
                className="!w-28 !h-48 flex-shrink-0"
              />

              {/* Script details */}
              <div className="flex-1 min-w-0 space-y-4 overflow-y-auto max-h-[70vh] pr-1">
                {videoScriptModal.script && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black text-purple-400 uppercase tracking-wider">Script</p>
                    <div className="bg-purple-950/40 border border-purple-500/15 rounded-xl p-4">
                      <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap">{videoScriptModal.script}</p>
                    </div>
                  </div>
                )}
                {videoScriptModal.shots && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black text-purple-400 uppercase tracking-wider">Shot-by-Shot Brief</p>
                    <div className="bg-purple-950/40 border border-purple-500/15 rounded-xl p-4">
                      <p className="text-sm text-white/70 leading-relaxed whitespace-pre-wrap">{videoScriptModal.shots}</p>
                    </div>
                  </div>
                )}
                {videoScriptModal.mood && (
                  <div className="flex items-center gap-2 bg-purple-950/20 border border-purple-500/10 rounded-xl px-4 py-3">
                    <span className="text-purple-300 text-sm">♪</span>
                    <span className="text-[11px] font-bold text-purple-300 uppercase tracking-wider">Music Mood:</span>
                    <span className="text-sm text-white/60">{videoScriptModal.mood}</span>
                  </div>
                )}
                {!videoScriptModal.script && !videoScriptModal.shots && (
                  <p className="text-sm text-white/30 italic">No script details available for this post.</p>
                )}
              </div>
            </div>

            <div className="px-6 pb-5">
              <p className="text-[10px] text-white/20 text-center">Click anywhere outside to close</p>
            </div>
          </div>
        </div>
      )}

      {showOnboarding && (
        <OnboardingWizard
          profile={profile}
          onUpdateProfile={updates => setProfile(prev => ({ ...prev, ...updates }))}
          onSave={handleSaveProfile}
          onDismiss={handleDismissOnboarding}
          userEmail={user?.email ?? undefined}
        />
      )}
      {/* Post-payment plan picker */}
      {showPlanPicker && (
        <div className="fixed inset-0 z-[999] bg-black/90 backdrop-blur-md flex items-center justify-center p-6">
          <div className="bg-[#111118] border border-white/10 rounded-3xl p-8 w-full max-w-lg text-center">
            <div className="w-14 h-14 mx-auto mb-5 bg-gradient-to-br from-green-500/20 to-emerald-500/20 border border-green-500/20 rounded-2xl flex items-center justify-center">
              <CheckCircle size={26} className="text-green-400" />
            </div>
            <h2 className="text-2xl font-black text-white mb-2">Payment successful! 🎉</h2>
            <p className="text-white/40 text-sm mb-8">Which plan did you purchase? This activates your dashboard.</p>
            <div className="space-y-3">
              {CLIENT.plans.map(plan => (
                <button
                  key={plan.id}
                  onClick={async () => {
                    setActivePlan(plan.id);
                    setSetupStatus('ordered');
                    setShowPlanPicker(false);
                    if (user) await updateDoc(doc(db, 'users', user.uid), { plan: plan.id, setupStatus: 'ordered' });
                    toast(`Welcome! Your ${plan.name} plan is now active. We\'ll be in touch within 1–3 days to connect your Facebook page.`);
                  }}
                  className={`w-full bg-gradient-to-r ${plan.color} text-white font-bold py-4 rounded-xl flex items-center justify-between px-5 hover:opacity-90 transition`}
                >
                  <span>{plan.name} — ${plan.price}/month</span>
                  <span className="text-xs opacity-70">{plan.postsPerWeek} posts/week</span>
                </button>
              ))}
            </div>
            <p className="text-xs text-white/20 mt-5">Not sure? Check your Stripe receipt email.</p>
          </div>
        </div>
      )}
      {/* Pricing Modal */}
      {showPricing && <PricingTable onClose={() => setShowPricing(false)} />}
      {/* Account Panel */}
      {showAccount && (
        <AccountPanel
          activePlan={activePlan ?? 'starter'}
          userEmail={user?.email ?? ''}
          onClose={() => setShowAccount(false)}
          onUpgrade={() => { setShowAccount(false); setShowPricing(true); }}
          onSignOut={() => { setShowAccount(false); logOut(); }}
        />
      )}
      {/* Header */}
      <header className="border-b border-white/5 bg-black/60 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <AppLogo size={72} />
            <div className="flex items-center gap-2 flex-wrap">
              {planCfg && (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full bg-gradient-to-r ${planCfg.color} text-white`}>
                  {planCfg.name}
                </span>
              )}
              {activePlan === 'agency' && (
                <ClientSwitcher
                  clients={clients}
                  activeClientId={activeClientId}
                  onSwitch={setActiveClientId}
                  onAdd={addClient}
                  onRename={renameClient}
                  onDelete={deleteClient}
                  agencyName={profile.name}
                />
              )}
              {activePlan !== 'agency' && profile.name && profile.name !== 'My Business' && (
                <span className="text-xs text-white/30 hidden sm:inline">{profile.name}</span>
              )}
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
                onClick={() => handlePullStats()}
                disabled={isPullingStats}
                className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white px-2.5 py-1 rounded-full transition disabled:opacity-40 text-xs"
                title="Pull live stats from Facebook"
              >
                <RefreshCw size={11} className={isPullingStats ? 'animate-spin' : ''} />
                {isPullingStats ? 'Pulling...' : 'Refresh Stats'}
              </button>
            )}
            {isProfileBlank && !showOnboarding && (
              <button
                onClick={() => setShowOnboarding(true)}
                className="flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 px-2.5 py-1 rounded-full transition text-xs font-semibold"
              >
                <ClipboardList size={11} /> Complete Setup
              </button>
            )}
            <button
              onClick={() => setShowPricing(true)}
              title="Upgrade plan"
              className="w-8 h-8 rounded-xl bg-white/5 hover:bg-amber-500/15 border border-white/10 hover:border-amber-500/30 flex items-center justify-center text-white/40 hover:text-amber-400 transition ml-1"
            >
              <ShoppingCart size={15} />
            </button>
            <button
              onClick={() => setShowAccount(true)}
              title="My Account"
              className={`w-8 h-8 rounded-xl bg-gradient-to-br ${planCfg?.color ?? 'from-white/10 to-white/5'} flex items-center justify-center text-white text-xs font-black hover:opacity-80 transition shadow`}
            >
              {user?.email?.charAt(0).toUpperCase() ?? '?'}
            </button>
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
        <SetupBanner
          status={setupStatus}
          onStatusChange={isAdminMode ? setSetupStatus : undefined}
          isAdmin={isAdminMode}
        />

        {/* ═══ CREATE TAB ═══ */}
        {activeTab === 'create' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-2xl font-bold flex items-center gap-2.5"><Wand2 className="text-amber-400" size={22} /> AI Content Generator</h2>
                <p className="text-sm text-white/40 mt-1">Generate a caption from a topic, or write your own post and let AI polish it.</p>
              </div>
            </div>

            {/* Mode toggle */}
            <div className="flex rounded-xl overflow-hidden border border-white/10 w-fit">
              <button
                onClick={() => setCreateMode('generate')}
                className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition ${createMode === 'generate' ? 'bg-amber-500 text-black' : 'bg-transparent text-white/40 hover:text-white/70'}`}
              >
                <Wand2 size={14} /> AI Generate
              </button>
              <button
                onClick={() => setCreateMode('write')}
                className={`flex items-center gap-2 px-5 py-2.5 text-sm font-semibold transition ${createMode === 'write' ? 'bg-purple-600 text-white' : 'bg-transparent text-white/40 hover:text-white/70'}`}
              >
                <Pencil size={14} /> AI Writer
              </button>
            </div>

            {/* ── AI GENERATE MODE ── */}
            {createMode === 'generate' && (
            <>
            {/* Tip Card */}
            <div className="bg-amber-500/8 border border-amber-500/20 rounded-2xl px-5 py-4 flex gap-3">
              <Lightbulb size={16} className="text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-white/50 leading-relaxed">
                <span className="text-amber-300 font-semibold">Pro tip: </span>
                Be specific with your topic for better results. Instead of "sale", try "25% off all winter jackets this Saturday only". The more context you give, the stronger the caption.
              </div>
            </div>

            <div className="bg-white/3 border border-white/8 rounded-2xl p-6 space-y-5">
              <div>
                <label className="text-xs font-semibold text-white/50 uppercase tracking-widest block mb-2">Topic / Prompt</label>
                <textarea
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  placeholder="e.g., 25% off all items this weekend only, come in and grab a bargain..."
                  className="w-full bg-black/40 border border-white/8 rounded-xl p-4 text-white resize-none min-h-[90px] text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40 transition"
                />
              </div>

              <div className="flex flex-wrap gap-3 items-center">
                <div className="flex rounded-xl overflow-hidden border border-white/10">
                  {(['Instagram', 'Facebook'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setPlatform(p)}
                      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition ${
                        platform === p
                          ? p === 'Instagram' ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white' : 'bg-blue-600 text-white'
                          : 'bg-transparent text-white/30 hover:text-white/60'
                      }`}
                    >
                      {p === 'Instagram' ? <Instagram size={14} /> : <Facebook size={14} />}
                      {p}
                    </button>
                  ))}
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !topic.trim()}
                  className="bg-gradient-to-r from-amber-500 to-orange-500 text-black font-bold px-6 py-2.5 rounded-xl transition flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-amber-500/20"
                >
                  {isGenerating ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}
                  Generate Caption
                </button>
                {canUseImages ? (
                  <button
                    onClick={handleGenerateImage}
                    disabled={isGeneratingImage || !topic.trim()}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4 py-2.5 rounded-xl transition flex items-center gap-2 disabled:opacity-50"
                  >
                    {isGeneratingImage ? <Loader2 className="animate-spin" size={16} /> : <ImageIcon size={16} />}
                    AI Image
                  </button>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-white/25 bg-white/5 border border-white/8 px-4 py-2.5 rounded-xl">
                    <ImageIcon size={14} /> AI Images — Growth plan+
                  </div>
                )}
              </div>
            </div>

            {/* Generated Output */}
            {(generatedContent || generatedImage) && (
              <div className="rounded-2xl border border-amber-500/20 overflow-hidden shadow-xl shadow-amber-500/5"
                style={{ background: 'linear-gradient(145deg,rgba(245,158,11,0.06) 0%,rgba(13,13,26,0.95) 60%)' }}>

                {/* Card header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/6">
                  <span className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                    <Sparkles size={13} className="text-amber-400" /> Generated Post
                  </span>
                  <div className="flex items-center gap-2">
                    {generatedContent && <span className="text-[10px] text-white/25">{generatedContent.length} chars</span>}
                    <button
                      onClick={() => { setGeneratedContent(''); setGeneratedHashtags([]); setGeneratedImage(null); }}
                      className="text-white/20 hover:text-white/50 transition p-1 rounded-lg hover:bg-white/5"
                      title="Clear"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>

                {/* Body: two-column when both exist, single when only one */}
                <div className={`flex ${generatedContent && generatedImage ? 'flex-col md:flex-row' : 'flex-col'} gap-0`}>

                  {/* Image panel */}
                  {generatedImage && (
                    <div className={`relative group flex-shrink-0 ${generatedContent ? 'md:w-56' : 'w-full'}`}>
                      <img
                        src={generatedImage}
                        alt="AI Generated"
                        className={`w-full object-cover ${generatedContent ? 'md:h-full max-h-72 md:max-h-none' : 'max-h-96'}`}
                        style={{ minHeight: generatedContent ? 180 : undefined }}
                      />
                      {/* Overlay actions */}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-2">
                        {canUseImages && (
                          <button
                            onClick={handleGenerateImage}
                            disabled={isGeneratingImage}
                            title="Regenerate image"
                            className="bg-white/15 hover:bg-white/25 backdrop-blur border border-white/20 text-white text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 transition"
                          >
                            {isGeneratingImage ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                            Regenerate
                          </button>
                        )}
                        <button
                          onClick={() => { setGeneratedImage(null); }}
                          title="Remove image"
                          className="bg-white/10 hover:bg-red-500/30 backdrop-blur border border-white/15 text-white/70 p-2 rounded-xl transition"
                        >
                          <X size={12} />
                        </button>
                      </div>
                      {/* Platform badge */}
                      <div className="absolute top-2 left-2">
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full ${platform === 'Instagram' ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white' : 'bg-blue-600 text-white'}`}>
                          {platform}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Caption panel */}
                  {generatedContent && (
                    <div className="flex-1 p-5 space-y-4">
                      <div className="bg-black/25 border border-white/5 rounded-xl p-4 text-gray-200 text-sm whitespace-pre-wrap leading-relaxed min-h-[80px]">
                        {generatedContent}
                      </div>
                      {generatedHashtags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {generatedHashtags.map((tag, i) => (
                            <span key={i} className="text-xs bg-amber-500/12 text-amber-300/80 px-2.5 py-1 rounded-full border border-amber-500/15">
                              {tag.startsWith('#') ? tag : `#${tag}`}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Footer actions */}
                <div className="flex flex-wrap gap-2.5 items-center px-5 py-4 border-t border-white/6 bg-black/15">
                  <input
                    type="datetime-local"
                    value={scheduleDate}
                    onChange={e => setScheduleDate(e.target.value)}
                    className="bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-amber-500/40 transition"
                    title="Schedule date/time"
                  />
                  <button
                    onClick={handleSavePost}
                    className="bg-gradient-to-r from-green-600 to-emerald-600 hover:opacity-90 text-white font-bold px-5 py-2 rounded-xl flex items-center gap-2 transition text-sm shadow-lg shadow-green-500/15"
                  >
                    <Save size={14} /> {scheduleDate ? 'Schedule Post' : 'Save Draft'}
                  </button>
                  {fbConnected && (
                    <button
                      onClick={handlePublishToFacebook}
                      disabled={isPublishing}
                      className="bg-[#1877F2] hover:bg-[#166FE5] text-white font-bold px-5 py-2 rounded-xl flex items-center gap-2 disabled:opacity-60 transition text-sm shadow-lg shadow-blue-500/15"
                    >
                      {isPublishing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      Publish Now
                    </button>
                  )}
                </div>
              </div>
            )}
            </>
            )}

            {/* ── AI WRITER MODE ── */}
            {createMode === 'write' && (
              <div className="space-y-5">
                <div className="bg-purple-500/8 border border-purple-500/20 rounded-2xl px-5 py-4 flex gap-3">
                  <Pencil size={16} className="text-purple-400 shrink-0 mt-0.5" />
                  <div className="text-xs text-white/50 leading-relaxed">
                    <span className="text-purple-300 font-semibold">AI Writer: </span>
                    Write your own post draft or rough idea below. The AI will polish it, add emojis, and generate hashtags — all in your brand voice.
                  </div>
                </div>

                <div className="bg-white/3 border border-white/8 rounded-2xl p-6 space-y-5">
                  {/* Platform selector */}
                  <div className="flex rounded-xl overflow-hidden border border-white/10 w-fit">
                    {(['Instagram', 'Facebook'] as const).map(p => (
                      <button
                        key={p}
                        onClick={() => setPlatform(p)}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition ${
                          platform === p
                            ? p === 'Instagram' ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white' : 'bg-blue-600 text-white'
                            : 'bg-transparent text-white/30 hover:text-white/60'
                        }`}
                      >
                        {p === 'Instagram' ? <Instagram size={14} /> : <Facebook size={14} />}
                        {p}
                      </button>
                    ))}
                  </div>

                  {/* Draft text */}
                  <div>
                    <label className="text-xs font-semibold text-white/50 uppercase tracking-widest block mb-2">Your Draft / Idea</label>
                    <textarea
                      value={draftText}
                      onChange={e => setDraftText(e.target.value)}
                      placeholder="e.g., 'We have a new burger on the menu. It has bacon and cheese. Come try it this week.' — The AI will make it shine."
                      className="w-full bg-black/40 border border-white/8 rounded-xl p-4 text-white resize-none min-h-[120px] text-sm placeholder:text-white/20 focus:outline-none focus:border-purple-500/40 transition"
                    />
                    <p className="text-xs text-white/25 mt-1.5">{draftText.length} characters</p>
                  </div>

                  {/* Instruction */}
                  <div>
                    <label className="text-xs font-semibold text-white/50 uppercase tracking-widest block mb-2">Instruction <span className="text-white/25 font-normal normal-case">(optional)</span></label>
                    <input
                      type="text"
                      value={rewriteInstruction}
                      onChange={e => setRewriteInstruction(e.target.value)}
                      placeholder='e.g., "Make it more urgent" · "Shorter and punchier" · "More casual tone"'
                      className="w-full bg-black/40 border border-white/8 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-purple-500/40 transition"
                    />
                  </div>

                  {/* Quick instruction chips */}
                  <div className="flex flex-wrap gap-2">
                    {['Make it more urgent', 'Shorter & punchier', 'More casual', 'More professional', 'Add a call to action'].map(chip => (
                      <button
                        key={chip}
                        onClick={() => setRewriteInstruction(chip)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition ${rewriteInstruction === chip ? 'bg-purple-500/20 border-purple-500/40 text-purple-300' : 'bg-white/3 border-white/10 text-white/40 hover:text-white/70 hover:border-white/20'}`}
                      >
                        {chip}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleRewrite}
                    disabled={isRewriting || !draftText.trim()}
                    className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-bold px-6 py-2.5 rounded-xl transition flex items-center gap-2 disabled:opacity-50 shadow-lg"
                  >
                    {isRewriting ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                    {isRewriting ? 'Polishing…' : 'AI Polish My Post'}
                  </button>
                </div>

                {/* Output after rewrite */}
                {(generatedContent || generatedImage) && (
                  <div className="bg-white/3 border border-white/8 rounded-2xl p-6 space-y-4">
                    {generatedContent && (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-purple-300 font-semibold flex items-center gap-1.5"><Sparkles size={12} /> AI-Polished Version</span>
                          <span className="text-[10px] text-white/25">{generatedContent.length} chars</span>
                        </div>
                        <div className="bg-black/30 border border-white/5 rounded-xl p-4 text-gray-200 text-sm whitespace-pre-wrap leading-relaxed">{generatedContent}</div>
                        {generatedHashtags.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {generatedHashtags.map((tag, i) => (
                              <span key={i} className="text-xs bg-purple-500/15 text-purple-300 px-2.5 py-1 rounded-full border border-purple-500/20">{tag.startsWith('#') ? tag : `#${tag}`}</span>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    {generatedImage && (
                      <img src={generatedImage} alt="Generated" className="w-full max-w-sm rounded-xl border border-white/10" />
                    )}
                    <div className="flex flex-wrap gap-3 items-end pt-2 border-t border-white/5">
                      <div>
                        <label className="text-xs text-white/40 block mb-1.5">Schedule (optional)</label>
                        <input type="datetime-local" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} className="bg-black/40 border border-white/8 rounded-xl px-3 py-2 text-white text-sm" />
                      </div>
                      <button onClick={handleSavePost} className="bg-green-600 hover:bg-green-700 text-white font-bold px-6 py-2.5 rounded-xl flex items-center gap-2 transition">
                        <Save size={16} /> {scheduleDate ? 'Schedule Post' : 'Save Draft'}
                      </button>
                      {fbConnected && (
                        <button
                          onClick={handlePublishToFacebook}
                          disabled={isPublishing}
                          className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-5 py-2.5 rounded-xl flex items-center gap-2 disabled:opacity-60 transition"
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

          </div>
        )}

        {/* ═══ CALENDAR TAB ═══ */}
        {activeTab === 'calendar' && (
          <div className="space-y-5">
            <input ref={calendarUploadRef} type="file" accept="image/*" className="hidden" onChange={handleCalendarFileChange} />
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-2xl font-bold flex items-center gap-2.5"><Calendar className="text-amber-400" size={22} /> Content Calendar</h2>
                <p className="text-sm text-white/40 mt-1">{posts.length} post{posts.length !== 1 ? 's' : ''} scheduled</p>
              </div>
              {posts.length > 0 && (
                <span className="text-xs text-white/25 bg-white/5 border border-white/8 px-3 py-1.5 rounded-xl">
                  {posts.filter(p => p.status === 'Scheduled').length} scheduled · {posts.filter(p => p.status === 'Posted').length} posted
                </span>
              )}
            </div>

            {/* Tip — only show when no social account connected */}
            {!fbConnected && (
              <div className="bg-blue-500/8 border border-blue-500/15 rounded-2xl px-5 py-3.5 flex gap-3">
                <Info size={14} className="text-blue-400 shrink-0 mt-0.5" />
                <p className="text-xs text-white/40 leading-relaxed">
                  <span className="text-blue-300 font-semibold">Connect to publish: </span>
                  Go to <button onClick={() => setActiveTab('settings')} className="text-blue-300 underline">Settings</button> to connect Facebook &amp; Instagram, then click <strong className="text-white/60">Publish</strong> on any post to go live instantly.
                </p>
              </div>
            )}

            <CalendarGrid
              posts={posts}
              calendarImages={calendarImages}
              calendarGenSet={calendarGenSet}
              fbConnected={fbConnected}
              hasApiKey={hasApiKey}
              onDelete={deletePost}
              onSave={handleUpdatePost}
              onPublish={async (post) => {
                try {
                  const text = post.hashtags?.length ? `${post.content}\n\n${post.hashtags.join(' ')}` : post.content;
                  if (lateProfileId) {
                    await LateService.post(lateProfileId, [post.platform.toLowerCase() as 'facebook' | 'instagram'], text);
                  } else {
                    await FacebookService.postToPageDirect(profile.facebookPageId, profile.facebookPageAccessToken, text, post.image);
                  }
                  setPosts(prev => prev.map(p => p.id === post.id ? { ...p, status: 'Posted' as const } : p));
                  toast('Published successfully!', 'success');
                } catch (e: any) { toast(`Publish failed: ${e?.message?.substring(0, 80)}`, 'error'); }
              }}
              onRegenImage={handleCalendarRegenImage}
              onUpload={handleCalendarUpload}
              onGoCreate={() => setActiveTab('create')}
              onGoSmart={() => setActiveTab('smart')}
            />
          </div>
        )}

        {/* ═══ SMART AI TAB ═══ */}
        {activeTab === 'smart' && (() => {
          const now = new Date();
          const upcomingPosts = posts.filter(p => new Date(p.scheduledFor) > now).sort((a,b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
          const nextPost = upcomingPosts[0];
          const canUseVideos = activePlan === 'pro' || activePlan === 'agency';
          return (
          <div className="space-y-5">
            <input ref={uploadFileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

            {/* ── Dashboard Overview Strip ── */}
            <DashboardStats
              posts={posts}
              stats={stats}
              liveStats={liveStats}
              hasApiKey={hasApiKey}
              fbConnected={fbConnected}
              activePlan={activePlan}
              planName={planCfg?.name}
              lastPulled={lastPulled}
              onGoToSettings={() => setActiveTab('settings')}
            />

            {/* ── Hero Generator ── */}
            <div className="bg-gradient-to-br from-[#0d0d14] via-[#111118] to-[#0d0d14] rounded-3xl p-7 relative overflow-hidden border border-white/10">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(245,158,11,0.10),transparent_55%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_20%,rgba(139,92,246,0.06),transparent_55%)]" />
              <div className="relative z-10 space-y-5">
                <div>
                  <h2 className="text-2xl font-black text-white flex items-center gap-2">
                    <Sparkles size={22} className="text-amber-400" /> AI Content Autopilot
                  </h2>
                  <p className="text-white/35 text-sm mt-1">Researches your industry, audience & platform algorithms — then writes your entire content calendar in one click.</p>
                </div>

                {/* Mode row */}
                <div className="flex flex-wrap gap-2">
                  {/* Normal mode */}
                  <button
                    onClick={() => { setSaturationMode(false); setSmartCount(7); }}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition ${
                      !saturationMode ? 'bg-amber-500/15 border-amber-500/40 text-amber-300' : 'bg-white/3 border-white/10 text-white/40 hover:text-white/60'
                    }`}
                  >
                    <Calendar size={14} /> Smart Schedule
                  </button>
                  {/* Saturation mode */}
                  <button
                    onClick={() => {
                      if (!canUseSaturation) { toast('Saturation Mode is a Pro plan feature.', 'warning'); return; }
                      setSaturationMode(true); setSmartCount(21);
                    }}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition ${
                      saturationMode ? 'bg-red-500/15 border-red-500/40 text-red-300' : 'bg-white/3 border-white/10 text-white/40 hover:text-white/60'
                    } ${!canUseSaturation ? 'opacity-50' : ''}`}
                  >
                    🔥 Saturation Campaign
                    {!canUseSaturation && <span className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded-full">Pro</span>}
                  </button>
                  {/* Short Videos */}
                  <button
                    onClick={() => {
                      if (!canUseVideos) { toast('Short Video posts require a Pro plan.', 'warning'); return; }
                      setIncludeVideos(v => !v);
                    }}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition ${
                      includeVideos ? 'bg-purple-500/15 border-purple-500/40 text-purple-300' : 'bg-white/3 border-white/10 text-white/40 hover:text-white/60'
                    } ${!canUseVideos ? 'opacity-50' : ''}`}
                  >
                    🎬 Include Reels/Videos
                    {!canUseVideos && <span className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded-full">Pro</span>}
                  </button>
                </div>

                {saturationMode && (
                  <div className="bg-red-500/8 border border-red-500/15 rounded-xl px-4 py-3">
                    <p className="text-xs text-red-300 font-semibold">🔥 Saturation Mode: 3–5 posts per day over 7 days — maximum algorithmic reach through sheer posting volume and content variety.</p>
                  </div>
                )}
                {includeVideos && (
                  <div className="bg-purple-500/8 border border-purple-500/15 rounded-xl px-4 py-3">
                    <p className="text-xs text-purple-300 font-semibold">🎬 Reels/Videos included: the AI will generate detailed video scripts, shot-by-shot briefs and music mood for short-form video posts alongside your regular content.</p>
                  </div>
                )}

                <div className="flex flex-wrap gap-3 items-end">
                  <div>
                    <label className="text-xs text-white/40 block mb-1.5">Posts to Generate</label>
                    <select
                      value={smartCount}
                      onChange={e => setSmartCount(Number(e.target.value))}
                      className="bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none"
                    >
                      {saturationMode
                        ? [<option key={14} value={14}>14 posts (2/day)</option>, <option key={21} value={21}>21 posts (3/day)</option>, <option key={28} value={28}>28 posts (4/day)</option>]
                        : [<option key={5} value={5}>5 posts (1 week)</option>, <option key={7} value={7}>7 posts (1 week)</option>, <option key={10} value={10}>10 posts (2 weeks)</option>, <option key={14} value={14}>14 posts (2 weeks)</option>]
                      }
                    </select>
                  </div>
                  <button
                    onClick={handleSmartSchedule}
                    disabled={isSmartGenerating || !hasApiKey}
                    className={`font-black px-8 py-3 rounded-2xl transition flex items-center gap-2 text-base shadow-xl disabled:opacity-60 ${
                      saturationMode
                        ? 'bg-gradient-to-r from-red-500 to-orange-600 hover:from-red-600 hover:to-orange-700 text-white shadow-red-900/30'
                        : 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-black shadow-amber-900/30'
                    }`}
                  >
                    {isSmartGenerating ? <Loader2 className="animate-spin" size={18} /> : <Zap size={18} />}
                    {isSmartGenerating ? 'Researching & Writing…' : saturationMode ? 'Launch Saturation Campaign' : 'Generate My Content Calendar'}
                  </button>
                  {!hasApiKey && <p className="text-xs text-red-400/70 self-center">Set your Gemini API key in Settings first</p>}
                </div>
              </div>
            </div>

            {/* Generation Ticker */}
            {isSmartGenerating && (
              <div className="bg-white/3 border border-white/8 rounded-2xl p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-amber-500/15 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Loader2 size={16} className="animate-spin text-amber-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-amber-300">{TICKER_STEPS[tickerIdx]?.label}</p>
                    <p className="text-xs text-white/25 mt-0.5">Using two AI calls for research + content quality</p>
                  </div>
                </div>
                <div className="w-full bg-white/8 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-amber-400 to-orange-500 h-2 rounded-full transition-all duration-700"
                    style={{ width: `${TICKER_STEPS[tickerIdx]?.pct ?? 0}%` }}
                  />
                </div>
                <p className="text-xs text-white/20 text-right">{TICKER_STEPS[tickerIdx]?.pct ?? 0}% complete</p>
              </div>
            )}

            {/* Strategy */}
            {smartStrategy && !isSmartGenerating && (
              <div className="bg-gradient-to-r from-amber-500/8 to-orange-500/5 border border-amber-500/20 rounded-2xl p-5">
                <p className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2">AI Research Strategy</p>
                <p className="text-sm text-white/70 leading-relaxed">{smartStrategy}</p>
              </div>
            )}

            {/* Generated Posts */}
            {smartPosts.length > 0 && !isSmartGenerating && (
              <div className="space-y-4">
                {/* Accept All bar */}
                <div className="sticky top-[72px] z-30 bg-[#0a0a0f]/90 backdrop-blur-xl border border-green-500/20 rounded-2xl px-5 py-3.5 flex items-center justify-between gap-4 shadow-xl">
                  <div>
                    <p className="text-sm font-bold text-white">{smartPosts.length} posts ready</p>
                    {autoGenSet.size > 0 ? (
                      <p className="text-xs text-amber-400 flex items-center gap-1">
                        <Loader2 size={10} className="animate-spin" /> Generating images… {imgGenDone}/{smartPosts.length}
                      </p>
                    ) : (
                      <p className="text-xs text-white/30">Review below, then add all to your calendar</p>
                    )}
                  </div>
                  <button
                    onClick={handleAcceptSmartPosts}
                    disabled={isAccepting}
                    className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:opacity-70 text-white font-black px-6 py-3 rounded-xl flex items-center gap-2 text-sm shadow-lg shadow-green-900/30 transition min-w-[220px] justify-center"
                  >
                    {isAccepting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>Saving… {acceptProgress}%</span>
                        <span className="text-xs font-normal opacity-60 ml-1">({Math.round(acceptProgress / 100 * smartPosts.length)}/{smartPosts.length})</span>
                      </>
                    ) : (
                      <><CheckCircle size={16} /> Accept All & Add to Calendar</>
                    )}
                  </button>
                </div>

                {/* Post cards */}
                {smartPosts.map((sp, i) => {
                  const isVideo = (sp as any).postType === 'video';
                  const hasImage = !!smartPostImages[i];
                  const isGenning = autoGenSet.has(i);
                  return (
                  <div key={i} className={`border rounded-2xl overflow-hidden transition ${
                    isVideo ? 'bg-purple-950/20 border-purple-500/20' : 'bg-white/3 border-white/8 hover:border-white/15'
                  }`}>
                    <div className="p-4 flex gap-4">
                      {/* Image / Video area */}
                      {isVideo ? (
                        <AnimatedReelPreview
                          hookText={
                            (sp as any).videoScript
                              ? (sp as any).videoScript.split(/Hook:|Body:|CTA:/).find((s: string) => s.trim())?.replace(/^['"]/, '').trim()
                              : sp.content
                          }
                          mood={(sp as any).videoMood}
                          size="md"
                          onClick={() => setVideoScriptModal({
                            hookText: (sp as any).videoScript
                              ? (sp as any).videoScript.split(/Hook:|Body:|CTA:/).find((s: string) => s.trim())?.replace(/^['"]/, '').trim() ?? sp.content
                              : sp.content,
                            script: (sp as any).videoScript,
                            shots: (sp as any).videoShots,
                            mood: (sp as any).videoMood,
                          })}
                        />
                      ) : (
                        <div className="w-24 h-24 rounded-xl flex-shrink-0 overflow-hidden bg-black/40 border border-white/8 relative group">
                          {hasImage ? (
                            <>
                              <img src={smartPostImages[i]} alt="" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center gap-1">
                                <button onClick={() => handleRegenImage(i)} title="Regenerate" className="bg-white/20 hover:bg-white/30 p-1.5 rounded-lg"><RefreshCw size={12} className="text-white" /></button>
                                <button onClick={() => handleUploadImage(i)} title="Upload" className="bg-white/20 hover:bg-white/30 p-1.5 rounded-lg"><Upload size={12} className="text-white" /></button>
                              </div>
                            </>
                          ) : isGenning ? (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-1.5">
                              <Loader2 size={20} className="animate-spin text-amber-400" />
                              <span className="text-[9px] text-white/40">Generating…</span>
                            </div>
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-1.5">
                              <ImageIcon size={18} className="text-white/20" />
                              <div className="flex flex-col gap-1 items-center">
                                <button onClick={() => handleRegenImage(i)} className="text-[9px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full hover:bg-amber-500/30 transition font-semibold">Generate</button>
                                <button onClick={() => handleUploadImage(i)} className="text-[9px] text-white/25 hover:text-white/50 transition">Upload</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {/* Content */}
                      <div className="flex-1 min-w-0 space-y-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          {sp.platform === 'Instagram' ? <Instagram size={13} className="text-pink-400 flex-shrink-0" /> : <Facebook size={13} className="text-blue-400 flex-shrink-0" />}
                          <span className="text-xs font-semibold text-white/50">
                            {new Date(sp.scheduledFor).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })} · {new Date(sp.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {sp.pillar && <span className="text-[10px] bg-purple-900/40 text-purple-300 border border-purple-500/20 px-2 py-0.5 rounded-full font-semibold">{sp.pillar}</span>}
                          {isVideo && <span className="text-[10px] bg-purple-900/40 text-purple-300 border border-purple-500/20 px-2 py-0.5 rounded-full font-semibold">🎬 Reel</span>}
                        </div>
                        <p className="text-sm text-white/80 leading-relaxed">{sp.content}</p>
                        <div className="flex flex-wrap gap-1">
                          {sp.hashtags.map((t, j) => (
                            <span key={j} className="text-[11px] text-amber-400/70 font-medium">{t.startsWith('#') ? t : `#${t}`}</span>
                          ))}
                        </div>
                        {sp.reasoning && <p className="text-[11px] text-white/25 italic border-t border-white/5 pt-2">{sp.reasoning}</p>}
                      </div>
                    </div>
                    {/* Video script section */}
                    {isVideo && (sp as any).videoScript && (
                      <details className="border-t border-purple-500/15">
                        <summary className="text-xs text-purple-400/70 hover:text-purple-300 cursor-pointer px-4 py-2.5 flex items-center gap-1.5 font-semibold transition">
                          <ChevronDown size={12} /> View Video Script & Shot Brief
                        </summary>
                        <div className="px-4 pb-4 space-y-3">
                          <div className="bg-purple-900/20 rounded-xl p-4 space-y-2">
                            <p className="text-xs font-bold text-purple-300">Script:</p>
                            <p className="text-xs text-white/60 leading-relaxed whitespace-pre-wrap">{(sp as any).videoScript}</p>
                          </div>
                          {(sp as any).videoShots && (
                            <div className="bg-purple-900/20 rounded-xl p-4 space-y-2">
                              <p className="text-xs font-bold text-purple-300">Shot-by-Shot:</p>
                              <p className="text-xs text-white/60 leading-relaxed whitespace-pre-wrap">{(sp as any).videoShots}</p>
                            </div>
                          )}
                          {(sp as any).videoMood && (
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-purple-300">Music Mood:</span>
                              <span className="text-xs text-white/50">{(sp as any).videoMood}</span>
                            </div>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                  );
                })}

                {/* Accept All bottom */}
                <button
                  onClick={handleAcceptSmartPosts}
                  className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 text-base shadow-xl shadow-green-900/20 transition"
                >
                  <CheckCircle size={18} /> Accept All {smartPosts.length} Posts & Add to Calendar
                </button>
              </div>
            )}

            {/* Empty state */}
            {smartPosts.length === 0 && !isSmartGenerating && (
              <div className="text-center py-16 space-y-4">
                <div className="w-16 h-16 mx-auto bg-amber-500/10 rounded-3xl flex items-center justify-center">
                  <Sparkles size={28} className="text-amber-400" />
                </div>
                <div>
                  <p className="text-white/50 font-semibold">Your AI content calendar is waiting</p>
                  <p className="text-white/20 text-sm mt-1">Click "Generate My Content Calendar" above to let the AI research your industry and write a full schedule</p>
                </div>
                {upcomingPosts.length > 0 && (
                  <button onClick={() => setActiveTab('calendar')} className="text-sm text-amber-400 hover:text-amber-300 underline transition">
                    View {upcomingPosts.length} scheduled posts in Calendar →
                  </button>
                )}
              </div>
            )}
          </div>
          );
        })()}

        {/* ═══ INSIGHTS TAB ═══ */}
        {activeTab === 'insights' && (
          <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-2xl font-bold flex items-center gap-2.5"><BarChart3 className="text-amber-400" size={22} /> AI Insights</h2>
                <p className="text-sm text-white/40 mt-1">
                  {insightReport
                    ? <>Last analysed: <span className="text-white/60">{new Date(insightReport.generatedAt).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span> · Updates automatically every 24h</>
                    : isAnalyzing ? 'Analysing your business…' : 'AI analyses your account daily and surfaces actionable insights.'}
                </p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {(profile.sotrendPageId || profile.facebookPageId) && (
                  <button
                    onClick={handleScanPastPosts}
                    disabled={isScanningPosts || isAnalyzing}
                    className="flex items-center gap-2 text-xs bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 hover:border-blue-500/35 text-blue-300/70 hover:text-blue-300 px-4 py-2 rounded-xl transition disabled:opacity-40"
                    title="Scan real past Facebook posts via Sotrender and generate data-driven insights"
                  >
                    {isScanningPosts ? <Loader2 size={13} className="animate-spin" /> : <BarChart3 size={13} />}
                    {isScanningPosts ? 'Scanning posts…' : 'Scan Past Posts'}
                  </button>
                )}
                <button
                  onClick={() => runInsightReport(true)}
                  disabled={isAnalyzing || isScanningPosts}
                  className="flex items-center gap-2 text-xs bg-white/5 hover:bg-amber-500/15 border border-white/10 hover:border-amber-500/25 text-white/50 hover:text-amber-300 px-4 py-2 rounded-xl transition disabled:opacity-40"
                >
                  {isAnalyzing ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                  {isAnalyzing ? 'Analysing…' : 'Refresh Now'}
                </button>
              </div>
            </div>

            {/* No API key */}
            {!hasApiKey && (
              <div className="bg-amber-500/8 border border-amber-500/20 rounded-2xl p-6 text-center space-y-3">
                <Sparkles size={28} className="text-amber-400 mx-auto" />
                <p className="text-white/60 font-semibold">Set your Gemini API key in Settings to enable AI Insights</p>
                <button onClick={() => setActiveTab('settings')} className="text-xs text-amber-400 underline hover:text-amber-300 transition">Go to Settings →</button>
              </div>
            )}

            {/* Loading skeleton */}
            {isAnalyzing && !insightReport && (
              <div className="space-y-4">
                {[1,2,3].map(i => (
                  <div key={i} className="bg-white/3 border border-white/8 rounded-2xl p-5 animate-pulse">
                    <div className="h-3 bg-white/10 rounded w-1/3 mb-3" />
                    <div className="h-2 bg-white/6 rounded w-full mb-2" />
                    <div className="h-2 bg-white/6 rounded w-4/5" />
                  </div>
                ))}
              </div>
            )}

            {insightReport && (
              <>
                {/* Score + Summary */}
                <div className="rounded-2xl border border-white/8 overflow-hidden"
                  style={{ background: 'linear-gradient(135deg,rgba(245,158,11,0.08) 0%,rgba(10,10,20,0.95) 60%)' }}>
                  <div className="p-6 flex gap-5 items-start">
                    <div className="shrink-0 w-20 h-20 rounded-2xl flex flex-col items-center justify-center border-2 border-amber-500/30 bg-amber-500/10">
                      <span className="text-3xl font-black text-amber-400">{insightReport.score}</span>
                      <span className="text-[9px] text-amber-400/60 font-bold uppercase tracking-widest">/ 100</span>
                    </div>
                    <div className="flex-1">
                      <p className="text-xs font-bold text-amber-300/70 uppercase tracking-widest mb-1.5">Social Health Score</p>
                      <p className="text-sm text-white/75 leading-relaxed">{insightReport.summary}</p>
                    </div>
                  </div>
                </div>

                {/* Quick Win */}
                {insightReport.quickWin && (
                  <div className="bg-green-500/8 border border-green-500/20 rounded-2xl px-5 py-4 flex gap-3 items-start">
                    <Zap size={16} className="text-green-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-green-300 mb-0.5">Quick Win — Do This Today</p>
                      <p className="text-sm text-white/70">{insightReport.quickWin}</p>
                    </div>
                  </div>
                )}

                {/* Recommendations */}
                <div className="space-y-2.5">
                  <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest px-1">Recommendations</h3>
                  {insightReport.recommendations.map((rec, i) => {
                    const colors = { high: 'border-red-500/25 bg-red-500/5', medium: 'border-amber-500/25 bg-amber-500/5', low: 'border-blue-500/20 bg-blue-500/5' };
                    const badges = { high: 'bg-red-500/20 text-red-300', medium: 'bg-amber-500/20 text-amber-300', low: 'bg-blue-500/20 text-blue-300' };
                    return (
                      <div key={i} className={`border rounded-2xl p-4 flex gap-3 items-start ${colors[rec.priority]}`}>
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full mt-0.5 shrink-0 ${badges[rec.priority]}`}>
                          {rec.priority.toUpperCase()}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-white/85">{rec.title}</p>
                          <p className="text-xs text-white/45 mt-0.5 leading-relaxed">{rec.detail}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Best Times */}
                {insightReport.bestTimes?.length > 0 && (
                  <div className="space-y-2.5">
                    <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest px-1">Best Posting Times</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {insightReport.bestTimes.map((bt, i) => (
                        <div key={i} className="bg-white/3 border border-white/8 rounded-2xl p-4">
                          <div className="flex items-center gap-2 mb-3">
                            {bt.platform === 'Facebook' ? <Facebook size={14} className="text-blue-400" /> : <Instagram size={14} className="text-pink-400" />}
                            <span className="text-xs font-bold text-white/60">{bt.platform}</span>
                          </div>
                          <div className="space-y-1.5">
                            {bt.slots.map((slot, j) => (
                              <div key={j} className="flex items-center gap-2">
                                <Clock size={10} className="text-amber-400/60 shrink-0" />
                                <span className="text-xs text-white/70">{slot}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Content Focus */}
                {insightReport.contentFocus?.length > 0 && (
                  <div className="space-y-2.5">
                    <h3 className="text-xs font-bold text-white/40 uppercase tracking-widest px-1">Content Topics to Focus On</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {insightReport.contentFocus.map((cf, i) => (
                        <div key={i} className="bg-white/3 border border-white/8 rounded-2xl p-4 space-y-1.5">
                          <p className="text-sm font-semibold text-amber-300">{cf.topic}</p>
                          <p className="text-xs text-white/45 leading-relaxed">{cf.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Live Stats edit row */}
                <details className="group">
                  <summary className="text-xs text-white/25 hover:text-white/45 cursor-pointer list-none flex items-center gap-1.5 transition">
                    <ChevronDown size={12} className="group-open:rotate-180 transition-transform" />
                    Update stats manually (used to calibrate insights)
                  </summary>
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
                    {([
                      { label: 'Followers', key: 'followers' as const },
                      { label: 'Monthly Reach', key: 'reach' as const },
                      { label: 'Engagement %', key: 'engagement' as const },
                      { label: 'Posts (30d)', key: 'postsLast30Days' as const }
                    ]).map(s => (
                      <div key={s.key}>
                        <label className="text-[10px] text-white/30 block mb-1">{s.label}</label>
                        <input type="number" value={stats[s.key]}
                          onChange={e => setStats(prev => ({ ...prev, [s.key]: Number(e.target.value) }))}
                          className="w-full bg-black/40 border border-white/8 rounded-xl px-3 py-2 text-white text-sm" />
                      </div>
                    ))}
                  </div>
                </details>
              </>
            )}
          </div>
        )}

        {/* ═══ SETTINGS TAB ═══ */}
        {activeTab === 'settings' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-2xl font-bold flex items-center gap-2.5"><Settings className="text-amber-400" size={22} /> Settings</h2>
              <p className="text-sm text-white/40 mt-1">Configure your AI key, brand profile, and integrations.</p>
            </div>

            {/* ── Plan & Billing ── */}
            <div className="bg-white/3 border border-white/8 rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-amber-500/15 border border-amber-500/20 rounded-xl flex items-center justify-center">
                    <ShoppingCart size={16} className="text-amber-400" />
                  </div>
                  <div>
                    <h3 className="font-bold text-white">Plan &amp; Billing</h3>
                    <p className="text-xs text-white/30 mt-0.5">
                      {activePlan ? <>Currently on <span className={`font-bold bg-gradient-to-r ${CLIENT.plans.find(p => p.id === activePlan)?.color ?? 'from-white to-white'} bg-clip-text text-transparent`}>{CLIENT.plans.find(p => p.id === activePlan)?.name}</span> plan</> : 'No active plan'}
                    </p>
                  </div>
                </div>
                {CLIENT.stripeCustomerPortalUrl && (
                  <a href={CLIENT.stripeCustomerPortalUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-white/40 hover:text-amber-300 border border-white/10 hover:border-amber-500/30 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5">
                    <Link2 size={12} /> Manage Billing
                  </a>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {CLIENT.plans.map(plan => {
                  const isCurrent = activePlan === plan.id;
                  const planOrder = ['starter', 'growth', 'pro', 'agency'];
                  const currentIdx = planOrder.indexOf(activePlan ?? '');
                  const planIdx = planOrder.indexOf(plan.id);
                  const isUpgrade = planIdx > currentIdx;
                  const isNew = !activePlan;
                  // New clients → payment link WITH setup fee; existing → upgrade link without setup fee
                  const upgradeLink = CLIENT.stripePaymentLinks?.[plan.id as keyof typeof CLIENT.stripePaymentLinks];
                  const newLink = (CLIENT as any).stripePaymentLinksNew?.[plan.id as keyof typeof CLIENT.stripePaymentLinks];
                  const baseLink = isNew ? (newLink || upgradeLink) : upgradeLink;
                  // Append client_reference_id so the Stripe webhook can identify the user + plan
                  const paymentLink = baseLink && user
                    ? `${baseLink}?client_reference_id=${user.uid}:${plan.id}&prefilled_email=${encodeURIComponent(user.email || '')}`
                    : baseLink;
                  return (
                    <div key={plan.id} className={`relative rounded-2xl border p-4 space-y-3 transition ${
                      isCurrent
                        ? 'border-amber-500/40 bg-amber-500/8'
                        : 'border-white/8 bg-white/2 hover:border-white/15'
                    }`}>
                      {plan.badge && (
                        <span className="absolute -top-2 left-3 text-[9px] font-black bg-amber-500 text-black px-2 py-0.5 rounded-full">{plan.badge}</span>
                      )}
                      {isCurrent && (
                        <span className="absolute -top-2 right-3 text-[9px] font-black bg-green-500 text-black px-2 py-0.5 rounded-full flex items-center gap-1"><CheckCircle size={8} /> Current</span>
                      )}
                      <div>
                        <p className={`text-sm font-black bg-gradient-to-r ${plan.color} bg-clip-text text-transparent`}>{plan.name}</p>
                        <p className="text-xl font-black text-white mt-0.5">${plan.price}<span className="text-xs text-white/30 font-normal">/mo</span></p>
                        {isNew && <p className="text-[9px] text-amber-400/70 mt-0.5">+ ${CLIENT.setupFee} setup fee</p>}
                      </div>
                      <ul className="space-y-1">
                        {plan.features.slice(0, 3).map((f, i) => (
                          <li key={i} className="text-[10px] text-white/45 flex items-start gap-1.5">
                            <CheckCircle size={9} className="text-green-400/60 shrink-0 mt-0.5" />
                            {f}
                          </li>
                        ))}
                      </ul>
                      {!isCurrent && (
                        isNew ? (
                          // New client — prompt them to fill intake form first
                          <button
                            onClick={() => setShowIntakeForm(true)}
                            className={`w-full text-center text-xs font-bold py-2 rounded-xl transition bg-gradient-to-r ${plan.color} text-white hover:opacity-90`}
                          >
                            Get Started
                          </button>
                        ) : paymentLink ? (
                          <a href={paymentLink} target="_blank" rel="noopener noreferrer"
                            className={`block text-center text-xs font-bold py-2 rounded-xl transition ${
                              isUpgrade
                                ? `bg-gradient-to-r ${plan.color} text-white hover:opacity-90`
                                : 'bg-white/8 hover:bg-white/12 text-white/60'
                            }`}>
                            {isUpgrade ? '↑ Upgrade' : '↓ Downgrade'}
                          </a>
                        ) : (
                          <a href={CLIENT.stripeCustomerPortalUrl || CLIENT.salesUrl} target="_blank" rel="noopener noreferrer"
                            className="block text-center text-xs font-semibold py-2 rounded-xl bg-white/6 hover:bg-white/10 text-white/40 transition">
                            {isUpgrade ? '↑ Upgrade' : '↓ Downgrade'} →
                          </a>
                        )
                      )}
                      {isCurrent && (
                        <div className="text-center text-[10px] text-green-400/60 font-semibold py-1">✓ Active</div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* New client intake form prompt */}
              {!activePlan && !intakeFormDone && (
                <div className="bg-blue-500/8 border border-blue-500/20 rounded-2xl px-4 py-4 flex items-start gap-3">
                  <div className="w-8 h-8 bg-blue-500/20 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-sm">📋</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-bold text-blue-300 mb-0.5">New to SocialAI Studio?</p>
                    <p className="text-xs text-white/45 leading-relaxed">Choose a plan above, then complete our quick setup form so we can connect your Facebook Page. A one-time <span className="text-amber-300 font-semibold">${CLIENT.setupFee} setup fee</span> applies to new accounts.</p>
                  </div>
                  <button
                    onClick={() => setShowIntakeForm(true)}
                    className="shrink-0 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/25 text-blue-300 text-xs font-bold px-3 py-2 rounded-xl transition"
                  >
                    Fill Setup Form
                  </button>
                </div>
              )}
              {intakeFormDone && !activePlan && (
                <div className="bg-green-500/8 border border-green-500/20 rounded-2xl px-4 py-3 flex items-center gap-3">
                  <CheckCircle size={14} className="text-green-400 shrink-0" />
                  <p className="text-xs text-green-300">Setup form submitted — our team will contact you within 1 business day with your payment link.</p>
                </div>
              )}
              {!CLIENT.stripeCustomerPortalUrl && (
                <p className="text-xs text-white/20 text-center">
                  To cancel or update payment details, contact <a href={`mailto:${CLIENT.supportEmail}`} className="text-amber-400/60 hover:text-amber-400 underline transition">{CLIENT.supportEmail}</a>
                </p>
              )}
            </div>

            {/* API Key */}
            <div className="bg-white/3 border border-white/8 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-amber-500/15 border border-amber-500/20 rounded-xl flex items-center justify-center">
                  <Sparkles size={16} className="text-amber-400" />
                </div>
                <div>
                  <h3 className="font-bold text-white">Gemini AI Key</h3>
                  <p className="text-xs text-white/30 mt-0.5">Powers all AI content generation features</p>
                </div>
                {hasApiKey && <span className="ml-auto text-xs text-green-400 bg-green-500/10 border border-green-500/15 px-2.5 py-1 rounded-full flex items-center gap-1"><CheckCircle size={11} /> Active</span>}
              </div>
              <p className="text-xs text-white/30 leading-relaxed">
                Get a free key from{' '}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-amber-400/70 hover:text-amber-400 underline transition">Google AI Studio</a>
                {' '}— it takes 30 seconds and is free to use.
              </p>
              <div className="flex gap-2 max-w-lg">
                <input
                  type="password"
                  value={profile.geminiApiKey}
                  onChange={e => setProfile(prev => ({ ...prev, geminiApiKey: e.target.value }))}
                  placeholder="AIza..."
                  className="flex-1 bg-black/40 border border-white/8 rounded-xl px-3 py-2.5 text-white font-mono text-sm placeholder:text-white/20"
                />
                <button
                  onClick={handleSaveApiKey}
                  disabled={isSavingKey}
                  className="bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-black font-bold px-5 py-2.5 rounded-xl text-sm transition flex items-center gap-2"
                >
                  {isSavingKey ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {isSavingKey ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            {/* Business Profile — Guided Questionnaire */}
            <div className="bg-white/3 border border-white/8 rounded-2xl p-6 space-y-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-white flex items-center gap-2"><Brain size={16} className="text-amber-400" /> AI Business Profile</h3>
                  <p className="text-xs text-white/30 mt-0.5">Your answers train the AI to write in your voice, for your audience, about what matters to your business.</p>
                </div>
                <button
                  onClick={handleSaveProfile}
                  disabled={isSavingProfile}
                  className="flex-shrink-0 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-black font-bold px-4 py-2 rounded-xl text-sm transition flex items-center gap-2"
                >
                  {isSavingProfile ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {isSavingProfile ? 'Saving…' : 'Save Profile'}
                </button>
              </div>

              <div className="space-y-5">
                {/* Q1 + Q2 */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-amber-400/80 uppercase tracking-wider block mb-1">1. What's your business name?</label>
                    <input
                      value={profile.name}
                      onChange={e => setProfile(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g. Bella's Bakery"
                      className="w-full bg-black/40 border border-white/8 rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-amber-400/80 uppercase tracking-wider block mb-1">2. What type of business do you run?</label>
                    <input
                      value={profile.type}
                      onChange={e => setProfile(prev => ({ ...prev, type: e.target.value }))}
                      placeholder="e.g. Artisan bakery & café"
                      className="w-full bg-black/40 border border-white/8 rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40"
                    />
                  </div>
                </div>

                {/* Q3 */}
                <div>
                  <label className="text-xs font-bold text-amber-400/80 uppercase tracking-wider block mb-1">3. Where are you based?</label>
                  <input
                    value={profile.location}
                    onChange={e => setProfile(prev => ({ ...prev, location: e.target.value }))}
                    placeholder="e.g. Bondi Beach, Sydney NSW"
                    className="w-full bg-black/40 border border-white/8 rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40"
                  />
                </div>

                {/* Q4 */}
                <div>
                  <label className="text-xs font-bold text-amber-400/80 uppercase tracking-wider block mb-1">4. Describe what you do and who you help <span className="text-white/20 font-normal normal-case">(2–3 sentences)</span></label>
                  <textarea
                    value={profile.description}
                    onChange={e => setProfile(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="We're a family-run bakery specialising in sourdough and pastries made fresh every morning. We serve locals, office workers, and weekend visitors looking for something a bit special with their coffee."
                    className="w-full bg-black/40 border border-white/8 rounded-xl px-3 py-3 text-white text-sm min-h-[80px] resize-none placeholder:text-white/20 focus:outline-none focus:border-amber-500/40"
                  />
                </div>

                {/* Q5 */}
                <div>
                  <label className="text-xs font-bold text-amber-400/80 uppercase tracking-wider block mb-1">5. Who is your ideal customer?</label>
                  <textarea
                    value={profile.targetAudience}
                    onChange={e => setProfile(prev => ({ ...prev, targetAudience: e.target.value }))}
                    placeholder="Local professionals aged 25–45 who appreciate quality food and are willing to pay a premium. Also young families on weekends and coffee enthusiasts."
                    className="w-full bg-black/40 border border-white/8 rounded-xl px-3 py-3 text-white text-sm min-h-[70px] resize-none placeholder:text-white/20 focus:outline-none focus:border-amber-500/40"
                  />
                </div>

                {/* Q6 */}
                <div>
                  <label className="text-xs font-bold text-amber-400/80 uppercase tracking-wider block mb-1">6. What makes you stand out from competitors?</label>
                  <textarea
                    value={profile.uniqueValue}
                    onChange={e => setProfile(prev => ({ ...prev, uniqueValue: e.target.value }))}
                    placeholder="We use only locally sourced ingredients, our sourdough ferments for 48 hours, and every item is made on-site. We've won the local 'Best Café' award 3 years running."
                    className="w-full bg-black/40 border border-white/8 rounded-xl px-3 py-3 text-white text-sm min-h-[70px] resize-none placeholder:text-white/20 focus:outline-none focus:border-amber-500/40"
                  />
                </div>

                {/* Q7 */}
                <div>
                  <label className="text-xs font-bold text-amber-400/80 uppercase tracking-wider block mb-1">7. What are your main products or services?</label>
                  <textarea
                    value={profile.productsServices}
                    onChange={e => setProfile(prev => ({ ...prev, productsServices: e.target.value }))}
                    placeholder="Sourdough loaves, croissants, seasonal pastries, specialty coffee, breakfast plates, and custom celebration cakes by order."
                    className="w-full bg-black/40 border border-white/8 rounded-xl px-3 py-3 text-white text-sm min-h-[70px] resize-none placeholder:text-white/20 focus:outline-none focus:border-amber-500/40"
                  />
                </div>

                {/* Q8 — Social Goal pill selector */}
                <div>
                  <label className="text-xs font-bold text-amber-400/80 uppercase tracking-wider block mb-2">8. What's your #1 goal for social media?</label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      'Grow brand awareness',
                      'Drive more foot traffic & sales',
                      'Build a loyal community',
                      'Educate & inform customers',
                      'Promote specific products & offers',
                      'All of the above',
                    ].map(goal => (
                      <button
                        key={goal}
                        type="button"
                        onClick={() => setProfile(prev => ({ ...prev, socialGoal: prev.socialGoal === goal ? '' : goal }))}
                        className={`text-xs px-3 py-1.5 rounded-full border transition font-medium ${
                          profile.socialGoal === goal
                            ? 'bg-amber-500 border-amber-500 text-black'
                            : 'bg-white/5 border-white/10 text-white/50 hover:border-amber-500/40 hover:text-white/80'
                        }`}
                      >
                        {goal}
                      </button>
                    ))}
                  </div>
                  {profile.socialGoal === '' && (
                    <input
                      value={profile.socialGoal}
                      onChange={e => setProfile(prev => ({ ...prev, socialGoal: e.target.value }))}
                      placeholder="Or type a custom goal…"
                      className="mt-2 w-full bg-black/40 border border-white/8 rounded-xl px-3 py-2 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40"
                    />
                  )}
                </div>

                {/* Q9 — Tone pill selector */}
                <div>
                  <label className="text-xs font-bold text-amber-400/80 uppercase tracking-wider block mb-2">9. How would you describe your brand's personality?</label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {[
                      'Friendly & warm',
                      'Professional & polished',
                      'Casual & laid-back',
                      'Fun & humorous',
                      'Bold & edgy',
                      'Inspiring & motivational',
                      'Educational & informative',
                      'Luxurious & premium',
                    ].map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setProfile(prev => ({
                          ...prev,
                          tone: prev.tone === t ? '' : t
                        }))}
                        className={`text-xs px-3 py-1.5 rounded-full border transition font-medium ${
                          profile.tone === t
                            ? 'bg-amber-500 border-amber-500 text-black'
                            : 'bg-white/5 border-white/10 text-white/50 hover:border-amber-500/40 hover:text-white/80'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <input
                    value={profile.tone}
                    onChange={e => setProfile(prev => ({ ...prev, tone: e.target.value }))}
                    placeholder="Or describe your tone in your own words…"
                    className="w-full bg-black/40 border border-white/8 rounded-xl px-3 py-2 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40"
                  />
                </div>

                {/* Q10 */}
                <div>
                  <label className="text-xs font-bold text-amber-400/80 uppercase tracking-wider block mb-1">10. What topics or themes should your posts focus on?</label>
                  <textarea
                    value={profile.contentTopics}
                    onChange={e => setProfile(prev => ({ ...prev, contentTopics: e.target.value }))}
                    placeholder="Behind the scenes of our baking process, seasonal specials, coffee tips, local community events, new menu items, customer shoutouts, and health benefits of sourdough."
                    className="w-full bg-black/40 border border-white/8 rounded-xl px-3 py-3 text-white text-sm min-h-[70px] resize-none placeholder:text-white/20 focus:outline-none focus:border-amber-500/40"
                  />
                </div>
              </div>
            </div>

            {/* Short Video Toggle — Pro+ */}
            <div className="bg-white/3 border border-white/8 rounded-2xl p-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-purple-500/15 border border-purple-500/20 rounded-xl flex items-center justify-center">
                    <span className="text-base">🎬</span>
                  </div>
                  <div>
                    <h3 className="font-bold text-white flex items-center gap-2">
                      Short Video / Reels
                      {!(activePlan === 'pro' || activePlan === 'agency') && (
                        <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/20 px-2 py-0.5 rounded-full font-semibold">Pro</span>
                      )}
                    </h3>
                    <p className="text-xs text-white/30 mt-0.5">AI generates full video scripts, shot briefs & music mood for Reels alongside regular posts</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (!(activePlan === 'pro' || activePlan === 'agency')) { toast('Short Video posts require a Pro plan.', 'warning'); return; }
                    setProfile(prev => ({ ...prev, videoEnabled: !prev.videoEnabled }));
                    setIncludeVideos(prev => !prev);
                  }}
                  className={`relative w-12 h-6 rounded-full transition flex-shrink-0 ${
                    profile.videoEnabled && (activePlan === 'pro' || activePlan === 'agency')
                      ? 'bg-purple-500'
                      : 'bg-white/15'
                  } ${!(activePlan === 'pro' || activePlan === 'agency') ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${
                    profile.videoEnabled && (activePlan === 'pro' || activePlan === 'agency') ? 'left-7' : 'left-1'
                  }`} />
                </button>
              </div>
              {profile.videoEnabled && (activePlan === 'pro' || activePlan === 'agency') && (
                <div className="mt-4 bg-purple-500/8 border border-purple-500/15 rounded-xl px-4 py-3">
                  <p className="text-xs text-purple-300">🎬 Short videos are now included in your AI content calendar. Each Reel post includes a full script, shot-by-shot brief, and music recommendation that you can film with your phone.</p>
                </div>
              )}
            </div>

            {/* Facebook Connection */}
            <div className="bg-white/3 border border-white/8 rounded-2xl p-6 space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-500/15 border border-blue-500/20 rounded-xl flex items-center justify-center">
                  <Facebook size={16} className="text-blue-400" />
                </div>
                <div>
                  <h3 className="font-bold text-white">Social Media Connection</h3>
                  <p className="text-xs text-white/30 mt-0.5">Connect Facebook &amp; Instagram to enable auto-publishing</p>
                </div>
              </div>

              {/* ── Primary — Late (Facebook + Instagram, no App Review needed) ── */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-black bg-gradient-to-r from-blue-500 to-purple-500 text-white px-2 py-0.5 rounded-full">RECOMMENDED</span>
                  <span className="text-xs text-white/40">Facebook + Instagram in one click</span>
                </div>
                <LateConnectButton
                  profileId={lateProfileId}
                  connectedPlatforms={lateConnectedPlatforms}
                  businessName={profile.name}
                  onConnected={(pid, platforms) => {
                    setLateProfileId(pid);
                    setLateConnectedPlatforms(platforms);
                    if (user) {
                      updateDoc(doc(db, 'users', user.uid), { lateProfileId: pid, lateConnectedPlatforms: platforms }).catch(() =>
                        setDoc(doc(db, 'users', user.uid), { lateProfileId: pid, lateConnectedPlatforms: platforms }, { merge: true })
                      );
                    }
                    toast(`Connected to ${platforms.join(' & ')} successfully!`, 'success');
                  }}
                  onDisconnect={() => {
                    setLateProfileId('');
                    setLateConnectedPlatforms([]);
                    if (user) updateDoc(doc(db, 'users', user.uid), { lateProfileId: null, lateConnectedPlatforms: [] }).catch(() => {});
                    toast('Social accounts disconnected.', 'warning');
                  }}
                />
              </div>

              {/* ── Divider ── */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-white/5" />
                <span className="text-[11px] text-white/20">or connect Facebook only (manual)</span>
                <div className="flex-1 h-px bg-white/5" />
              </div>

              {/* Legacy — Facebook-only OAuth button */}
              <FacebookConnectButton
                connectedPageId={profile.facebookPageId}
                connectedPageName={profile.name !== CLIENT.defaultBusinessName ? profile.name : undefined}
                tokenNeverExpires={fbTokenNeverExpires}
                onConnected={(pageId, pageAccessToken, pageName, longLivedUserToken) => {
                  const permanent = !!longLivedUserToken;
                  setFbTokenNeverExpires(permanent);
                  setProfile(prev => ({
                    ...prev,
                    facebookPageId: pageId,
                    facebookPageAccessToken: pageAccessToken,
                    facebookConnected: true,
                    name: prev.name === CLIENT.defaultBusinessName ? pageName : prev.name,
                  }));
                  // Persist permanent token status + optional long-lived user token to Firestore
                  if (user) {
                    const extra = { fbTokenNeverExpires: permanent, ...(longLivedUserToken ? { fbLongLivedUserToken: longLivedUserToken } : {}) };
                    updateDoc(doc(db, 'users', user.uid), extra).catch(() =>
                      setDoc(doc(db, 'users', user.uid), extra, { merge: true })
                    );
                  }
                  toast(permanent ? `Connected to "${pageName}" with a permanent token ✓` : `Connected to "${pageName}"! Saving…`, 'success');
                  handleSaveFacebook();
                }}
                onDisconnect={() => {
                  setFbTokenNeverExpires(undefined);
                  setProfile(prev => ({
                    ...prev,
                    facebookPageId: '',
                    facebookPageAccessToken: '',
                    facebookConnected: false,
                  }));
                  if (user) updateDoc(doc(db, 'users', user.uid), { fbTokenNeverExpires: null, fbLongLivedUserToken: null }).catch(() => {});
                  toast('Facebook page disconnected.', 'warning');
                }}
              />

              {/* Fallback — manual token (collapsible) */}
              <details className="group">
                <summary className="text-xs text-white/20 hover:text-white/40 cursor-pointer list-none flex items-center gap-1.5 transition pt-1 border-t border-white/5">
                  <ChevronDown size={12} className="group-open:rotate-180 transition-transform" />
                  Connect manually with an access token instead
                </summary>
                <div className="mt-4 space-y-3">
                  {/* ── Option A: System User (permanent, recommended) ── */}
                  <div className="bg-emerald-500/5 border border-emerald-500/15 rounded-xl p-4 space-y-2">
                    <p className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">⭐ Recommended — Never-expiring System User token</p>
                    <ol className="text-xs text-white/35 space-y-1.5 list-decimal list-inside leading-relaxed">
                      <li>Go to <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noopener noreferrer" className="text-emerald-400/70 hover:text-emerald-400">Facebook Business Manager → System Users</a></li>
                      <li>Create a System User (role: <strong className="text-white/50">Admin</strong>)</li>
                      <li>Click <strong className="text-white/50">Add Assets</strong> → select your Facebook Page → give it <strong className="text-white/50">Full Control</strong></li>
                      <li>Click <strong className="text-white/50">Generate New Token</strong> → select your App → tick <code className="bg-white/10 px-1 rounded">pages_manage_posts</code> <code className="bg-white/10 px-1 rounded">pages_read_engagement</code></li>
                      <li>Set expiry to <strong className="text-white/50">Never</strong> → copy and paste below</li>
                    </ol>
                  </div>

                  {/* ── Option B: Graph Explorer (quick, short-lived) ── */}
                  <div className="bg-blue-500/5 border border-blue-500/10 rounded-xl p-4 space-y-2">
                    <p className="text-xs font-semibold text-blue-300">Quick option — Graph Explorer token (expires in ~60 days)</p>
                    <ol className="text-xs text-white/35 space-y-1 list-decimal list-inside leading-relaxed">
                      <li>Go to <a href="https://developers.facebook.com/tools/explorer/" target="_blank" rel="noopener noreferrer" className="text-blue-400/70 hover:text-blue-400">Facebook Graph Explorer</a></li>
                      <li>Click <strong className="text-white/50">Generate Access Token</strong> → select your <strong className="text-white/50">Page</strong></li>
                      <li>Add: <code className="bg-white/10 px-1 rounded">pages_show_list</code> <code className="bg-white/10 px-1 rounded">pages_manage_posts</code> <code className="bg-white/10 px-1 rounded">pages_read_engagement</code></li>
                    </ol>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={profile.facebookPageAccessToken}
                      onChange={e => { setProfile(prev => ({ ...prev, facebookPageAccessToken: e.target.value })); setFbPages([]); setFbLookupError(''); }}
                      placeholder="EAAxxxxxxxx… paste token here"
                      className="flex-1 bg-black/40 border border-white/8 rounded-xl px-3 py-2.5 text-white font-mono text-xs placeholder:text-white/20 focus:outline-none focus:border-blue-500/40"
                    />
                    <button
                      onClick={handleFindPages}
                      disabled={isFindingPages || !profile.facebookPageAccessToken.trim()}
                      className="flex-shrink-0 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition flex items-center gap-2"
                    >
                      {isFindingPages ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                      {isFindingPages ? 'Searching…' : 'Find My Pages'}
                    </button>
                  </div>
                  {fbLookupError && (
                    <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{fbLookupError}</p>
                  )}
                  {fbPages.length > 0 && (
                    <div className="space-y-2">
                      {fbPages.map(page => (
                        <button key={page.id} type="button"
                          onClick={() => {
                            setProfile(prev => ({ ...prev, facebookPageId: page.id, facebookPageAccessToken: page.access_token || prev.facebookPageAccessToken, facebookConnected: true }));
                            if (user && typeof fbTokenNeverExpires === 'boolean') {
                              updateDoc(doc(db, 'users', user.uid), { fbTokenNeverExpires }).catch(() => {});
                            }
                            setFbPages([]);
                            toast(`Page "${page.name}" selected!`, 'success');
                          }}
                          className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/8 bg-white/3 hover:bg-white/5 hover:border-blue-500/30 transition text-left"
                        >
                          <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0"><Facebook size={13} className="text-blue-400" /></div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white truncate">{page.name}</p>
                            <p className="text-xs text-white/30">{page.id}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={handleSaveFacebook} disabled={isSavingFacebook}
                      className="bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-black font-bold px-4 py-2 rounded-xl text-sm transition flex items-center gap-2">
                      {isSavingFacebook ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                      {isSavingFacebook ? 'Saving…' : 'Save Credentials'}
                    </button>
                    {fbConnected && (
                      <button onClick={() => handlePullStats()} disabled={isPullingStats}
                        className="text-sm bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/20 px-4 py-2 rounded-xl flex items-center gap-2 transition disabled:opacity-50">
                        <RefreshCw size={14} className={isPullingStats ? 'animate-spin' : ''} />
                        {isPullingStats ? 'Testing…' : 'Test Connection'}
                      </button>
                    )}
                  </div>
                </div>
              </details>
            </div>

            {/* ── AI Analytics — Sotrender Page ID ── */}
            <div className="bg-white/3 border border-white/8 rounded-2xl p-5 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-500/10 border border-blue-500/20 rounded-xl flex items-center justify-center">
                  <BarChart3 size={16} className="text-blue-400" />
                </div>
                <div>
                  <h3 className="font-bold text-white">AI Analytics — Facebook Page ID</h3>
                  <p className="text-xs text-white/30 mt-0.5">Enables real-data insights by scanning your page's past posts via Sotrender</p>
                </div>
                {profile.sotrendPageId && (
                  <span className="ml-auto text-xs text-green-400 bg-green-500/10 border border-green-500/15 px-2.5 py-1 rounded-full flex items-center gap-1">
                    <CheckCircle size={11} /> Set
                  </span>
                )}
              </div>
              <p className="text-xs text-white/25 leading-relaxed">
                Find your Page ID: go to your Facebook page → <strong className="text-white/40">About</strong> → scroll to the bottom. It's a long number (e.g. <code className="bg-white/8 px-1.5 py-0.5 rounded text-white/50">123456789012345</code>).
              </p>
              <div className="flex gap-2 max-w-lg">
                <input
                  value={profile.sotrendPageId}
                  onChange={e => setProfile(prev => ({ ...prev, sotrendPageId: e.target.value }))}
                  placeholder="e.g. 123456789012345"
                  className="flex-1 bg-black/40 border border-white/8 rounded-xl px-3 py-2.5 text-white font-mono text-sm placeholder:text-white/20 focus:outline-none focus:border-blue-500/40 transition"
                />
                <button
                  onClick={handleSaveProfile}
                  disabled={isSavingProfile}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition flex items-center gap-2"
                >
                  {isSavingProfile ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save
                </button>
              </div>
            </div>

            {/* Your Plan */}
            <div className="bg-white/3 border border-white/8 rounded-2xl p-6 space-y-4">
              <h3 className="font-bold text-white flex items-center gap-2"><Zap size={16} className="text-amber-400" /> Your Plan</h3>
              {planCfg ? (
                <div className="flex items-start gap-4 flex-wrap">
                  <div className={`px-4 py-3 rounded-xl bg-gradient-to-br ${planCfg.color} bg-opacity-10`}>
                    <p className="text-xs text-white/50">Current plan</p>
                    <p className="text-xl font-black text-white">{planCfg.name}</p>
                    <p className="text-xs text-white/50">${planCfg.price}/month · {planCfg.postsPerWeek} posts/week</p>
                  </div>
                  <div className="flex-1 min-w-[200px] space-y-1.5">
                    {planCfg.features.slice(0, 4).map((f, i) => (
                      <p key={i} className="text-xs text-white/40 flex items-center gap-2"><CheckCircle size={11} className="text-green-400 shrink-0" /> {f}</p>
                    ))}
                  </div>
                  {activePlan !== 'pro' && (
                    <a
                      href={CLIENT.salesUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/20 text-amber-300 px-4 py-2 rounded-xl transition flex items-center gap-1.5 self-start"
                    >
                      <ArrowRight size={12} /> Upgrade Plan
                    </a>
                  )}
                </div>
              ) : null}
            </div>

            {/* Save All */}
            <div className="flex justify-end">
              <button
                onClick={handleSaveAll}
                disabled={isSavingAll}
                className="bg-gradient-to-r from-amber-500 to-orange-500 hover:opacity-90 disabled:opacity-60 text-black font-black px-8 py-3 rounded-2xl text-sm transition flex items-center gap-2 shadow-lg shadow-amber-500/20"
              >
                {isSavingAll ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                {isSavingAll ? 'Saving All…' : 'Save All Settings'}
              </button>
            </div>

            {/* Data */}
            <div className="bg-white/3 border border-white/8 rounded-2xl p-6 space-y-4">
              <h3 className="font-bold text-white">Data</h3>
              <div className="flex gap-3 flex-wrap">
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
                  className="bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 px-4 py-2 rounded-xl text-sm transition"
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
                  className="bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 px-4 py-2 rounded-xl text-sm transition"
                >
                  Clear All Posts
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-white/5 mt-12">
        <div className="max-w-6xl mx-auto px-4 py-5 flex items-center justify-between flex-wrap gap-3">
          <AppLogo size={44} />
          <div className="flex items-center gap-4 text-xs text-white/20">
            <a href={`mailto:${CLIENT.supportEmail}`} className="hover:text-white/40 transition">{CLIENT.supportEmail}</a>
            {CLIENT.poweredBy && (
              <a href={CLIENT.poweredByUrl || '#'} target="_blank" rel="noopener noreferrer" className="hover:text-white/40 transition">{CLIENT.poweredBy}</a>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
};

// ── Splash Screen ──
const SplashScreen: React.FC = () => {
  const LINES = [
    'Crafting your content strategy…',
    'Powering up the AI engine…',
    'Loading your social command centre…',
    'Syncing your business profile…',
    'Almost ready to grow your audience…',
  ];
  const [lineIdx, setLineIdx] = useState(0);
  const [dotCount, setDotCount] = useState(1);

  useEffect(() => {
    const t1 = setInterval(() => setLineIdx(i => (i + 1) % LINES.length), 1800);
    const t2 = setInterval(() => setDotCount(d => d < 3 ? d + 1 : 1), 500);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(245,158,11,0.12),transparent_65%)] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_80%,rgba(234,88,12,0.06),transparent_50%)] pointer-events-none" />

      {/* Pulsing ring behind logo */}
      <div className="relative mb-10">
        <div className="absolute inset-[-4px] rounded-3xl bg-amber-400/10 animate-ping" style={{ animationDuration: '2s' }} />
        <div className="absolute inset-[-12px] rounded-[32px] border border-amber-400/10 animate-pulse" />
        <AppLogo size={160} />
      </div>

      {/* Cycling status line */}
      <div className="h-6 flex items-center justify-center">
        <p className="text-sm text-white/30 transition-all duration-500">
          {LINES[lineIdx].replace('…', '.'.repeat(dotCount))}
        </p>
      </div>

      {/* Progress dots */}
      <div className="flex gap-2 mt-6">
        {[0, 1, 2, 3, 4].map(i => (
          <div
            key={i}
            className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
              i === lineIdx % 5 ? 'bg-amber-400 scale-125' : 'bg-white/10'
            }`}
          />
        ))}
      </div>

      {/* Footer */}
      <p className="absolute bottom-8 text-xs text-white/15">
        {CLIENT.poweredBy}
      </p>
    </div>
  );
};

// ── Auth Loading Gate ──
const AuthGate: React.FC = () => {
  const { loading } = useAuth();
  if (loading) return <SplashScreen />;
  return <Dashboard />;
};

// ── App Wrapper ──
const App: React.FC = () => (
  <ToastProvider>
    <AuthGate />
  </ToastProvider>
);

export default App;

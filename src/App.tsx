import React, { useState, useEffect, useRef } from 'react';
import { CLIENT } from './client.config';
import { ToastProvider, useToast } from './components/Toast';
import { SocialPost, BusinessProfile, ContentCalendarStats, PlanTier, SetupStatus, ClientWorkspace, SocialTokens, DEFAULT_SOCIAL_TOKENS, Campaign } from './types';
import { LandingPage } from './components/LandingPage';
import { SetupBanner } from './components/SetupBanner';
import { AuthScreen } from './components/AuthScreen';
import { AppLogo } from './components/AppLogo';
import { useAuth } from './contexts/AuthContext';
import { useDb } from './hooks/useDb';
import { ClientSwitcher } from './components/ClientSwitcher';
import { AccountPanel } from './components/AccountPanel';
import { PricingTable } from './components/PricingTable';
import { DashboardStats } from './components/DashboardStats';
import { AnimatedReelPreview } from './components/AnimatedReelPreview';
import { OnboardingWizard } from './components/OnboardingWizard';
import { ClientIntakeForm } from './components/ClientIntakeForm';
import { generateSocialPost, generateMarketingImage, analyzePostTimes, generateRecommendations, generateSmartSchedule, rewritePost, generateInsightReport, generateInsightReportFromPosts, generateVideoScript, InsightReport, SmartScheduledPost, VideoScript } from './services/gemini';
import { FacebookService } from './services/facebookService';
import { FalService } from './services/falService';
import { addAudioToVideo, trackUrlForMood } from './services/videoAudioService';
import { FacebookConnectButton } from './components/FacebookConnectButton';
import { CalendarGrid } from './components/CalendarGrid';
import { HomeDashboard } from './components/HomeDashboard';
import { DateTimePicker } from './components/DateTimePicker';
import { LivePostPreview } from './components/LivePostPreview';
import { AiEnginePanel } from './components/AiEnginePanel';
import {
  Sparkles, Settings, Calendar, BarChart3, Wand2, Image as ImageIcon,
  Send, Loader2, Plus, Edit2, Trash2, Facebook, Instagram, Clock,
  CheckCircle, ChevronDown, ChevronUp, Zap, Save, Eye, X, Brain, Upload,
  RefreshCw, Link2, Link2Off, TrendingUp, Users, Activity,
  Lightbulb, ArrowRight, MessageSquare, Info, LogOut, ClipboardList, ShoppingCart, Pencil, Play, ExternalLink,
  Key, EyeOff, Home, AlertCircle, Target, ChevronRight
} from 'lucide-react';

/** Expandable campaign card — extracted so useState works correctly inside .map() */
const CampaignCard: React.FC<{
  campaign: Campaign;
  onUpdate: (id: string, fields: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  onFieldChange: (id: string, field: string, value: unknown) => void;
}> = ({ campaign: c, onUpdate, onDelete, onFieldChange }) => {
  const [expanded, setExpanded] = useState(false);
  const daysToGo = Math.max(0, Math.ceil((new Date(c.endDate).getTime() - Date.now()) / 86400000));
  return (
    <div className="bg-amber-500/8 border border-amber-500/15 rounded-xl overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full px-4 py-3 flex items-center justify-between text-left">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
          <input
            value={c.name}
            onChange={(e) => onFieldChange(c.id, 'name', e.target.value)}
            onBlur={() => onUpdate(c.id, { name: c.name })}
            onClick={(e) => e.stopPropagation()}
            className="bg-transparent text-white text-sm font-bold border-none outline-none min-w-0 flex-1"
          />
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className="text-amber-400 text-xs font-bold">{daysToGo}d left</span>
          <ChevronRight size={13} className={`text-white/25 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-amber-500/10 pt-3 animate-fadeSlideDown">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-white/30 block mb-1">Start date</label>
              <input type="date" value={c.startDate} onChange={(e) => {
                onFieldChange(c.id, 'startDate', e.target.value);
                onUpdate(c.id, { startDate: e.target.value });
              }} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white" />
            </div>
            <div>
              <label className="text-[10px] text-white/30 block mb-1">End date</label>
              <input type="date" value={c.endDate} onChange={(e) => {
                onFieldChange(c.id, 'endDate', e.target.value);
                onUpdate(c.id, { endDate: e.target.value });
              }} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white" />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-white/30 block mb-1">What should the AI do?</label>
            <textarea
              value={c.rules}
              onChange={(e) => onFieldChange(c.id, 'rules', e.target.value)}
              onBlur={() => onUpdate(c.id, { rules: c.rules })}
              placeholder='e.g. Mention our 30% off winter sale in every post. Use urgency — "only X days left!" Target Gladstone locals.'
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/15 resize-none h-20"
            />
            <p className="text-[10px] text-white/15 mt-1">The AI will weave these rules + countdown language into every generated post.</p>
          </div>
          <div>
            <label className="text-[10px] text-white/30 block mb-1 flex items-center gap-1"><ImageIcon size={10} /> Image suggestions</label>
            <textarea
              value={(c as any).imageNotes || ''}
              onChange={(e) => onFieldChange(c.id, 'imageNotes', e.target.value)}
              onBlur={() => onUpdate(c.id, { imageNotes: (c as any).imageNotes })}
              placeholder='e.g. Show our winter sale banner, laptop with discount prices on screen, cozy office with Penny Wise branding. Avoid generic stock photos.'
              className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/15 resize-none h-16"
            />
            <p className="text-[10px] text-white/15 mt-1">Describes what campaign images should look like. The AI uses this for image prompts.</p>
          </div>
          <div className="flex items-center justify-between pt-1">
            <button onClick={() => onUpdate(c.id, { enabled: false })} className="text-[11px] text-white/25 hover:text-amber-400 transition">Pause</button>
            <button onClick={() => onDelete(c.id)} className="text-[11px] text-white/25 hover:text-red-400 transition flex items-center gap-1"><Trash2 size={10} /> Delete</button>
          </div>
        </div>
      )}
    </div>
  );
};

const DEFAULT_PROFILE: BusinessProfile = {
  name: CLIENT.defaultBusinessName,
  type: CLIENT.defaultBusinessType,
  description: CLIENT.defaultDescription,
  tone: CLIENT.defaultTone,
  location: CLIENT.defaultLocation,
  logoUrl: '',
  facebookAppId: '',
  targetAudience: '',
  uniqueValue: '',
  productsServices: '',
  socialGoal: '',
  contentTopics: '',
  videoEnabled: false,
};

const DEFAULT_STATS: ContentCalendarStats = {
  followers: 500,
  reach: 2000,
  engagement: 4.5,
  postsLast30Days: 8
};

// ── Dynamic Quick Starts based on business type ─────────
const getQuickStarts = (businessType: string, businessName: string) => {
  const t = (businessType || '').toLowerCase();
  const name = businessName || 'our business';

  // Food / Restaurant / Café / Food Truck / Catering / BBQ
  if (/food|restaurant|café|cafe|bistro|bakery|pizza|burger|bbq|barbecue|grill|meat|kitchen|catering|food.?truck|bar\b|pub\b|diner|sushi|taco|wing|fried|smoke/i.test(t)) return [
    { icon: '🔥', label: "Today's special", text: `Today's special at ${name} — here's what's on the grill right now and why you need to try it before it's gone.` },
    { icon: '📍', label: 'Where to find us', text: `Here's where you can find ${name} today — our location, hours, and what's on the menu.` },
    { icon: '🍖', label: 'Menu spotlight', text: `Let's talk about our most popular menu item — what makes it special and why customers keep coming back for it.` },
    { icon: '🎬', label: 'Behind the grill', text: `A look behind the scenes at ${name} — how we prep, cook, and serve up our signature dishes.` },
    { icon: '⭐', label: 'Customer fave', text: `One of our regulars just said this about ${name} — here's what they love and why they keep coming back.` },
    { icon: '🎉', label: 'Catering / events', text: `Did you know ${name} does catering? Here's how we can make your next event unforgettable.` },
  ];

  // Tech / IT / Software / Web / Digital
  if (/tech|it\b|software|web|digital|computer|cyber|cloud|data|network|repair|support|managed|saas|app\b|developer/i.test(t)) return [
    { icon: '🛡️', label: 'Security tip', text: `A quick cybersecurity tip that could protect your business today — most people overlook this.` },
    { icon: '💡', label: 'Tech tip', text: `Here's a tech tip that saves our clients hours every week — and it only takes 2 minutes to set up.` },
    { icon: '🔧', label: 'Problem solved', text: `A client came to us with a tech issue that was costing them time and money — here's how we fixed it.` },
    { icon: '📊', label: 'Did you know?', text: `Most small businesses don't realise this about their IT setup — here's what we see all the time.` },
    { icon: '⭐', label: 'Client story', text: `One of our clients just had a huge win after we helped them with their tech setup — here's what happened.` },
    { icon: '📣', label: 'New service', text: `We just added a new service at ${name} — and it's going to be a game-changer for small businesses.` },
  ];

  // Beauty / Hair / Salon / Spa / Nails
  if (/beauty|hair|salon|spa|nail|lash|brow|skin|facial|barber|makeup|cosmetic|aesthetic|wax/i.test(t)) return [
    { icon: '✨', label: 'Transformation', text: `Before and after — check out this incredible transformation we did at ${name} this week.` },
    { icon: '💇', label: 'Style trend', text: `This style is trending right now and our clients are loving it — here's why you should try it.` },
    { icon: '🎉', label: 'Special offer', text: `Book this week and get something special — here's our current offer at ${name}.` },
    { icon: '💡', label: 'Care tip', text: `A quick tip to keep your look fresh between appointments — most people get this wrong.` },
    { icon: '⭐', label: 'Happy client', text: `One of our clients just left us the nicest review — here's what they said about their experience at ${name}.` },
    { icon: '🎬', label: 'Behind the chair', text: `A peek behind the scenes at ${name} — watch this process from start to finish.` },
  ];

  // Fitness / Gym / Personal Training / Health
  if (/fitness|gym|train|workout|yoga|pilates|crossfit|health|wellness|coach|sport|martial|boxing|physio/i.test(t)) return [
    { icon: '💪', label: 'Workout tip', text: `Try this simple exercise change — it makes a massive difference and most people don't know about it.` },
    { icon: '🏆', label: 'Member win', text: `One of our members just hit an incredible milestone — here's their story and what they did differently.` },
    { icon: '🎬', label: 'Quick demo', text: `Watch this quick form breakdown — doing this exercise wrong is the #1 mistake we see.` },
    { icon: '🔥', label: 'Challenge', text: `Here's a quick fitness challenge you can do right now — tag a mate who needs this.` },
    { icon: '📅', label: 'Class schedule', text: `Here's what's on this week at ${name} — these classes are filling up fast.` },
    { icon: '💡', label: 'Nutrition tip', text: `A simple nutrition hack that our members swear by — it takes 5 minutes and changes everything.` },
  ];

  // Retail / Shop / Store / E-commerce
  if (/retail|shop|store|boutique|e.?commerce|online.?store|fashion|cloth|apparel|jewel|gift|home.?decor|furniture/i.test(t)) return [
    { icon: '🔥', label: 'Flash sale', text: `Flash sale at ${name} — these deals won't last. Here's what's on offer right now.` },
    { icon: '🆕', label: 'New arrival', text: `Just landed at ${name} — our newest arrivals are here and they're selling fast.` },
    { icon: '⭐', label: 'Best seller', text: `Our #1 best seller this month — here's why customers can't stop buying it.` },
    { icon: '🎁', label: 'Gift guide', text: `Looking for the perfect gift? Here are our top picks from ${name} that people actually love.` },
    { icon: '📣', label: 'Restock alert', text: `It's back in stock! This sold out last time — grab it before it's gone again.` },
    { icon: '🎬', label: 'Unboxing', text: `Unboxing our latest shipment at ${name} — here's a first look at what just arrived.` },
  ];

  // Trades / Construction / Plumbing / Electrical / Building
  if (/trade|plumb|electric|build|construct|roofing|painting|carpenter|handyman|landscap|clean|mow|hvac|air.?con|solar|renovat/i.test(t)) return [
    { icon: '🔧', label: 'Job spotlight', text: `Check out this job we just completed — before and after photos that speak for themselves.` },
    { icon: '💡', label: 'DIY tip', text: `Here's a quick DIY tip from our team — this could save you a call-out fee.` },
    { icon: '⭐', label: 'Customer review', text: `Another 5-star review for ${name} — here's what our latest customer had to say.` },
    { icon: '📸', label: 'Before & after', text: `Before and after — look at the difference. This is what we do at ${name}.` },
    { icon: '⚠️', label: 'Common mistake', text: `The most common mistake homeowners make with this — and how to avoid costly repairs.` },
    { icon: '📣', label: 'Availability', text: `We have availability this week — if you've been putting off that job, now's the time. Book with ${name}.` },
  ];

  // Real Estate / Property
  if (/real.?estate|property|agent|rental|mortgage|home.?loan|invest|land|house|apartment|realty/i.test(t)) return [
    { icon: '🏠', label: 'New listing', text: `Just listed — check out this property and what makes it stand out in the current market.` },
    { icon: '📈', label: 'Market update', text: `Here's what's happening in the local property market right now — and what it means for buyers and sellers.` },
    { icon: '💡', label: 'Buyer tip', text: `A tip for anyone looking to buy — most people miss this and it costs them thousands.` },
    { icon: '🔑', label: 'Just sold', text: `Another one SOLD by ${name} — congratulations to the new owners!` },
    { icon: '⭐', label: 'Client story', text: `Our clients just found their dream home — here's how we helped them through the process.` },
    { icon: '📣', label: 'Open home', text: `Open for inspection this weekend — here's what's available and when you can come through.` },
  ];

  // Default / General — still contextual with business name
  return [
    { icon: '🔥', label: 'Special offer', text: `We've got something special on right now at ${name} — here's the deal and why you should jump on it.` },
    { icon: '🆕', label: 'What\'s new', text: `Exciting things happening at ${name} — here's what we've been working on and what's coming next.` },
    { icon: '🎬', label: 'Behind the scenes', text: `A behind-the-scenes look at how we do things at ${name} — here's what a typical day looks like.` },
    { icon: '⭐', label: 'Customer story', text: `A recent customer experience at ${name} — here's what happened and what they said about it.` },
    { icon: '💡', label: 'Quick tip', text: `Here's a useful tip related to what we do at ${name} — most people don't know this.` },
    { icon: '📣', label: 'Reminder', text: `A friendly reminder from ${name} — here's what you need to know this week.` },
  ];
};

// ── Autopilot draft persistence ─────────────────────────
const DRAFT_KEY_PREFIX = 'sai_autopilot_draft';
const DRAFT_MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours
// One-time migration: nuke ALL old drafts that were generated with corrupted profile data
// This version flag ensures it only runs once per browser
const DRAFT_MIGRATION_KEY = 'sai_draft_v3_migrated';
if (!localStorage.getItem(DRAFT_MIGRATION_KEY)) {
  try {
    // Clear ALL draft keys (global + any per-client) since old drafts had wrong profile data
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(DRAFT_KEY_PREFIX)) keysToRemove.push(k);
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
    // Also clear cached profile that may have wrong agency data
    localStorage.removeItem('sai_profile');
    localStorage.setItem(DRAFT_MIGRATION_KEY, '1');
    console.log('[Draft Migration] Cleared', keysToRemove.length, 'old draft(s) and cached profile');
  } catch {}
}
const getDraftKey = (clientId: string | null) => clientId ? `${DRAFT_KEY_PREFIX}_${clientId}` : DRAFT_KEY_PREFIX;
const readDraft = (clientId?: string | null): { posts: any[]; strategy: string; savedAt: number; mode: string; platform: string } | null => {
  try {
    const key = getDraftKey(clientId ?? null);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d?.posts?.length || Date.now() - (d.savedAt || 0) > DRAFT_MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return d;
  } catch { return null; }
};
const saveDraft = (posts: any[], strategy: string, mode: string, platform: string, clientId?: string | null) => {
  try {
    const key = getDraftKey(clientId ?? null);
    localStorage.setItem(key, JSON.stringify({ posts, strategy, savedAt: Date.now(), mode, platform }));
  } catch {}
};
const clearDraft = (clientId?: string | null) => {
  try {
    const key = getDraftKey(clientId ?? null);
    localStorage.removeItem(key);
    // Also clear legacy global key if it exists
    localStorage.removeItem(DRAFT_KEY_PREFIX);
  } catch {}
};

type AutopilotMode = 'smart' | 'saturation' | 'quick24h' | 'highlights';

// ── Main Dashboard ──────────────────────────────────────
const Dashboard: React.FC = () => {
  const { toast } = useToast();
  const { user, userDoc, loading, logIn, logOut, refreshUserDoc, authMode, portalClientId } = useAuth();
  const db = useDb();
  const [activeTab, setActiveTab] = useState<'home' | 'calendar' | 'smart' | 'insights' | 'settings' | 'clients'>('home');
  const [smartSubMode, setSmartSubMode] = useState<'autopilot' | 'quickpost'>('autopilot');
  const [profileExpanded, setProfileExpanded] = useState(false);
  const [showLanding, setShowLanding] = useState(() => CLIENT.clientMode ? false : !user);
  const [autoLoginPending, setAutoLoginPending] = useState(false);

  useEffect(() => { document.title = CLIENT.appName; }, []);

  const handlePlanActivated = async (planId: string) => {
    setActivePlan(planId as PlanTier);
    setSetupStatus('ordered');
    setShowPricing(false);
    if (user) {
      await db.upsertUser({ plan: planId, setupStatus: 'ordered' }).catch(() => {});
    }
  };

  // Profile & Posts — init from localStorage cache for instant render
  const [profile, setProfile] = useState<BusinessProfile>(() => {
    // In portal/client mode, NEVER use cached localStorage — always start with CLIENT defaults
    if (CLIENT.clientMode) return DEFAULT_PROFILE;
    try {
      const s = localStorage.getItem('sai_profile');
      if (s) {
        const p = { ...DEFAULT_PROFILE, ...JSON.parse(s) };
        // Migrate old default name to current default
        if (p.name === 'My Business') { p.name = CLIENT.defaultBusinessName; localStorage.setItem('sai_profile', JSON.stringify(p)); }
        return p;
      }
      return DEFAULT_PROFILE;
    } catch { return DEFAULT_PROFILE; }
  });
  const [posts, setPosts] = useState<SocialPost[]>(() => {
    if (CLIENT.clientMode) return []; // Portal mode — don't load cached agency posts
    try { const s = localStorage.getItem('sai_posts'); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const [stats, setStats] = useState<ContentCalendarStats>(() => {
    try { const s = localStorage.getItem('sai_stats'); return s ? { ...DEFAULT_STATS, ...JSON.parse(s) } : DEFAULT_STATS; } catch { return DEFAULT_STATS; }
  });
  const [dbLoaded] = useState(true);
  const [d1SyncError, setD1SyncError] = useState<string | null>(null);

  // Onboarding wizard — auto-show for new users who haven't set up their profile
  const [showOnboarding, setShowOnboarding] = useState(false);
  const isProfileBlank = (
    (profile.name === CLIENT.defaultBusinessName || !profile.name) &&
    !profile.description &&
    !localStorage.getItem('sai_onboarding_done')
  );

  const [showAccount, setShowAccount] = useState(false);
  const [showPricing, setShowPricing] = useState(false);
  const [showIntakeForm, setShowIntakeForm] = useState(false);
  const [intakeFormDone, setIntakeFormDone] = useState(false);
  const [videoScriptModal, setVideoScriptModal] = useState<{ hookText: string; script?: string; shots?: string; mood?: string; imageUrl?: string; imagePrompt?: string } | null>(null);
  const [videoModalGenerating, setVideoModalGenerating] = useState(false);
  const [videoModalProgress, setVideoModalProgress] = useState(0);
  const [videoModalUrl, setVideoModalUrl] = useState<string | null>(null);
  const [videoModalError, setVideoModalError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptProgress, setAcceptProgress] = useState(0);
  const [acceptSaved, setAcceptSaved] = useState(0);
  const [isScanningPosts, setIsScanningPosts] = useState(false);
  const [agencyBillingUrl, setAgencyBillingUrl] = useState('');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [portalContent, setPortalContent] = useState<{ hero_title: string; hero_subtitle: string; hero_cta_text: string }>({ hero_title: '', hero_subtitle: '', hero_cta_text: '' });

  // Cache agency profile name for display
  const agencyNameRef = useRef(CLIENT.defaultBusinessName);
  // Track workspace switches to prevent persistence writing client data to agency doc
  const prevClientIdRef = useRef<string | null | undefined>(undefined);
  // Block profile/stats persistence until D1 initial sync + workspace loads have completed
  const isSyncingRef = useRef(true);

  // Social tokens — loaded from D1, NEVER cached in localStorage
  const [socialTokens, setSocialTokens] = useState<SocialTokens>(DEFAULT_SOCIAL_TOKENS);
  const saveSocialTokens = (tokens: SocialTokens) => {
    setSocialTokens(tokens);
    db.setSocialTokens(tokens as unknown as Record<string, unknown>, activeClientId).catch(() => {
      toast('Facebook token could not be saved — check VITE_AI_WORKER_URL is set in CF Pages.', 'error');
    });
  };

  // Agency client workspaces
  const [clients, setClients] = useState<ClientWorkspace[]>([]);
  const [activeClientId, setActiveClientId] = useState<string | null>(null);

  // In portal mode, auto-select the client workspace that belongs to this portal
  useEffect(() => {
    if (authMode === 'portal' && portalClientId && activeClientId === null) {
      setActiveClientId(portalClientId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authMode, portalClientId]);

  const [clientHealthMap, setClientHealthMap] = useState<Record<string, { scheduledCount: number; lastPostAt: string | null }>>({});
  const [portalInputs, setPortalInputs] = useState<Record<string, { slug: string; email: string; password: string; showPw: boolean; saving: boolean }>>({});

  // Helpers: update the active workspace (own user doc or client doc)
  const upsertActiveWorkspace = (fields: Record<string, unknown>) =>
    activeClientId ? db.updateClient(activeClientId, fields) : db.upsertUser(fields);

  // Sync D1 in background (non-blocking)
  useEffect(() => {
    if (!user) return;
    isSyncingRef.current = true;
    const sync = async () => {
      try {
        // In clientMode, never grant agency/admin powers — the branded site is a locked-down client view
        const isAdmin = !CLIENT.clientMode && !!user.email && CLIENT.adminEmails.some(e => e === user.email);
        if (isAdmin) {
          localStorage.setItem('sai_admin', '1');
          setActivePlan('agency');
          setSetupStatus('live');
          db.upsertUser({ plan: 'agency', setupStatus: 'live', isAdmin: true }).catch(() => {});
        }
        setD1SyncError(null); // Clear any previous error — Worker is reachable
        const row = await db.getUser();
        if (!row && isAdmin) {
          // Brand-new D1 row — clear any stale localStorage profile contamination
          const fresh = { ...DEFAULT_PROFILE, name: CLIENT.defaultBusinessName };
          setProfile(fresh);
          localStorage.setItem('sai_profile', JSON.stringify(fresh));
          localStorage.removeItem('sai_posts');
          setPosts([]);
        }
        if (row) {
          const profile_raw = row.profile;
          const d = {
            profile: typeof profile_raw === 'string' ? JSON.parse(profile_raw) : (profile_raw ?? {}),
            stats: typeof row.stats === 'string' ? JSON.parse(row.stats as string) : (row.stats ?? {}),
            plan: row.plan,
            setupStatus: row.setup_status,
            falApiKey: row.fal_api_key,
            isAdmin: !!row.is_admin,
            onboardingDone: !!row.onboarding_done,
            intakeFormDone: !!row.intake_form_done,
            agencyBillingUrl: row.agency_billing_url,
            insightReport: row.insight_report ? (typeof row.insight_report === 'string' ? JSON.parse(row.insight_report as string) : row.insight_report) : null,
          };
          // In portal mode, skip user-level profile/stats/tokens — the client workspace effect handles those
          if (authMode !== 'portal') {
            if (d.profile && Object.keys(d.profile).length) {
              const p = { ...DEFAULT_PROFILE, ...d.profile };
              if (p.name === 'My Business') p.name = CLIENT.defaultBusinessName;
              // Strip deprecated token fields before caching in localStorage
              const { facebookPageId: _fpid, facebookPageAccessToken: _fpat, facebookConnected: _fc, instagramBusinessAccountId: _ig, ...safeProfile } = p;
              setProfile(p); localStorage.setItem('sai_profile', JSON.stringify(safeProfile));
              agencyNameRef.current = p.name;
            } else if (isAdmin) {
              // D1 has no profile yet — clear any stale localStorage (e.g. from a previous client session)
              const fresh = { ...DEFAULT_PROFILE, name: CLIENT.defaultBusinessName };
              setProfile(fresh);
              localStorage.setItem('sai_profile', JSON.stringify(fresh));
              agencyNameRef.current = CLIENT.defaultBusinessName;
            }
            // Load social tokens from dedicated D1 column (separate from profile blob)
            try {
              const rawTokens = await db.getSocialTokens(null);
              if (rawTokens && Object.keys(rawTokens).length) {
                setSocialTokens({ ...DEFAULT_SOCIAL_TOKENS, ...rawTokens } as SocialTokens);
              }
            } catch { /* tokens will remain as defaults */ }
            if (d.stats && Object.keys(d.stats).length) { const st = { ...DEFAULT_STATS, ...d.stats }; setStats(st); localStorage.setItem('sai_stats', JSON.stringify(st)); }
          }
          if (!isAdmin && d.plan) setActivePlan(d.plan as PlanTier);
          if (!isAdmin && d.setupStatus) setSetupStatus(d.setupStatus as SetupStatus);
          if (d.falApiKey) { localStorage.setItem('sai_fal_key', d.falApiKey); setFalApiKey(d.falApiKey); }
          if (d.isAdmin) localStorage.setItem('sai_admin', '1');
          if (d.onboardingDone) localStorage.setItem('sai_onboarding_done', '1');
          if (d.intakeFormDone) setIntakeFormDone(true);
          if (d.agencyBillingUrl) setAgencyBillingUrl(d.agencyBillingUrl);
          if (d.insightReport) {
            setInsightReport(d.insightReport as InsightReport);
            const ageMs = Date.now() - new Date((d.insightReport as InsightReport).generatedAt).getTime();
            if (ageMs > 24 * 60 * 60 * 1000) setInsightStale(true);
          } else {
            setInsightStale(true);
          }
        }
        // Check for pending PayPal activation
        if (!isAdmin && !row?.plan) {
          const pending = await db.getActivation(user.email);
          if (pending && !pending.consumed) {
            setActivePlan(pending.plan as PlanTier);
            setSetupStatus('live');
            await db.upsertUser({ plan: pending.plan, setupStatus: 'live', email: user.email, paypalSubscriptionId: pending.paypal_subscription_id || null });
            await db.consumeActivation(pending.id as string);
          }
        }
        // Check for pending PayPal cancellation
        if (!isAdmin) {
          const cancel = await db.getCancellation(user.email);
          if (cancel && !cancel.consumed) {
            setActivePlan(null);
            setSetupStatus('cancelled');
            await db.upsertUser({ plan: null, setupStatus: 'cancelled' });
            await db.consumeCancellation(cancel.id as string);
          }
        }
        // Load agency clients
        const loadedClients = await db.getClients();
        setClients(loadedClients.map(c => ({
          id: c.id, name: c.name, businessType: c.business_type ?? '', createdAt: c.created_at ?? '',
          plan: c.plan as PlanTier | undefined, clientSlug: c.client_slug ?? undefined,
        } as ClientWorkspace)));
        // Load posts for own workspace — skip in portal mode (client workspace effect handles posts)
        if (authMode !== 'portal') {
          const loadedPosts = await db.getPosts();
          const loaded: SocialPost[] = loadedPosts.map(p => ({
            id: p.id, content: p.content, platform: p.platform as SocialPost['platform'],
            status: p.status as SocialPost['status'], scheduledFor: p.scheduled_for ?? '',
            hashtags: Array.isArray(p.hashtags) ? p.hashtags : [],
            image: p.image_url ?? undefined, topic: p.topic ?? undefined, pillar: p.pillar as SocialPost['pillar'] | undefined,
            imagePrompt: p.image_prompt ?? undefined, reasoning: p.reasoning ?? undefined,
            postType: p.post_type as SocialPost['postType'] ?? undefined,
            videoScript: p.video_script ?? undefined, videoShots: p.video_shots ?? undefined, videoMood: p.video_mood ?? undefined,
          }));
          setPosts(loaded);
          localStorage.setItem('sai_posts', JSON.stringify(loaded));
        }
        // Load campaigns
        try {
          const loadedCampaigns = await db.getCampaigns(null);
          setCampaigns(loadedCampaigns.map(c => ({
            id: c.id, name: c.name, type: (c.type || 'custom') as Campaign['type'],
            startDate: c.start_date || '', endDate: c.end_date || '',
            rules: c.rules || '', imageNotes: (c as any).image_notes || '', postsPerDay: c.posts_per_day || 1,
            enabled: !!c.enabled, createdAt: c.created_at || new Date().toISOString(),
          })));
        } catch { /* campaigns will remain empty */ }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('D1 sync error:', msg);
        if (msg.includes('localhost') || msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
          setD1SyncError('Cannot reach the API Worker. Check that VITE_AI_WORKER_URL is set in Cloudflare Pages env vars.');
        } else {
          setD1SyncError(msg);
        }
      } finally {
        isSyncingRef.current = false;
        // Auto-show onboarding for brand-new users after sync completes
        const done = !!localStorage.getItem('sai_onboarding_done');
        const hasProfile = !!localStorage.getItem('sai_profile');
        if (!done && !hasProfile) setShowOnboarding(true);
      }
    };
    sync();
  // Depend on user.uid only — the user object itself is memoized in AuthContext but
  // using the primitive uid prevents re-firing if the memo ever misses a reference change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  // ── Sync post statuses (cron handles missed-post detection now) ──
  const syncPostStatuses = async () => {
    // No-op: post status sync is handled by the cron worker
  };

  // Manual sync function for user-triggered refresh
  const handleManualSync = async () => {
    if (!fbConnected) {
      toast('Connect your Facebook page first', 'warning');
      return;
    }
    await syncPostStatuses();
  };

  // Detect overdue scheduled posts and mark them as 'Missed'
  useEffect(() => {
    if (!user || posts.length === 0) return;
    const now = new Date();
    // Give 10 minutes grace period after scheduled time
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
    // Only mark as missed if scheduled time was more than 10 minutes ago
    const overdue = posts.filter(p => 
      p.status === 'Scheduled' && 
      new Date(p.scheduledFor) < tenMinAgo
    );
    
    if (overdue.length > 0) {
      console.log(`[MISSED] Marking ${overdue.length} posts as missed (scheduled > 10 min ago)`);
      db.bulkUpdatePostStatus(overdue.map(p => p.id), 'Missed').catch(() => {});
      setPosts(prev => prev.map(p => overdue.find(o => o.id === p.id) ? { ...p, status: 'Missed' as const } : p));
    }
  }, [posts, user, activeClientId]);

  // ── Facebook token health check — detect expired/expiring tokens on load ──
  useEffect(() => {
    if (!user || !socialTokens.facebookPageAccessToken) return;
    const checkToken = async () => {
      try {
        const res = await fetch(`https://graph.facebook.com/v21.0/me?fields=id&access_token=${encodeURIComponent(socialTokens.facebookPageAccessToken)}`);
        const data = await res.json();
        if (data.error) {
          const msg = data.error.message || '';
          if (msg.includes('expired') || msg.includes('Invalid') || data.error.code === 190) {
            toast('Your Facebook token has expired. Go to Settings → Facebook and reconnect to keep posts publishing.', 'error');
          }
        }
      } catch { /* network error — skip silently */ }
    };
    checkToken();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, socialTokens.facebookPageAccessToken]);

  // Load health metrics (last post + scheduled count) when Clients tab is active
  useEffect(() => {
    if (activeTab !== 'clients' || !user || clients.length === 0) return;
    const loadHealth = async () => {
      const health: Record<string, { scheduledCount: number; lastPostAt: string | null }> = {};
      await Promise.all(clients.map(async c => {
        try {
          const clientPosts = await db.getClientPostHealth(c.id);
          health[c.id] = {
            scheduledCount: clientPosts.filter(p => p.status !== 'Posted').length,
            lastPostAt: (clientPosts[0]?.scheduled_for) ?? null,
          };
        } catch { health[c.id] = { scheduledCount: 0, lastPostAt: null }; }
      }));
      setClientHealthMap(health);
    };
    loadHealth();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, user, clients.length]);

  // Reload profile+posts+tokens when switching client workspace
  useEffect(() => {
    if (!user || activeClientId === null) return;
    let isMounted = true;
    const loadClient = async () => {
      isSyncingRef.current = true;
      // Resolve workspace name/type before try so catch block can use them
      const ws = clients.find(c => c.id === activeClientId);
      const wsName = ws?.name || CLIENT.defaultBusinessName;
      const wsType = ws?.businessType || CLIENT.defaultBusinessType;
      try {
        const clientRow = await db.getClient(activeClientId);
        if (!isMounted) return;
        if (clientRow) {
          const cp = { ...DEFAULT_PROFILE, name: wsName, type: wsType, ...(clientRow.profile || {}) };
          if (!clientRow.profile || !(clientRow.profile as Record<string,unknown>).name || (clientRow.profile as Record<string,unknown>).name === CLIENT.defaultBusinessName || (clientRow.profile as Record<string,unknown>).name === 'My Business') cp.name = wsName;
          if (!clientRow.profile || !(clientRow.profile as Record<string,unknown>).type || (clientRow.profile as Record<string,unknown>).type === CLIENT.defaultBusinessType) cp.type = wsType;
          setProfile(cp);
          if (clientRow.stats && Object.keys(clientRow.stats).length) setStats({ ...DEFAULT_STATS, ...clientRow.stats });
          else setStats(DEFAULT_STATS);
          if (clientRow.insightReport) {
            setInsightReport(clientRow.insightReport as InsightReport);
            const ageMs = Date.now() - new Date((clientRow.insightReport as InsightReport).generatedAt).getTime();
            setInsightStale(ageMs > 24 * 60 * 60 * 1000);
          } else {
            setInsightReport(null);
            setInsightStale(true);
          }
        } else {
          setProfile({ ...DEFAULT_PROFILE, name: wsName, type: wsType });
          setStats(DEFAULT_STATS);
          setInsightReport(null);
          setInsightStale(true);
        }
        // Load social tokens for this client workspace
        try {
          const rawTokens = await db.getSocialTokens(activeClientId);
          setSocialTokens(rawTokens && Object.keys(rawTokens).length ? { ...DEFAULT_SOCIAL_TOKENS, ...rawTokens } as SocialTokens : DEFAULT_SOCIAL_TOKENS);
        } catch { setSocialTokens(DEFAULT_SOCIAL_TOKENS); }
        const clientPosts = await db.getPosts(activeClientId);
        setPosts(clientPosts.map(p => ({ id: p.id, content: p.content, platform: p.platform as SocialPost['platform'], status: p.status as SocialPost['status'], scheduledFor: p.scheduled_for ?? '', hashtags: Array.isArray(p.hashtags) ? p.hashtags : [], image: p.image_url ?? undefined, topic: p.topic ?? undefined, pillar: p.pillar as SocialPost['pillar'] | undefined, imagePrompt: p.image_prompt ?? undefined, reasoning: p.reasoning ?? undefined, postType: p.post_type as SocialPost['postType'] ?? undefined, videoScript: p.video_script ?? undefined, videoShots: p.video_shots ?? undefined, videoMood: p.video_mood ?? undefined })));
        // Load campaigns for this client workspace
        try {
          const loadedCampaigns = await db.getCampaigns(activeClientId);
          setCampaigns(loadedCampaigns.map(c => ({
            id: c.id, name: c.name, type: (c.type || 'custom') as Campaign['type'],
            startDate: c.start_date || '', endDate: c.end_date || '',
            rules: c.rules || '', imageNotes: (c as any).image_notes || '', postsPerDay: c.posts_per_day || 1,
            enabled: !!c.enabled, createdAt: c.created_at || new Date().toISOString(),
          })));
        } catch { setCampaigns([]); }
      } catch (e) {
        console.warn('Client load error:', e);
        setProfile({ ...DEFAULT_PROFILE, name: wsName, type: wsType });
        setStats(DEFAULT_STATS);
        setSocialTokens(DEFAULT_SOCIAL_TOKENS);
        setPosts([]);
        if (isSuperAdmin) toast('Could not load client workspace from database — check VITE_AI_WORKER_URL is set in CF Pages.', 'error');
      }
      finally { if (isMounted) isSyncingRef.current = false; }
    };
    loadClient();
    return () => { isMounted = false; };
  }, [activeClientId, user?.uid]);

  // Load portal branding content when active client changes
  useEffect(() => {
    const client = clients.find(c => c.id === activeClientId);
    if (client?.clientSlug) {
      db.getPortalContent(client.clientSlug).then(setPortalContent).catch(() => {});
    } else {
      setPortalContent({ hero_title: '', hero_subtitle: '', hero_cta_text: '' });
    }
  }, [activeClientId, clients]);

  // Restore own workspace (profile, posts, tokens) when switching back from a client
  useEffect(() => {
    if (!user || activeClientId !== null || authMode === 'portal') return;
    let isMounted = true;
    setSocialTokens(DEFAULT_SOCIAL_TOKENS); // Reset tokens until own workspace loads from D1
    isSyncingRef.current = true;
    const restoreOwn = async () => {
      const row = await db.getUser();
      if (!isMounted) return;
      if (row) {
        const rp = typeof row.profile === 'string' ? JSON.parse(row.profile) : (row.profile ?? {});
        const rs = typeof row.stats === 'string' ? JSON.parse(row.stats as string) : (row.stats ?? {});
        if (rp && Object.keys(rp).length) { const p = { ...DEFAULT_PROFILE, ...rp }; setProfile(p); localStorage.setItem('sai_profile', JSON.stringify(p)); }
        if (rs && Object.keys(rs).length) { const st = { ...DEFAULT_STATS, ...rs }; setStats(st); localStorage.setItem('sai_stats', JSON.stringify(st)); }
        const ir = row.insight_report ? (typeof row.insight_report === 'string' ? JSON.parse(row.insight_report as string) : row.insight_report) : null;
        if (ir) {
          setInsightReport(ir as InsightReport);
          const ageMs = Date.now() - new Date((ir as InsightReport).generatedAt).getTime();
          setInsightStale(ageMs > 24 * 60 * 60 * 1000);
        } else {
          setInsightReport(null);
          setInsightStale(true);
        }
      }
      // Restore own social tokens from dedicated D1 column
      try {
        const rawTokens = await db.getSocialTokens(null);
        setSocialTokens(rawTokens && Object.keys(rawTokens).length ? { ...DEFAULT_SOCIAL_TOKENS, ...rawTokens } as SocialTokens : DEFAULT_SOCIAL_TOKENS);
      } catch { setSocialTokens(DEFAULT_SOCIAL_TOKENS); }
      const ownPosts = await db.getPosts();
      const loaded: SocialPost[] = ownPosts.map(p => ({ id: p.id, content: p.content, platform: p.platform as SocialPost['platform'], status: p.status as SocialPost['status'], scheduledFor: p.scheduled_for ?? '', hashtags: Array.isArray(p.hashtags) ? p.hashtags : [], image: p.image_url ?? undefined, topic: p.topic ?? undefined, pillar: p.pillar as SocialPost['pillar'] | undefined, imagePrompt: p.image_prompt ?? undefined, reasoning: p.reasoning ?? undefined, postType: p.post_type as SocialPost['postType'] ?? undefined, videoScript: p.video_script ?? undefined, videoShots: p.video_shots ?? undefined, videoMood: p.video_mood ?? undefined }));
      setPosts(loaded);
      localStorage.setItem('sai_posts', JSON.stringify(loaded));
      // Load campaigns for own workspace
      try {
        const loadedCampaigns = await db.getCampaigns(null);
        setCampaigns(loadedCampaigns.map(c => ({
          id: c.id, name: c.name, type: (c.type || 'custom') as Campaign['type'],
          startDate: c.start_date || '', endDate: c.end_date || '',
          rules: c.rules || '', imageNotes: (c as any).image_notes || '', postsPerDay: c.posts_per_day || 1,
          enabled: !!c.enabled, createdAt: c.created_at || new Date().toISOString(),
        })));
      } catch { setCampaigns([]); }
    };
    restoreOwn().catch(() => {}).finally(() => { if (isMounted) isSyncingRef.current = false; });
    return () => { isMounted = false; };
  }, [activeClientId, user?.uid]);

  // Add a new client workspace
  const addClient = async (name: string, businessType: string) => {
    if (!user) return;
    if (activePlan !== 'agency' && !isAdminMode) { toast('Client workspaces require an Agency plan.', 'warning'); return; }
    if (clients.length >= agencyClientLimit) {
      toast(`You have reached the ${agencyClientLimit}-client limit on the Agency plan.`, 'warning'); return;
    }
    const newClient: Omit<ClientWorkspace, 'id'> = { name, businessType, createdAt: new Date().toISOString() };
    const newId = await db.createClient({ name, businessType, createdAt: newClient.createdAt });
    const created: ClientWorkspace = { id: newId, ...newClient };
    setClients(prev => [...prev, created]);
    setActiveClientId(newId);
    toast(`Client "${name}" added!`, 'success');
  };

  // Rename a client workspace
  const renameClient = async (clientId: string, name: string, businessType: string) => {
    if (!user) return;
    await db.updateClient(clientId, { name, businessType });
    setClients(prev => prev.map(c => c.id === clientId ? { ...c, name, businessType } : c));
    toast('Client updated.', 'success');
  };

  // Set plan tier for a client workspace
  const [savingClientPlan, setSavingClientPlan] = useState<string | null>(null);
  const setClientPlan = async (clientId: string, plan: PlanTier) => {
    if (!user) return;
    setSavingClientPlan(plan);
    try {
      await db.updateClient(clientId, { plan });
      setClients(prev => prev.map(c => c.id === clientId ? { ...c, plan } : c));
      toast(`Client plan updated to ${plan.charAt(0).toUpperCase() + plan.slice(1)}!`, 'success');
    } catch (e: any) {
      toast(`Failed to update plan: ${e?.message || 'Unknown error'}`, 'error');
    }
    setSavingClientPlan(null);
  };

  // Delete a client workspace (including all posts)
  const deleteClient = async (clientId: string) => {
    if (!user) return;
    try {
      await db.deleteClient(clientId);
      setClients(prev => prev.filter(c => c.id !== clientId));
      if (activeClientId === clientId) { setActiveClientId(null); setPosts([]); }
      toast('Client and all their data removed.', 'success');
    } catch (e) { toast('Failed to delete client.', 'error'); }
  };

  // Persist profile to D1 (debounced) — blocked during initial sync and workspace switches
  useEffect(() => {
    if (!user || !dbLoaded || isSyncingRef.current) return;
    if (prevClientIdRef.current !== activeClientId) {
      prevClientIdRef.current = activeClientId;
      return;
    }
    const t = setTimeout(() => {
      if (isSyncingRef.current) return; // double-check after debounce delay
      // SAFEGUARD: If we're in a client workspace, verify the profile belongs to this client
      // Prevents agency profile from accidentally overwriting client profiles during workspace switches
      if (activeClientId) {
        const client = clients.find(c => c.id === activeClientId);
        if (client) {
          // Block save if profile name doesn't match client name (fuzzy: ignore case/punctuation)
          const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
          const profileNorm = normName(profile.name || '');
          const clientNorm = normName(client.name || '');
          const defaultNorm = normName(CLIENT.defaultBusinessName);
          if (profileNorm && profileNorm !== clientNorm && profileNorm !== defaultNorm) {
            console.warn(`[Profile Save Guard] Blocked save — profile "${profile.name}" doesn't match client "${client.name}"`);
            return;
          }
          // Block save if profile type doesn't match the client's business type
          if (profile.type && client.businessType && normName(profile.type) !== normName(client.businessType)) {
            console.warn(`[Profile Save Guard] Blocked save — profile type "${profile.type}" doesn't match client type "${client.businessType}"`);
            return;
          }
        }
      }
      upsertActiveWorkspace({ profile }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [profile, user, dbLoaded, activeClientId]);

  // Persist stats to D1 — same guards as profile (debounced)
  useEffect(() => {
    if (!user || !dbLoaded || isSyncingRef.current) return;
    if (prevClientIdRef.current !== activeClientId) return;
    const t = setTimeout(() => {
      if (isSyncingRef.current) return;
      upsertActiveWorkspace({ stats }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [stats, user, dbLoaded, activeClientId]);

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
  const [contentType, setContentType] = useState<'text' | 'image' | 'video'>('text');
  const [contentFormat, setContentFormat] = useState<string>('standard');
  const [lastImagePrompt, setLastImagePrompt] = useState<string>('');
  const [generatedVideoScript, setGeneratedVideoScript] = useState<VideoScript | null>(null);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [showVideoBriefDetail, setShowVideoBriefDetail] = useState(false);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [isGeneratingReel, setIsGeneratingReel] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [publishSuccess, setPublishSuccess] = useState(false);
  const [publishingPlatforms, setPublishingPlatforms] = useState<string[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [rewriteInstruction, setRewriteInstruction] = useState('');
  const [isRewriting, setIsRewriting] = useState(false);

  // Smart Schedule State — restored from localStorage draft if browser crashed before accepting
  const [_initialDraft] = useState(() => readDraft(null)); // reads localStorage exactly once (own workspace draft)
  const [smartPosts, setSmartPosts] = useState<SmartScheduledPost[]>(_initialDraft?.posts ?? []);
  const [smartStrategy, setSmartStrategy] = useState(_initialDraft?.strategy ?? '');
  const [draftRestoredAt, setDraftRestoredAt] = useState<number | null>(_initialDraft?.savedAt ?? null);
  const [isSmartGenerating, setIsSmartGenerating] = useState(false);
  const [autopilotMode, setAutopilotMode] = useState<AutopilotMode>('smart');
  const saturationMode = autopilotMode === 'saturation';
  const [smartCount, setSmartCount] = useState(7);
  const [includeVideos, setIncludeVideos] = useState(false);
  const [autopilotPlatform, setAutopilotPlatform] = useState<'both' | 'facebook' | 'instagram'>('both');
  const [smartGenPhase, setSmartGenPhase] = useState<'researching' | 'writing' | null>(null);

  // Load/clear smart drafts when switching client workspaces
  useEffect(() => {
    const draft = readDraft(activeClientId);
    if (draft) {
      setSmartPosts(draft.posts);
      setSmartStrategy(draft.strategy);
      setDraftRestoredAt(draft.savedAt);
    } else {
      setSmartPosts([]);
      setSmartStrategy('');
      setDraftRestoredAt(null);
    }
    setSmartPostImages({});
    setAutoGenSet(new Set());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeClientId]);

  // Smart post image generation
  const [smartPostImages, setSmartPostImages] = useState<Record<number, string>>({});
  const [autoGenSet, setAutoGenSet] = useState<Set<number>>(new Set());
  const [currentGenIdx, setCurrentGenIdx] = useState<number | null>(null);
  const [imgGenDone, setImgGenDone] = useState(0);
  const uploadFileRef = useRef<HTMLInputElement>(null);
  const [uploadTargetIdx, setUploadTargetIdx] = useState<number | null>(null);
  const quickPostVideoUploadRef = useRef<HTMLInputElement>(null);
  const quickPostImageUploadRef = useRef<HTMLInputElement>(null);

  // Calendar post image generation (keyed by post ID)
  const [calendarImages, setCalendarImages] = useState<Record<string, string>>({});
  const [calendarGenSet, setCalendarGenSet] = useState<Set<string>>(new Set());
  const calendarUploadRef = useRef<HTMLInputElement>(null);
  const [calendarUploadId, setCalendarUploadId] = useState<string | null>(null);

  // Generation ticker
  const TICKER_STEPS_QUICK24H = [
    { label: 'Analysing your brand for a quick-fire burst...', pct: 10 },
    { label: 'Finding the top time slots in the next 24 hours...', pct: 30 },
    { label: 'Writing punchy, high-engagement content...', pct: 55 },
    { label: 'Crafting image prompts for maximum impact...', pct: 75 },
    { label: 'Finalising your 24-hour burst schedule...', pct: 95 },
  ];
  const TICKER_STEPS_HIGHLIGHTS = [
    { label: 'Researching your industry\'s absolute peak moments...', pct: 8 },
    { label: 'Identifying the top 3 highest-engagement time slots...', pct: 22 },
    { label: 'Selecting the strongest content pillars for your brand...', pct: 40 },
    { label: 'Writing polished, pillar-defining captions...', pct: 58 },
    { label: 'Crafting premium image prompts for highlight posts...', pct: 75 },
    { label: 'Verifying perfect timing alignment...', pct: 88 },
    { label: 'Finalising your highlights-only schedule...', pct: 96 },
  ];
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
  const TICKER_STEPS = autopilotMode === 'saturation' ? TICKER_STEPS_SATURATION
    : autopilotMode === 'quick24h' ? TICKER_STEPS_QUICK24H
    : autopilotMode === 'highlights' ? TICKER_STEPS_HIGHLIGHTS
    : TICKER_STEPS_NORMAL;
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

  const INSIGHT_TICKER_STEPS_SCAN = [
    { label: 'Connecting to your social accounts…', pct: 8 },
    { label: 'Fetching your published posts…', pct: 20 },
    { label: 'Reading post content and engagement data…', pct: 35 },
    { label: 'Identifying top-performing content…', pct: 50 },
    { label: 'Analysing audience engagement patterns…', pct: 65 },
    { label: 'Scoring your social health…', pct: 78 },
    { label: 'Building actionable recommendations…', pct: 88 },
    { label: 'Finalising your insight report…', pct: 96 },
  ];
  const INSIGHT_TICKER_STEPS_ANALYZE = [
    { label: 'Reviewing your business profile…', pct: 10 },
    { label: 'Analysing your industry & location…', pct: 25 },
    { label: 'Studying engagement trends for your business type…', pct: 42 },
    { label: 'Identifying content opportunities…', pct: 58 },
    { label: 'Researching best posting times…', pct: 72 },
    { label: 'Scoring your social health…', pct: 84 },
    { label: 'Building actionable recommendations…', pct: 93 },
    { label: 'Finalising your insight report…', pct: 97 },
  ];
  const [insightTickerIdx, setInsightTickerIdx] = useState(0);
  const [insightTickerSteps, setInsightTickerSteps] = useState(INSIGHT_TICKER_STEPS_ANALYZE);
  useEffect(() => {
    if (!isAnalyzing && !isScanningPosts) { setInsightTickerIdx(0); return; }
    setInsightTickerSteps(isScanningPosts ? INSIGHT_TICKER_STEPS_SCAN : INSIGHT_TICKER_STEPS_ANALYZE);
    const id = setInterval(() => {
      setInsightTickerIdx(prev => (prev < (isScanningPosts ? INSIGHT_TICKER_STEPS_SCAN : INSIGHT_TICKER_STEPS_ANALYZE).length - 1 ? prev + 1 : prev));
    }, 2600);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnalyzing, isScanningPosts]);
  const [insightStale, setInsightStale] = useState(false);

  const hasApiKey = true; // AI is server-side via OpenRouter worker
  const fbConnected = !!socialTokens.facebookPageId && socialTokens.facebookConnected;

  // Auto-run daily insight analysis when stale — only in own workspace, never in client workspaces
  useEffect(() => {
    if (insightStale && hasApiKey && user && !activeClientId) {
      runInsightReport(false, true);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insightStale, user, activeClientId]);

  // Plan & setup state (sourced from Firestore via userDoc)
  const [activePlan, setActivePlan] = useState<PlanTier | null>(null);
  const [setupStatus, setSetupStatus] = useState<SetupStatus>('ordered');
  const [isAdminMode] = useState(() => localStorage.getItem('sai_admin') === '1');
  // isSuperAdmin = the app owner (Steve) only — gates umbrella settings (fal.ai credits, API keys).
  // isAdminMode may be broadened to client admins in future; isSuperAdmin never will be.
  const isSuperAdmin = !CLIENT.clientMode && !!user?.email && CLIENT.adminEmails.some(e => e === user.email);


  // Persist plan/setupStatus to D1
  useEffect(() => {
    if (!user || !activePlan) return;
    db.upsertUser({ plan: activePlan }).catch(() => {});
  }, [activePlan, user]);
  useEffect(() => {
    if (!user) return;
    db.upsertUser({ setupStatus }).catch(() => {});
  }, [setupStatus, user]);

  const activeClientWorkspace = clients.find(c => c.id === activeClientId);
  const effectivePlan: PlanTier = (activeClientId && activeClientWorkspace?.plan) ? activeClientWorkspace.plan : (activePlan ?? (CLIENT.clientMode ? 'pro' : 'starter'));
  const agencyClientLimit = isAdminMode ? 10 : CLIENT.agencyClientLimit;
  const planCfg = CLIENT.plans.find(p => p.id === effectivePlan);
  const canUseImages = effectivePlan === 'growth' || effectivePlan === 'pro' || effectivePlan === 'agency';
  const canUseSaturation = effectivePlan === 'pro' || effectivePlan === 'agency';
  const maxPostsPerWeek = isAdminMode ? Infinity : (planCfg?.postsPerWeek ?? 7);

  // Live Facebook Stats
  interface LiveFbStats { fanCount: number; followersCount: number; reach28d: number; engagedUsers28d: number; engagementRate: number; }
  const [liveStats, setLiveStats] = useState<LiveFbStats | null>(null);
  const [isPullingStats, setIsPullingStats] = useState(false);
  const [lastPulled, setLastPulled] = useState<Date | null>(null);
  const [isPublishing, setIsPublishing] = useState(false);

  const handlePullStats = async (silent = false) => {
    setIsPullingStats(true);
    try {
      if (!silent) toast('Connect your Facebook page in Settings to pull live stats.', 'warning');
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

  // Stats are fetched manually via Refresh Stats button only — auto-fetch removed (was firing on every workspace switch)

  const handlePublishDirect = async (platforms: ('facebook' | 'instagram')[] = ['facebook']) => {
    if (!socialTokens.facebookPageId || !socialTokens.facebookPageAccessToken) {
      toast('Connect your Facebook page in Settings first.', 'warning'); return;
    }
    setIsPublishing(true);
    setPublishingPlatforms(platforms);
    try {
      const fullText = generatedHashtags.length > 0
        ? `${generatedContent}\n\n${generatedHashtags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ')}`
        : generatedContent;

      for (const plat of platforms) {
        if (plat === 'facebook') {
          if (generatedImage) {
            await FacebookService.postToPageDirect(socialTokens.facebookPageId, socialTokens.facebookPageAccessToken, fullText, generatedImage);
          } else {
            await FacebookService.postToPageDirect(socialTokens.facebookPageId, socialTokens.facebookPageAccessToken, fullText);
          }
        } else if (plat === 'instagram' && socialTokens.instagramBusinessAccountId) {
          if (generatedImage) {
            // Instagram requires a public image URL — if base64, we can't use it directly
            const imgUrl = generatedImage.startsWith('http') ? generatedImage : undefined;
            if (imgUrl) {
              await FacebookService.postToInstagram(socialTokens.instagramBusinessAccountId, socialTokens.facebookPageAccessToken, fullText, imgUrl);
            } else {
              toast('Instagram requires a public image URL. Generate or upload an image first.', 'warning');
            }
          }
        }
      }
      setPublishSuccess(true);
      setTimeout(() => setPublishSuccess(false), 4000);
    } catch (e: any) {
      toast(`Publish failed: ${e?.message?.substring(0, 100) || 'Unknown error'}`, 'error');
    }
    setIsPublishing(false);
  };

  // ── Content Generation ──
  const handleGenerate = async (): Promise<{ content: string; hashtags: string[]; imagePrompt?: string } | null> => {
    if (!topic.trim()) { toast('Enter a topic first.', 'warning'); return null; }
    setIsGenerating(true);
    try {
      const result = await generateSocialPost(topic, platform, profile.name, profile.type, profile.tone, profile, contentFormat);
      setGeneratedContent(result.content);
      setGeneratedHashtags(result.hashtags || []);
      if (result.imagePrompt) setLastImagePrompt(result.imagePrompt);
      return result;
    } catch (e: any) {
      const msg: string = e?.message || String(e);
      if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) {
        toast('AI rate limit hit — try again in a moment.', 'error');
      } else {
        toast(`AI error: ${msg.substring(0, 100)}`, 'error');
      }
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCreatePost = async () => {
    setGeneratedVideoScript(null);
    setGeneratedVideoUrl(null);
    setVideoProgress(0);
    const result = await handleGenerate();
    if (!result) return;
    if (contentType === 'image') await handleGenerateImage(result.imagePrompt);
    if (contentType === 'video') {
      // Step 1: Generate text brief with full business context
      setIsGeneratingVideo(true);
      const brief = await generateVideoScript(
        topic, platform, profile.name, profile.type, profile.tone, result.content,
        profile, result.hashtags, contentFormat
      );
      setGeneratedVideoScript(brief);
      setShowVideoBriefDetail(false);
      setIsGeneratingVideo(false);

      // Step 2: Generate thumbnail image using AI-tailored visual description
      const thumbPrompt = brief.thumbnailPrompt || result.imagePrompt || `${profile.type}: ${topic}`;
      console.log('Video thumbnail prompt:', thumbPrompt);
      if (hasApiKey || FalService.isConfigured()) {
        setIsGeneratingImage(true);
        let thumbnailBase64: string | null = null;
        try {
          const img = await generateImage(thumbPrompt);
          if (img) {
            thumbnailBase64 = img;
          } else {
            toast('Thumbnail image generation failed — video will be skipped.', 'warning');
          }
        } catch (e: any) {
          toast(`Image generation error: ${e?.message?.substring(0, 80)}`, 'error');
        }
        setIsGeneratingImage(false);

        // Step 3: Generate Reel via fal.ai Kling using AI-crafted motion prompt
        if (thumbnailBase64) {
          const videoMotionPrompt = brief.videoPrompt
            || `${brief.hook} — ${brief.shots?.[0] || topic}. Cinematic motion, professional quality.`;
          console.log('Video motion prompt:', videoMotionPrompt);
          setIsGeneratingReel(true);
          setVideoProgress(0.05);
          toast('Generating your Reel via fal.ai (Kling) — this takes 1–3 minutes…', 'info');
          try {
            const videoUrl = await FalService.generateVideo(
              videoMotionPrompt,
              thumbnailBase64,
              5,
              p => setVideoProgress(p),
            );
            setGeneratedVideoUrl(videoUrl);
            toast('Your video Reel is ready — click Publish Now to post!', 'success');
          } catch (e: any) {
            const falErr = e?.message || 'Generation failed';
            const isKeyErr = falErr.toLowerCase().includes('key') || falErr.toLowerCase().includes('unauthorized') || falErr.toLowerCase().includes('403');
            if (isKeyErr) {
              toast('fal.ai API key missing or invalid. Go to Settings → fal.ai API Key and paste your key from fal.ai/dashboard/keys.', 'error');
            } else {
              toast(`Video generation failed: ${falErr.substring(0, 90)}`, 'error');
            }
          }
          setIsGeneratingReel(false);
        }
      }
    }
  };

  const handleGenerateImage = async (aiImagePrompt?: string) => {
    if (!topic.trim()) { toast('Enter a topic first.', 'warning'); return; }
    setIsGeneratingImage(true);
    // Use AI-generated image prompt if available, otherwise fall back to topic
    const imageDesc = aiImagePrompt || lastImagePrompt || `${profile.type}: ${topic}`;
    console.log('Image prompt:', imageDesc);
    try {
      const img = await generateImage(imageDesc);
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
    const newPostId = await db.createPost({ ...postData, clientId: activeClientId, image_url: postData.image, scheduled_for: postData.scheduledFor });
    setPosts(prev => [{ id: newPostId, ...postData } as SocialPost, ...prev]);
    if (scheduleDate && socialTokens.facebookPageId && socialTokens.facebookPageAccessToken) {
      try {
        const fullText = generatedHashtags.length ? `${generatedContent}\n\n${generatedHashtags.join(' ')}` : generatedContent;
        const imageUrl = generatedImage?.startsWith('http') ? generatedImage : undefined;
        await FacebookService.postToPageScheduled(
          socialTokens.facebookPageId, socialTokens.facebookPageAccessToken,
          fullText, new Date(scheduleDate), imageUrl
        );
        toast('Post scheduled on Facebook — it will auto-publish at the set time!');
      } catch (e: any) {
        toast(`Post saved but Facebook scheduling failed: ${e?.message?.substring(0, 70) ?? 'check your connection'}. The cron will catch it.`, 'warning');
      }
    } else {
      toast(`Post ${scheduleDate ? 'scheduled' : 'saved as draft'}!${scheduleDate && !fbConnected ? ' Connect Facebook in Settings to enable auto-publishing.' : ''}`);
    }
    setGeneratedContent('');
    setGeneratedHashtags([]);
    setGeneratedImage(null);
    setTopic('');
    setScheduleDate('');
  };

  // ── Auto-generate images for all smart posts ──
  const autoGenerateAllImages = async (posts: SmartScheduledPost[]) => {
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
        const img = await generateImage(prompt);
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

  const handleQuickPostVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    setGeneratedVideoUrl(objectUrl);
    setGeneratedVideoScript(null);
    setIsGeneratingReel(false);
    setVideoProgress(0);
    toast('Video uploaded — schedule or publish it below.', 'success');
    e.target.value = '';
  };

  const handleQuickPostImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string;
      if (dataUrl) {
        setGeneratedImage(dataUrl);
        toast('Photo added — write a caption or hit Create Post, then publish.', 'success');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
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

  // ── Audio mixing state ──
  const [isMixingAudio, setIsMixingAudio] = useState(false);
  const [mixedVideoUrl, setMixedVideoUrl] = useState<string | null>(null);
  const [audioMixProgress, setAudioMixProgress] = useState(0);

  const handleAddAudio = async () => {
    const sourceUrl = generatedVideoUrl;
    const mood = generatedVideoScript?.mood || 'upbeat';
    if (!sourceUrl) return;
    setIsMixingAudio(true);
    setAudioMixProgress(0);
    try {
      const result = await addAudioToVideo(sourceUrl, mood, {
        onProgress: p => setAudioMixProgress(p),
      });
      setMixedVideoUrl(result);
      setAudioMixProgress(1);
      toast('Music added! Download or publish your video with audio.', 'success');
    } catch (e: any) {
      toast(`Audio mix failed: ${e?.message?.substring(0, 80) || 'Unknown error'}`, 'error');
    }
    setIsMixingAudio(false);
  };

  // ── Smart Schedule ──
  const handleSmartSchedule = async () => {
    // AI is always available server-side
    setIsSmartGenerating(true);
    setSmartGenPhase('researching');
    setSmartPostImages({});
    setAutoGenSet(new Set());
    clearDraft(activeClientId);
    const platformsObj = {
      facebook: autopilotPlatform === 'both' || autopilotPlatform === 'facebook',
      instagram: autopilotPlatform === 'both' || autopilotPlatform === 'instagram',
    };
    try {
      const activeCampaigns = campaigns.filter(c => c.enabled && new Date(c.endDate) >= new Date());
      const result = await generateSmartSchedule(
        profile.name, profile.type, profile.tone, stats, smartCount,
        profile.location || 'Australia',
        platformsObj,
        saturationMode,
        profile,
        includeVideos,
        autopilotMode,
        (phase) => setSmartGenPhase(phase),
        undefined,
        activeCampaigns.map(c => ({ name: c.name, type: c.type, startDate: c.startDate, endDate: c.endDate, rules: c.rules, imageNotes: c.imageNotes, postsPerDay: c.postsPerDay }))
      );
      if (result.posts.length === 0 && result.strategy.startsWith('Error:')) {
        toast(`Generation failed: ${result.strategy.replace('Error: ', '').substring(0, 100)}`, 'error');
      } else {
        // Enforce plan limits: strip video posts if plan doesn't support them
        const canVideos = effectivePlan === 'pro' || effectivePlan === 'agency';
        const cleanPosts = canVideos ? result.posts : result.posts.map(p =>
          (p as any).postType === 'video'
            ? { ...p, postType: 'image' as const, videoScript: undefined, videoShots: undefined, videoMood: undefined }
            : p
        );
        setSmartPosts(cleanPosts);
        setSmartStrategy(result.strategy);
        saveDraft(cleanPosts, result.strategy, autopilotMode, autopilotPlatform, activeClientId);
        autoGenerateAllImages(cleanPosts);
      }
    } catch (e: any) {
      toast(`Smart schedule failed: ${e?.message?.substring(0, 100) || 'Unknown error — check your API key and connection.'}`, 'error');
    } finally {
      setIsSmartGenerating(false);
      setSmartGenPhase(null);
    }
  };

  const handleRewrite = async () => {
    if (!draftText.trim()) { toast('Write your draft first.', 'warning'); return; }
    // AI is always available server-side
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
      const img = await generateImage(prompt);
      if (img) setSmartPostImages(prev => ({ ...prev, [idx]: img }));
      else toast('Image generation failed — try uploading instead.', 'warning');
    } catch (e: any) { toast(`Image error: ${e?.message?.substring(0, 80) || 'Unknown'}`, 'error'); }
    setAutoGenSet(prev => { const s = new Set(prev); s.delete(idx); return s; });
  };

  // ── Image generation: fal.ai FLUX → Gemini Imagen → Pollinations.ai (free) ──
  const generateImage = async (prompt: string): Promise<string | null> => {
    if (FalService.isConfigured()) {
      try {
        const url = await FalService.generateImage(
          `Professional social media marketing photograph: ${prompt}. Cinematic lighting, vibrant colours, sharp focus, commercial quality. No text, no watermarks, no logos.`
        );
        if (url) return url;
      } catch (e: any) {
        console.warn('fal.ai image gen failed, trying Gemini:', e?.message ?? e);
      }
    }
    return generateMarketingImage(prompt);
  };

  // ── Auto-generate images for calendar posts that have imagePrompt but no image ──
  // Only runs when viewing the calendar tab, and skips posts currently being generated by Smart Schedule
  const calendarAutoGenRanRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    if (activeTab !== 'calendar') return;
    if (!hasApiKey && !FalService.isConfigured()) return;
    if (isSmartGenerating || isAccepting) return; // Don't double-generate during Smart Schedule
    const missing = posts.filter(p =>
      p.imagePrompt &&
      !p.image &&
      !calendarImages[p.id] &&
      !calendarGenSet.has(p.id) &&
      !calendarAutoGenRanRef.current.has(p.id) &&
      (p as any).postType !== 'video'
    );
    if (missing.length === 0) return;
    const run = async () => {
      for (const post of missing) {
        calendarAutoGenRanRef.current.add(post.id);
        setCalendarGenSet(prev => new Set(prev).add(post.id));
        try {
          const img = await generateImage(post.imagePrompt!);
          if (img) setCalendarImages(prev => ({ ...prev, [post.id]: img }));
        } catch { /* silently skip */ }
        setCalendarGenSet(prev => { const s = new Set(prev); s.delete(post.id); return s; });
      }
    };
    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, activeTab]);

  const handleCalendarRegenImage = async (postId: string, prompt: string) => {
    setCalendarGenSet(prev => new Set(prev).add(postId));
    try {
      const img = await generateImage(prompt);
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
    const { content, hashtags, scheduledFor, status, image } = updates;
    const patch: Record<string, unknown> = {};
    if (content !== undefined) patch.content = content;
    if (hashtags !== undefined) patch.hashtags = hashtags;
    if (scheduledFor !== undefined) patch.scheduledFor = scheduledFor;
    if (status !== undefined) patch.status = status;
    if (image !== undefined) patch.imageUrl = image;
    await db.updatePost(id, patch);
    setPosts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    toast('Post updated!', 'success');
  };

  const handleAcceptSmartPosts = async () => {
    if (!user) return;
    const total = smartPosts.length;
    setIsAccepting(true);
    setAcceptProgress(0);
    setAcceptSaved(0);
    let completedCount = 0;
    let scheduleFailCount = 0;
    try {
      const results = await Promise.all(
        smartPosts.map(async (sp, i) => {
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
            topic: sp.topic,
            postType: sp.postType || 'image',
            videoScript: sp.videoScript || undefined,
            videoShots: sp.videoShots || undefined,
            videoMood: sp.videoMood || undefined,
          };
          const batchPostId = await db.createPost({ ...postData, clientId: activeClientId, image_url: postData.image, scheduled_for: postData.scheduledFor });
          completedCount++;
          setAcceptSaved(completedCount);
          setAcceptProgress(Math.round((completedCount / total) * 100));
          // Schedule via Facebook Graph API so it auto-publishes at the scheduled time
          if (socialTokens.facebookPageId && socialTokens.facebookPageAccessToken) {
            try {
              const text = sp.hashtags?.length ? `${sp.content}\n\n${sp.hashtags.join(' ')}` : sp.content;
              const imageUrl = smartPostImages[i]?.startsWith('http') ? smartPostImages[i] : undefined;
              await FacebookService.postToPageScheduled(
                socialTokens.facebookPageId, socialTokens.facebookPageAccessToken,
                text, new Date(sp.scheduledFor), imageUrl
              );
            } catch (schedErr: any) {
              scheduleFailCount++;
              console.warn(`Facebook scheduling failed for post ${i}:`, schedErr?.message);
            }
          }
          return { id: batchPostId, ...postData } as SocialPost;
        })
      );
      setPosts(prev => [...results, ...prev]);
      clearDraft(activeClientId);
      if (!fbConnected) {
        toast(`${results.length} posts saved to calendar. Connect Facebook in Settings to enable auto-publishing.`, 'success');
      } else if (scheduleFailCount > 0) {
        toast(`${results.length} posts saved. ${scheduleFailCount} failed to schedule on Facebook — publish those manually from the calendar.`, 'warning');
      } else {
        toast(`${results.length} posts scheduled on Facebook — they'll auto-publish at the set times!`, 'success');
      }
      setSmartPosts([]);
      setSmartStrategy('');
      setSmartPostImages({});
      setAutoGenSet(new Set());
      setCurrentGenIdx(null);
      setActiveTab('calendar');
    } catch (e: any) {
      toast(`Failed to save posts — ${e?.message?.substring(0, 80) ?? 'check your connection and try again.'}`, 'error');
    } finally {
      setIsAccepting(false);
      setAcceptProgress(0);
      setAcceptSaved(0);
    }
  };

  // ── Insights ──
  const runInsightReport = async (forceRefresh = false, silent = false) => {
    // AI insights are always available server-side
    if (!forceRefresh && insightReport) return;
    setIsAnalyzing(true);
    try {
      const recentTopics = posts.slice(0, 10).map(p => p.topic || p.content.substring(0, 40));
      // In portal mode, always use CLIENT config to avoid stale cached profile data
      const insightName = authMode === 'portal' ? (CLIENT.defaultBusinessName || profile.name) : profile.name;
      const insightType = authMode === 'portal' ? (CLIENT.defaultBusinessType || profile.type) : profile.type;
      const report = await generateInsightReport(insightName, insightType, profile.location || 'Australia', stats, recentTopics);
      setInsightReport(report);
      setInsightStale(false);
      if (user) {
        upsertActiveWorkspace({ insightReport: report }).catch(() => {});
      }
      if (!silent) toast('AI insights updated!', 'success');
    } catch (e: any) {
      setInsightStale(false); 
      if (!silent) {
        const msg: string = e?.message || String(e);
        if (msg.includes('429') || msg.includes('rate limit') || msg.includes('quota')) {
          toast('AI rate limit hit — try again in a moment.', 'error');
        } else if (msg.includes('404') || msg.includes('not found') || msg.includes('Failed to fetch')) {
          toast('AI service unavailable — try again in 1–2 minutes.', 'error');
        } else {
          toast(`Insights failed: ${msg.substring(0, 80)}`, 'error');
        }
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleScanPastPosts = async () => {
    if (!hasApiKey) { return; } // hasApiKey is always true; kept for type-safety
    setIsScanningPosts(true);
    try {
      // Path 0 — App's own posts (always available, no external API needed)
      const appPosts = posts
        .filter(p => p.content && p.content.trim().length > 0)
        .map(p => ({
          message: p.content,
          created_time: p.scheduledFor || new Date().toISOString(),
          likes: 0,
          comments: 0,
          shares: 0,
        }));
      // Keep same reference so the fallback checks (scanPosts === appPosts) work
      // correctly even when there are zero local posts.
      let scanPosts = appPosts;

      if (!scanPosts.length) {
        // No external posts found — fall back to generating insights from profile data alone
        toast('No published posts found — generating insights from your profile & stats.', 'info');
        await runInsightReport(true);
        setIsScanningPosts(false);
        return;
      }

      const report = await generateInsightReportFromPosts(profile.name, profile.type, profile.location || 'Australia', scanPosts);
      if (report) {
        setInsightReport(report);
        setInsightStale(false);
        if (user) upsertActiveWorkspace({ insightReport: report }).catch(() => {});
        toast(`Scanned ${scanPosts.length} posts — insights updated!`, 'success');
      }
    } catch (e: any) {
      const msg: string = e?.message || String(e);
      const primaryMsg = msg.includes('| Gemini error:') ? msg.split('| Gemini error:')[0].trim() : msg;
      toast(`Scan failed: ${primaryMsg.substring(0, 80) || 'Unknown error'}`, 'error');
    }
    setIsScanningPosts(false);
  };

  const handleAnalyze = async () => {
    // AI is always available server-side
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
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);

  const handleDismissOnboarding = async () => {
    setShowOnboarding(false);
    localStorage.setItem('sai_onboarding_done', '1');
    if (user) {
      await db.upsertUser({ onboardingDone: true }).catch(() => {});
    }
    await handleSaveProfile().catch(() => {});
  };

  const [falApiKey, setFalApiKey] = useState(() => localStorage.getItem('sai_fal_key') || '');
  const [isSavingFalKey, setIsSavingFalKey] = useState(false);
  const handleSaveFalKey = async () => {
    if (!falApiKey.trim()) { toast('Enter your fal.ai API key first.', 'warning'); return; }
    setIsSavingFalKey(true);
    try {
      localStorage.setItem('sai_fal_key', falApiKey.trim());
      if (user) await db.upsertUser({ falApiKey: falApiKey.trim() });
      toast('fal.ai key saved — AI video generation is now active!', 'success');
    } catch { toast('Failed to save fal.ai key.', 'error'); }
    setIsSavingFalKey(false);
  };

  const handleSaveProfile = async () => {
    setIsSavingProfile(true);
    try {
      localStorage.setItem('sai_profile', JSON.stringify(profile));
      await upsertActiveWorkspace({ profile });
      toast('Business profile saved!', 'success');
    } catch { toast('Failed to save profile.', 'error'); }
    setIsSavingProfile(false);
  };

  const handleSaveAll = async () => {
    setIsSavingAll(true);
    try {
      localStorage.setItem('sai_profile', JSON.stringify(profile));
      await upsertActiveWorkspace({ profile });
      toast('All settings saved!', 'success');
    } catch { toast('Failed to save settings.', 'error'); }
    setIsSavingAll(false);
  };

  // ── Portal auto-login credentials ──
  const savePortalCredentials = async (clientId: string) => {
    const inp = portalInputs[clientId];
    if (!inp?.slug?.trim()) { toast('Enter the client slug first (e.g. "streetmeats").', 'warning'); return; }
    if (!inp?.email?.trim()) { toast('Enter the auto-login email.', 'warning'); return; }
    if (!inp?.password?.trim()) { toast('Enter the auto-login password.', 'warning'); return; }
    if (!user) return;
    setPortalInputs(prev => ({ ...prev, [clientId]: { ...prev[clientId], saving: true } }));
    try {
      const slug = inp.slug.trim().toLowerCase();
      await db.setPortal(slug, inp.email.trim(), inp.password);
      await db.updateClient(clientId, { clientSlug: slug }).catch(() => {});
      setClients(prev => prev.map(c => c.id === clientId ? { ...c, clientSlug: slug } : c));
      toast(`Portal credentials saved for "${slug}"! The branded site will auto-login on next load.`, 'success');
    } catch (e: any) {
      toast(`Save failed: ${e?.message || 'Unknown error'}`, 'error');
    }
    setPortalInputs(prev => ({ ...prev, [clientId]: { ...prev[clientId], saving: false } }));
  };

  // ── Delete Post ──
  const deletePost = async (id: string) => {
    if (!user) return;
    await db.deletePost(id);
    setPosts(prev => prev.filter(p => p.id !== id));
    toast('Post deleted.');
  };

  // ── Tab Rendering ──
  const tabs = [
    { id: 'home' as const, label: 'Home', icon: Home },
    { id: 'calendar' as const, label: 'Calendar', icon: Calendar },
    { id: 'smart' as const, label: 'Create', icon: Wand2 },
    { id: 'insights' as const, label: 'Insights', icon: BarChart3 },
    ...(!CLIENT.clientMode && (activePlan === 'agency' || isAdminMode) ? [{ id: 'clients' as const, label: 'Clients', icon: Users }] : []),
    { id: 'settings' as const, label: 'Settings', icon: Settings }
  ];

  // Auth gate
  if (!user) {
    if (loading || autoLoginPending) {
      return (
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-white/40">
            <Loader2 size={28} className="animate-spin text-amber-400" />
            <span className="text-sm">Signing in…</span>
          </div>
        </div>
      );
    }
    if (CLIENT.clientMode) {
      // Portal mode — if we reach here, the portal token wasn't found
      return (
        <div className="min-h-screen bg-black flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-white/60 max-w-md text-center">
            <AlertCircle size={32} className="text-red-400" />
            <p className="text-lg font-semibold text-red-400">Portal not configured</p>
            <p className="text-sm">This client portal hasn't been set up yet. Ask your agency administrator to configure the portal token.</p>
          </div>
        </div>
      );
    }
    if (showLanding && !CLIENT.clientMode) {
      return <LandingPage onActivate={() => setShowLanding(false)} onSignIn={() => setShowLanding(false)} portalContent={portalContent} />;
    }
    return <AuthScreen onShowLanding={() => setShowLanding(false)} />;
  }

  // Show landing page (logged-in user without a plan, or explicitly navigated) — skip in clientMode
  if (!CLIENT.clientMode && (showLanding || (!activePlan && dbLoaded))) {
    return <LandingPage
      onActivate={async plan => {
        setActivePlan(plan);
        setShowLanding(false);
        if (user) await db.upsertUser({ plan, setupStatus: 'ordered' }).catch(() => {});
      }}
      onSignIn={() => setShowLanding(false)}
      portalContent={portalContent}
    />;
  }

  // Still loading D1 data
  if (!dbLoaded) {
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
    <div className="min-h-full bg-[#0a0a0f] flex flex-col">
      {/* Onboarding Wizard */}
      {showIntakeForm && user && (
        <ClientIntakeForm
          userEmail={user.email || ''}
          onClose={() => setShowIntakeForm(false)}
          onSubmitted={() => {
            setIntakeFormDone(true);
            setShowIntakeForm(false);
            db.upsertUser({ intakeFormDone: true }).catch(() => {});
          }}
        />
      )}

      {/* Video Script Lightbox */}
      {videoScriptModal && (
        <div
          className="fixed inset-0 z-[999] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(14px)' }}
          onClick={() => { if (!videoModalGenerating) setVideoScriptModal(null); }}
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
              <button onClick={() => { if (!videoModalGenerating) setVideoScriptModal(null); }} className="text-white/30 hover:text-white transition p-1 rounded-lg hover:bg-white/8">
                <X size={16} />
              </button>
            </div>

            <div className="flex gap-5 p-6">
              {/* Left: preview pane */}
              <div className="flex-shrink-0 flex flex-col items-center gap-3">
                {videoModalUrl ? (
                  <div className="w-28 rounded-2xl overflow-hidden border border-purple-500/30 shadow-lg shadow-purple-900/40" style={{ aspectRatio: '9/16' }}>
                    <video
                      src={videoModalUrl}
                      controls
                      autoPlay
                      loop
                      playsInline
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <AnimatedReelPreview
                    hookText={videoScriptModal.hookText}
                    mood={videoScriptModal.mood}
                    size="md"
                    className="!w-28 !h-48"
                  />
                )}

                {/* Generate button / progress */}
                {!videoModalUrl && (
                  <div className="w-28 space-y-2">
                    {videoModalGenerating ? (
                      <>
                        <div className="w-full bg-purple-900/30 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-full bg-purple-400 rounded-full transition-all duration-500"
                            style={{ width: `${Math.round(videoModalProgress * 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-purple-300 text-center">
                          Generating… {Math.round(videoModalProgress * 100)}%
                        </p>
                      </>
                    ) : (
                      <button
                        onClick={async () => {
                          setVideoModalError(null);
                          setVideoModalGenerating(true);
                          setVideoModalProgress(0);
                          try {
                            // Coerce script/shots to string (AI may return arrays)
                            const scriptStr = Array.isArray(videoScriptModal.script)
                              ? (videoScriptModal.script as string[]).join(' ')
                              : String(videoScriptModal.script || '');
                            const shotsStr = Array.isArray(videoScriptModal.shots)
                              ? (videoScriptModal.shots as string[]).join('. ')
                              : String(videoScriptModal.shots || '');
                            // Build a motion prompt from the script + shots
                            const motionPrompt = [
                              scriptStr.split(/\.|,|\n/).slice(0, 2).join('. '),
                              shotsStr.split(/\n|;|\d+\./).filter(Boolean).slice(0, 2).join('. '),
                            ].filter(Boolean).join(' — ').slice(0, 300) || videoScriptModal.hookText;

                            // Use the post's generated image as the input frame if available
                            const inputImage = videoScriptModal.imageUrl || '';

                            const url = await FalService.generateVideo(
                              motionPrompt,
                              inputImage,
                              5,
                              (p) => setVideoModalProgress(p),
                            );
                            setVideoModalUrl(url);
                          } catch (e: any) {
                            setVideoModalError(e?.message || 'Video generation failed');
                          } finally {
                            setVideoModalGenerating(false);
                          }
                        }}
                        className="w-full flex items-center justify-center gap-1.5 bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold py-2 rounded-xl transition-all"
                      >
                        <Play size={11} />
                        Generate Video
                      </button>
                    )}
                    {videoModalError && (
                      <p className="text-[10px] text-red-400 text-center leading-tight">{videoModalError}</p>
                    )}
                  </div>
                )}

                {videoModalUrl && (
                  <a
                    href={videoModalUrl}
                    download="reel.mp4"
                    className="w-28 flex items-center justify-center gap-1.5 bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/30 text-purple-300 text-[11px] font-bold py-2 rounded-xl transition-all"
                  >
                    ↓ Download
                  </a>
                )}
              </div>

              {/* Script details */}
              <div className="flex-1 min-w-0 space-y-4 overflow-y-auto max-h-[70vh] pr-1">
                {videoScriptModal.script && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black text-purple-400 uppercase tracking-wider">Script</p>
                    <div className="bg-purple-950/40 border border-purple-500/15 rounded-xl p-4">
                      <p className="text-sm text-white/80 leading-relaxed whitespace-pre-wrap">
                        {Array.isArray(videoScriptModal.script)
                          ? (videoScriptModal.script as string[]).join(' ')
                          : videoScriptModal.script}
                      </p>
                    </div>
                  </div>
                )}
                {videoScriptModal.shots && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-black text-purple-400 uppercase tracking-wider">Shot-by-Shot Brief</p>
                    <div className="bg-purple-950/40 border border-purple-500/15 rounded-xl p-4">
                      <p className="text-sm text-white/70 leading-relaxed whitespace-pre-wrap">
                        {Array.isArray(videoScriptModal.shots)
                          ? (videoScriptModal.shots as string[]).map((s, i) => `${i + 1}. ${s}`).join('\n')
                          : videoScriptModal.shots}
                      </p>
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
              <p className="text-[10px] text-white/20 text-center">
                {videoModalGenerating ? 'Generating your video — please wait…' : 'Click anywhere outside to close'}
              </p>
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
          socialTokens={socialTokens}
          onSaveSocialTokens={saveSocialTokens}
        />
      )}
      {/* ── Publishing overlay ── */}
      {isPublishing && (
        <div className="fixed inset-0 z-[800] bg-black/75 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-[#0d0d1a] border border-blue-500/20 rounded-3xl p-10 flex flex-col items-center gap-6 max-w-xs w-full mx-4 shadow-2xl shadow-blue-900/30">
            <div className="relative w-16 h-16">
              <div className="absolute inset-0 rounded-full border-2 border-blue-500/20" />
              <div className="absolute inset-0 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Send size={22} className="text-blue-400" />
              </div>
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-lg font-bold text-white">Publishing your post…</p>
              <p className="text-xs text-white/40">
                Sending to {publishingPlatforms.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' & ')}…
              </p>
              {generatedVideoUrl && <p className="text-xs text-purple-400/70 mt-1">📹 Video included</p>}
            </div>
            <div className="flex gap-1.5">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.18}s` }} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Publish success overlay ── */}
      {publishSuccess && !isPublishing && (
        <div className="fixed inset-0 z-[800] bg-black/70 backdrop-blur-sm flex items-center justify-center" onClick={() => setPublishSuccess(false)}>
          <div className="bg-[#0d0d1a] border border-green-500/25 rounded-3xl p-10 flex flex-col items-center gap-5 max-w-xs w-full mx-4 shadow-2xl shadow-green-900/20">
            <div className="w-16 h-16 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center">
              <CheckCircle size={32} className="text-green-400" />
            </div>
            <div className="text-center space-y-1.5">
              <p className="text-xl font-black text-white">Posted! 🎉</p>
              <p className="text-xs text-white/40">
                Published to {publishingPlatforms.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' & ')} successfully
              </p>
              {generatedVideoUrl && <p className="text-xs text-purple-300/60 mt-1">📹 Video attached</p>}
            </div>
            <p className="text-[10px] text-white/20">Tap anywhere to dismiss</p>
          </div>
        </div>
      )}

      {/* ── Post preview modal ── */}
      {showPreview && (
        <div className="fixed inset-0 z-[800] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Facebook-style header */}
            <div className="flex items-center gap-3 p-4 border-b border-gray-100">
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-black text-sm flex-shrink-0">
                {(profile.name || 'B').charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-bold text-gray-900 text-sm leading-tight">{profile.name || 'Your Business'}</p>
                <p className="text-xs text-gray-400 flex items-center gap-1">Just now · 🌐</p>
              </div>
              <button onClick={() => setShowPreview(false)} className="ml-auto text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-100 transition">
                <X size={16} />
              </button>
            </div>
            {/* Post body */}
            <div className="p-4">
              <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">
                {generatedContent}
              </p>
              {generatedHashtags.length > 0 && (
                <p className="text-blue-600 text-sm mt-2 leading-relaxed">
                  {generatedHashtags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ')}
                </p>
              )}
            </div>
            {/* Media preview */}
            {generatedVideoUrl ? (
              <video src={generatedVideoUrl} className="w-full max-h-64 object-cover bg-black" autoPlay loop muted playsInline />
            ) : contentType === 'video' ? (
              isGeneratingReel ? (
                <div className="w-full h-32 bg-purple-950/40 flex flex-col items-center justify-center gap-2 border-t border-purple-500/15">
                  <Loader2 size={20} className="animate-spin text-purple-400" />
                  <p className="text-xs text-purple-300/60">Generating video… {Math.round(videoProgress * 100)}%</p>
                </div>
              ) : (
                <div className="w-full h-20 bg-purple-950/20 flex items-center justify-center border-t border-purple-500/10">
                  <p className="text-xs text-white/20">Video will appear here once generated</p>
                </div>
              )
            ) : generatedImage ? (
              <img src={generatedImage} alt="Post media" className="w-full max-h-64 object-cover" />
            ) : null}
            {/* Facebook-style actions */}
            <div className="px-4 py-3 border-t border-gray-100">
              <div className="flex justify-around text-gray-500 text-sm font-semibold">
                <span className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg hover:bg-gray-50 cursor-default">👍 Like</span>
                <span className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg hover:bg-gray-50 cursor-default">💬 Comment</span>
                <span className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg hover:bg-gray-50 cursor-default">↗ Share</span>
              </div>
            </div>
            <div className="px-4 pb-4">
              <button
                onClick={() => { setShowPreview(false); handlePublishDirect([platform.toLowerCase() as 'facebook' | 'instagram']); }}
                disabled={!fbConnected || isGeneratingReel}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-90 disabled:opacity-40 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 transition text-sm"
              >
                <Send size={14} /> Publish to {platform}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pricing Modal */}
      {showPricing && <PricingTable onClose={() => setShowPricing(false)} onPlanActivated={handlePlanActivated} userId={user?.uid} />}
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
      <header id="app-header" className="border-b border-white/[0.06] bg-[var(--color-surface-0)]/80 backdrop-blur-xl sticky top-0 z-40 noise">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-4 min-h-[64px]">
          <div className="flex items-center gap-3 min-w-0">
            {CLIENT.clientMode ? (
              <div className="flex items-center gap-3 min-w-0">
                <AppLogo size={48} />
                <div className="min-w-0">
                  <h1 className="text-base font-black text-white truncate leading-tight">{CLIENT.appName}</h1>
                  <p className="text-[11px] text-white/30 truncate">{profile.type || CLIENT.defaultBusinessType}</p>
                </div>
              </div>
            ) : (
              <>
                <AppLogo size={72} />
                <div className="flex items-center gap-2 flex-wrap">
                  {planCfg && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full bg-gradient-to-r ${planCfg.color} text-white`}>
                      {planCfg.name}
                    </span>
                  )}
                  {activePlan === 'agency' && authMode !== 'portal' && (
                    <ClientSwitcher
                      clients={clients}
                      activeClientId={activeClientId}
                      onSwitch={setActiveClientId}
                      onAdd={addClient}
                      onRename={renameClient}
                      onDelete={deleteClient}
                      agencyName={agencyNameRef.current || profile.name}
                      clientLimit={agencyClientLimit}
                    />
                  )}
                  {(activePlan !== 'agency' || authMode === 'portal') && profile.name && profile.name !== 'My Business' && (
                    <span className="text-xs text-white/30 hidden sm:inline">{profile.name}</span>
                  )}
                </div>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs flex-shrink-0">
            {fbConnected ? (
              <span className="flex items-center gap-1.5 text-blue-400 bg-blue-500/10 px-2.5 py-1 rounded-full border border-blue-500/20 whitespace-nowrap">
                <Link2 size={12} /> {CLIENT.clientMode ? 'Connected' : 'Facebook Connected'}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-gray-500 bg-white/5 px-2.5 py-1 rounded-full border border-white/10 whitespace-nowrap">
                <Link2Off size={12} /> {CLIENT.clientMode ? 'Not Connected' : 'Facebook Not Connected'}
              </span>
            )}
            {!CLIENT.clientMode && (
              <>
                {hasApiKey ? (
                  <span className="flex items-center gap-1.5 text-green-400 bg-green-500/10 px-2.5 py-1 rounded-full border border-green-500/20 whitespace-nowrap">
                    <CheckCircle size={12} /> AI Active
                  </span>
                ) : (
                  <span className="text-yellow-400 bg-yellow-500/10 px-2.5 py-1 rounded-full border border-yellow-500/20 whitespace-nowrap">No API Key</span>
                )}
              </>
            )}
            {fbConnected && (
              <button
                onClick={() => handlePullStats()}
                disabled={isPullingStats}
                className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white px-2.5 py-1 rounded-full transition disabled:opacity-40 text-xs whitespace-nowrap"
                title="Pull live stats from Facebook"
              >
                <RefreshCw size={11} className={isPullingStats ? 'animate-spin' : ''} />
                {isPullingStats ? 'Pulling...' : 'Refresh Stats'}
              </button>
            )}
            {isProfileBlank && !showOnboarding && (
              <button
                onClick={() => setShowOnboarding(true)}
                className="flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 px-2.5 py-1 rounded-full transition text-xs font-semibold whitespace-nowrap"
              >
                <ClipboardList size={11} /> Complete Setup
              </button>
            )}
            {!CLIENT.clientMode && (
            <button
              onClick={() => setShowPricing(true)}
              title="Upgrade plan"
              className="w-8 h-8 rounded-xl bg-white/5 hover:bg-amber-500/15 border border-white/10 hover:border-amber-500/30 flex items-center justify-center text-white/40 hover:text-amber-400 transition ml-1"
            >
              <ShoppingCart size={15} />
            </button>
            )}
            <button
              onClick={() => setShowAccount(true)}
              title="My Account"
              className={`w-8 h-8 rounded-xl bg-gradient-to-br ${planCfg?.color ?? 'from-white/10 to-white/5'} flex items-center justify-center text-white text-xs font-black hover:opacity-80 transition shadow flex-shrink-0`}
            >
              {user?.email?.charAt(0).toUpperCase() ?? '?'}
            </button>
          </div>
        </div>
        {/* Live Stats Bar */}
        {liveStats && (
          <div className="border-t border-white/[0.06] bg-[var(--color-surface-0)]/60 backdrop-blur-md">
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
      <nav className="border-b border-white/[0.06] bg-[var(--color-surface-0)]/60 backdrop-blur-lg sticky top-[64px] z-30">
        <div className="max-w-6xl mx-auto px-4 flex gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap press ${
                activeTab === tab.id
                  ? 'border-amber-400 text-amber-400 shadow-[0_2px_8px_rgba(245,158,11,0.3)]'
                  : 'border-transparent text-gray-400 hover:text-white'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Agency active-client banner — PROMINENT so you always know which account you're working on */}
      {activeClientId && activePlan === 'agency' && authMode !== 'portal' && (() => {
        const activeClient = clients.find(c => c.id === activeClientId);
        return activeClient ? (
          <div className="bg-gradient-to-r from-emerald-950/80 via-emerald-900/60 to-emerald-950/80 border-b border-emerald-500/20 backdrop-blur-sm sticky top-[109px] z-20 glass">
            <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/25 border border-emerald-500/40 flex items-center justify-center flex-shrink-0">
                  <Users size={15} className="text-emerald-400" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-emerald-300 truncate">{activeClient.name}</span>
                    {activeClient.plan && (
                      <span className="text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full uppercase">{activeClient.plan}</span>
                    )}
                  </div>
                  {activeClient.businessType && (
                    <span className="text-[11px] text-emerald-400/50">{activeClient.businessType}</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => setActiveClientId(null)}
                className="flex items-center gap-1.5 text-xs font-bold text-emerald-300 hover:text-white bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 px-4 py-2 rounded-xl transition whitespace-nowrap flex-shrink-0"
              >
                <X size={12} /> Back to my workspace
              </button>
            </div>
          </div>
        ) : null;
      })()}

      {/* Content */}
      <main key={activeTab} className={`max-w-6xl mx-auto px-4 flex-1 w-full animate-tab-enter ${CLIENT.clientMode ? 'py-4' : 'py-8'}`}>
        {!CLIENT.clientMode && (
        <SetupBanner
          status={setupStatus}
          onStatusChange={isAdminMode ? setSetupStatus : undefined}
          isAdmin={isAdminMode}
        />
        )}

        {/* ═══ QUICK POST MODE ═══ */}
        {activeTab === 'smart' && smartSubMode === 'quickpost' && (
          <div className="space-y-5">
            <div className="bg-white/3 border border-white/8 rounded-2xl p-6 space-y-5">
              {/* Platform + Content type */}
              <div className="flex flex-wrap gap-5">
                <div>
                  <label className="text-[10px] font-semibold text-white/30 uppercase tracking-widest block mb-1.5">Platform</label>
                  <div className="flex rounded-xl overflow-hidden border border-white/10">
                    {(['Instagram', 'Facebook'] as const)
                      .filter(p => p === 'Facebook' ? fbConnected : !!socialTokens.instagramBusinessAccountId)
                      .map(p => (
                      <button key={p} onClick={() => setPlatform(p)}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition ${
                          platform === p
                            ? p === 'Instagram' ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white' : 'bg-blue-600 text-white'
                            : 'bg-transparent text-white/30 hover:text-white/60'
                        }`}>
                        {p === 'Instagram' ? <Instagram size={14} /> : <Facebook size={14} />} {p}
                      </button>
                    ))}
                    {!fbConnected && !socialTokens.instagramBusinessAccountId && (
                      <div className="flex items-center gap-2 px-4 py-2.5 text-xs text-white/30">
                        No platforms connected. <button onClick={() => setActiveTab('settings')} className="text-amber-400 underline">Settings →</button>
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-white/30 uppercase tracking-widest block mb-1.5">Content Type</label>
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={() => setContentType('text')}
                      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border rounded-xl transition ${contentType === 'text' ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-white/3 border-white/10 text-white/40 hover:text-white/60'}`}>
                      <MessageSquare size={14} /> Text
                    </button>
                    {canUseImages ? (
                      <button onClick={() => setContentType('image')}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border rounded-xl transition ${contentType === 'image' ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300' : 'bg-white/3 border-white/10 text-white/40 hover:text-white/60'}`}>
                        <ImageIcon size={14} /> Text + Image
                      </button>
                    ) : (
                      <div title="Upgrade to Growth+ to unlock" className="flex items-center gap-2 px-4 py-2.5 text-sm border border-white/8 rounded-xl text-white/20 cursor-not-allowed">
                        <ImageIcon size={14} /> Image <span className="text-[10px] ml-1 bg-white/5 px-1.5 py-0.5 rounded">Growth+</span>
                      </div>
                    )}
                    {(effectivePlan === 'pro' || effectivePlan === 'agency' || (isAdminMode && !activeClientId)) ? (
                      <button onClick={() => setContentType('video')}
                        className={`flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border rounded-xl transition ${contentType === 'video' ? 'bg-purple-500/20 border-purple-500/40 text-purple-300' : 'bg-white/3 border-white/10 text-white/40 hover:text-white/60'}`}>
                        <Play size={14} /> Text + Video Brief
                      </button>
                    ) : (
                      <div title="Upgrade to Pro+ to unlock" className="flex items-center gap-2 px-4 py-2.5 text-sm border border-white/8 rounded-xl text-white/20 cursor-not-allowed">
                        <Play size={14} /> Video <span className="text-[10px] ml-1 bg-white/5 px-1.5 py-0.5 rounded">Pro+</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Topic input */}
              <div>
                <label className="text-xs font-semibold text-white/50 uppercase tracking-widest block mb-2">What's this post about?</label>
                <textarea
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  placeholder="e.g., '25% off all items this weekend only' — or paste your own draft and AI will polish it…"
                  className="w-full bg-black/40 border border-white/8 rounded-xl p-4 text-white resize-none min-h-[100px] text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40 transition"
                />
              </div>

              {/* Tone chips */}
              <div className="flex flex-wrap gap-2">
                {['Make it urgent', 'Short & punchy', 'More casual', 'More professional', 'Add a call to action'].map(chip => (
                  <button key={chip}
                    onClick={() => setTopic(prev => prev.trim() ? `${prev.trim()} · ${chip}` : chip)}
                    className="text-xs px-3 py-1.5 rounded-full border border-white/10 bg-white/3 text-white/35 hover:text-white/60 hover:border-white/20 transition">
                    {chip}
                  </button>
                ))}
              </div>

              {/* Post Style / Format selector */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-white/20 uppercase tracking-widest">Post style</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'standard', icon: '✨', label: 'Standard' },
                    { id: 'question', icon: '❓', label: 'Question' },
                    { id: 'tip', icon: '💡', label: 'Quick Tip' },
                    { id: 'story', icon: '📖', label: 'Micro-Story' },
                    { id: 'behindscenes', icon: '🎬', label: 'Behind the Scenes' },
                    { id: 'poll', icon: '📊', label: 'Poll / This or That' },
                    { id: 'carousel', icon: '📋', label: 'List / Carousel' },
                    { id: 'promotional', icon: '🏷️', label: 'Soft Promo' },
                  ].map(f => (
                    <button key={f.id}
                      onClick={() => setContentFormat(f.id)}
                      className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition font-medium ${
                        contentFormat === f.id
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                          : 'bg-white/3 border-white/8 text-white/30 hover:text-white/60 hover:border-white/20'
                      }`}>
                      <span>{f.icon}</span> {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick-start starters — dynamic based on business type */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-white/20 uppercase tracking-widest">Quick starts — click to use</p>
                <div className="flex flex-wrap gap-2">
                  {getQuickStarts(profile.type, profile.name).map(s => (
                    <button key={s.label}
                      onClick={() => { setTopic(s.text); setTimeout(() => { (document.querySelector('[data-auto-create]') as HTMLButtonElement)?.click(); }, 100); }}
                      disabled={isGenerating || isGeneratingImage || isGeneratingVideo}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-white/8 bg-white/2 text-white/30 hover:text-white/60 hover:border-amber-500/30 hover:bg-amber-500/5 transition disabled:opacity-30 disabled:cursor-not-allowed">
                      <span>{s.icon}</span> {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Create button */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  data-auto-create
                  onClick={handleCreatePost}
                  disabled={isGenerating || isGeneratingImage || isGeneratingVideo || !topic.trim()}
                  className="bg-gradient-to-r from-amber-500 to-orange-500 text-black font-bold px-7 py-3 rounded-xl transition flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-amber-500/20 text-sm"
                >
                  {(isGenerating || isGeneratingImage || isGeneratingVideo) ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />}
                  {isGenerating ? 'Writing caption…' : isGeneratingVideo ? 'Building video brief…' : isGeneratingImage ? 'Generating image…' : `Create ${contentType === 'image' ? 'Post + Image' : contentType === 'video' ? 'Post + Video Brief' : 'Post'}`}
                </button>
                {contentType === 'video' && (
                  <>
                    <span className="text-white/20 text-xs">or</span>
                    <button
                      onClick={() => quickPostVideoUploadRef.current?.click()}
                      className="flex items-center gap-2 px-4 py-3 text-sm font-semibold border border-white/10 bg-white/3 hover:bg-purple-500/10 hover:border-purple-500/30 text-white/40 hover:text-purple-300 rounded-xl transition"
                    >
                      <Upload size={14} /> Upload your own video
                    </button>
                    <input
                      ref={quickPostVideoUploadRef}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={handleQuickPostVideoUpload}
                    />
                  </>
                )}
                {contentType !== 'video' && (
                  <>
                    <span className="text-white/30 text-xs font-medium">or</span>
                    <button
                      onClick={() => quickPostImageUploadRef.current?.click()}
                      className="flex items-center gap-2 px-5 py-3 text-sm font-bold border-2 border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 hover:border-indigo-500/50 text-indigo-300 rounded-xl transition shadow-sm"
                    >
                      <Upload size={15} /> Upload Photo
                    </button>
                    <input
                      ref={quickPostImageUploadRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={handleQuickPostImageUpload}
                    />
                  </>
                )}
              </div>
            </div>

            {/* Generation loading skeleton with step progress */}
            {(isGenerating || isGeneratingImage || isGeneratingVideo) && !generatedContent && !generatedImage && (
              <div className="rounded-2xl border border-white/10 overflow-hidden bg-white/2 p-5 space-y-4">
                {/* Step progress for image posts */}
                {contentType === 'image' && (
                  <div className="flex items-center justify-center gap-3 pb-2">
                    {[
                      { label: 'Writing caption', active: isGenerating, done: !isGenerating && (isGeneratingImage || !!generatedContent) },
                      { label: 'Generating image', active: isGeneratingImage, done: false },
                    ].map((step, i) => (
                      <div key={step.label} className="flex items-center gap-2">
                        {i > 0 && <div className={`h-px w-8 ${step.done || step.active ? 'bg-amber-500/30' : 'bg-white/8'}`} />}
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${
                          step.done ? 'bg-green-500 text-black' : step.active ? 'bg-amber-500 text-black' : 'bg-white/8 text-white/25'
                        }`}>
                          {step.done ? <CheckCircle size={10} /> : step.active ? <Loader2 size={10} className="animate-spin" /> : i + 1}
                        </div>
                        <span className={`text-[11px] font-medium ${step.done ? 'text-green-400' : step.active ? 'text-amber-300' : 'text-white/25'}`}>
                          {step.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {/* Shimmer skeleton */}
                <div className="space-y-2.5 animate-pulse">
                  <div className="h-3 bg-white/6 rounded-full w-full" />
                  <div className="h-3 bg-white/6 rounded-full w-4/5" />
                  <div className="h-3 bg-white/6 rounded-full w-3/5" />
                </div>
                <div className="flex gap-2 animate-pulse">
                  <div className="h-5 w-16 bg-white/5 rounded-full" />
                  <div className="h-5 w-20 bg-white/5 rounded-full" />
                  <div className="h-5 w-14 bg-white/5 rounded-full" />
                </div>
                <p className="text-xs text-white/20 text-center pt-2">
                  {isGenerating ? '✍️ Writing your post…' : isGeneratingImage ? '🎨 Generating image…' : '🎬 Building video brief…'}
                </p>
              </div>
            )}

            {/* Generated Output */}
            {(generatedContent || generatedImage) && (
              <div className="rounded-2xl border border-amber-500/20 overflow-hidden shadow-xl shadow-amber-500/5"
                style={{ background: 'linear-gradient(145deg,rgba(245,158,11,0.06) 0%,rgba(13,13,26,0.95) 60%)' }}>

                {/* Card header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-white/6">
                  <span className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                    <Sparkles size={13} className="text-amber-400" /> Generated Post
                    {contentFormat !== 'standard' && (
                      <span className="text-[9px] bg-amber-500/15 text-amber-400/70 border border-amber-500/20 px-2 py-0.5 rounded-full font-semibold uppercase">
                        {contentFormat === 'behindscenes' ? 'BTS' : contentFormat}
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    {generatedContent && <span className="text-[10px] text-white/25">{generatedContent.length} chars</span>}
                    <button
                      onClick={() => { setGeneratedContent(''); setGeneratedHashtags([]); setGeneratedImage(null); setGeneratedVideoScript(null); setGeneratedVideoUrl(null); setVideoProgress(0); setIsGeneratingReel(false); }}
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
                            onClick={() => handleGenerateImage()}
                            disabled={isGeneratingImage}
                            title="Regenerate image"
                            className="bg-white/15 hover:bg-white/25 backdrop-blur border border-white/20 text-white text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 transition"
                          >
                            {isGeneratingImage ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                            Regenerate
                          </button>
                        )}
                        <button
                          onClick={() => quickPostImageUploadRef.current?.click()}
                          title="Upload your own photo"
                          className="bg-white/15 hover:bg-indigo-500/30 backdrop-blur border border-white/20 text-white text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 transition"
                        >
                          <Upload size={12} /> Upload
                        </button>
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

                  {/* Upload photo prompt when no image was generated */}
                  {generatedContent && !generatedImage && !isGeneratingImage && contentType === 'image' && (
                    <div
                      onClick={() => quickPostImageUploadRef.current?.click()}
                      className="flex-shrink-0 md:w-56 border-2 border-dashed border-white/15 hover:border-amber-500/40 rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer transition bg-white/2 hover:bg-amber-500/5 min-h-[180px] p-4"
                    >
                      <Upload size={24} className="text-white/30" />
                      <span className="text-xs text-white/40 text-center font-medium">Upload your own photo</span>
                      <span className="text-[10px] text-white/20 text-center">Drag & drop or click to browse</span>
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
                      {/* Action buttons */}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          onClick={() => {
                            const full = generatedHashtags.length
                              ? `${generatedContent}\n\n${generatedHashtags.map(t => t.startsWith('#') ? t : `#${t}`).join(' ')}`
                              : generatedContent;
                            navigator.clipboard.writeText(full);
                            toast('Copied to clipboard!', 'success');
                          }}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/40 hover:text-white/70 hover:border-white/20 transition"
                        >
                          <ClipboardList size={11} /> Copy
                        </button>
                        <button
                          onClick={handleCreatePost}
                          disabled={isGenerating}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/40 hover:text-amber-300 hover:border-amber-500/30 transition"
                        >
                          <RefreshCw size={11} /> Regenerate
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Video section — clean ticker */}
                {(isGeneratingVideo || (isGeneratingImage && contentType === 'video') || isGeneratingReel || generatedVideoScript || generatedVideoUrl) && (
                  <div className="border-t border-purple-500/15 bg-purple-950/20 px-5 py-3.5 space-y-3">

                    {/* ── Step tracker (slim) ── */}
                    <div className="flex items-center gap-2">
                      <Play size={11} className="text-purple-400 flex-shrink-0" />
                      {[
                        { label: 'Brief',     done: !!generatedVideoScript,  active: isGeneratingVideo },
                        { label: 'Thumbnail', done: !!generatedVideoScript && !isGeneratingImage && (isGeneratingReel || !!generatedVideoUrl), active: isGeneratingImage && contentType === 'video' },
                        { label: 'Video',     done: !!generatedVideoUrl,     active: isGeneratingReel },
                      ].map((step, i) => (
                        <React.Fragment key={step.label}>
                          {i > 0 && <div className={`h-px w-6 flex-shrink-0 ${step.done || (i === 1 && !!generatedVideoScript) ? 'bg-purple-500/30' : 'bg-white/8'}`} />}
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black flex-shrink-0 transition-all ${
                              step.done ? 'bg-green-500 text-black' : step.active ? 'bg-purple-500 text-white' : 'bg-white/8 text-white/25'
                            }`}>
                              {step.done ? <CheckCircle size={9} /> : step.active ? <Loader2 size={8} className="animate-spin" /> : i + 1}
                            </div>
                            <span className={`text-[11px] font-medium ${step.done ? 'text-green-400' : step.active ? 'text-purple-300' : 'text-white/25'}`}>
                              {step.label}
                            </span>
                          </div>
                        </React.Fragment>
                      ))}
                      {generatedVideoUrl && (
                        <span className="ml-auto text-[10px] text-green-400 flex items-center gap-1 flex-shrink-0"><CheckCircle size={9} /> Ready</span>
                      )}
                    </div>

                    {/* ── Status line ── */}
                    {(isGeneratingVideo || (isGeneratingImage && contentType === 'video') || isGeneratingReel) && (
                      <div className="flex items-center gap-2">
                        <Loader2 size={12} className="animate-spin text-purple-400 flex-shrink-0" />
                        <span className="text-xs text-white/50">
                          {isGeneratingVideo && 'Writing video script & shot list…'}
                          {isGeneratingImage && contentType === 'video' && 'Generating thumbnail image…'}
                          {isGeneratingReel && `Generating your Reel via fal.ai (Kling) — this takes 1–3 min…`}
                        </span>
                        {isGeneratingReel && (
                          <span className="ml-auto text-xs font-bold text-purple-300 flex-shrink-0">{Math.round(videoProgress * 100)}%</span>
                        )}
                      </div>
                    )}

                    {/* ── Progress bar (video only) ── */}
                    {isGeneratingReel && (
                      <div className="h-1 bg-white/8 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-700"
                          style={{ width: `${Math.max(5, Math.round(videoProgress * 100))}%` }}
                        />
                      </div>
                    )}

                    {/* ── Video ready: small preview ── */}
                    {generatedVideoUrl && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <div className="relative w-10 flex-shrink-0 rounded-lg overflow-hidden bg-black border border-purple-500/30" style={{ aspectRatio: '9/16' }}>
                            <video src={generatedVideoUrl} className="w-full h-full object-cover" autoPlay loop muted playsInline />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-green-400">Video ready — click Publish Now to post</p>
                            {generatedVideoScript && (
                              <button onClick={() => setShowVideoBriefDetail(v => !v)} className="flex items-center gap-1 text-[11px] text-purple-400/60 hover:text-purple-300 transition mt-0.5">
                                {showVideoBriefDetail ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                                {showVideoBriefDetail ? 'Hide script' : 'View script'}
                              </button>
                            )}
                          </div>
                        </div>
                        {generatedVideoScript?.mood && !mixedVideoUrl && (
                          <div className="flex items-center gap-2 bg-pink-500/8 border border-pink-500/15 rounded-xl px-3 py-2">
                            <span className="text-sm flex-shrink-0">🎵</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[11px] font-bold text-pink-300/80">Suggested vibe: <span className="text-white/70 font-medium">{generatedVideoScript.mood}</span></p>
                            </div>
                            <button
                              onClick={handleAddAudio}
                              disabled={isMixingAudio}
                              className="flex items-center gap-1.5 text-[11px] font-bold text-pink-300 hover:text-white bg-pink-500/15 hover:bg-pink-500/25 border border-pink-500/20 px-2.5 py-1.5 rounded-lg transition flex-shrink-0 disabled:opacity-50"
                            >
                              {isMixingAudio ? <Loader2 size={10} className="animate-spin" /> : <span>🎵</span>}
                              {isMixingAudio ? `Mixing… ${Math.round(audioMixProgress * 100)}%` : 'Add Music'}
                            </button>
                          </div>
                        )}
                        {mixedVideoUrl && (
                          <div className="flex items-center gap-2 bg-green-500/8 border border-green-500/15 rounded-xl px-3 py-2">
                            <CheckCircle size={12} className="text-green-400 flex-shrink-0" />
                            <p className="text-[11px] font-bold text-green-300 flex-1">Music added!</p>
                            <a
                              href={mixedVideoUrl}
                              download="reel-with-music.webm"
                              className="text-[11px] font-bold text-green-300 hover:text-white bg-green-500/15 hover:bg-green-500/25 border border-green-500/20 px-2.5 py-1.5 rounded-lg transition flex-shrink-0"
                            >
                              ⬇ Download
                            </a>
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Script done, awaiting reel ── */}
                    {generatedVideoScript && !generatedVideoUrl && !isGeneratingReel && !isGeneratingImage && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <CheckCircle size={11} className="text-green-400 flex-shrink-0" />
                          <p className="text-xs text-white/50 flex-1 truncate">Script ready — <span className="text-white/70 font-medium">"{generatedVideoScript.hook}"</span></p>
                          <button onClick={() => setShowVideoBriefDetail(v => !v)} className="flex items-center gap-1 text-[11px] text-purple-400/60 hover:text-purple-300 transition flex-shrink-0">
                            {showVideoBriefDetail ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                            {showVideoBriefDetail ? 'Hide' : 'View script'}
                          </button>
                        </div>
                        <button
                          onClick={() => quickPostVideoUploadRef.current?.click()}
                          className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-xl border border-purple-500/20 bg-purple-500/8 text-purple-300/70 hover:text-purple-200 hover:bg-purple-500/15 transition w-fit"
                        >
                          <Upload size={12} /> Upload your own video instead
                        </button>
                      </div>
                    )}

                    {/* ── Expandable script ── */}
                    {showVideoBriefDetail && generatedVideoScript && (
                      <div className="border-t border-purple-500/10 pt-3 space-y-3">
                        <div className="bg-black/30 border border-white/6 rounded-xl px-4 py-3 text-xs text-white/55 whitespace-pre-wrap leading-relaxed">{generatedVideoScript.script}</div>
                        {generatedVideoScript.shots.length > 0 && (
                          <div className="space-y-1.5">
                            {generatedVideoScript.shots.map((shot, i) => (
                              <div key={i} className="flex gap-2.5 text-xs">
                                <span className="w-4 h-4 rounded-full bg-purple-500/15 text-purple-400 text-[9px] font-black flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                                <p className="text-white/45 leading-relaxed">{shot}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Footer actions */}
                <div className="flex flex-wrap gap-2.5 items-center px-5 py-4 border-t border-white/6 bg-black/15">
                  <DateTimePicker value={scheduleDate} onChange={setScheduleDate} />
                  <button
                    onClick={handleSavePost}
                    className="bg-gradient-to-r from-green-600 to-emerald-600 hover:opacity-90 text-white font-bold px-5 py-2 rounded-xl flex items-center gap-2 transition text-sm shadow-lg shadow-green-500/15"
                  >
                    <Save size={14} /> {scheduleDate ? 'Schedule Post' : 'Save Draft'}
                  </button>
                  {generatedContent && (
                    <button
                      onClick={() => setShowPreview(true)}
                      className="bg-white/6 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white font-semibold px-4 py-2 rounded-xl flex items-center gap-2 transition text-sm"
                    >
                      <Eye size={14} /> Full Preview
                    </button>
                  )}
                  {fbConnected && (
                    <button
                      onClick={() => handlePublishDirect([platform.toLowerCase() as 'facebook' | 'instagram'])}
                      disabled={isPublishing || isGeneratingReel}
                      title={isGeneratingReel ? 'Wait for video to finish generating before publishing' : `Publish to ${platform}`}
                      className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:opacity-90 text-white font-bold px-5 py-2 rounded-xl flex items-center gap-2 disabled:opacity-60 transition text-sm shadow-lg shadow-blue-500/15"
                    >
                      {isPublishing ? <Loader2 size={14} className="animate-spin" /> : isGeneratingReel ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      {isGeneratingReel ? 'Generating video…' : `Publish to ${platform}`}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── Live Post Preview (auto-show when content generated) ── */}
            {generatedContent && (
              <div className="mt-4 pb-6">
                <LivePostPreview
                  platform={platform}
                  profileName={profile.name}
                  profileLogo={profile.logoUrl || undefined}
                  content={generatedContent}
                  hashtags={generatedHashtags}
                  image={generatedImage}
                  videoUrl={generatedVideoUrl}
                  isGeneratingReel={isGeneratingReel}
                  videoProgress={videoProgress}
                  contentType={contentType}
                />
              </div>
            )}

          </div>
        )}

        {/* ═══ HOME TAB ═══ */}
        {activeTab === 'home' && (
          <HomeDashboard
            posts={posts}
            stats={stats}
            liveStats={liveStats}
            hasApiKey={hasApiKey}
            fbConnected={fbConnected}
            activePlan={effectivePlan}
            planName={planCfg?.name}
            businessName={authMode === 'portal' ? (CLIENT.defaultBusinessName || profile.name) : (profile.name || CLIENT.defaultBusinessName)}
            onGoCalendar={() => setActiveTab('calendar')}
            onGoCreate={() => { setActiveTab('smart'); setSmartSubMode('quickpost'); }}
            onGoSchedule={() => { setActiveTab('smart'); setSmartSubMode('autopilot'); }}
            onGoInsights={() => setActiveTab('insights')}
            onGoSettings={() => setActiveTab('settings')}
          />
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
              <div className="flex items-center gap-2 flex-wrap">
                {/* Sync statuses button */}
                <button
                  onClick={handleManualSync}
                  disabled={!fbConnected}
                  className="flex items-center gap-1.5 text-xs font-bold text-blue-300 hover:text-white bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/25 px-3 py-1.5 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Check if scheduled posts were published"
                >
                  <RefreshCw size={11} /> Sync Status
                </button>
                {posts.some(p => p.status === 'Missed') && (
                  <button
                    onClick={async () => {
                      const missed = posts.filter(p => p.status === 'Missed');
                      await db.bulkUpdatePostStatus(missed.map(p => p.id), 'Draft');
                      setPosts(prev => prev.map(p => p.status === 'Missed' ? { ...p, status: 'Draft' as const } : p));
                      toast(`${missed.length} missed post${missed.length > 1 ? 's' : ''} reset to Draft.`);
                    }}
                    className="flex items-center gap-1.5 text-xs font-bold text-red-300 hover:text-white bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 px-3 py-1.5 rounded-xl transition"
                  >
                    <RefreshCw size={11} /> Clear {posts.filter(p => p.status === 'Missed').length} missed
                  </button>
                )}
                {posts.length > 0 && (
                  <span className="text-xs text-white/25 bg-white/5 border border-white/8 px-3 py-1.5 rounded-xl">
                    {posts.filter(p => p.status === 'Scheduled').length} scheduled · {posts.filter(p => p.status === 'Posted').length} posted
                  </span>
                )}
              </div>
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
                  if (!socialTokens.facebookPageId) { toast('Connect Facebook in Settings first.', 'warning'); return; }
                  const imageSource = calendarImages[post.id] || post.image;
                  const imageUrl = imageSource?.startsWith('http') ? imageSource : undefined;
                  if (post.platform === 'Facebook') {
                    if (imageUrl) {
                      await FacebookService.postToPageWithImageUrl(socialTokens.facebookPageId, socialTokens.facebookPageAccessToken, text, imageUrl);
                    } else if (imageSource?.startsWith('data:')) {
                      await FacebookService.postToPageDirect(socialTokens.facebookPageId, socialTokens.facebookPageAccessToken, text, imageSource);
                    } else {
                      await FacebookService.postToPageDirect(socialTokens.facebookPageId, socialTokens.facebookPageAccessToken, text);
                    }
                  } else if (post.platform === 'Instagram' && socialTokens.instagramBusinessAccountId && imageUrl) {
                    await FacebookService.postToInstagram(socialTokens.instagramBusinessAccountId, socialTokens.facebookPageAccessToken, text, imageUrl);
                  }
                  setPosts(prev => prev.map(p => p.id === post.id ? { ...p, status: 'Posted' as const } : p));
                  await db.updatePost(post.id, { status: 'Posted' });
                  toast('Published successfully!', 'success');
                } catch (e: any) { toast(`Publish failed: ${e?.message?.substring(0, 80)}`, 'error'); }
              }}
              onRetry={async (post) => {
                try {
                  const text = post.hashtags?.length ? `${post.content}\n\n${post.hashtags.join(' ')}` : post.content;
                  if (!socialTokens.facebookPageId) { toast('Connect Facebook in Settings first.', 'warning'); return; }
                  const imageSource = calendarImages[post.id] || post.image;
                  const imageUrl = imageSource?.startsWith('http') ? imageSource : undefined;
                  if (post.platform === 'Facebook') {
                    if (imageUrl) {
                      await FacebookService.postToPageWithImageUrl(socialTokens.facebookPageId, socialTokens.facebookPageAccessToken, text, imageUrl);
                    } else if (imageSource?.startsWith('data:')) {
                      await FacebookService.postToPageDirect(socialTokens.facebookPageId, socialTokens.facebookPageAccessToken, text, imageSource);
                    } else {
                      await FacebookService.postToPageDirect(socialTokens.facebookPageId, socialTokens.facebookPageAccessToken, text);
                    }
                  } else if (post.platform === 'Instagram' && socialTokens.instagramBusinessAccountId && imageUrl) {
                    await FacebookService.postToInstagram(socialTokens.instagramBusinessAccountId, socialTokens.facebookPageAccessToken, text, imageUrl);
                  }
                  await db.updatePost(post.id, { status: 'Posted' });
                  setPosts(prev => prev.map(p => p.id === post.id ? { ...p, status: 'Posted' as const } : p));
                  toast('Post published successfully!', 'success');
                } catch (e: any) { toast(`Retry failed: ${e?.message?.substring(0, 80)}`, 'error'); }
              }}
              onRegenImage={handleCalendarRegenImage}
              onUpload={handleCalendarUpload}
              onGoCreate={() => { setActiveTab('smart'); setSmartSubMode('quickpost'); }}
              onGoSmart={() => setActiveTab('smart')}
            />
          </div>
        )}

        {/* ═══ SMART AI TAB ═══ */}
        {activeTab === 'smart' && (() => {
          const now = new Date();
          const upcomingPosts = posts.filter(p => new Date(p.scheduledFor) > now).sort((a,b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
          const nextPost = upcomingPosts[0];
          const canUseVideos = effectivePlan === 'pro' || effectivePlan === 'agency';
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
              activePlan={effectivePlan}
              planName={planCfg?.name}
              lastPulled={lastPulled}
              onGoToSettings={() => setActiveTab('settings')}
            />

            {/* ── Sub-mode toggle ── */}
            <div className="flex gap-1 p-1 bg-white/3 border border-white/8 rounded-2xl w-fit">
              <button
                onClick={() => setSmartSubMode('autopilot')}
                className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition ${
                  smartSubMode === 'autopilot'
                    ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-black shadow-lg shadow-amber-900/30'
                    : 'text-white/40 hover:text-white/60'
                }`}
              >
                <Brain size={14} /> AI Autopilot
              </button>
              <button
                onClick={() => setSmartSubMode('quickpost')}
                className={`flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold transition ${
                  smartSubMode === 'quickpost'
                    ? 'bg-white/10 text-white border border-white/15'
                    : 'text-white/40 hover:text-white/60'
                }`}
              >
                <Wand2 size={14} /> Quick Post
              </button>
            </div>

            {/* ── AUTOPILOT MODE ── */}
            {smartSubMode === 'autopilot' && (<>

            {/* ── CAMPAIGNS — Create Hub Section ── */}
            <div className="glass rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-white flex items-center gap-2">
                    <Target size={16} className="text-amber-400" /> Campaigns
                  </h3>
                  <p className="text-[11px] text-white/30 mt-0.5">Set a goal with a date range and rules — the AI weaves it into every post it generates. Countdowns, urgency, themes — all automatic.</p>
                </div>
                <button
                  onClick={async () => {
                    const id = await db.createCampaign({
                      clientId: activeClientId, name: 'New Campaign', type: 'custom',
                      startDate: new Date().toISOString().split('T')[0],
                      endDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
                      rules: '', postsPerDay: 1, enabled: true,
                    });
                    setCampaigns(prev => [...prev, {
                      id, name: 'New Campaign', type: 'custom' as const,
                      startDate: new Date().toISOString().split('T')[0],
                      endDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
                      rules: '', postsPerDay: 1, enabled: true, createdAt: new Date().toISOString(),
                    }]);
                  }}
                  className="flex items-center gap-1.5 text-xs font-bold text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 px-3 py-1.5 rounded-lg transition press flex-shrink-0"
                >
                  <Plus size={13} /> New
                </button>
              </div>

              {campaigns.filter(c => c.enabled).length === 0 ? (
                <div className="bg-white/3 border border-dashed border-white/10 rounded-xl p-6 text-center">
                  <p className="text-white/20 text-xs">No active campaigns. Posts will use your business profile only.</p>
                  <p className="text-white/12 text-[10px] mt-1">Create a campaign for a sale, event launch, seasonal push, or any time-boxed goal.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {campaigns.filter(c => c.enabled && new Date(c.endDate) >= new Date()).map(c => (
                    <CampaignCard
                      key={c.id}
                      campaign={c}
                      onUpdate={async (id, fields) => {
                        await db.updateCampaign(id, fields);
                        if (fields.enabled === false) {
                          setCampaigns(prev => prev.map(x => x.id === id ? { ...x, enabled: false } : x));
                          toast('Campaign paused');
                        }
                      }}
                      onFieldChange={(id, field, value) => {
                        setCampaigns(prev => prev.map(x => x.id === id ? { ...x, [field]: value } : x));
                      }}
                      onDelete={async (id) => {
                        await db.deleteCampaign(id);
                        setCampaigns(prev => prev.filter(x => x.id !== id));
                        toast('Campaign deleted');
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* ── AI Content Generator ── */}
            <div className="bg-gradient-to-br from-[#0d0d14] via-[#111118] to-[#0d0d14] rounded-3xl p-7 relative overflow-hidden border border-white/10">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(245,158,11,0.10),transparent_55%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_20%,rgba(139,92,246,0.06),transparent_55%)]" />
              <div className="relative z-10 space-y-5">
                <div>
                  <h2 className="text-2xl font-black text-white flex items-center gap-2">
                    <Sparkles size={22} className="text-amber-400" /> Generate Content
                  </h2>
                  <p className="text-white/35 text-sm mt-1">Researches your industry, audience & platform algorithms — then writes your entire content calendar in one click.</p>
                </div>

                {/* Vibe Mode selector */}
                <div>
                  <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2">Choose your vibe</p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {/* Smart Schedule */}
                    <button
                      onClick={() => { setAutopilotMode('smart'); setSmartCount(7); }}
                      className={`flex flex-col gap-1 px-3 py-3 rounded-xl border text-left transition ${
                        autopilotMode === 'smart' ? 'bg-amber-500/15 border-amber-500/40' : 'bg-white/3 border-white/8 hover:border-white/20'
                      }`}
                    >
                      <span className="text-base">📅</span>
                      <span className={`text-xs font-bold ${autopilotMode === 'smart' ? 'text-amber-300' : 'text-white/50'}`}>Smart Schedule</span>
                      <span className="text-[10px] text-white/25 leading-tight">Best times, 1–2 weeks</span>
                    </button>
                    {/* Quick 24hr */}
                    <button
                      onClick={() => { setAutopilotMode('quick24h'); setSmartCount(3); }}
                      className={`flex flex-col gap-1 px-3 py-3 rounded-xl border text-left transition ${
                        autopilotMode === 'quick24h' ? 'bg-blue-500/15 border-blue-500/40' : 'bg-white/3 border-white/8 hover:border-white/20'
                      }`}
                    >
                      <span className="text-base">⚡</span>
                      <span className={`text-xs font-bold ${autopilotMode === 'quick24h' ? 'text-blue-300' : 'text-white/50'}`}>Quick 24hr Burst</span>
                      <span className="text-[10px] text-white/25 leading-tight">3–5 posts today</span>
                    </button>
                    {/* Highlights Only */}
                    <button
                      onClick={() => {
                        const canUse = activePlan === 'growth' || activePlan === 'pro' || activePlan === 'agency' || isAdminMode;
                        if (!canUse) { toast('Highlights Only requires a Growth plan or above.', 'warning'); return; }
                        setAutopilotMode('highlights'); setSmartCount(5);
                      }}
                      className={`flex flex-col gap-1 px-3 py-3 rounded-xl border text-left transition ${
                        autopilotMode === 'highlights' ? 'bg-green-500/15 border-green-500/40' : 'bg-white/3 border-white/8 hover:border-white/20'
                      } ${!(activePlan === 'growth' || activePlan === 'pro' || activePlan === 'agency' || isAdminMode) ? 'opacity-50' : ''}`}
                    >
                      <span className="text-base">🏆</span>
                      <span className={`text-xs font-bold flex items-center gap-1 ${autopilotMode === 'highlights' ? 'text-green-300' : 'text-white/50'}`}>
                        Highlights Only
                        {!(activePlan === 'growth' || activePlan === 'pro' || activePlan === 'agency' || isAdminMode) && <span className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded-full">Growth</span>}
                      </span>
                      <span className="text-[10px] text-white/25 leading-tight">Peak slots only</span>
                    </button>
                    {/* Saturation */}
                    <button
                      onClick={() => {
                        if (!canUseSaturation) { toast('Saturation Mode is a Pro plan feature.', 'warning'); return; }
                        setAutopilotMode('saturation'); setSmartCount(21);
                      }}
                      className={`flex flex-col gap-1 px-3 py-3 rounded-xl border text-left transition ${
                        autopilotMode === 'saturation' ? 'bg-red-500/15 border-red-500/40' : 'bg-white/3 border-white/8 hover:border-white/20'
                      } ${!canUseSaturation ? 'opacity-50' : ''}`}
                    >
                      <span className="text-base">🔥</span>
                      <span className={`text-xs font-bold flex items-center gap-1 ${autopilotMode === 'saturation' ? 'text-red-300' : 'text-white/50'}`}>
                        Saturation
                        {!canUseSaturation && <span className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded-full">Pro</span>}
                      </span>
                      <span className="text-[10px] text-white/25 leading-tight">3–5 posts/day, 7 days</span>
                    </button>
                  </div>
                </div>

                {/* Mode hint */}
                {autopilotMode === 'quick24h' && (
                  <div className="bg-blue-500/8 border border-blue-500/15 rounded-xl px-4 py-3">
                    <p className="text-xs text-blue-300 font-semibold">⚡ Quick 24hr Burst: generates 3–5 high-energy posts scheduled across the best windows in the next 24 hours — ideal for promotions, events, or when you need results fast.</p>
                  </div>
                )}
                {autopilotMode === 'highlights' && (
                  <div className="bg-green-500/8 border border-green-500/15 rounded-xl px-4 py-3">
                    <p className="text-xs text-green-300 font-semibold">🏆 Highlights Only: AI identifies the absolute top 3 researched time slots and places one polished, pillar-defining post at each — quality over quantity.</p>
                  </div>
                )}
                {autopilotMode === 'saturation' && (
                  <div className="bg-red-500/8 border border-red-500/15 rounded-xl px-4 py-3">
                    <p className="text-xs text-red-300 font-semibold">🔥 Saturation: 3–5 posts per day over 7 days — maximum algorithmic reach through volume and content variety.</p>
                  </div>
                )}

                {/* Platform selector — only show platforms that are connected */}
                <div>
                  <label className="text-[10px] font-semibold text-white/30 uppercase tracking-widest block mb-1.5">Post to</label>
                  {(() => {
                    const hasFb = fbConnected;
                    const hasIg = !!socialTokens.instagramBusinessAccountId;
                    const availableOpts = [
                      ...(hasFb && hasIg ? ['both' as const] : []),
                      ...(hasFb ? ['facebook' as const] : []),
                      ...(hasIg ? ['instagram' as const] : []),
                    ];
                    // If nothing is connected, show all as disabled
                    if (availableOpts.length === 0) {
                      return (
                        <div className="text-xs text-white/30 bg-white/3 border border-white/10 rounded-xl px-4 py-3">
                          No platforms connected. <button onClick={() => setActiveTab('settings')} className="text-amber-400 underline">Connect in Settings →</button>
                        </div>
                      );
                    }
                    // Auto-select first available if current selection isn't valid
                    if (!availableOpts.includes(autopilotPlatform) && availableOpts.length > 0) {
                      setTimeout(() => setAutopilotPlatform(availableOpts[0]), 0);
                    }
                    return (
                      <div className="flex rounded-xl overflow-hidden border border-white/10 w-fit">
                        {availableOpts.map(opt => (
                          <button
                            key={opt}
                            onClick={() => setAutopilotPlatform(opt)}
                            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-semibold transition ${
                              autopilotPlatform === opt
                                ? opt === 'instagram'
                                  ? 'bg-gradient-to-r from-pink-600 to-purple-600 text-white'
                                  : opt === 'facebook'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-gradient-to-r from-blue-600 to-purple-600 text-white'
                                : 'bg-transparent text-white/30 hover:text-white/60'
                            }`}
                          >
                            {opt === 'facebook' && <Facebook size={13} />}
                            {opt === 'instagram' && <Instagram size={13} />}
                            {opt === 'both' && <span className="text-[11px]">f + 📸</span>}
                            {opt === 'both' ? 'Both' : opt.charAt(0).toUpperCase() + opt.slice(1)}
                          </button>
                        ))}
                      </div>
                    );
                  })()}
                </div>

                {/* Include Reels toggle */}
                <button
                  onClick={() => {
                    if (!canUseVideos) { toast('Short Video posts require a Pro plan.', 'warning'); return; }
                    setIncludeVideos(v => !v);
                  }}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-semibold transition w-fit ${
                    includeVideos ? 'bg-purple-500/15 border-purple-500/40 text-purple-300' : 'bg-white/3 border-white/10 text-white/40 hover:text-white/60'
                  } ${!canUseVideos ? 'opacity-50' : ''}`}
                >
                  🎬 Include Reels/Videos
                  {!canUseVideos && <span className="text-[9px] bg-white/10 px-1.5 py-0.5 rounded-full">Pro</span>}
                </button>
                {includeVideos && (
                  <div className="bg-purple-500/8 border border-purple-500/15 rounded-xl px-4 py-3">
                    <p className="text-xs text-purple-300 font-semibold">🎬 Reels included: AI generates video scripts, shot-by-shot briefs and music mood alongside your regular posts.</p>
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
                      {autopilotMode === 'saturation'
                        ? [<option key={14} value={14}>14 posts (2/day)</option>, <option key={21} value={21}>21 posts (3/day)</option>, <option key={28} value={28}>28 posts (4/day)</option>]
                        : autopilotMode === 'quick24h'
                          ? [<option key={3} value={3}>3 posts</option>, <option key={4} value={4}>4 posts</option>, <option key={5} value={5}>5 posts</option>]
                          : autopilotMode === 'highlights'
                            ? [<option key={3} value={3}>3 posts (top 3 slots)</option>, <option key={5} value={5}>5 posts (top 5 slots)</option>]
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
                </div>
              </div>
            </div>

            {/* Generation Ticker */}
            {isSmartGenerating && (
              <div className="bg-white/3 border border-white/8 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                      smartGenPhase === 'writing' ? 'bg-purple-500/15' : 'bg-amber-500/15'
                    }`}>
                      <Loader2 size={16} className={`animate-spin ${
                        smartGenPhase === 'writing' ? 'text-purple-400' : 'text-amber-400'
                      }`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-amber-300">{TICKER_STEPS[tickerIdx]?.label}</p>
                        {smartGenPhase && (
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            smartGenPhase === 'writing'
                              ? 'bg-purple-500/20 text-purple-300'
                              : 'bg-amber-500/20 text-amber-300'
                          }`}>
                            {smartGenPhase === 'researching' ? 'Phase 1: Researching' : 'Phase 2: Writing posts'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-white/25 mt-0.5">This can take 30–60 seconds — two AI calls for research + content</p>
                    </div>
                  </div>
                  <button
                    onClick={() => { setIsSmartGenerating(false); setSmartGenPhase(null); }}
                    className="text-xs text-white/25 hover:text-white/60 border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-lg transition flex items-center gap-1.5"
                    title="Cancel generation"
                  >
                    <X size={11} /> Cancel
                  </button>
                </div>
                <div className="w-full bg-white/8 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-700 ${
                      smartGenPhase === 'writing'
                        ? 'bg-gradient-to-r from-purple-400 to-pink-500'
                        : 'bg-gradient-to-r from-amber-400 to-orange-500'
                    }`}
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
                {/* Restored draft banner */}
                {draftRestoredAt && (
                  <div className="bg-amber-500/8 border border-amber-500/25 rounded-2xl px-5 py-3.5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-lg flex-shrink-0">📋</span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-amber-300">Draft restored from previous session</p>
                        <p className="text-xs text-white/40 mt-0.5">
                          {smartPosts.length} posts saved {Math.round((Date.now() - draftRestoredAt) / 60000) < 60
                            ? `${Math.round((Date.now() - draftRestoredAt) / 60000)} min ago`
                            : `${Math.round((Date.now() - draftRestoredAt) / 3600000)} hr ago`
                          } — accept them below or generate a new set.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => { clearDraft(activeClientId); setSmartPosts([]); setSmartStrategy(''); setDraftRestoredAt(null); }}
                      className="text-xs text-white/30 hover:text-white/60 border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 flex-shrink-0"
                    >
                      <X size={11} /> Discard
                    </button>
                  </div>
                )}

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
                  <div className="flex flex-col items-end gap-1.5">
                    <button
                      onClick={handleAcceptSmartPosts}
                      disabled={isAccepting}
                      className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:opacity-90 text-white font-black px-6 py-3 rounded-xl flex items-center gap-2 text-sm shadow-lg shadow-green-900/30 transition min-w-[220px] justify-center"
                    >
                      {isAccepting ? (
                        <><Loader2 size={16} className="animate-spin" /> Saving {acceptSaved} of {smartPosts.length}…</>
                      ) : (
                        <><CheckCircle size={16} /> Accept All & Add to Calendar</>
                      )}
                    </button>
                    {isAccepting && (
                      <div className="w-full min-w-[220px] bg-white/10 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-green-400 to-emerald-400 rounded-full transition-all duration-300"
                          style={{ width: `${acceptProgress}%` }}
                        />
                      </div>
                    )}
                  </div>
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
                          onClick={() => {
                            setVideoModalUrl(null);
                            setVideoModalError(null);
                            setVideoModalProgress(0);
                            setVideoModalGenerating(false);
                            setVideoScriptModal({
                              hookText: (sp as any).videoScript
                                ? (sp as any).videoScript.split(/Hook:|Body:|CTA:/).find((s: string) => s.trim())?.replace(/^['"]/, '').trim() ?? sp.content
                                : sp.content,
                              script: (sp as any).videoScript,
                              shots: (sp as any).videoShots,
                              mood: (sp as any).videoMood,
                              imageUrl: (sp as any).imageUrl || undefined,
                              imagePrompt: (sp as any).imagePrompt || undefined,
                            });
                          }}
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
                <div className="space-y-2">
                  <button
                    onClick={handleAcceptSmartPosts}
                    disabled={isAccepting}
                    className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:opacity-90 text-white font-black py-4 rounded-2xl flex items-center justify-center gap-2 text-base shadow-xl shadow-green-900/20 transition"
                  >
                    {isAccepting ? (
                      <><Loader2 size={18} className="animate-spin" /> Saving {acceptSaved} of {smartPosts.length}…</>
                    ) : (
                      <><CheckCircle size={18} /> Accept All {smartPosts.length} Posts & Add to Calendar</>
                    )}
                  </button>
                  {isAccepting && (
                    <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-green-400 to-emerald-400 rounded-full transition-all duration-300"
                        style={{ width: `${acceptProgress}%` }}
                      />
                    </div>
                  )}
                </div>
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

            </>)}
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
                <button
                    onClick={handleScanPastPosts}
                    disabled={isScanningPosts || isAnalyzing}
                    className="flex items-center gap-2 text-xs bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 hover:border-blue-500/35 text-blue-300/70 hover:text-blue-300 px-4 py-2 rounded-xl transition disabled:opacity-40"
                    title="Analyse your posts and generate data-driven insights"
                  >
                    {isScanningPosts ? <Loader2 size={13} className="animate-spin" /> : <BarChart3 size={13} />}
                    {isScanningPosts ? 'Scanning posts…' : 'Scan Past Posts'}
                  </button>
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
            {/* AI Insights are always available */}
            <div className="bg-green-500/8 border border-green-500/20 rounded-2xl p-6 text-center space-y-3">
              <Sparkles size={28} className="text-green-400 mx-auto" />
              <p className="text-white/60 font-semibold">AI Insights are powered by OpenRouter</p>
              <button onClick={() => setActiveTab('settings')} className="text-xs text-amber-400 underline hover:text-amber-300 transition">Go to Settings →</button>
            </div>

            {/* Progress ticker */}
            {(isAnalyzing || isScanningPosts) && (
              <div className="rounded-2xl border border-amber-500/20 overflow-hidden"
                style={{ background: 'linear-gradient(135deg,rgba(245,158,11,0.07) 0%,rgba(10,10,20,0.97) 60%)' }}>
                <div className="px-6 py-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center flex-shrink-0">
                      <Loader2 size={18} className="animate-spin text-amber-400" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">
                        {isScanningPosts ? 'Scanning Past Posts…' : 'Generating AI Insights…'}
                      </p>
                      <p className="text-xs text-white/40">Powered by Claude AI</p>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full bg-white/8 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-amber-400 to-orange-400 rounded-full transition-all duration-700"
                      style={{ width: `${insightTickerSteps[insightTickerIdx]?.pct ?? 5}%` }}
                    />
                  </div>

                  {/* Step list */}
                  <div className="space-y-1.5">
                    {insightTickerSteps.map((step, i) => {
                      const done = i < insightTickerIdx;
                      const active = i === insightTickerIdx;
                      return (
                        <div key={i} className={`flex items-center gap-2.5 text-xs transition-all duration-500 ${active ? 'opacity-100' : done ? 'opacity-35' : 'opacity-15'}`}>
                          <div className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${done ? 'bg-emerald-500/30 text-emerald-400' : active ? 'bg-amber-500/25 text-amber-400' : 'bg-white/5 text-white/20'}`}>
                            {done ? <CheckCircle size={10} /> : active ? <Loader2 size={9} className="animate-spin" /> : <div className="w-1.5 h-1.5 rounded-full bg-current" />}
                          </div>
                          <span className={active ? 'text-white font-medium' : done ? 'text-white/50' : 'text-white/20'}>{step.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
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
                      <div key={i} className={`border rounded-2xl p-4 ${colors[rec.priority]}`}>
                        <div className="flex gap-3 items-start">
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full mt-0.5 shrink-0 ${badges[rec.priority]}`}>
                            {rec.priority.toUpperCase()}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white/85">{rec.title}</p>
                            <p className="text-xs text-white/45 mt-0.5 leading-relaxed">{rec.detail}</p>
                          </div>
                        </div>
                        <div className="flex gap-2 mt-3 ml-10">
                          <button
                            onClick={() => {
                              setTopic(`${rec.title}: ${rec.detail}`);
                              setActiveTab('smart'); setSmartSubMode('quickpost');
                              toast('Recommendation loaded — hit Generate in Quick Post!', 'success');
                            }}
                            className="flex items-center gap-1.5 text-xs font-bold text-white/60 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-xl transition"
                          >
                            <Wand2 size={11} /> Create Post
                          </button>
                          <button
                            onClick={() => {
                              setTopic(`${rec.title}: ${rec.detail}`);
                              setActiveTab('smart'); setSmartSubMode('quickpost');
                              toast('Recommendation loaded — generate and schedule your post!', 'success');
                            }}
                            className="flex items-center gap-1.5 text-xs font-bold text-amber-300/70 hover:text-amber-300 bg-amber-500/8 hover:bg-amber-500/15 border border-amber-500/15 hover:border-amber-500/25 px-3 py-1.5 rounded-xl transition"
                          >
                            <Calendar size={11} /> Schedule
                          </button>
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

        {/* ═══ CLIENTS TAB ═══ */}
        {activeTab === 'clients' && (
          <div className="space-y-6">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-2xl font-bold flex items-center gap-2.5"><Users className="text-emerald-400" size={22} /> Client Workspaces</h2>
                <p className="text-sm text-white/40 mt-1">Manage each client's workspace, social connections, and content independently.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-center bg-white/3 border border-white/8 rounded-xl px-4 py-2">
                  <p className="text-xl font-black text-white">{clients.length}</p>
                  <p className="text-[10px] text-white/30 uppercase tracking-wider">Active</p>
                </div>
                <div className="text-center bg-white/3 border border-white/8 rounded-xl px-4 py-2">
                  <p className="text-xl font-black text-emerald-400">{clients.length}</p>
                  <p className="text-[10px] text-white/30 uppercase tracking-wider">Total</p>
                </div>
                <div className="text-center bg-white/3 border border-white/8 rounded-xl px-4 py-2">
                  <p className="text-xl font-black text-white/40">{Math.max(0, agencyClientLimit - clients.length)}</p>
                  <p className="text-[10px] text-white/30 uppercase tracking-wider">Slots free</p>
                </div>
              </div>
            </div>

            {/* Billing model info */}
            <div className="bg-blue-500/6 border border-blue-500/15 rounded-2xl px-5 py-4 flex gap-3">
              <Info size={15} className="text-blue-400 shrink-0 mt-0.5" />
              <div className="text-xs text-white/40 leading-relaxed space-y-1">
                <p><span className="text-blue-300 font-semibold">Agency billing model: </span>Your single Agency plan covers all client workspaces. You bill each client directly at your own rate — they never interact with SocialAI Studio billing.</p>
                <p>Each workspace has its own AI business profile, content calendar, social media connection, and Smart AI schedule — fully isolated.</p>
              </div>
            </div>

            {/* Client cards */}
            {clients.length === 0 ? (
              <div className="bg-white/3 border border-white/8 rounded-2xl p-10 text-center space-y-3">
                <div className="w-14 h-14 bg-emerald-500/10 border border-emerald-500/15 rounded-2xl flex items-center justify-center mx-auto">
                  <Users size={24} className="text-emerald-400/50" />
                </div>
                <p className="text-white/40 text-sm">No client workspaces yet.</p>
                <p className="text-white/25 text-xs">Use the client switcher in the header to add your first client.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {clients.map(client => {
                  const isActive = activeClientId === client.id;
                  const connected = false; // Connection status is per-workspace tokens, not stored on client object
                  const platforms: string[] = [];
                  const health = clientHealthMap[client.id];
                  const lastPostDate = health?.lastPostAt ? new Date(health.lastPostAt) : null;
                  const daysSincePost = lastPostDate ? Math.floor((Date.now() - lastPostDate.getTime()) / 86400000) : null;
                  const healthColor = !health ? 'text-white/20' : daysSincePost === null ? 'text-red-400' : daysSincePost <= 7 ? 'text-emerald-400' : daysSincePost <= 30 ? 'text-amber-400' : 'text-red-400';
                  const healthDot = !health ? 'bg-white/15' : daysSincePost === null ? 'bg-red-500' : daysSincePost <= 7 ? 'bg-emerald-500' : daysSincePost <= 30 ? 'bg-amber-500' : 'bg-red-500';
                  const planColors: Record<string, string> = { starter: 'text-blue-300 bg-blue-500/15 border-blue-500/25', growth: 'text-purple-300 bg-purple-500/15 border-purple-500/25', pro: 'text-amber-300 bg-amber-500/15 border-amber-500/25', agency: 'text-emerald-300 bg-emerald-500/15 border-emerald-500/25' };
                  return (
                    <div key={client.id} className={`bg-white/3 border rounded-2xl p-5 space-y-4 transition ${isActive ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-white/8 hover:border-white/15'}`}>
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="relative">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0 text-sm font-black text-emerald-300">
                              {client.name.charAt(0).toUpperCase()}
                            </div>
                            <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#0d0d1a] ${healthDot}`} title={daysSincePost === null ? 'No posts yet' : `Last post ${daysSincePost}d ago`} />
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-white truncate">{client.name}</p>
                            <p className="text-xs text-white/30 truncate">{client.businessType || 'No business type set'}</p>
                          </div>
                        </div>
                        {isActive && (
                          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/25 px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">Active</span>
                        )}
                      </div>

                      {/* Connection + health row */}
                      <div className="space-y-1.5">
                        {connected ? (
                          <div className="flex items-center gap-2 text-xs text-emerald-400">
                            <Link2 size={12} />
                            <span className="font-semibold">Social connected</span>
                            {platforms.length > 0 && (
                              <span className="text-emerald-400/50">· {platforms.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')}</span>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-xs text-white/30">
                            <Link2Off size={12} />
                            <span>Social not connected</span>
                          </div>
                        )}
                        {/* Health metrics */}
                        <div className={`flex items-center gap-3 text-xs ${healthColor}`}>
                          <Activity size={11} />
                          <span>
                            {!health ? 'Loading…' : daysSincePost === null ? 'No posts yet' : daysSincePost === 0 ? 'Posted today' : `Last post ${daysSincePost}d ago`}
                          </span>
                          {health && health.scheduledCount > 0 && (
                            <span className="text-white/30">· {health.scheduledCount} scheduled</span>
                          )}
                        </div>
                      </div>

                      {/* Plan setter */}
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold text-white/25 uppercase tracking-wider">Client Plan</p>
                        <div className="flex gap-1.5 flex-wrap">
                          {(['starter', 'growth', 'pro'] as PlanTier[]).map(p => (
                            <button
                              key={p}
                              onClick={() => setClientPlan(client.id, p)}
                              className={`text-[10px] font-bold px-2.5 py-1 rounded-lg border transition capitalize ${client.plan === p ? planColors[p] : 'text-white/25 bg-white/3 border-white/8 hover:border-white/20'}`}
                            >
                              {p}
                            </button>
                          ))}
                          {!client.plan && (
                            <span className="text-[10px] text-white/20 flex items-center">← set tier</span>
                          )}
                        </div>
                      </div>

                      {/* Portal auto-login */}
                      {isSuperAdmin && (
                        <div className="space-y-1.5">
                          <button
                            onClick={() => setPortalInputs(prev => ({
                              ...prev,
                              [client.id]: prev[client.id] ?? { slug: client.clientSlug ?? '', email: '', password: '', showPw: false, saving: false }
                            }))}
                            className="text-[10px] font-semibold text-white/30 uppercase tracking-wider flex items-center gap-1 hover:text-white/60 transition"
                          >
                            <Key size={10} /> Portal Auto-Login {portalInputs[client.id] ? '▲' : '▼'}
                          </button>
                          {portalInputs[client.id] && (
                            <div className="space-y-2 pt-1">
                              <input
                                type="text"
                                placeholder="Client slug (e.g. streetmeats)"
                                value={portalInputs[client.id].slug}
                                onChange={e => setPortalInputs(prev => ({ ...prev, [client.id]: { ...prev[client.id], slug: e.target.value } }))}
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-white/25 outline-none focus:border-amber-500/50"
                              />
                              <input
                                type="email"
                                placeholder="Auto-login email"
                                value={portalInputs[client.id].email}
                                onChange={e => setPortalInputs(prev => ({ ...prev, [client.id]: { ...prev[client.id], email: e.target.value } }))}
                                className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-white/25 outline-none focus:border-amber-500/50"
                              />
                              <div className="relative">
                                <input
                                  type={portalInputs[client.id].showPw ? 'text' : 'password'}
                                  placeholder="Auto-login password"
                                  value={portalInputs[client.id].password}
                                  onChange={e => setPortalInputs(prev => ({ ...prev, [client.id]: { ...prev[client.id], password: e.target.value } }))}
                                  className="w-full bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 pr-8 text-xs text-white placeholder-white/25 outline-none focus:border-amber-500/50"
                                />
                                <button
                                  onClick={() => setPortalInputs(prev => ({ ...prev, [client.id]: { ...prev[client.id], showPw: !prev[client.id].showPw } }))}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                                >
                                  {portalInputs[client.id].showPw ? <EyeOff size={11} /> : <Eye size={11} />}
                                </button>
                              </div>
                              <button
                                onClick={() => savePortalCredentials(client.id)}
                                disabled={portalInputs[client.id].saving}
                                className="w-full flex items-center justify-center gap-1.5 text-[10px] font-bold bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/25 text-amber-300 py-1.5 rounded-lg transition disabled:opacity-40"
                              >
                                {portalInputs[client.id].saving ? <Loader2 size={10} className="animate-spin" /> : <Key size={10} />}
                                {portalInputs[client.id].saving ? 'Saving…' : 'Save Portal Login'}
                              </button>
                              {client.clientSlug && (
                                <p className="text-[9px] text-white/25 text-center">Active slug: <span className="text-amber-400/60">{client.clientSlug}</span></p>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => { setActiveClientId(client.id); setActiveTab('smart'); setSmartSubMode('quickpost'); }}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/25 text-emerald-300 py-2 rounded-xl transition"
                        >
                          <Wand2 size={12} /> Create Post
                        </button>
                        <button
                          onClick={() => { setActiveClientId(client.id); setActiveTab('smart'); }}
                          className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 hover:text-white py-2 rounded-xl transition"
                        >
                          <Brain size={12} /> Smart AI
                        </button>
                        <button
                          onClick={() => { setActiveClientId(client.id); setActiveTab('settings'); }}
                          className="flex items-center justify-center gap-1.5 text-xs font-semibold bg-white/5 hover:bg-white/10 border border-white/10 text-white/40 hover:text-white py-2 px-3 rounded-xl transition"
                          title="Client settings"
                        >
                          <Settings size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Empty slot card */}
                {clients.length < agencyClientLimit && (
                  <div className="border-2 border-dashed border-white/8 rounded-2xl p-5 flex flex-col items-center justify-center gap-3 text-center min-h-[180px] hover:border-white/15 transition cursor-pointer"
                    onClick={() => {
                      const name = prompt('Client name:');
                      const btype = name?.trim() ? (prompt('Business type (optional):') ?? '') : '';
                      if (name?.trim()) addClient(name.trim(), btype.trim() || 'Business');
                    }}>
                    <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                      <Plus size={18} className="text-white/30" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white/30">Add client</p>
                      <p className="text-xs text-white/20 mt-0.5">{agencyClientLimit - clients.length} slot{(agencyClientLimit - clients.length) !== 1 ? 's' : ''} remaining</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Agency billing link */}
            {(agencyBillingUrl || CLIENT.paypalManageUrl) && (
              <div className="flex items-center justify-between bg-white/3 border border-white/8 rounded-2xl px-5 py-4">
                <div>
                  <p className="text-sm font-semibold text-white">Agency Billing</p>
                  <p className="text-xs text-white/30 mt-0.5">
                    {agencyBillingUrl ? 'Your custom client billing portal' : 'Manage your agency subscription and payment method'}
                  </p>
                </div>
                <a
                  href={agencyBillingUrl || CLIENT.paypalManageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs font-semibold bg-white/8 hover:bg-white/12 border border-white/10 text-white/60 hover:text-white px-4 py-2.5 rounded-xl transition flex-shrink-0"
                >
                  <ShoppingCart size={13} /> {agencyBillingUrl ? 'Client Portal' : 'PayPal Billing'}
                </a>
              </div>
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

            {isSuperAdmin && d1SyncError && (
              <div className="bg-red-500/10 border border-red-500/25 rounded-2xl p-4 flex items-start gap-3">
                <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-red-400 mb-1">D1 sync failed — data not persisted</p>
                  <p className="text-xs text-red-300/70 leading-relaxed">{d1SyncError}</p>
                  <p className="text-xs text-white/30 mt-2">Fix: Cloudflare Pages → socialai-studio → Settings → Environment variables → add <code className="bg-white/10 px-1 rounded">VITE_AI_WORKER_URL = https://socialai-api.steve-700.workers.dev</code></p>
                </div>
              </div>
            )}

            {/* ── Plan & Billing ── */}
            {(() => {
              const activeClient = activeClientId ? clients.find(c => c.id === activeClientId) : null;
              const clientPlan = activeClient?.plan ?? null;

              // ── Client workspace plan management (agency admin only) ──
              if (activeClientId && isSuperAdmin && activeClient) {
                const planOrder: PlanTier[] = ['starter', 'growth', 'pro', 'agency'];
                const currentIdx = planOrder.indexOf(clientPlan ?? 'starter');
                return (
                  <div className="bg-white/3 border border-white/8 rounded-2xl p-6 space-y-5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-amber-500/15 border border-amber-500/20 rounded-xl flex items-center justify-center">
                        <ShoppingCart size={16} className="text-amber-400" />
                      </div>
                      <div>
                        <h3 className="font-bold text-white">Client Plan — <span className="text-amber-300">{activeClient.name}</span></h3>
                        <p className="text-xs text-white/30 mt-0.5">
                          {clientPlan
                            ? <>Currently on <span className={`font-bold bg-gradient-to-r ${CLIENT.plans.find(p => p.id === clientPlan)?.color ?? 'from-white to-white'} bg-clip-text text-transparent`}>{CLIENT.plans.find(p => p.id === clientPlan)?.name ?? clientPlan}</span> plan</>
                            : 'No plan assigned yet'}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {CLIENT.plans.map(plan => {
                        const isCurrent = clientPlan === plan.id;
                        const planIdx = planOrder.indexOf(plan.id as PlanTier);
                        const isUpgrade = planIdx > currentIdx;
                        const isSaving = savingClientPlan === plan.id;
                        return (
                          <div key={plan.id} className={`relative rounded-2xl border p-4 space-y-3 transition ${
                            isCurrent ? 'border-amber-500/40 bg-amber-500/8' : 'border-white/8 bg-white/2 hover:border-white/15'
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
                            </div>
                            <ul className="space-y-1">
                              {plan.features.slice(0, 3).map((f, i) => (
                                <li key={i} className="text-[10px] text-white/45 flex items-start gap-1.5">
                                  <CheckCircle size={9} className="text-green-400/60 shrink-0 mt-0.5" />{f}
                                </li>
                              ))}
                            </ul>
                            {isCurrent ? (
                              <div className="text-center text-[10px] text-green-400/60 font-semibold py-1">✓ Active</div>
                            ) : (
                              <button
                                onClick={() => setClientPlan(activeClientId, plan.id as PlanTier)}
                                disabled={!!savingClientPlan}
                                className={`w-full flex items-center justify-center gap-1.5 text-xs font-bold py-2 rounded-xl transition disabled:opacity-40 ${
                                  isUpgrade
                                    ? `bg-gradient-to-r ${plan.color} text-white hover:opacity-90`
                                    : 'bg-white/8 hover:bg-white/12 text-white/60'
                                }`}
                              >
                                {isSaving ? <Loader2 size={11} className="animate-spin" /> : isUpgrade ? '↑ Upgrade' : '↓ Downgrade'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-white/20 text-center">Billing is handled externally — changing the plan here updates the client's permissions immediately.</p>
                  </div>
                );
              }

              // ── Normal owner Plan & Billing ──
              return (
                <div className="bg-white/3 border border-white/8 rounded-2xl p-6 space-y-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 bg-amber-500/15 border border-amber-500/20 rounded-xl flex items-center justify-center">
                        <ShoppingCart size={16} className="text-amber-400" />
                      </div>
                      <div>
                        <h3 className="font-bold text-white">Plan &amp; Billing</h3>
                        <p className="text-xs text-white/30 mt-0.5">
                          {effectivePlan ? <>Currently on <span className={`font-bold bg-gradient-to-r ${CLIENT.plans.find(p => p.id === effectivePlan)?.color ?? 'from-white to-white'} bg-clip-text text-transparent`}>{CLIENT.plans.find(p => p.id === effectivePlan)?.name}</span> plan</> : 'No active plan'}
                        </p>
                      </div>
                    </div>
                    {CLIENT.paypalManageUrl && (
                      <a href={CLIENT.paypalManageUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-white/40 hover:text-amber-300 border border-white/10 hover:border-amber-500/30 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5">
                        <Link2 size={12} /> Manage Billing
                      </a>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {CLIENT.plans.map(plan => {
                      const isCurrent = effectivePlan === plan.id;
                      const planOrder = ['starter', 'growth', 'pro', 'agency'];
                      const currentIdx = planOrder.indexOf(activePlan ?? '');
                      const planIdx = planOrder.indexOf(plan.id);
                      const isUpgrade = planIdx > currentIdx;
                      const isNew = !activePlan;
                      return (
                        <div key={plan.id} className={`relative rounded-2xl border p-4 space-y-3 transition ${
                          isCurrent ? 'border-amber-500/40 bg-amber-500/8' : 'border-white/8 bg-white/2 hover:border-white/15'
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
                                <CheckCircle size={9} className="text-green-400/60 shrink-0 mt-0.5" />{f}
                              </li>
                            ))}
                          </ul>
                          {!isCurrent && (
                            isNew ? (
                              <button onClick={() => setShowIntakeForm(true)}
                                className={`w-full text-center text-xs font-bold py-2 rounded-xl transition bg-gradient-to-r ${plan.color} text-white hover:opacity-90`}>
                                Get Started
                              </button>
                            ) : (
                              <button onClick={() => setShowPricing(true)}
                                className={`w-full text-center text-xs font-bold py-2 rounded-xl transition ${
                                  isUpgrade ? `bg-gradient-to-r ${plan.color} text-white hover:opacity-90` : 'bg-white/8 hover:bg-white/12 text-white/60'
                                }`}>
                                {isUpgrade ? '↑ Upgrade' : '↓ Downgrade'}
                              </button>
                            )
                          )}
                          {isCurrent && <div className="text-center text-[10px] text-green-400/60 font-semibold py-1">✓ Active</div>}
                        </div>
                      );
                    })}
                  </div>

                  {!activePlan && !intakeFormDone && (
                    <div className="bg-blue-500/8 border border-blue-500/20 rounded-2xl px-4 py-4 flex items-start gap-3">
                      <div className="w-8 h-8 bg-blue-500/20 rounded-xl flex items-center justify-center shrink-0 mt-0.5"><span className="text-sm">📋</span></div>
                      <div className="flex-1">
                        <p className="text-xs font-bold text-blue-300 mb-0.5">New to SocialAI Studio?</p>
                        <p className="text-xs text-white/45 leading-relaxed">Choose a plan above, then complete our quick setup form so we can connect your Facebook Page. A one-time <span className="text-amber-300 font-semibold">${CLIENT.setupFee} setup fee</span> applies to new accounts.</p>
                      </div>
                      <button onClick={() => setShowIntakeForm(true)}
                        className="shrink-0 bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/25 text-blue-300 text-xs font-bold px-3 py-2 rounded-xl transition">
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
                  <p className="text-xs text-white/20 text-center">
                    To cancel or update payment details, visit <a href={CLIENT.paypalManageUrl} target="_blank" rel="noopener noreferrer" className="text-amber-400/60 hover:text-amber-400 underline transition">PayPal autopay</a> or contact <a href={`mailto:${CLIENT.supportEmail}`} className="text-amber-400/60 hover:text-amber-400 underline transition">{CLIENT.supportEmail}</a>
                  </p>
                </div>
              );
            })()}

            {/* ── SECTION: AI & Keys (super-admin / owner only) ── */}
            {isSuperAdmin && (
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-black text-white/20 uppercase tracking-widest whitespace-nowrap">AI &amp; Keys</span>
                <div className="h-px flex-1 bg-white/6" />
              </div>
            )}

            {/* AI Engine Panel — agents + live OpenRouter stats */}
            <AiEnginePanel isSuperAdmin={isSuperAdmin} />

            {/* ── SECTION: Business Profile ── */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-black text-white/20 uppercase tracking-widest whitespace-nowrap">Business Profile</span>
              <div className="h-px flex-1 bg-white/6" />
            </div>

            {/* Business Profile — Guided Questionnaire */}
            <div className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
              <button
                onClick={() => setProfileExpanded(p => !p)}
                className="w-full flex items-center justify-between p-6 text-left hover:bg-white/2 transition"
              >
                <div>
                  <h3 className="font-bold text-white flex items-center gap-2"><Brain size={16} className="text-amber-400" /> AI Business Profile</h3>
                  <p className="text-xs text-white/30 mt-0.5">
                    {profile.name && profile.name !== CLIENT.defaultBusinessName ? `${profile.name} · ${profile.type || 'No type set'}` : 'Your answers train the AI to write in your voice and for your audience.'}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {profile.name && profile.name !== CLIENT.defaultBusinessName && (
                    <span className="text-xs text-green-400 bg-green-500/10 border border-green-500/15 px-2.5 py-1 rounded-full hidden sm:flex items-center gap-1"><CheckCircle size={10} /> Profile set</span>
                  )}
                  {profileExpanded ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
                </div>
              </button>

              {profileExpanded && <div className="px-6 pb-6 space-y-6 border-t border-white/5 pt-5">
              <div className="flex justify-end">
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
            </div>}
            </div>

            {/* fal.ai API Key — super-admin only */}
            {isSuperAdmin && (activePlan === 'pro' || activePlan === 'agency') && (
            <div className="bg-white/3 border border-white/8 rounded-2xl p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-purple-500/15 border border-purple-500/20 rounded-xl flex items-center justify-center">
                  <span className="text-base">🎬</span>
                </div>
                <div>
                  <h3 className="font-bold text-white">fal.ai API Key <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/20 px-2 py-0.5 rounded-full ml-1 font-semibold">Admin only</span></h3>
                  <p className="text-xs text-white/30 mt-0.5">Powers AI Reel / video generation (Kling v1.6)</p>
                </div>
                {falApiKey && <span className="ml-auto text-xs text-green-400 bg-green-500/10 border border-green-500/15 px-2.5 py-1 rounded-full flex items-center gap-1"><CheckCircle size={11} /> Active</span>}
              </div>
              <p className="text-xs text-white/30 leading-relaxed">
                Get a free key at{' '}
                <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noopener noreferrer" className="text-purple-400/70 hover:text-purple-400 underline transition">fal.ai/dashboard/keys</a>
                {' '}— sign up free, click <strong className="text-white/50">+ Add key</strong>, copy and paste it here.
              </p>
              <div className="flex gap-2 max-w-lg">
                <input
                  type="password"
                  value={falApiKey}
                  onChange={e => setFalApiKey(e.target.value)}
                  placeholder="fal_..."
                  className="flex-1 bg-black/40 border border-white/8 rounded-xl px-3 py-2.5 text-white font-mono text-sm placeholder:text-white/20 focus:outline-none focus:border-purple-500/40"
                />
                <button
                  onClick={handleSaveFalKey}
                  disabled={isSavingFalKey}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white font-bold px-5 py-2.5 rounded-xl text-sm transition flex items-center gap-2"
                >
                  {isSavingFalKey ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  Save
                </button>
              </div>
            </div>
            )}


            {/* ── SECTION: Content & Video ── */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-black text-white/20 uppercase tracking-widest whitespace-nowrap">Content &amp; Video</span>
              <div className="h-px flex-1 bg-white/6" />
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
                      {!(effectivePlan === 'pro' || effectivePlan === 'agency') && (
                        <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/20 px-2 py-0.5 rounded-full font-semibold">Pro</span>
                      )}
                    </h3>
                    <p className="text-xs text-white/30 mt-0.5">AI generates full video scripts, shot briefs & music mood for Reels alongside regular posts</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (!(effectivePlan === 'pro' || effectivePlan === 'agency')) { toast('Short Video posts require a Pro plan.', 'warning'); return; }
                    setProfile(prev => ({ ...prev, videoEnabled: !prev.videoEnabled }));
                    setIncludeVideos(prev => !prev);
                  }}
                  className={`relative w-12 h-6 rounded-full transition flex-shrink-0 ${
                    profile.videoEnabled && (effectivePlan === 'pro' || effectivePlan === 'agency')
                      ? 'bg-purple-500'
                      : 'bg-white/15'
                  } ${!(effectivePlan === 'pro' || effectivePlan === 'agency') ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${
                    profile.videoEnabled && (effectivePlan === 'pro' || effectivePlan === 'agency') ? 'left-7' : 'left-1'
                  }`} />
                </button>
              </div>
              {profile.videoEnabled && (effectivePlan === 'pro' || effectivePlan === 'agency') && (
                <div className="mt-4 bg-purple-500/8 border border-purple-500/15 rounded-xl px-4 py-3">
                  <p className="text-xs text-purple-300">🎬 Short videos are now included in your AI content calendar. Each Reel post includes a full script, shot-by-shot brief, and music recommendation that you can film with your phone.</p>
                </div>
              )}
            </div>

            {/* ── SECTION: Connected Accounts ── */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-black text-white/20 uppercase tracking-widest whitespace-nowrap">Connected Accounts</span>
              <div className="h-px flex-1 bg-white/6" />
            </div>

            {/* Social Media Connection — Facebook Graph API */}
            <div className="bg-white/3 border border-white/8 rounded-2xl p-6 space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-blue-500/15 border border-blue-500/20 rounded-xl flex items-center justify-center">
                  <Link2 size={16} className="text-blue-400" />
                </div>
                <div>
                  <h3 className="font-bold text-white">Social Media Connection</h3>
                  <p className="text-xs text-white/30 mt-0.5">Connect your Facebook Page &amp; Instagram via the official Facebook API</p>
                </div>
              </div>

              <div className="space-y-2">
                <FacebookConnectButton
                  connectedPageId={socialTokens.facebookPageId}
                  connectedPageName={socialTokens.facebookPageName || profile.name}
                  instagramConnected={!!socialTokens.instagramBusinessAccountId}
                  tokenNeverExpires={socialTokens.facebookConnected ? true : undefined}
                  onConnected={async (pageId, pageAccessToken, pageName, longLivedUserToken, instagramBusinessAccountId) => {
                    const updated: SocialTokens = {
                      ...socialTokens,
                      facebookPageId: pageId,
                      facebookPageAccessToken: pageAccessToken,
                      facebookConnected: true,
                      connectedAt: new Date().toISOString(),
                      facebookPageName: pageName,
                      longLivedUserToken: longLivedUserToken || undefined,
                      instagramBusinessAccountId: instagramBusinessAccountId || '',
                      instagramConnected: !!instagramBusinessAccountId,
                    };
                    saveSocialTokens(updated);
                    toast(`Connected to ${pageName}${instagramBusinessAccountId ? ' + Instagram' : ''} successfully!`, 'success');
                  }}
                  onDisconnect={() => {
                    saveSocialTokens(DEFAULT_SOCIAL_TOKENS);
                    toast('Social accounts disconnected.', 'warning');
                  }}
                />
              </div>

            </div>

            {/* ── SECTION: Campaigns ── */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-black text-white/20 uppercase tracking-widest whitespace-nowrap">Campaigns</span>
              <div className="h-px flex-1 bg-white/6" />
            </div>

            <div className="space-y-3">
              {campaigns.map(c => (
                <div key={c.id} className="glass rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${c.enabled ? 'bg-emerald-400' : 'bg-white/20'}`} />
                      <span className="text-sm font-bold text-white">{c.name}</span>
                      <span className="text-[10px] text-white/30 bg-white/5 px-2 py-0.5 rounded-full">{c.type}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          await db.updateCampaign(c.id, { enabled: !c.enabled });
                          setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, enabled: !x.enabled } : x));
                        }}
                        className={`text-xs px-2 py-1 rounded-lg transition ${c.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-white/30'}`}
                      >
                        {c.enabled ? 'Active' : 'Paused'}
                      </button>
                      <button
                        onClick={async () => {
                          await db.deleteCampaign(c.id);
                          setCampaigns(prev => prev.filter(x => x.id !== c.id));
                        }}
                        className="text-white/20 hover:text-red-400 transition"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-white/30 block mb-1">Start</label>
                      <input type="date" value={c.startDate} onChange={async (e) => {
                        const v = e.target.value;
                        await db.updateCampaign(c.id, { startDate: v });
                        setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, startDate: v } : x));
                      }} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white" />
                    </div>
                    <div>
                      <label className="text-[10px] text-white/30 block mb-1">End</label>
                      <input type="date" value={c.endDate} onChange={async (e) => {
                        const v = e.target.value;
                        await db.updateCampaign(c.id, { endDate: v });
                        setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, endDate: v } : x));
                      }} className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-white/30 block mb-1">Campaign Rules / Instructions for AI</label>
                    <textarea
                      value={c.rules}
                      onChange={(e) => setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, rules: e.target.value } : x))}
                      onBlur={async () => { await db.updateCampaign(c.id, { rules: c.rules }); }}
                      placeholder="e.g. Mention our grand opening event, use festive language, include countdown..."
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder-white/20 resize-none h-16"
                    />
                  </div>
                </div>
              ))}
              <button
                onClick={async () => {
                  const id = await db.createCampaign({
                    clientId: activeClientId,
                    name: 'New Campaign',
                    type: 'custom',
                    startDate: new Date().toISOString().split('T')[0],
                    endDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
                    rules: '',
                    postsPerDay: 1,
                    enabled: true,
                  });
                  setCampaigns(prev => [...prev, {
                    id, name: 'New Campaign', type: 'custom' as const,
                    startDate: new Date().toISOString().split('T')[0],
                    endDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
                    rules: '', postsPerDay: 1, enabled: true, createdAt: new Date().toISOString(),
                  }]);
                }}
                className="w-full glass rounded-xl py-3 text-xs font-bold text-amber-400 hover:bg-amber-500/10 transition flex items-center justify-center gap-2 press"
              >
                <Plus size={14} /> Add Campaign
              </button>
            </div>


            {/* ── SECTION: Portal Branding ── */}
            {(() => {
              const client = clients.find(c => c.id === activeClientId);
              const slug = client?.clientSlug;
              if (!slug) return null;
              return (
                <>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-black text-white/20 uppercase tracking-widest whitespace-nowrap">Portal Branding</span>
                    <div className="h-px flex-1 bg-white/6" />
                  </div>
                  <div className="glass rounded-2xl p-5 space-y-4">
                    <p className="text-xs text-white/40">Customize the hero section on the <span className="text-amber-400">{slug}</span> client portal landing page.</p>
                    <div>
                      <label className="text-[10px] text-white/30 block mb-1">Hero Title</label>
                      <input
                        type="text"
                        value={portalContent.hero_title}
                        onChange={(e) => setPortalContent(prev => ({ ...prev, hero_title: e.target.value }))}
                        onBlur={() => db.setPortalContent(slug, { hero_title: portalContent.hero_title }).catch(() => {})}
                        placeholder="e.g. WE DON'T DO FAST FOOD"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-white/30 block mb-1">Hero Subtitle</label>
                      <input
                        type="text"
                        value={portalContent.hero_subtitle}
                        onChange={(e) => setPortalContent(prev => ({ ...prev, hero_subtitle: e.target.value }))}
                        onBlur={() => db.setPortalContent(slug, { hero_subtitle: portalContent.hero_subtitle }).catch(() => {})}
                        placeholder="e.g. Premium BBQ — crafted slow, served with soul"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-white/30 block mb-1">Call-to-Action Button Text</label>
                      <input
                        type="text"
                        value={portalContent.hero_cta_text}
                        onChange={(e) => setPortalContent(prev => ({ ...prev, hero_cta_text: e.target.value }))}
                        onBlur={() => db.setPortalContent(slug, { hero_cta_text: portalContent.hero_cta_text }).catch(() => {})}
                        placeholder="e.g. Start Today — $99 Setup"
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20"
                      />
                    </div>
                  </div>
                </>
              );
            })()}

            {/* ── SECTION: Plan & Admin ── */}
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-black text-white/20 uppercase tracking-widest whitespace-nowrap">Plan &amp; Admin</span>
              <div className="h-px flex-1 bg-white/6" />
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
                  {effectivePlan !== 'pro' && effectivePlan !== 'agency' && (
                    <a
                      href={CLIENT.salesUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/20 text-amber-300 px-4 py-2 rounded-xl transition flex items-center gap-1.5 self-start"
                    >
                      <ArrowRight size={12} /> Upgrade Plan
                    </a>
                  )}
                  {effectivePlan === 'agency' && authMode !== 'portal' && (
                    <div className="text-xs bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 px-4 py-2 rounded-xl flex items-center gap-1.5 self-start font-bold">
                      <CheckCircle size={12} /> You're on our top plan
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Agency Client Management — hidden in portal mode */}
            {(activePlan === 'agency' || isAdminMode) && authMode !== 'portal' && (
              <div className="bg-white/3 border border-emerald-500/20 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <h3 className="font-bold text-white flex items-center gap-2"><Users size={16} className="text-emerald-400" /> Client Workspaces</h3>
                  <span className="text-xs text-white/30">{clients.length} / {CLIENT.agencyClientLimit} used</span>
                </div>
                {clients.length === 0 ? (
                  <p className="text-sm text-white/30 py-2">No client workspaces yet. Add one using the switcher in the header.</p>
                ) : (
                  <div className="space-y-2">
                    {clients.map(client => (
                      <div key={client.id} className="flex items-center justify-between gap-3 bg-black/25 border border-white/6 rounded-xl px-4 py-3 flex-wrap">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                            <Users size={13} className="text-emerald-400" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white truncate">{client.name}</p>
                            <p className="text-xs text-white/30 truncate">{client.businessType || 'No business type set'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => setActiveClientId(client.id)}
                            className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 hover:text-white px-3 py-1.5 rounded-lg transition flex items-center gap-1.5"
                          >
                            <ArrowRight size={11} /> Open Workspace
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {/* Custom billing URL */}
                <div className="pt-2 border-t border-white/5 space-y-2">
                  <label className="text-xs font-semibold text-white/40 uppercase tracking-wider block">Your client billing portal URL <span className="text-white/20 font-normal normal-case">(optional)</span></label>
                  <p className="text-xs text-white/25 leading-relaxed">Point clients to your own payment portal instead of the default. Leave blank to use the SocialAI Studio billing link.</p>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={agencyBillingUrl}
                      onChange={e => setAgencyBillingUrl(e.target.value)}
                      placeholder="https://www.paypal.com/myaccount/autopay"
                      className="flex-1 bg-black/40 border border-white/8 rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-emerald-500/40 transition"
                    />
                    <button
                      onClick={async () => {
                        if (!user) return;
                        await db.upsertUser({ agencyBillingUrl }).catch(() => {});
                        toast('Billing URL saved.', 'success');
                      }}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2.5 rounded-xl text-sm transition flex items-center gap-2 flex-shrink-0"
                    >
                      <Save size={13} /> Save
                    </button>
                  </div>
                </div>
                {(agencyBillingUrl || CLIENT.paypalManageUrl) && (
                  <a
                    href={agencyBillingUrl || CLIENT.paypalManageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs text-emerald-300/70 hover:text-emerald-300 transition w-fit"
                  >
                    <ShoppingCart size={12} /> {agencyBillingUrl ? 'Open your client billing portal' : 'Manage PayPal billing'}
                  </a>
                )}
              </div>
            )}

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
                      db.deleteAllPosts(activeClientId).then(() => {
                        setPosts([]);
                        localStorage.removeItem('sai_posts');
                        toast('All posts cleared.');
                      }).catch(() => toast('Failed to clear posts.'));
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
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => setTimedOut(true), 10_000);
    return () => clearTimeout(t);
  }, [loading]);

  if (loading && timedOut) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center gap-6 px-6">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(245,158,11,0.08),transparent_65%)] pointer-events-none" />
        <AppLogo size={100} />
        <div className="text-center space-y-3 max-w-sm">
          <p className="text-red-400 font-bold text-base">Authentication not configured</p>
          <p className="text-white/40 text-sm leading-relaxed">
            <code className="text-amber-300/80 bg-white/5 px-1.5 py-0.5 rounded text-xs">VITE_CLERK_PUBLISHABLE_KEY</code> is missing from your Cloudflare Pages environment variables.
          </p>
          <p className="text-white/25 text-xs">
            Add it in Cloudflare Pages → Settings → Environment Variables, then redeploy.
          </p>
        </div>
        <a
          href="https://dashboard.clerk.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-amber-400/60 hover:text-amber-400 underline transition"
        >
          Open Clerk Dashboard →
        </a>
      </div>
    );
  }

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

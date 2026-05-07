import React, { useState } from 'react';
import { CLIENT } from '../client.config';
import { PricingTable } from './PricingTable';
import {
  CheckCircle, Zap, Image as ImageIcon, Calendar,
  BarChart3, Facebook, Instagram, ArrowRight, Star, Clock,
  Shield, ChevronDown, ChevronUp, Brain, Users, Play, X,
  TrendingUp, MessageCircle, Repeat2, DollarSign, Timer, Rocket
} from 'lucide-react';
import { AppLogo } from './AppLogo';
import { AnimatedDemo } from './AnimatedDemo';

type LandingTab = 'home' | 'benefits' | 'pricing' | 'faq' | 'contact';

interface Props {
  onActivate: (plan: 'starter' | 'growth' | 'pro') => void;
  onSignIn: () => void;
  portalContent?: { hero_title: string; hero_subtitle: string; hero_cta_text: string };
}

const faqs = [
  {
    q: 'What happens after I purchase?',
    a: `You're taken straight to a quick setup wizard. Enter your business details, connect your Facebook page, and the AI starts generating your first posts — all in under 5 minutes.`,
  },
  {
    q: 'Do I need a Facebook Business page?',
    a: 'Yes — you need an active Facebook Business page. You connect it yourself during setup with a single click. No technical knowledge needed.',
  },
  {
    q: 'What is the $99 setup fee for?',
    a: 'The one-time setup covers your personalised AI configuration: training the AI on your brand voice, industry, and tone so every post sounds like you wrote it.',
  },
  {
    q: 'Can I change plans later?',
    a: 'Yes — contact us any time to upgrade or downgrade. Upgrades are instant, downgrades take effect at the next billing cycle.',
  },
  {
    q: 'What does "posts per week" mean?',
    a: 'The AI generates and schedules that many posts into your Facebook and Instagram calendar each week. You can review, edit, or delete any post before it goes live.',
  },
  {
    q: 'Do I still control what gets posted?',
    a: 'Absolutely. The AI suggests and schedules — you always have the final say. You can edit any post in the calendar, delete ones you don\'t like, or generate entirely new ones.',
  },
];

const howItWorks = [
  { step: '1', title: 'Choose a plan', desc: 'Pick the plan that suits your business. Setup takes less than 5 minutes.', icon: Star },
  { step: '2', title: 'Set up your profile', desc: 'Tell us about your business — name, location, tone. The AI learns your brand voice.', icon: Clock },
  { step: '3', title: 'Connect Facebook', desc: 'Link your Facebook page in one click. No technical knowledge needed.', icon: Shield },
  { step: '4', title: "You're live!", desc: 'The AI generates your posts instantly. Review, schedule, and publish with one click.', icon: Zap },
];

const planIncludes: Record<string, string> = {
  growth: 'Everything in Starter, plus:',
  pro: 'Everything in Growth, plus:',
  agency: 'Built for agencies:',
};

export const LandingPage: React.FC<Props> = ({ onActivate, onSignIn, portalContent }) => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [showPricing, setShowPricing] = useState(false);
  const [videoLightbox, setVideoLightbox] = useState(false);
  const [tab, setTab] = useState<LandingTab>('home');
  const [contactForm, setContactForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [contactSent, setContactSent] = useState(false);
  const [contactSending, setContactSending] = useState(false);

  const NAV_TABS: { id: LandingTab; label: string }[] = [
    { id: 'home', label: 'Home' },
    { id: 'benefits', label: 'Benefits' },
    { id: 'pricing', label: 'Pricing' },
    { id: 'faq', label: 'FAQ' },
    { id: 'contact', label: 'Contact' },
  ];

  const handleContactSend = async () => {
    setContactSending(true);
    const hasEmailJs = CLIENT.emailJsServiceId && CLIENT.emailJsTemplateId && CLIENT.emailJsPublicKey;
    if (hasEmailJs) {
      try {
        const emailjs = await import('@emailjs/browser');
        await emailjs.default.send(CLIENT.emailJsServiceId, CLIENT.emailJsTemplateId, {
          from_name: contactForm.name,
          from_email: contactForm.email,
          phone: contactForm.phone || 'Not provided',
          message: contactForm.message,
          business_name: 'Website Enquiry',
          to_email: CLIENT.supportEmail,
        }, CLIENT.emailJsPublicKey);
        setContactSent(true);
      } catch {
        fallbackContactMailto();
        setContactSent(true);
      }
    } else {
      fallbackContactMailto();
      setContactSent(true);
    }
    setContactSending(false);
  };

  const fallbackContactMailto = () => {
    const body = `Name: ${contactForm.name}\nEmail: ${contactForm.email}\nPhone: ${contactForm.phone}\n\nMessage:\n${contactForm.message}`;
    window.open(`mailto:${CLIENT.supportEmail}?subject=${encodeURIComponent('Website Enquiry — ' + contactForm.name)}&body=${encodeURIComponent(body)}`, '_blank');
  };

  return (
    <div className="min-h-screen bg-[var(--color-surface-0)] text-white overflow-x-hidden">
      {showPricing && (
        <PricingTable
          onClose={() => setShowPricing(false)}
          onAccountSetup={onSignIn}
        />
      )}

      {/* NAV */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[var(--color-surface-0)]/80 backdrop-blur-xl noise">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <button onClick={() => setTab('home')}><AppLogo size={52} /></button>

          {/* Tab links — hidden on mobile, visible md+ */}
          <div className="hidden md:flex items-center gap-1">
            {NAV_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`text-sm font-semibold px-4 py-2 rounded-full transition ${
                  tab === t.id
                    ? 'bg-white/10 text-white'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/5'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onSignIn}
              className="text-sm text-white/60 hover:text-white font-semibold px-4 py-2 rounded-full border border-white/10 hover:border-white/25 bg-white/5 hover:bg-white/10 transition"
            >
              Sign In
            </button>
            <button
              onClick={() => setShowPricing(true)}
              className="text-sm bg-gradient-to-r from-amber-500 to-orange-500 text-black font-bold px-5 py-2 rounded-full hover:opacity-90 transition"
            >
              Get Started
            </button>
          </div>
        </div>

        {/* Mobile tab row */}
        <div className="md:hidden flex border-t border-white/5">
          {NAV_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 text-xs font-semibold py-2.5 transition ${
                tab === t.id
                  ? 'text-amber-400 border-b-2 border-amber-400'
                  : 'text-white/30 border-b-2 border-transparent'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {/* ═══ TAB CONTENT ═══ */}
      <main className="pt-20 md:pt-16">

        {/* ─── HOME TAB ─── */}
        {tab === 'home' && (
          <div>
            {/* HERO */}
            <section className="relative pt-20 pb-16 px-6 text-center overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(245,158,11,0.15),transparent_70%)]" />
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_50%,rgba(168,85,247,0.06),transparent_60%)]" />
              <div className="relative max-w-3xl mx-auto animate-fadeSlideUp">
                <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold px-4 py-2 rounded-full mb-7">
                  <Zap size={12} /> AI-Powered Social Media — Done For You
                </div>
                <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black mb-5 leading-[1.1] sm:leading-[1.05] tracking-tight px-2 sm:px-0">
                  {portalContent?.hero_title ? (
                    <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-pink-400 bg-clip-text text-transparent">
                      {portalContent.hero_title}
                    </span>
                  ) : (
                    <>
                      Your social media,{' '}
                      <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-pink-400 bg-clip-text text-transparent">
                        on autopilot.
                      </span>
                    </>
                  )}
                </h1>
                <p className="text-base sm:text-lg text-white/50 mb-8 max-w-xl mx-auto leading-relaxed px-4 sm:px-0">
                  {portalContent?.hero_subtitle || "AI writes, designs, and schedules your Facebook & Instagram posts every week — so you can focus on running your business."}
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center items-center">
                  <button
                    onClick={() => setShowPricing(true)}
                    className="group bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black px-8 py-4 rounded-2xl text-base hover:opacity-90 transition flex items-center gap-2 shadow-2xl shadow-amber-500/25"
                  >
                    {portalContent?.hero_cta_text || 'Start Today — $99 Setup'}
                    <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                  </button>
                  <p className="text-sm text-white/30">From $29/month · Cancel anytime</p>
                </div>
              </div>

              {/* 3 BENEFIT PILLARS */}
              <div className="relative max-w-3xl mx-auto mt-14 grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  {
                    icon: Timer,
                    color: 'text-amber-400',
                    bg: 'bg-amber-500/10',
                    border: 'border-amber-500/20',
                    stat: '8+ hrs',
                    title: 'Saved Every Week',
                    desc: 'No more writing captions, finding images, or manually scheduling. The AI handles it all automatically.',
                  },
                  {
                    icon: DollarSign,
                    color: 'text-emerald-400',
                    bg: 'bg-emerald-500/10',
                    border: 'border-emerald-500/20',
                    stat: '$500+',
                    title: 'Saved vs. a Social Manager',
                    desc: 'A freelance social media manager costs $500–$2,000/month. Our AI does the same job from $29.',
                  },
                  {
                    icon: Rocket,
                    color: 'text-purple-400',
                    bg: 'bg-purple-500/10',
                    border: 'border-purple-500/20',
                    stat: '3× more',
                    title: 'Consistent Posting',
                    desc: 'Businesses that post consistently get 3× more reach. AI never forgets, never gets busy, never skips.',
                  },
                ].map((p, i) => (
                  <div key={i} className={`${p.bg} border ${p.border} rounded-2xl p-6 text-left`}>
                    <p.icon size={22} className={`${p.color} mb-3`} />
                    <p className={`text-3xl font-black ${p.color} mb-1`}>{p.stat}</p>
                    <p className="font-bold text-white text-sm mb-2">{p.title}</p>
                    <p className="text-xs text-white/40 leading-relaxed">{p.desc}</p>
                  </div>
                ))}
              </div>
            </section>

              {/* VIDEO LIGHTBOX */}
              {videoLightbox && CLIENT.youtubeVideoId && (
                <div
                  className="fixed inset-0 z-[999] flex items-center justify-center p-4 md:p-10"
                  style={{ background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(12px)' }}
                  onClick={() => setVideoLightbox(false)}
                >
                  <div className="relative w-full max-w-5xl" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => setVideoLightbox(false)}
                      className="absolute -top-10 right-0 text-white/50 hover:text-white text-sm flex items-center gap-1.5 transition"
                    >
                      <X size={16} /> Close
                    </button>
                    <div className="aspect-video rounded-2xl overflow-hidden shadow-2xl border border-white/10">
                      <iframe
                        className="w-full h-full"
                        src={`https://www.youtube.com/embed/${CLIENT.youtubeVideoId}?autoplay=1&rel=0&modestbranding=1`}
                        title="AI Social Media Demo"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* ANIMATED DEMO */}
            <section className="py-12 px-6">
              <div className="max-w-3xl mx-auto">
                <div className="text-center mb-8">
                  <h2 className="text-xl sm:text-2xl md:text-3xl font-black mb-2">See it in action</h2>
                  <p className="text-white/40 text-sm">Watch AI write, schedule, and publish your posts in real time</p>
                </div>
                <div className="relative rounded-3xl overflow-hidden border border-white/10 shadow-2xl bg-[#0d0d1a] aspect-video">
                  {CLIENT.youtubeVideoId ? (
                    <div className="absolute inset-0 cursor-pointer group" onClick={() => setVideoLightbox(true)}>
                      <img src={`https://img.youtube.com/vi/${CLIENT.youtubeVideoId}/maxresdefault.jpg`} alt="Video thumbnail" className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 group-hover:bg-black/25 transition flex items-center justify-center">
                        <div className="w-20 h-20 rounded-full bg-white/95 group-hover:scale-110 transition-transform flex items-center justify-center shadow-2xl shadow-black/50">
                          <Play size={32} className="text-black ml-1" fill="black" />
                        </div>
                      </div>
                      <div className="absolute bottom-4 right-4 text-[10px] text-white/40 bg-black/40 px-2 py-1 rounded-lg backdrop-blur-sm">Click to watch</div>
                    </div>
                  ) : (
                    <AnimatedDemo />
                  )}
                </div>
              </div>
            </section>

            {/* HOW IT WORKS — compact */}
            <section className="py-12 px-6 border-t border-white/5">
              <div className="max-w-4xl mx-auto">
                <div className="text-center mb-10">
                  <h2 className="text-xl sm:text-2xl md:text-3xl font-black mb-2">Up and running in 5 minutes</h2>
                  <p className="text-white/40 text-sm">Self-service setup — no waiting, no tech skills needed</p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {howItWorks.map((step, i) => (
                    <div key={i} className="relative text-center glass-card card-hover rounded-2xl p-4">
                      {i < howItWorks.length - 1 && (
                        <div className="hidden md:block absolute top-7 left-[62%] w-full h-px bg-gradient-to-r from-amber-500/25 to-transparent z-0" />
                      )}
                      <div className="relative z-10">
                        <div className="w-14 h-14 mx-auto mb-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-center">
                          <step.icon size={20} className="text-amber-400" />
                        </div>
                        <div className="text-[10px] font-bold text-amber-500 mb-1">Step {step.step}</div>
                        <h3 className="font-bold text-white text-sm mb-1">{step.title}</h3>
                        <p className="text-[11px] text-white/35 leading-relaxed">{step.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* BOTTOM CTA */}
            <section className="py-16 px-6 text-center relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,rgba(245,158,11,0.10),transparent_70%)]" />
              <div className="relative max-w-xl mx-auto">
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-black mb-3">Ready to put social media on autopilot?</h2>
                <p className="text-white/40 mb-8 text-sm">Australian businesses already saving 8+ hours a week.</p>
                <button
                  onClick={() => setShowPricing(true)}
                  className="group inline-flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black px-8 py-4 rounded-2xl text-lg hover:opacity-90 transition shadow-2xl shadow-amber-500/25"
                >
                  Get Started Today <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                </button>
                <p className="text-white/20 text-xs mt-5">$99 setup · from $29/month · No lock-in contract</p>
                <p className="text-white/20 text-xs mt-2">
                  Already a customer?{' '}
                  <button onClick={() => onActivate('growth')} className="text-amber-400 hover:text-amber-300 underline underline-offset-2 transition">
                    Access your dashboard
                  </button>
                </p>
              </div>
            </section>
          </div>
        )}

        {/* ─── BENEFITS TAB ─── */}
        {tab === 'benefits' && (
          <div className="max-w-5xl mx-auto px-6 py-16 space-y-24">

            {/* HERO PROBLEM/SOLUTION */}
            <div className="text-center">
              <div className="inline-flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-300 text-xs font-semibold px-4 py-2 rounded-full mb-6">
                <Timer size={12} /> The #1 reason small businesses fail at social media
              </div>
              <h2 className="text-2xl sm:text-3xl md:text-5xl font-black mb-5 leading-tight">
                You know you <span className="italic text-white/50">should</span> be posting.{' '}
                <span className="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">But who has the time?</span>
              </h2>
              <p className="text-white/45 max-w-2xl mx-auto text-base leading-relaxed mb-10">
                Most businesses post once, get busy, then go silent for weeks. Your competitors don't stop.
                SocialAI Studio makes sure <strong className="text-white/70">you never go quiet again</strong> — with AI that writes, designs, schedules, and publishes for you.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-3xl mx-auto">
                {[
                  { emoji: '1', title: 'Tell us about your business', desc: 'Industry, location, tone — takes 60 seconds', color: 'from-blue-500 to-indigo-600' },
                  { emoji: '2', title: 'AI creates your content plan', desc: 'Captions, images, hashtags, schedule — all done', color: 'from-amber-500 to-orange-500' },
                  { emoji: '3', title: 'Posts publish automatically', desc: 'Facebook & Instagram, on autopilot', color: 'from-emerald-500 to-teal-500' },
                ].map((step, i) => (
                  <div key={i} className="relative bg-white/[0.03] border border-white/10 rounded-2xl p-6 text-center">
                    <div className={`w-10 h-10 mx-auto mb-4 rounded-full bg-gradient-to-br ${step.color} flex items-center justify-center`}>
                      <span className="text-white font-black text-sm">{step.emoji}</span>
                    </div>
                    <h3 className="font-bold text-sm mb-1.5">{step.title}</h3>
                    <p className="text-xs text-white/40">{step.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* IMPACT STATS — BIG & BOLD */}
            <div>
              <div className="text-center mb-10">
                <div className="inline-flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs font-semibold px-4 py-2 rounded-full mb-5">
                  <TrendingUp size={12} /> Real Results for Real Businesses
                </div>
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-black mb-3">The numbers speak for themselves</h2>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { icon: Clock,         value: '8+ hrs',  label: 'Saved every single week',     sub: 'That\'s a full work day back',     color: 'text-amber-400',   bg: 'bg-gradient-to-br from-amber-500/15 to-orange-500/5',   border: 'border-amber-500/25' },
                  { icon: TrendingUp,    value: '47%',     label: 'Higher engagement rate',       sub: 'vs manual posting',                color: 'text-emerald-400', bg: 'bg-gradient-to-br from-emerald-500/15 to-teal-500/5',   border: 'border-emerald-500/25' },
                  { icon: Repeat2,       value: '3x',      label: 'More consistent posting',     sub: 'Never go silent again',            color: 'text-blue-400',    bg: 'bg-gradient-to-br from-blue-500/15 to-indigo-500/5',   border: 'border-blue-500/25' },
                  { icon: MessageCircle, value: '2.4x',    label: 'Wider audience reach',         sub: 'More eyes on your brand',          color: 'text-purple-400',  bg: 'bg-gradient-to-br from-purple-500/15 to-pink-500/5',   border: 'border-purple-500/25' },
                ].map((s, i) => (
                  <div key={i} className={`${s.bg} border ${s.border} rounded-2xl p-6 text-center hover:scale-[1.03] transition-transform`}>
                    <s.icon size={22} className={`${s.color} mx-auto mb-3`} />
                    <p className={`text-4xl md:text-5xl font-black ${s.color}`}>{s.value}</p>
                    <p className="text-sm font-semibold text-white/70 mt-2">{s.label}</p>
                    <p className="text-xs text-white/30 mt-1">{s.sub}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* BEFORE / AFTER COMPARISON */}
            <div>
              <div className="text-center mb-10">
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-black mb-3">
                  <span className="text-red-400">Without</span> vs <span className="text-emerald-400">With</span> SocialAI Studio
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="bg-red-500/[0.04] border border-red-500/15 rounded-2xl p-7">
                  <div className="flex items-center gap-2 mb-5">
                    <X size={18} className="text-red-400" />
                    <h3 className="font-black text-red-400">Doing It Yourself</h3>
                  </div>
                  <div className="space-y-3">
                    {[
                      'Spend hours thinking of what to post',
                      'Scramble for images or skip them entirely',
                      'Post once, get busy, go silent for weeks',
                      'No idea what time your audience is online',
                      'Competitors drown you out',
                      'Engagement flatlines, followers stagnate',
                    ].map((item, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <X size={13} className="text-red-400/60 shrink-0 mt-0.5" />
                        <span className="text-sm text-white/45">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-emerald-500/[0.04] border border-emerald-500/15 rounded-2xl p-7 ring-1 ring-emerald-500/10">
                  <div className="flex items-center gap-2 mb-5">
                    <Rocket size={18} className="text-emerald-400" />
                    <h3 className="font-black text-emerald-400">With SocialAI Studio</h3>
                  </div>
                  <div className="space-y-3">
                    {[
                      'AI writes captions in your brand voice instantly',
                      'Every post gets a custom AI-generated image',
                      'Up to 21 posts per week, completely automated',
                      'AI schedules at peak engagement times',
                      'Your brand stays visible and top of mind',
                      'Consistent growth in followers and engagement',
                    ].map((item, i) => (
                      <div key={i} className="flex items-start gap-2.5">
                        <CheckCircle size={13} className="text-emerald-400 shrink-0 mt-0.5" />
                        <span className="text-sm text-white/70">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* FEATURES — WHAT YOU GET */}
            <div>
              <div className="text-center mb-10">
                <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold px-4 py-2 rounded-full mb-5">
                  <Zap size={12} /> Packed with Power
                </div>
                <h2 className="text-3xl md:text-4xl font-black mb-2">Everything your socials need to thrive</h2>
                <p className="text-white/40 text-sm">Built for busy small businesses who want results, not busywork</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
                {[
                  { icon: Brain, title: 'AI Caption Writing', desc: 'Google Gemini writes scroll-stopping captions in your brand voice. Hashtags included.', color: 'from-purple-500 to-indigo-600' },
                  { icon: ImageIcon, title: 'AI Image Generation', desc: 'Every single post gets a custom, eye-catching AI image. No stock photos needed.', color: 'from-pink-500 to-rose-600' },
                  { icon: Calendar, title: 'Smart Scheduling', desc: 'AI analyses your industry and picks the exact times your audience is most active.', color: 'from-blue-500 to-cyan-500' },
                  { icon: Facebook, title: 'Auto-Publish to Facebook & Insta', desc: 'Posts go live automatically. No logging in, no copying, no pasting. Ever.', color: 'from-blue-600 to-blue-800' },
                  { icon: BarChart3, title: 'Live Analytics Dashboard', desc: 'Track followers, reach, and engagement in real time. Know exactly what\'s working.', color: 'from-emerald-500 to-teal-600' },
                  { icon: Zap, title: 'Saturation Mode', desc: 'Flood your socials with 21 posts in one hit. Perfect for launches, promos, or catching up.', color: 'from-amber-500 to-orange-600' },
                ].map((f, i) => (
                  <div key={i} className="bg-white/[0.03] border border-white/8 rounded-2xl p-6 hover:bg-white/[0.06] hover:border-white/15 transition-all group">
                    <div className={`w-11 h-11 bg-gradient-to-br ${f.color} rounded-xl flex items-center justify-center mb-4 shadow-lg group-hover:scale-110 transition-transform`}>
                      <f.icon size={20} className="text-white" />
                    </div>
                    <h3 className="font-black mb-2 text-[15px]">{f.title}</h3>
                    <p className="text-xs text-white/45 leading-relaxed">{f.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* SOCIAL PROOF / TRUST */}
            <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/5 border border-amber-500/20 rounded-3xl p-8 md:p-10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
                <div>
                  <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold px-3 py-1.5 rounded-full mb-5">
                    <Star size={12} /> Built for Aussie Businesses
                  </div>
                  <h2 className="text-2xl md:text-3xl font-black mb-4 leading-tight">
                    Your social media on{' '}
                    <span className="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">complete autopilot</span>
                  </h2>
                  <p className="text-white/50 mb-6 text-sm leading-relaxed">
                    While you focus on running your business, SocialAI Studio keeps your brand in front of customers every single day. More visibility means more enquiries, more walk-ins, and more revenue.
                  </p>
                  <div className="space-y-3 mb-6">
                    {[
                      { text: 'Set it up in 60 seconds', bold: 'No design skills needed' },
                      { text: 'Posts go live automatically', bold: 'Even while you sleep' },
                      { text: 'Cancel anytime', bold: 'No lock-in contracts' },
                      { text: 'Aussie-built', bold: 'Local support, local business focus' },
                    ].map((f, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <CheckCircle size={15} className="text-amber-400 shrink-0 mt-0.5" />
                        <span className="text-sm text-white/65"><strong className="text-white/90">{f.bold}.</strong> {f.text}.</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5">
                    <div className="flex gap-1 mb-2">{[1,2,3,4,5].map(n => <Star key={n} size={14} className="text-amber-400 fill-amber-400" />)}</div>
                    <p className="text-sm text-white/60 italic leading-relaxed mb-3">"I used to spend my Sundays writing posts. Now the AI does a full week in 30 seconds. Game changer for my bakery."</p>
                    <p className="text-xs font-bold text-white/80">Sarah M. — Cafe Owner, Gold Coast</p>
                  </div>
                  <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-5">
                    <div className="flex gap-1 mb-2">{[1,2,3,4,5].map(n => <Star key={n} size={14} className="text-amber-400 fill-amber-400" />)}</div>
                    <p className="text-sm text-white/60 italic leading-relaxed mb-3">"My gym's Instagram went from dead to 3 posts a week with real engagement. Members are finding us through social now."</p>
                    <p className="text-xs font-bold text-white/80">Jake T. — Fitness Studio, Brisbane</p>
                  </div>
                </div>
              </div>
            </div>

            {/* AGENCY SECTION */}
            <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/5 border border-emerald-500/20 rounded-3xl p-8 md:p-10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
                <div>
                  <div className="inline-flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-semibold px-3 py-1.5 rounded-full mb-5">
                    <Users size={12} /> For Social Media Managers & Agencies
                  </div>
                  <h2 className="text-2xl md:text-3xl font-black mb-3 leading-tight">
                    Manage all your clients{' '}
                    <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">from one dashboard</span>
                  </h2>
                  <p className="text-white/50 mb-5 text-sm leading-relaxed">
                    The Agency plan gives you up to 5 client workspaces — each with their own profile, posts, Facebook page, and AI settings. Switch between clients instantly.
                  </p>
                  <div className="space-y-2.5 mb-6">
                    {[
                      'Up to 5 separate client workspaces',
                      'Per-client Facebook & Instagram connection',
                      'Per-client AI content, schedule & analytics',
                      'One monthly bill — not per client',
                    ].map((f, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm">
                        <CheckCircle size={14} className="text-emerald-400 shrink-0" />
                        <span className="text-white/70">{f}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-end gap-2 mb-5">
                    <span className="text-3xl font-black text-white">$149</span>
                    <span className="text-white/40 mb-0.5 text-sm">/month + $99 setup</span>
                  </div>
                  <button
                    onClick={() => setShowPricing(true)}
                    className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white font-bold px-5 py-2.5 rounded-xl hover:opacity-90 transition text-sm"
                  >
                    Get Agency Plan <ArrowRight size={15} />
                  </button>
                </div>
                <div className="space-y-3">
                  {[
                    { name: "Bella's Bakery", type: 'Cafe & Bakery', posts: 14, active: true },
                    { name: 'FastFit Gym', type: 'Fitness Studio', posts: 21, active: false },
                    { name: 'Green Thumb Nursery', type: 'Garden Centre', posts: 7, active: false },
                  ].map((client, i) => (
                    <div key={i} className={`flex items-center gap-3 p-3.5 rounded-2xl border ${client.active ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/3 border-white/8'}`}>
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
                        <span className="text-white font-black text-sm">{client.name.charAt(0)}</span>
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-sm text-white">{client.name}</p>
                        <p className="text-xs text-white/40">{client.type}</p>
                      </div>
                      <p className="text-xs font-bold text-emerald-400">{client.posts} posts/wk</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* FINAL CTA */}
            <div className="text-center space-y-5">
              <h2 className="text-2xl md:text-3xl font-black">Ready to grow your business on social media?</h2>
              <p className="text-white/40 text-sm max-w-lg mx-auto">Join hundreds of businesses that stopped overthinking social media and let AI handle it.</p>
              <button onClick={() => { setTab('pricing'); }} className="inline-flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black px-10 py-4 rounded-2xl hover:opacity-90 transition text-base shadow-xl shadow-amber-500/20">
                Get Started Now <ArrowRight size={18} />
              </button>
              <p className="text-xs text-white/25">No lock-in. Cancel anytime. Set up in 60 seconds.</p>
            </div>
          </div>
        )}

        {/* ─── PRICING TAB ─── */}
        {tab === 'pricing' && (
          <div className="max-w-5xl mx-auto px-6 py-16">
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold px-4 py-2 rounded-full mb-5">
                One-time ${CLIENT.setupFee} setup fee · then pay monthly · cancel anytime
              </div>
              <h2 className="text-3xl md:text-4xl font-black mb-2">Simple, honest pricing</h2>
              <p className="text-white/40 text-sm">Pick one plan — that's it. No stacking, no hidden extras.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
              {CLIENT.plans.map((plan) => {
                const checkColor = plan.id === 'starter' ? 'text-blue-400' : plan.id === 'growth' ? 'text-amber-400' : plan.id === 'pro' ? 'text-purple-400' : 'text-emerald-400';
                const glowBg = plan.id === 'starter' ? 'rgba(59,130,246,0.1)' : plan.id === 'growth' ? 'rgba(245,158,11,0.1)' : plan.id === 'pro' ? 'rgba(168,85,247,0.1)' : 'rgba(16,185,129,0.1)';
                const borderColor = plan.id === 'starter' ? 'border-blue-500/30' : plan.id === 'growth' ? 'border-amber-500/30' : plan.id === 'pro' ? 'border-purple-500/30' : 'border-emerald-500/30';
                const includesLabel = planIncludes[plan.id];
                return (
                  <div
                    key={plan.id}
                    className={`relative rounded-3xl border flex flex-col overflow-hidden hover:scale-[1.02] transition-transform ${borderColor}`}
                    style={{ background: `linear-gradient(160deg, ${glowBg} 0%, #0d0d14 55%)` }}
                  >
                    <div className={`h-1 w-full bg-gradient-to-r ${plan.color}`} />
                    {plan.badge && (
                      <div className={`absolute top-4 right-4 bg-gradient-to-r ${plan.color} text-white text-[10px] font-black px-3 py-1 rounded-full shadow-lg`}>
                        {plan.badge}
                      </div>
                    )}
                    <div className="p-6 flex flex-col flex-1">
                      <div className={`w-10 h-10 rounded-2xl bg-gradient-to-br ${plan.color} flex items-center justify-center mb-4 shadow-lg`}>
                        <Zap size={18} className="text-white" />
                      </div>
                      <h3 className="text-xl font-black mb-1 text-white">{plan.name}</h3>
                      {/* Price — standalone, not cumulative */}
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-black text-white">${plan.price}</span>
                        <span className="text-white/40 text-sm">/mo</span>
                      </div>
                      <p className="text-[11px] text-amber-400/70 mt-0.5 mb-5">+ ${CLIENT.setupFee} one-time setup</p>
                      {includesLabel && (
                        <p className="text-[10px] font-bold text-white/30 uppercase tracking-wider mb-2">{includesLabel}</p>
                      )}
                      <ul className="space-y-2 mb-6 flex-1">
                        {plan.features.map((f, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm">
                            <CheckCircle size={13} className={`${checkColor} shrink-0 mt-0.5`} />
                            <span className="text-white/65">{f}</span>
                          </li>
                        ))}
                        {plan.limitations.map((f, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm opacity-40">
                            <span className="text-white/20 shrink-0 mt-0.5 w-[13px] text-center">—</span>
                            <span className="text-white/30 line-through">{f}</span>
                          </li>
                        ))}
                      </ul>
                      <button
                        onClick={() => setShowPricing(true)}
                        className={`w-full bg-gradient-to-r ${plan.color} text-white font-black py-3.5 rounded-2xl hover:opacity-90 transition flex items-center justify-center gap-2 shadow-lg text-sm`}
                      >
                        Get {plan.name} <ArrowRight size={15} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-8 bg-white/3 border border-white/8 rounded-2xl px-6 py-5 max-w-2xl mx-auto text-center space-y-1">
              <p className="text-sm font-bold text-white/60">You only pay for one plan</p>
              <p className="text-xs text-white/30 leading-relaxed">Each plan is standalone — you're not charged for lower tiers. The {CLIENT.setupFee === 99 ? '$99' : `$${CLIENT.setupFee}`} setup fee is a one-time charge that covers Facebook page connection and account configuration.</p>
            </div>
          </div>
        )}

        {/* ─── CONTACT TAB ─── */}
        {tab === 'contact' && (
          <div className="max-w-2xl mx-auto px-6 py-16">
            <div className="text-center mb-10">
              <h2 className="text-3xl md:text-4xl font-black mb-2">Get in touch</h2>
              <p className="text-white/40 text-sm">We'd love to hear from you. Usually reply within 1 business day.</p>
            </div>

            {contactSent ? (
              <div className="bg-green-500/8 border border-green-500/25 rounded-3xl p-10 text-center space-y-4">
                <div className="w-16 h-16 mx-auto bg-green-500/15 border border-green-500/25 rounded-2xl flex items-center justify-center">
                  <CheckCircle size={28} className="text-green-400" />
                </div>
                <h3 className="text-xl font-black text-white">Message sent!</h3>
                <p className="text-white/50 text-sm">Thanks for reaching out. We'll be in touch shortly at <span className="text-amber-300">{contactForm.email}</span>.</p>
                <button onClick={() => { setContactSent(false); setContactForm({ name: '', email: '', phone: '', message: '' }); }} className="text-xs text-white/30 hover:text-white/60 transition underline">
                  Send another message
                </button>
              </div>
            ) : (
              <div className="glass-card border-gradient rounded-3xl p-6 md:p-8 space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-white/40 block mb-1.5">Your Name *</label>
                    <input
                      value={contactForm.name}
                      onChange={e => setContactForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="Jane Smith"
                      className="w-full bg-black/40 border border-white/8 rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40 transition"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-white/40 block mb-1.5">Email Address *</label>
                    <input
                      type="email"
                      value={contactForm.email}
                      onChange={e => setContactForm(p => ({ ...p, email: e.target.value }))}
                      placeholder="jane@yourbusiness.com.au"
                      className="w-full bg-black/40 border border-white/8 rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40 transition"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-white/40 block mb-1.5">Phone (optional)</label>
                  <input
                    value={contactForm.phone}
                    onChange={e => setContactForm(p => ({ ...p, phone: e.target.value }))}
                    placeholder="0412 345 678"
                    className="w-full bg-black/40 border border-white/8 rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40 transition"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-white/40 block mb-1.5">Message *</label>
                  <textarea
                    value={contactForm.message}
                    onChange={e => setContactForm(p => ({ ...p, message: e.target.value }))}
                    rows={5}
                    placeholder="Tell us about your business and what you need..."
                    className="w-full bg-black/40 border border-white/8 rounded-xl px-3 py-2.5 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40 transition resize-none"
                  />
                </div>
                <button
                  onClick={handleContactSend}
                  disabled={!contactForm.name.trim() || !contactForm.email.trim() || !contactForm.message.trim() || contactSending}
                  className="w-full bg-gradient-to-r from-amber-500 to-orange-500 disabled:opacity-40 text-black font-black py-3.5 rounded-2xl flex items-center justify-center gap-2 transition hover:opacity-90 text-sm"
                >
                  {contactSending
                    ? <><span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> Sending…</>
                    : <>Send Message <ArrowRight size={15} /></>}
                </button>

                <div className="border-t border-white/6 pt-5 space-y-3">
                  <p className="text-xs text-white/25 text-center">Or reach us directly:</p>
                  <div className="flex flex-wrap justify-center gap-3">
                    <a href={`mailto:${CLIENT.supportEmail}`} className="flex items-center gap-2 text-xs text-white/40 hover:text-amber-300 border border-white/8 hover:border-amber-500/25 px-3 py-2 rounded-xl transition">
                      ✉ {CLIENT.supportEmail}
                    </a>
                    <a href={CLIENT.salesUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-white/40 hover:text-amber-300 border border-white/8 hover:border-amber-500/25 px-3 py-2 rounded-xl transition">
                      🌐 {CLIENT.salesUrl.replace('https://', '')}
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── FAQ TAB ─── */}
        {tab === 'faq' && (
          <div className="max-w-2xl mx-auto px-6 py-16">
            <div className="text-center mb-10">
              <h2 className="text-3xl md:text-4xl font-black mb-2">Common questions</h2>
              <p className="text-white/40 text-sm">Everything you need to know before getting started</p>
            </div>
            <div className="space-y-3">
              {faqs.map((faq, i) => (
                <div key={i} className="glass rounded-2xl overflow-hidden">
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full flex items-center justify-between px-6 py-5 text-left hover:bg-white/3 transition"
                  >
                    <span className="font-semibold text-sm md:text-base pr-4">{faq.q}</span>
                    {openFaq === i
                      ? <ChevronUp size={16} className="text-amber-400 shrink-0" />
                      : <ChevronDown size={16} className="text-white/30 shrink-0" />}
                  </button>
                  {openFaq === i && (
                    <div className="px-6 pb-5 text-sm text-white/50 leading-relaxed border-t border-white/5 pt-4">
                      {faq.a}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-10 text-center">
              <p className="text-white/30 text-sm mb-4">Still have questions?</p>
              <a
                href={`mailto:${CLIENT.supportEmail}`}
                className="inline-flex items-center gap-2 border border-white/15 text-white/60 hover:text-white hover:border-white/30 px-5 py-2.5 rounded-xl text-sm font-semibold transition"
              >
                Email us at {CLIENT.supportEmail}
              </a>
            </div>
          </div>
        )}

      </main>

      {/* FOOTER */}
      <footer className="border-t border-white/5 py-8 px-6 mt-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/20">
          <AppLogo size={40} />
          <div className="flex items-center gap-4 flex-wrap justify-center">
            {NAV_TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} className="hover:text-white/50 transition">{t.label}</button>
            ))}
          </div>
          <span>
            <a href={CLIENT.poweredByUrl} target="_blank" rel="noopener noreferrer" className="hover:text-white/40 transition">{CLIENT.poweredBy}</a>
            {' · '}
            <a href={`mailto:${CLIENT.supportEmail}`} className="hover:text-white/40 transition">{CLIENT.supportEmail}</a>
          </span>
        </div>
      </footer>
    </div>
  );
};

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
import { PostShowcase } from './PostShowcase';
import { LiveGallery } from './LiveGallery';
import { HowItActuallyWorks } from './HowItActuallyWorks';
import { CinematicTour } from './CinematicTour';

type LandingTab = 'home' | 'benefits' | 'pricing' | 'faq' | 'contact';

interface Props {
  onActivate: (plan: 'starter' | 'growth' | 'pro') => void;
  onSignIn: () => void;
  portalContent?: { hero_title: string; hero_subtitle: string; hero_cta_text: string };
}

const faqs = [
  {
    q: 'Do I have to pay to try it?',
    a: `No. Sign up free and generate your first ${CLIENT.freeTrialPosts ?? 3} AI posts — captions, hashtags, the lot — without entering payment details. Pick a plan when you want to keep going.`,
  },
  {
    q: 'What happens after I sign up?',
    a: `You go straight into a quick setup wizard — business details, tone, Facebook page connection — and the AI starts generating your first posts. Under 5 minutes from signup to your first post.`,
  },
  {
    q: 'Do I need a Facebook Business page?',
    a: 'Yes — you need an active Facebook Business page that you admin. You connect it yourself during setup with a single click. No technical knowledge needed.',
  },
  {
    q: 'Is there a setup fee or contract?',
    a: 'No setup fee, no contract, no lock-in. Just a monthly subscription you can cancel anytime from PayPal.',
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
            {/* Single primary CTA in the header — duplicate amber buttons
                trained the eye to ignore both. The hero owns the trial CTA;
                the nav is for returning customers. */}
            <button
              onClick={onSignIn}
              className="text-sm text-white/70 hover:text-white font-semibold px-5 py-2 rounded-full border border-white/15 hover:border-white/30 bg-white/5 hover:bg-white/10 transition"
            >
              Sign In
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
            {/* HERO — editorial split. Left: copy. Right: PostShowcase (rotating
                post mockups across 6 Aussie SMB industries — the actual product
                output, not an abstract "AI tool" demo). Less amber gradient,
                more grain texture, more whitespace. */}
            <section className="relative pt-16 sm:pt-20 pb-20 px-6 overflow-hidden grain-bg">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_-10%,rgba(245,158,11,0.13),transparent_55%)]" />
              <div className="relative max-w-6xl mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-[1.1fr_0.9fr] gap-10 lg:gap-16 items-center animate-fadeSlideUp">
                  {/* LEFT — copy + CTA. Editorial alignment: left on md+, centered
                      on mobile. Headline drops gradient on the lead phrase to feel
                      less "tech demo", reserves the gradient for the closer. */}
                  <div className="text-center md:text-left">
                    <div className="inline-flex items-center gap-2 text-[10px] sm:text-[11px] font-bold tracking-[0.18em] text-amber-300/80 uppercase mb-7">
                      <span className="w-6 h-px bg-amber-300/40" />
                      Crafted in Australia · For small business
                    </div>
                    <h1 className="text-[2.25rem] sm:text-5xl md:text-6xl lg:text-[4rem] font-black mb-6 leading-[1.02] tracking-[-0.02em]">
                      {portalContent?.hero_title ? (
                        <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-pink-400 bg-clip-text text-transparent">
                          {portalContent.hero_title}
                        </span>
                      ) : (
                        <>
                          <span className="block text-white">Your Facebook &amp;</span>
                          <span className="block text-white">Instagram posts —</span>
                          <span className="block bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 bg-clip-text text-transparent italic font-serif font-light pt-1">
                            written every day.
                          </span>
                        </>
                      )}
                    </h1>
                    <p className="text-base sm:text-lg md:text-[1.075rem] text-white/70 mb-8 max-w-xl mx-auto md:mx-0 leading-[1.6]">
                      {portalContent?.hero_subtitle || "Built for Aussie cafes, tradies, salons and small retailers. We read your existing posts to learn your voice, so every caption sounds like you on a good day — not a robot."}
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start items-center">
                      <button
                        onClick={onSignIn}
                        className="group bg-white text-black font-black px-7 py-4 rounded-full text-sm sm:text-base hover:bg-amber-50 transition-all flex items-center gap-2 shadow-[0_10px_40px_-12px_rgba(255,255,255,0.3)]"
                      >
                        {portalContent?.hero_cta_text || `Generate ${CLIENT.freeTrialPosts ?? 3} free posts`}
                        <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
                      </button>
                      {CLIENT.youtubeVideoId && (
                        <button
                          onClick={() => setVideoLightbox(true)}
                          className="group inline-flex items-center gap-2.5 text-sm text-white/65 hover:text-white transition px-3 py-2"
                        >
                          <span className="w-9 h-9 rounded-full bg-white/8 group-hover:bg-white/15 border border-white/15 flex items-center justify-center transition">
                            <Play size={12} className="text-white ml-0.5" fill="white" />
                          </span>
                          Watch the 90-second tour
                        </button>
                      )}
                    </div>
                    <p className="text-xs sm:text-sm text-white/40 mt-5">
                      {CLIENT.freeTrialPosts ?? 3} free posts · No card · $29/mo when you're ready · Cancel in 2 clicks
                    </p>
                  </div>

                  {/* RIGHT — PostShowcase: 6 rotating Aussie SMB post mockups.
                      Cards stack with perspective, swap every 4.5s. The product
                      output IS the demo. */}
                  <div className="relative pt-2 md:pt-0">
                    <PostShowcase />
                  </div>
                </div>

                {/* 3 BENEFIT PILLARS — one amber anchor + two neutral surfaces.
                    Linear/Stripe rule: colour earns its place by signalling
                    state or hierarchy, not as decoration. */}
                <div className="mt-12 grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {[
                    {
                      icon: Timer,
                      anchor: true,
                      stat: '8+ hrs',
                      title: 'Saved every week',
                      desc: 'No more writing captions, hunting images, or scheduling at midnight. The AI handles it.',
                    },
                    {
                      icon: DollarSign,
                      anchor: false,
                      stat: '$0.87',
                      title: 'Per post on Growth',
                      desc: 'A freelance manager charges $40–$80 per post in Australia. Our AI does the job from 87¢.',
                    },
                    {
                      icon: Rocket,
                      anchor: false,
                      stat: '3× more',
                      title: 'Consistent posting',
                      desc: 'Businesses that post consistently get 3× the reach. AI never forgets, never gets busy.',
                    },
                  ].map((p, i) => (
                    <div
                      key={i}
                      className={`rounded-2xl p-6 text-left border ${
                        p.anchor
                          ? 'bg-gradient-to-br from-amber-500/[0.08] to-amber-500/[0.02] border-amber-500/20'
                          : 'bg-white/[0.03] border-white/[0.08]'
                      }`}
                    >
                      <p.icon size={22} className={`${p.anchor ? 'text-amber-400' : 'text-white/55'} mb-3`} />
                      <p className={`text-3xl font-black mb-1 ${p.anchor ? 'text-amber-400' : 'text-white'}`}>{p.stat}</p>
                      <p className="font-bold text-white text-sm mb-2">{p.title}</p>
                      <p className="text-xs text-white/45 leading-relaxed">{p.desc}</p>
                    </div>
                  ))}
                </div>
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

              {/* LIVE GALLERY — full-bleed two-row marquee of post mockups
                  across six Aussie SMB industries. Concrete proof of variety;
                  the hero's PostShowcase is intimate, this is panoramic. */}
              <LiveGallery />

            {/* HOW IT ACTUALLY WORKS — light cream tonal break.
                Replaces the previous setup-checklist (which explained
                onboarding effort, not the AI black box). */}
            <HowItActuallyWorks />

            {/* CINEMATIC TOUR — atmospheric video moment. Renders YouTube
                thumbnail when CLIENT.youtubeVideoId is set, otherwise an
                animated CSS placeholder until real footage drops in. */}
            <CinematicTour onPlay={() => setVideoLightbox(true)} />

            {/* BOTTOM CTA — routes to signup, not pricing. The product is
                the wedge; pricing fires after the trial is felt. */}
            <section className="py-16 px-6 text-center relative overflow-hidden">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,rgba(245,158,11,0.10),transparent_70%)]" />
              <div className="relative max-w-xl mx-auto">
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-black mb-3">Stop spending Sundays writing captions.</h2>
                <p className="text-white/55 mb-8 text-sm">Let it post while you sleep. {CLIENT.freeTrialPosts ?? 3} free posts to start — no card.</p>
                <button
                  onClick={onSignIn}
                  className="group inline-flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black px-8 py-4 rounded-2xl text-lg hover:opacity-90 transition shadow-2xl shadow-amber-500/25"
                >
                  Generate {CLIENT.freeTrialPosts ?? 3} Free Posts <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
                </button>
                <p className="text-white/30 text-xs mt-5">No card · $29/mo when you're ready · Cancel in 2 clicks</p>
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
              {/* 3-step strip — editorial pattern matching HowItActuallyWorks
                  on the home tab. Amber-only accents, large numerals, no
                  rainbow gradient circles. */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-8 max-w-4xl mx-auto text-left">
                {[
                  { num: '01', title: 'Tell us about your business', desc: 'Industry, location, tone — 60 seconds, one time.' },
                  { num: '02', title: 'AI writes &amp; designs every post', desc: 'Captions in your voice, custom images, smart scheduling.' },
                  { num: '03', title: 'Posts publish automatically', desc: 'Direct to Facebook &amp; Instagram. You stay in control.' },
                ].map((step, i) => (
                  <div key={i} className="relative">
                    <div className="flex items-baseline gap-3 mb-3">
                      <span className="text-5xl sm:text-6xl font-black text-amber-400/85 tracking-[-0.04em] leading-none">{step.num}</span>
                    </div>
                    <h3 className="font-black text-base sm:text-lg text-white mb-1.5 tracking-tight" dangerouslySetInnerHTML={{ __html: step.title }} />
                    <p className="text-sm text-white/50 leading-[1.55]" dangerouslySetInnerHTML={{ __html: step.desc }} />
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
              {/* Stats row — single amber anchor (the headline number),
                  three neutral surfaces. Same Linear/Stripe rule the hero
                  pillars follow: colour signals hierarchy, not decoration.
                  Removed the hover:scale — suggests interactivity that isn't there. */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { icon: Clock,         value: '8+ hrs',  label: 'Saved every single week',  sub: "That's a full work day back",   anchor: true  },
                  { icon: TrendingUp,    value: '47%',     label: 'Higher engagement rate',   sub: 'vs manual posting',             anchor: false },
                  { icon: Repeat2,       value: '3x',      label: 'More consistent posting',  sub: 'Never go silent again',         anchor: false },
                  { icon: MessageCircle, value: '2.4x',    label: 'Wider audience reach',     sub: 'More eyes on your brand',       anchor: false },
                ].map((s, i) => (
                  <div
                    key={i}
                    className={`rounded-2xl p-6 text-center border ${
                      s.anchor
                        ? 'bg-gradient-to-br from-amber-500/[0.10] to-amber-500/[0.02] border-amber-500/25'
                        : 'bg-white/[0.03] border-white/[0.08]'
                    }`}
                  >
                    <s.icon size={22} className={`${s.anchor ? 'text-amber-400' : 'text-white/55'} mx-auto mb-3`} />
                    <p className={`text-4xl md:text-5xl font-black ${s.anchor ? 'text-amber-400' : 'text-white'}`}>{s.value}</p>
                    <p className="text-sm font-semibold text-white/70 mt-2">{s.label}</p>
                    <p className="text-xs text-white/35 mt-1">{s.sub}</p>
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

            {/* FEATURES — editorial spec-sheet. Two featured "anchor" cards
                with amber accents, four supporting items as text-list with
                editorial numbering. Replaces the rainbow gradient grid that
                fought every other surface for attention. */}
            <div>
              <div className="mb-12 max-w-2xl">
                <div className="inline-flex items-center gap-2 text-[10px] sm:text-[11px] font-bold tracking-[0.22em] text-amber-300/80 uppercase mb-5">
                  <span className="w-6 h-px bg-amber-300/40" />
                  Packed with power
                </div>
                <h2 className="text-3xl md:text-5xl font-black tracking-[-0.02em] leading-[1.05]">
                  Everything your socials need —
                  <span className="block italic font-serif font-light text-white/50">no busywork attached.</span>
                </h2>
              </div>

              {/* Two featured cards — the most visual features. Amber-only
                  accents, no per-card gradient story. */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
                {[
                  { icon: Brain, title: 'AI Caption Writing', desc: "Captions in your voice — not a generic template. We read your existing posts and match the tone before we write a word." },
                  { icon: ImageIcon, title: 'AI Image Generation', desc: "A custom image with every post. Not stock photos. Not Canva templates. Made on the fly to match the caption." },
                ].map((f, i) => (
                  <div key={i} className="bg-gradient-to-br from-white/[0.04] to-white/[0.01] border border-white/[0.08] rounded-3xl p-7 sm:p-9 hover:border-amber-500/25 transition">
                    <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/25 rounded-2xl flex items-center justify-center mb-5">
                      <f.icon size={20} className="text-amber-400" />
                    </div>
                    <h3 className="text-xl sm:text-2xl font-black mb-3 text-white tracking-tight">{f.title}</h3>
                    <p className="text-[15px] text-white/55 leading-[1.6]">{f.desc}</p>
                  </div>
                ))}
              </div>

              {/* Four supporting items — magazine columns with editorial
                  numbering (03–06), divider lines, no icons. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-12 gap-y-7 pt-2">
                {[
                  { title: 'Smart Scheduling', desc: "AI picks the times your audience is actually online. No more 9am-because-that's-when-you-remembered." },
                  { title: 'Auto-publish to FB & IG', desc: "Posts go live automatically. No logging in, no copy-paste, no time-zone maths." },
                  { title: 'Live Analytics', desc: "Followers, reach, engagement — track what's working, drop what isn't." },
                  { title: 'Saturation Mode', desc: "Going on holiday? Doing a launch? Hit one button — 21 posts queued and scheduled across 3 weeks." },
                ].map((f, i) => (
                  <div key={i} className="border-t border-white/8 pt-5">
                    <h3 className="text-[10px] font-bold tracking-[0.22em] text-amber-300/70 uppercase mb-2.5">
                      0{i + 3}
                    </h3>
                    <h4 className="text-lg font-black text-white mb-1.5 tracking-tight">{f.title}</h4>
                    <p className="text-sm text-white/55 leading-[1.6]">{f.desc}</p>
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
                {/* Trust card — adapts to whether a founder is configured.
                    With CLIENT.founder.firstName + photoUrl set, becomes a
                    personal "Hi, I'm [name]" promise card with the photo.
                    Without, falls back to the AU flag + generic commitments.
                    See client.config.ts founder block to enable. */}
                {(() => {
                  const founder = CLIENT.founder;
                  const hasFounder = !!(founder?.firstName && founder?.photoUrl);
                  return (
                    <div className="bg-white/[0.04] border border-white/10 rounded-2xl p-7 space-y-5">
                      <div className="flex items-center gap-3.5">
                        {hasFounder ? (
                          <img
                            src={founder.photoUrl}
                            alt={founder.firstName}
                            className="w-14 h-14 rounded-2xl object-cover border-2 border-amber-500/30 flex-shrink-0"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/10 border border-amber-500/30 flex items-center justify-center flex-shrink-0 text-3xl">
                            🇦🇺
                          </div>
                        )}
                        <div>
                          <p className="font-black text-white text-sm">
                            {hasFounder
                              ? <>Hi, I'm <span className="text-amber-300">{founder.firstName}</span> — and I built this.</>
                              : 'Built and supported in Australia'}
                          </p>
                          <p className="text-xs text-white/50 mt-0.5">
                            {hasFounder
                              ? founder.promise
                              : 'A small team. A real human reply.'}
                          </p>
                        </div>
                      </div>
                      <ul className="space-y-3 text-sm text-white/70">
                        <li className="flex gap-2.5">
                          <CheckCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                          <span><strong className="text-white/90">Same-day email replies</strong> — usually within a few hours, AEST.</span>
                        </li>
                        <li className="flex gap-2.5">
                          <CheckCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                          <span><strong className="text-white/90">Your content stays yours</strong> — we never train AI on your business data.</span>
                        </li>
                        <li className="flex gap-2.5">
                          <CheckCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                          <span><strong className="text-white/90">Cancel anytime</strong> — two clicks in PayPal. No contract, no email tag.</span>
                        </li>
                        <li className="flex gap-2.5">
                          <CheckCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                          <span><strong className="text-white/90">No card to start</strong> — generate {CLIENT.freeTrialPosts ?? 3} free posts before you ever pay.</span>
                        </li>
                      </ul>
                      <a href={`mailto:${CLIENT.supportEmail}`} className="inline-flex items-center gap-2 text-xs text-amber-400 hover:text-amber-300 transition pt-1">
                        <span>✉</span> {CLIENT.supportEmail}
                      </a>
                    </div>
                  );
                })()}
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
                    <span className="text-white/40 mb-0.5 text-sm">/month</span>
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

            {/* FINAL CTA — claims dropped that we can't substantiate.
                "Hundreds of businesses" without a real number reads suspicious. */}
            <div className="text-center space-y-5">
              <h2 className="text-2xl md:text-3xl font-black">Stop overthinking social media. Let AI handle it.</h2>
              <p className="text-white/45 text-sm max-w-lg mx-auto">Generate {CLIENT.freeTrialPosts ?? 3} full posts — caption, image, hashtags — in your voice. If they sound like a robot, walk away. We've wasted 4 minutes of your day, not $29 of your money.</p>
              <button onClick={onSignIn} className="inline-flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black px-10 py-4 rounded-2xl hover:opacity-90 transition text-base shadow-xl shadow-amber-500/20">
                Generate {CLIENT.freeTrialPosts ?? 3} Free Posts <ArrowRight size={18} />
              </button>
              <p className="text-xs text-white/25">No credit card · No setup fee · Cancel in 2 clicks</p>
            </div>
          </div>
        )}

        {/* ─── PRICING TAB ─── editorial unified palette */}
        {tab === 'pricing' && (
          <div className="max-w-5xl mx-auto px-6 py-20">
            <div className="mb-14 max-w-2xl">
              <div className="inline-flex items-center gap-2 text-[10px] sm:text-[11px] font-bold tracking-[0.22em] text-amber-300/80 uppercase mb-5">
                <span className="w-6 h-px bg-amber-300/40" />
                {CLIENT.freeTrialPosts ?? 3} free posts to start · cancel any time
              </div>
              <h2 className="text-3xl md:text-5xl font-black tracking-[-0.02em] leading-[1.05]">
                Simple, honest pricing.
                <span className="block italic font-serif font-light text-white/55">Pick one. That's it.</span>
              </h2>
              <p className="mt-5 text-base text-white/55 leading-[1.65] max-w-xl">
                Each plan is standalone — you're not charged for lower tiers. Try {CLIENT.freeTrialPosts ?? 3} AI posts free first, then pick what suits you.
              </p>
            </div>
            {/* Pricing grid — Growth is the single visual anchor (amber).
                Starter and Pro are matte neutral surfaces. Killing the
                rainbow per-plan colour story removes the "AI SaaS template"
                feel and makes the eye actually pick a plan. */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-4xl">
              {CLIENT.plans.filter(plan => plan.id !== 'agency').map((plan) => {
                const isAnchor = plan.id === 'growth';
                const includesLabel = planIncludes[plan.id];
                return (
                  <div
                    key={plan.id}
                    className={`relative rounded-3xl border flex flex-col overflow-hidden transition ${
                      isAnchor
                        ? 'bg-gradient-to-br from-amber-500/[0.08] to-amber-500/[0.02] border-amber-500/30 shadow-[0_30px_80px_-30px_rgba(245,158,11,0.25)]'
                        : 'bg-white/[0.02] border-white/[0.08] hover:border-white/15'
                    }`}
                  >
                    {plan.badge && (
                      <div className="absolute top-5 right-5 bg-gradient-to-r from-amber-500 to-orange-500 text-black text-[10px] font-black px-3 py-1 rounded-full shadow-lg tracking-wide">
                        {plan.badge.toUpperCase()}
                      </div>
                    )}
                    <div className="p-7 sm:p-8 flex flex-col flex-1">
                      {/* Plan name — editorial small caps, no icon */}
                      <p className={`text-[10px] font-bold tracking-[0.22em] uppercase mb-3 ${isAnchor ? 'text-amber-300/80' : 'text-white/40'}`}>
                        {plan.name}
                      </p>
                      <div className="flex items-baseline gap-1.5 mb-1">
                        <span className="text-4xl sm:text-5xl font-black text-white tracking-tight">${plan.price}</span>
                        <span className="text-white/40 text-sm font-bold">/mo</span>
                      </div>
                      {plan.yearlyPrice && (
                        <p className="text-[11px] text-white/40 mb-5">
                          or <span className="text-white/65 font-semibold">${Math.round(plan.yearlyPrice / 12)}/mo</span> billed yearly · save ${plan.price * 12 - plan.yearlyPrice}
                        </p>
                      )}
                      {!plan.yearlyPrice && (
                        <p className="text-[11px] text-white/35 mb-5">
                          {CLIENT.setupFee > 0
                            ? <>+ ${CLIENT.setupFee} one-time setup</>
                            : <>No setup fee · {CLIENT.freeTrialPosts ?? 3} posts free first</>}
                        </p>
                      )}

                      {includesLabel && (
                        <p className="text-[10px] font-bold tracking-[0.18em] text-white/30 uppercase mb-3 pt-2">{includesLabel}</p>
                      )}
                      <ul className="space-y-2.5 mb-7 flex-1">
                        {plan.features.map((f, i) => (
                          <li key={i} className="flex items-start gap-2.5 text-[13.5px]">
                            <CheckCircle size={13} className={`${isAnchor ? 'text-amber-400' : 'text-white/45'} shrink-0 mt-1`} />
                            <span className="text-white/70 leading-snug">{f}</span>
                          </li>
                        ))}
                        {plan.limitations.map((f, i) => (
                          <li key={i} className="flex items-start gap-2.5 text-[13.5px] opacity-40">
                            <span className="text-white/20 shrink-0 mt-0.5 w-[13px] text-center">—</span>
                            <span className="text-white/30 line-through leading-snug">{f}</span>
                          </li>
                        ))}
                      </ul>
                      <button
                        onClick={() => setShowPricing(true)}
                        className={`w-full font-black py-3.5 rounded-full transition flex items-center justify-center gap-2 text-sm ${
                          isAnchor
                            ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-black shadow-2xl shadow-amber-500/25 hover:opacity-90'
                            : 'bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 text-white'
                        }`}
                      >
                        Get {plan.name} <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-12 pt-8 border-t border-white/8 max-w-4xl flex flex-wrap items-center justify-between gap-4 text-[11px] text-white/40">
              <p className="font-bold tracking-[0.18em] uppercase">Standalone plans · You only pay for one</p>
              <p>No setup fee · No contract · Cancel any time</p>
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

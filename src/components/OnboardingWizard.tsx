import React, { useState } from 'react';
import { CLIENT } from '../client.config';
import { BusinessProfile, SocialTokens, DEFAULT_SOCIAL_TOKENS } from '../types';
import { AppLogo } from './AppLogo';
import { FacebookConnectButton } from './FacebookConnectButton';
import {
  CheckCircle, ArrowRight, Sparkles, Loader2,
  Building2, MapPin, Facebook, Instagram, PartyPopper, X,
  Wand2, HelpCircle, Calendar,
} from 'lucide-react';

interface Props {
  profile: BusinessProfile;
  onUpdateProfile: (updates: Partial<BusinessProfile>) => void;
  onSave: () => Promise<void>;
  onDismiss: () => void;
  userEmail?: string;
  socialTokens?: SocialTokens;
  onSaveSocialTokens?: (tokens: SocialTokens) => void;
  onGenerateFirstPosts?: () => Promise<void>;
  isGenerating?: boolean;
  generatedCount?: number;
  onAdvanceSetup?: (status: string) => void;
}

type Step = 'welcome' | 'business' | 'facebook' | 'firstposts' | 'done';

const STEPS: Step[] = ['welcome', 'business', 'facebook', 'firstposts', 'done'];

const stepLabel: Record<Step, string> = {
  welcome: 'Welcome',
  business: 'Your Business',
  facebook: 'Facebook',
  firstposts: 'First Posts',
  done: 'Done',
};

export const OnboardingWizard: React.FC<Props> = ({
  profile, onUpdateProfile, onSave, onDismiss, userEmail,
  socialTokens: socialTokensProp,
  onSaveSocialTokens,
  onGenerateFirstPosts,
  isGenerating = false,
  generatedCount = 0,
  onAdvanceSetup,
}) => {
  const socialTokens = socialTokensProp ?? DEFAULT_SOCIAL_TOKENS;
  const [step, setStep] = useState<Step>('welcome');
  const [isSaving, setIsSaving] = useState(false);

  const stepIdx = STEPS.indexOf(step);
  const progress = Math.round((stepIdx / (STEPS.length - 1)) * 100);

  const next = async (skip = false) => {
    if (!skip) {
      setIsSaving(true);
      await onSave().catch(() => {});
      setIsSaving(false);
    }
    const nextStep = STEPS[stepIdx + 1];
    if (nextStep) setStep(nextStep);
  };

  const canAdvanceBusiness =
    profile.name.trim() && profile.name !== CLIENT.defaultBusinessName &&
    profile.location.trim() && profile.location !== CLIENT.defaultLocation;

  // ── Overlay backdrop ──────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
      <div className="relative w-full max-w-[calc(100vw-1rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto bg-[var(--color-surface-1)] glass-card noise border-gradient rounded-3xl shadow-2xl animate-spring-in">

        {/* Progress bar */}
        <div className="h-1 bg-white/5">
          <div
            className="h-full bg-gradient-to-r from-amber-500 to-orange-400 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Step pills */}
        {step !== 'done' && (
          <div className="flex items-center justify-center gap-1.5 pt-5 px-6">
            {STEPS.filter(s => s !== 'done').map((s, i) => (
              <div key={s} className="flex items-center gap-1.5">
                <div className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold transition ${
                  STEPS.indexOf(s) < stepIdx
                    ? 'bg-amber-500 text-black'
                    : s === step
                    ? 'bg-amber-500/20 border border-amber-500/50 text-amber-400'
                    : 'bg-white/5 text-white/20'
                }`}>
                  {STEPS.indexOf(s) < stepIdx ? <CheckCircle size={11} /> : i + 1}
                </div>
                <span className={`text-[10px] font-semibold hidden sm:block ${s === step ? 'text-amber-400' : 'text-white/20'}`}>
                  {stepLabel[s]}
                </span>
                {i < STEPS.filter(s => s !== 'done').length - 1 && (
                  <div className="w-4 h-px bg-white/10 mx-0.5" />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Dismiss (only after welcome) */}
        {step !== 'welcome' && step !== 'done' && (
          <button
            onClick={onDismiss}
            className="absolute top-4 right-4 text-white/20 hover:text-white/50 transition p-1"
          >
            <X size={16} />
          </button>
        )}

        <div className="p-8">

          {/* ── WELCOME ── */}
          {step === 'welcome' && (
            <div className="text-center space-y-6">
              <div className="flex justify-center">
                <AppLogo size={72} />
              </div>
              <div>
                <h1 className="text-2xl font-black text-white mb-2">
                  Welcome{userEmail ? `, ${userEmail.split('@')[0]}` : ''}! 👋
                </h1>
                <p className="text-white/40 text-sm leading-relaxed">
                  Let's take 2 minutes to set up your account so the AI can create content that sounds exactly like your business.
                </p>
              </div>
              <div className="bg-white/3 border border-white/8 rounded-2xl p-5 text-left space-y-3">
                {[
                  { icon: Building2, label: 'Your business profile', sub: 'So the AI writes in your voice' },
                  { icon: Sparkles, label: 'AI content generation', sub: 'Included with your plan' },
                  { icon: Facebook, label: 'Facebook page (optional)', sub: 'For one-click publishing' },
                ].map(({ icon: Icon, label, sub }) => (
                  <div key={label} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                      <Icon size={14} className="text-amber-400" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">{label}</p>
                      <p className="text-xs text-white/30">{sub}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={() => next(true)}
                className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black py-4 rounded-2xl text-sm flex items-center justify-center gap-2 hover:opacity-90 transition shadow-lg shadow-amber-500/20"
              >
                Let's go <ArrowRight size={16} />
              </button>
            </div>
          )}

          {/* ── BUSINESS ── */}
          {step === 'business' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-black text-white mb-1">Tell us about your business</h2>
                <p className="text-xs text-white/35">The AI uses this to write posts in your brand voice.</p>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-amber-400/80 uppercase tracking-wider block mb-1.5">
                    Business Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={profile.name === CLIENT.defaultBusinessName ? '' : profile.name}
                    onChange={e => onUpdateProfile({ name: e.target.value })}
                    placeholder="e.g. Bella's Bakery"
                    autoFocus
                    className="w-full bg-black/40 border border-white/8 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-amber-400/80 uppercase tracking-wider block mb-1.5">
                    Business Type
                  </label>
                  <input
                    value={profile.type === CLIENT.defaultBusinessType ? '' : profile.type}
                    onChange={e => onUpdateProfile({ type: e.target.value })}
                    placeholder="e.g. Artisan bakery & café"
                    className="w-full bg-black/40 border border-white/8 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-amber-400/80 uppercase tracking-wider block mb-1.5">
                    <MapPin size={11} className="inline mr-1 text-amber-400/60" />
                    Location <span className="text-red-400">*</span>
                  </label>
                  <input
                    value={profile.location === CLIENT.defaultLocation ? '' : profile.location}
                    onChange={e => onUpdateProfile({ location: e.target.value })}
                    placeholder="e.g. Bondi Beach, Sydney NSW"
                    className="w-full bg-black/40 border border-white/8 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/50"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-amber-400/80 uppercase tracking-wider block mb-1.5">
                    Brand Personality / Tone
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {['Friendly & warm', 'Professional', 'Casual & fun', 'Bold & edgy', 'Inspiring'].map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onUpdateProfile({ tone: profile.tone === t ? '' : t })}
                        className={`text-xs px-3 py-1.5 rounded-full border transition ${
                          profile.tone === t
                            ? 'bg-amber-500 border-amber-500 text-black font-bold'
                            : 'bg-white/5 border-white/10 text-white/40 hover:border-amber-500/30'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => next(false)}
                  disabled={!canAdvanceBusiness || isSaving}
                  className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 disabled:opacity-50 text-black font-black py-3.5 rounded-2xl text-sm flex items-center justify-center gap-2 hover:opacity-90 transition"
                >
                  {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
                  {isSaving ? 'Saving…' : <>Save & Continue <ArrowRight size={16} /></>}
                </button>
              </div>
            </div>
          )}

          {/* ── FACEBOOK ── */}
          {step === 'facebook' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-black text-white mb-1 flex items-center gap-2">
                  <Facebook className="text-blue-400" size={20} /> Connect Facebook & Instagram
                </h2>
                <p className="text-xs text-white/35 leading-relaxed">
                  Connect your Facebook Page to enable one-click publishing. Instagram will be linked automatically if connected to your page.
                </p>
              </div>
              <FacebookConnectButton
                connectedPageId={socialTokens.facebookPageId}
                connectedPageName={profile.name}
                onConnected={(pageId, pageAccessToken, pageName) => {
                  const updated = { ...socialTokens, facebookPageId: pageId, facebookPageAccessToken: pageAccessToken, facebookConnected: true, connectedAt: new Date().toISOString(), facebookPageName: pageName };
                  if (onSaveSocialTokens) onSaveSocialTokens(updated);
                  else onUpdateProfile({ facebookPageId: pageId, facebookPageAccessToken: pageAccessToken, facebookConnected: true });
                  void onSave();
                }}
                onDisconnect={() => {
                  const cleared = { ...DEFAULT_SOCIAL_TOKENS };
                  if (onSaveSocialTokens) onSaveSocialTokens(cleared);
                  else onUpdateProfile({ facebookPageId: '', facebookPageAccessToken: '', facebookConnected: false });
                }}
              />

              {/* Instagram setup instructions */}
              <div className="bg-pink-500/5 border border-pink-500/15 rounded-2xl p-4 space-y-2">
                <p className="text-xs font-semibold text-pink-300 flex items-center gap-1.5">
                  <Instagram size={12} /> Want Instagram posting too?
                </p>
                <p className="text-[11px] text-white/40 leading-relaxed">
                  To enable Instagram, your Facebook Page needs a linked Instagram Business account. Here's how:
                </p>
                <ol className="text-[11px] text-white/35 leading-relaxed space-y-1 list-decimal list-inside">
                  <li>Open your Facebook Page on facebook.com</li>
                  <li>Go to <strong className="text-white/50">Settings</strong> → <strong className="text-white/50">Linked Accounts</strong></li>
                  <li>Click <strong className="text-white/50">Connect Account</strong> next to Instagram</li>
                  <li>Log in to your Instagram Business or Creator account</li>
                  <li>Come back here and reconnect Facebook — Instagram will be detected automatically</li>
                </ol>
                <p className="text-[10px] text-white/20">
                  Note: Instagram must be a Business or Creator account, not a personal one.
                </p>
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => next(true)}
                  className="text-white/30 hover:text-white/60 text-sm transition px-4"
                >
                  Skip for now
                </button>
                <button
                  onClick={() => next(!socialTokens.facebookPageId)}
                  disabled={isSaving}
                  className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 disabled:opacity-50 text-black font-black py-3.5 rounded-2xl text-sm flex items-center justify-center gap-2 hover:opacity-90 transition"
                >
                  {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
                  {socialTokens.facebookPageId ? 'Continue' : 'Skip'} <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ── FIRST POSTS ── */}
          {step === 'firstposts' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-black text-white mb-1 flex items-center gap-2">
                  <Wand2 className="text-amber-400" size={20} /> Generate Your First Posts
                </h2>
                <p className="text-xs text-white/35 leading-relaxed">
                  Let the AI create 3 posts for your business. You can review and edit them before they go live.
                </p>
              </div>

              {generatedCount > 0 ? (
                <div className="bg-green-500/8 border border-green-500/20 rounded-2xl p-5 text-center space-y-3">
                  <Calendar size={28} className="text-green-400 mx-auto" />
                  <p className="text-sm font-semibold text-white">{generatedCount} posts generated!</p>
                  <p className="text-xs text-white/35">They're ready in your calendar. You can edit or publish them anytime.</p>
                </div>
              ) : onGenerateFirstPosts ? (
                <div className="bg-white/3 border border-white/8 rounded-2xl p-5 text-center space-y-4">
                  <div className="text-4xl">✨</div>
                  <p className="text-sm text-white/50">The AI will research your business type and create 3 tailored posts with images, captions, and hashtags.</p>
                  <button
                    onClick={onGenerateFirstPosts}
                    disabled={isGenerating}
                    className="w-full bg-gradient-to-r from-amber-500 to-orange-500 disabled:opacity-50 text-black font-black py-3.5 rounded-2xl text-sm flex items-center justify-center gap-2 hover:opacity-90 transition"
                  >
                    {isGenerating ? (
                      <><Loader2 size={16} className="animate-spin" /> Generating…</>
                    ) : (
                      <><Wand2 size={16} /> Generate 3 Posts</>
                    )}
                  </button>
                </div>
              ) : (
                <div className="bg-white/3 border border-white/8 rounded-2xl p-5 text-center space-y-3">
                  <div className="text-4xl">✨</div>
                  <p className="text-sm font-semibold text-white">You're all set!</p>
                  <p className="text-xs text-white/50 leading-relaxed">Head to <span className="text-amber-300 font-semibold">Smart Schedule</span> to auto-plan a week of AI posts, or go to <span className="text-amber-300 font-semibold">Create</span> to write a single post. The AI knows your business now.</p>
                </div>
              )}

              {/* Need help? */}
              <div className="bg-blue-500/5 border border-blue-500/15 rounded-2xl p-4 flex items-start gap-3">
                <HelpCircle size={16} className="text-blue-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-white/50">
                    <span className="font-semibold text-blue-300">Need help getting started?</span>{' '}
                    Our team can set everything up for you.{' '}
                    <a href={`mailto:${CLIENT.supportEmail}?subject=Help setting up my ${CLIENT.appName} account`} className="text-blue-400 underline">Email support</a>
                  </p>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { onAdvanceSetup?.('live'); next(true); }}
                  className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black py-3.5 rounded-2xl text-sm flex items-center justify-center gap-2 hover:opacity-90 transition"
                >
                  {generatedCount > 0 || !onGenerateFirstPosts ? 'Finish Setup' : 'Skip for now'} <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ── DONE ── */}
          {step === 'done' && (
            <div className="text-center space-y-6 py-4">
              <div className="text-6xl">🎉</div>
              <div>
                <h2 className="text-2xl font-black text-white mb-2">You're all set!</h2>
                <p className="text-white/40 text-sm leading-relaxed">
                  {profile.name && profile.name !== CLIENT.defaultBusinessName
                    ? `${profile.name} is ready to go.`
                    : 'Your account is ready to go.'
                  } The AI will now create content tailored specifically for your business.
                </p>
              </div>
              <div className="bg-white/3 border border-white/8 rounded-2xl p-5 text-left space-y-3">
                <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">What you can do now:</p>
                {[
                  { label: 'Create a post', sub: 'Head to the Create tab and generate your first AI post' },
                  { label: 'Build a content calendar', sub: 'Use Smart AI to generate a full week of posts' },
                  { label: 'Complete your profile', sub: 'Answer more questions in Settings for even better AI content' },
                ].map(({ label, sub }) => (
                  <div key={label} className="flex items-start gap-3">
                    <CheckCircle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-semibold text-white">{label}</p>
                      <p className="text-xs text-white/30">{sub}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={onDismiss}
                className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black py-4 rounded-2xl text-sm flex items-center justify-center gap-2 hover:opacity-90 transition shadow-lg shadow-amber-500/20"
              >
                <PartyPopper size={16} /> Start creating content
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

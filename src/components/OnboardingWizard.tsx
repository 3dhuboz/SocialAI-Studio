import React, { useState } from 'react';
import { CLIENT } from '../client.config';
import { BusinessProfile } from '../types';
import { AppLogo } from './AppLogo';
import { FacebookConnectButton } from './FacebookConnectButton';
import {
  CheckCircle, ArrowRight, Sparkles, Loader2, Eye, EyeOff,
  Building2, MapPin, Zap, Facebook, PartyPopper, X, ExternalLink,
} from 'lucide-react';

interface Props {
  profile: BusinessProfile;
  onUpdateProfile: (updates: Partial<BusinessProfile>) => void;
  onSave: () => Promise<void>;
  onDismiss: () => void;
  userEmail?: string;
}

type Step = 'welcome' | 'business' | 'ai_key' | 'facebook' | 'done';

const STEPS: Step[] = ['welcome', 'business', 'ai_key', 'facebook', 'done'];

const stepLabel: Record<Step, string> = {
  welcome: 'Welcome',
  business: 'Your Business',
  ai_key: 'AI Setup',
  facebook: 'Facebook',
  done: 'Done',
};

export const OnboardingWizard: React.FC<Props> = ({
  profile, onUpdateProfile, onSave, onDismiss, userEmail,
}) => {
  const [step, setStep] = useState<Step>('welcome');
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [localKey, setLocalKey] = useState(profile.geminiApiKey || '');

  const stepIdx = STEPS.indexOf(step);
  const progress = Math.round((stepIdx / (STEPS.length - 1)) * 100);

  const next = async (skip = false) => {
    if (!skip) {
      setIsSaving(true);
      if (step === 'ai_key' && localKey.trim()) {
        localStorage.setItem('sai_gemini_key', localKey.trim());
        onUpdateProfile({ geminiApiKey: localKey.trim() });
      }
      await onSave().catch(() => {});
      setIsSaving(false);
    }
    const nextStep = STEPS[stepIdx + 1];
    if (nextStep) setStep(nextStep);
  };

  const canAdvanceBusiness =
    profile.name.trim() && profile.name !== CLIENT.defaultBusinessName;

  // ── Overlay backdrop ──────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-lg bg-[#0f0f0f] border border-white/10 rounded-3xl shadow-2xl overflow-hidden">

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
                  { icon: Sparkles, label: 'Gemini AI key (free)', sub: 'Powers all content generation' },
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
                    Location
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

          {/* ── AI KEY ── */}
          {step === 'ai_key' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-black text-white mb-1 flex items-center gap-2">
                  <Sparkles className="text-amber-400" size={20} /> Connect your AI
                </h2>
                <p className="text-xs text-white/35 leading-relaxed">
                  A free Gemini API key powers all content generation. It takes 30 seconds to get.
                </p>
              </div>
              <div className="bg-amber-500/8 border border-amber-500/15 rounded-2xl p-4 space-y-2">
                <p className="text-xs font-bold text-amber-300">How to get your free key:</p>
                <ol className="text-xs text-white/40 space-y-1 list-decimal list-inside leading-relaxed">
                  <li>Go to{' '}
                    <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer"
                      className="text-amber-400 hover:text-amber-300 underline inline-flex items-center gap-0.5">
                      aistudio.google.com <ExternalLink size={10} />
                    </a>
                  </li>
                  <li>Sign in with any Google account</li>
                  <li>Click <strong className="text-white/60">Get API Key → Create API key</strong></li>
                  <li>Copy and paste it below</li>
                </ol>
              </div>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={localKey}
                  onChange={e => setLocalKey(e.target.value)}
                  placeholder="AIza…"
                  className="w-full bg-black/40 border border-white/8 rounded-xl px-4 py-3 text-white font-mono text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/50 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition"
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {localKey.trim().length > 10 && (
                <p className="text-xs text-green-400 flex items-center gap-1.5"><CheckCircle size={12} /> Key looks good!</p>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => next(true)}
                  className="text-white/30 hover:text-white/60 text-sm transition px-4"
                >
                  Skip for now
                </button>
                <button
                  onClick={() => next(false)}
                  disabled={!localKey.trim() || isSaving}
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
                  <Facebook className="text-blue-400" size={20} /> Connect Facebook
                </h2>
                <p className="text-xs text-white/35 leading-relaxed">
                  Optional — lets the app publish directly to your Facebook Page with one click.
                </p>
              </div>
              <FacebookConnectButton
                connectedPageId={profile.facebookPageId}
                connectedPageName={profile.name}
                onConnected={(pageId, pageAccessToken, pageName) => {
                  onUpdateProfile({ facebookPageId: pageId, facebookPageAccessToken: pageAccessToken, facebookConnected: true });
                  void onSave();
                }}
                onDisconnect={() => {
                  onUpdateProfile({ facebookPageId: '', facebookPageAccessToken: '', facebookConnected: false });
                }}
              />
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => next(true)}
                  className="text-white/30 hover:text-white/60 text-sm transition px-4"
                >
                  Skip for now
                </button>
                <button
                  onClick={() => next(!profile.facebookPageId)}
                  disabled={isSaving}
                  className="flex-1 bg-gradient-to-r from-amber-500 to-orange-500 disabled:opacity-50 text-black font-black py-3.5 rounded-2xl text-sm flex items-center justify-center gap-2 hover:opacity-90 transition"
                >
                  {isSaving ? <Loader2 size={16} className="animate-spin" /> : null}
                  {profile.facebookPageId ? 'Continue' : 'Skip'} <ArrowRight size={16} />
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

import React, { useState } from 'react';
import { SignIn, SignUp } from '@clerk/react';
import { CLIENT } from '../client.config';
import { AppLogo } from './AppLogo';

const clerkAppearance = {
  elements: {
    rootBox: 'w-full',
    card: '!bg-[#111111] border border-white/10 rounded-3xl shadow-2xl',
    headerTitle: '!text-white font-black text-2xl',
    headerSubtitle: '!text-white/60 text-sm',
    socialButtonsBlockButton: '!bg-white/5 !border-white/10 hover:!bg-white/10 rounded-xl transition',
    socialButtonsBlockButtonText: '!text-white font-semibold',
    socialButtonsBlockButtonArrow: '!text-white/40',
    dividerLine: '!bg-white/10',
    dividerText: '!text-white/30 text-xs',
    formFieldLabel: '!text-white/60 text-xs font-semibold',
    formFieldInput: '!bg-[#0d0d0d] !border-white/10 !text-white rounded-xl text-sm focus:!border-amber-500/50',
    formFieldInputShowPasswordButton: '!text-white/50 hover:!text-white',
    formButtonPrimary: '!bg-gradient-to-r from-amber-500 to-orange-500 hover:!opacity-90 !text-black font-black rounded-xl',
    footerActionText: '!text-white/50',
    footerActionLink: '!text-amber-400 hover:!text-amber-300',
    footerPages: '!bg-transparent',
    footer: '!bg-transparent',
    identityPreviewText: '!text-white/60',
    identityPreviewEditButtonIcon: '!text-white/40',
    formResendCodeLink: '!text-amber-400 hover:!text-amber-300',
    otpCodeFieldInput: '!bg-[#0d0d0d] !border-white/10 !text-white rounded-xl',
    alertText: '!text-red-400',
    alertIcon: '!text-red-400',
    badge: '!text-white/20 !bg-transparent',
    alternativeMethodsBlockButton: '!bg-white/5 !border-white/10 hover:!bg-white/10 rounded-xl',
    alternativeMethodsBlockButtonText: '!text-white/70',
    backLink: '!text-white/50 hover:!text-white/80',
    formHeaderTitle: '!text-white',
    formHeaderSubtitle: '!text-white/60',
    selectButton: '!bg-[#0d0d0d] !border-white/10 !text-white rounded-xl',
    selectOptionsContainer: '!bg-[#111111] !border-white/10 rounded-xl',
    selectOption: '!text-white hover:!bg-white/5',
    formFieldInputGroup: '!bg-[#0d0d0d]',
  },
  variables: {
    colorBackground: '#111111',
    colorInputBackground: '#0d0d0d',
    colorInputText: '#ffffff',
    colorText: '#ffffff',
    colorTextSecondary: 'rgba(255,255,255,0.6)',
    colorTextOnPrimaryBackground: '#000000',
    colorPrimary: '#f59e0b',
    colorDanger: '#f87171',
    colorSuccess: '#34d399',
    colorNeutral: '#ffffff',
    colorAlphaShade: 'white',
    borderRadius: '0.75rem',
    fontFamily: 'inherit',
  },
};

interface Props {
  onShowLanding: () => void;
  loginOnly?: boolean;
}

export const AuthScreen: React.FC<Props> = ({ onShowLanding, loginOnly = false }) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  return (
    <div className="min-h-screen bg-[#06060a] flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background layers */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(245,158,11,0.18),transparent)] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_40%_30%_at_80%_80%,rgba(251,146,60,0.06),transparent)] pointer-events-none" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_40%_30%_at_20%_70%,rgba(168,85,247,0.05),transparent)] pointer-events-none" />
      {/* Grid overlay */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{backgroundImage:'linear-gradient(rgba(255,255,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.5) 1px,transparent 1px)',backgroundSize:'48px 48px'}} />

      <div className="w-full max-w-[420px] relative z-10">
        {/* Branding */}
        <div className="flex flex-col items-center mb-8">
          <AppLogo size={80} />
          <h1 className="mt-4 text-2xl font-black text-white tracking-tight">{CLIENT.appName}</h1>
          <p className="text-sm text-white/30 mt-1">{CLIENT.tagline}</p>
        </div>

        {/* Card glow */}
        <div className="absolute -inset-1 bg-gradient-to-br from-amber-500/10 via-transparent to-orange-500/5 rounded-[28px] blur-xl pointer-events-none" />

        {mode === 'login' ? (
          <SignIn
            appearance={clerkAppearance}
            routing="hash"
            signUpUrl="#signup"
            fallbackRedirectUrl="/"
          />
        ) : (
          <SignUp
            appearance={clerkAppearance}
            routing="hash"
            signInUrl="#signin"
            fallbackRedirectUrl="/"
          />
        )}

        {!loginOnly && (
          <div className="mt-5 text-center">
            {mode === 'login' ? (
              <p className="text-xs text-white/20">
                No account?{' '}
                <button onClick={() => setMode('signup')} className="text-amber-400/80 hover:text-amber-300 transition font-semibold">
                  Sign up free
                </button>
                <span className="mx-2 text-white/10">·</span>
                <button onClick={onShowLanding} className="text-white/20 hover:text-white/50 transition">
                  View plans
                </button>
              </p>
            ) : (
              <p className="text-xs text-white/20">
                Have an account?{' '}
                <button onClick={() => setMode('login')} className="text-amber-400/80 hover:text-amber-300 transition font-semibold">
                  Sign in
                </button>
              </p>
            )}
          </div>
        )}

        <p className="text-center text-[11px] text-white/10 mt-6">
          <a href={CLIENT.salesUrl} target="_blank" rel="noopener noreferrer" className="hover:text-white/25 transition">
            {CLIENT.poweredBy || 'Powered by Penny Wise I.T'}
          </a>
        </p>
      </div>
    </div>
  );
};

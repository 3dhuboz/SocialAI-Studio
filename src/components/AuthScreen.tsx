import React, { useState } from 'react';
import { SignIn, SignUp } from '@clerk/react';
import { CLIENT } from '../client.config';
import { AppLogo } from './AppLogo';

const clerkAppearance = {
  elements: {
    rootBox: 'w-full',
    card: 'bg-[#111] border border-white/8 rounded-3xl shadow-2xl p-2',
    headerTitle: 'text-white font-black text-2xl',
    headerSubtitle: 'text-white/30 text-sm',
    socialButtonsBlockButton: 'bg-white/5 border border-white/10 text-white hover:bg-white/8 transition rounded-xl',
    socialButtonsBlockButtonText: 'text-white font-semibold',
    dividerLine: 'bg-white/10',
    dividerText: 'text-white/20 text-xs',
    formFieldLabel: 'text-white/40 text-xs font-semibold',
    formFieldInput: 'bg-black/40 border border-white/8 rounded-xl text-white text-sm placeholder:text-white/20 focus:border-amber-500/40',
    formButtonPrimary: 'bg-gradient-to-r from-amber-500 to-orange-500 hover:opacity-90 text-black font-black rounded-xl',
    footerActionLink: 'text-amber-400 hover:text-amber-300',
    identityPreviewText: 'text-white/60',
    identityPreviewEditButtonIcon: 'text-white/40',
    formResendCodeLink: 'text-amber-400 hover:text-amber-300',
    otpCodeFieldInput: 'bg-black/40 border border-white/8 rounded-xl text-white',
    alertText: 'text-red-400',
    alertIcon: 'text-red-400',
  },
  variables: {
    colorBackground: '#111111',
    colorInputBackground: 'rgba(0,0,0,0.4)',
    colorInputText: '#ffffff',
    colorText: '#ffffff',
    colorTextSecondary: 'rgba(255,255,255,0.4)',
    colorPrimary: '#f59e0b',
    colorDanger: '#f87171',
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
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center p-6">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(245,158,11,0.1),transparent_60%)] pointer-events-none" />

      <div className="w-full max-w-md relative">
        <div className="flex justify-center mb-8">
          <AppLogo size={90} />
        </div>

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
          <div className="mt-4 text-center">
            {mode === 'login' ? (
              <p className="text-xs text-white/25">
                Don't have an account?{' '}
                <button onClick={() => setMode('signup')} className="text-amber-400/70 hover:text-amber-400 transition font-semibold">
                  Sign Up
                </button>
                {' · '}
                <button onClick={onShowLanding} className="text-white/20 hover:text-white/40 transition">
                  View plans
                </button>
              </p>
            ) : (
              <p className="text-xs text-white/25">
                Already have an account?{' '}
                <button onClick={() => setMode('login')} className="text-amber-400/70 hover:text-amber-400 transition font-semibold">
                  Sign in
                </button>
              </p>
            )}
          </div>
        )}

        <p className="text-center text-xs text-white/15 mt-5">
          <a href={CLIENT.salesUrl} target="_blank" rel="noopener noreferrer" className="hover:text-white/30 transition">
            {CLIENT.poweredBy || 'Powered by Penny Wise I.T'}
          </a>
        </p>
      </div>
    </div>
  );
};

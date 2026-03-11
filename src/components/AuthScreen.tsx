import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { CLIENT } from '../client.config';
import { Sparkles, Mail, Lock, Eye, EyeOff, ArrowRight, Loader2, CheckCircle } from 'lucide-react';

type Mode = 'login' | 'signup' | 'reset';

interface Props {
  onShowLanding: () => void;
}

export const AuthScreen: React.FC<Props> = ({ onShowLanding }) => {
  const { logIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetSent, setResetSent] = useState(false);

  const friendlyError = (code: string) => {
    if (code.includes('user-not-found') || code.includes('wrong-password') || code.includes('invalid-credential')) return 'Incorrect email or password.';
    if (code.includes('email-already-in-use')) return 'An account with this email already exists. Try logging in.';
    if (code.includes('weak-password')) return 'Password must be at least 6 characters.';
    if (code.includes('invalid-email')) return 'Please enter a valid email address.';
    if (code.includes('too-many-requests')) return 'Too many attempts. Please try again later.';
    return 'Something went wrong. Please try again.';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'login') {
        await logIn(email, password);
      } else if (mode === 'signup') {
        await signUp(email, password);
      } else {
        await resetPassword(email);
        setResetSent(true);
      }
    } catch (err: any) {
      setError(friendlyError(err.code || ''));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center p-6">
      {/* Background glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(245,158,11,0.1),transparent_60%)] pointer-events-none" />

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-orange-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/30">
            <Sparkles size={18} className="text-white" />
          </div>
          <span className="text-xl font-bold text-white">{CLIENT.appName}</span>
        </div>

        {/* Card */}
        <div className="bg-white/3 border border-white/8 rounded-3xl p-8">
          {resetSent ? (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 mx-auto bg-green-500/10 border border-green-500/20 rounded-2xl flex items-center justify-center">
                <CheckCircle size={24} className="text-green-400" />
              </div>
              <h2 className="text-xl font-bold text-white">Check your email</h2>
              <p className="text-white/40 text-sm">We sent a password reset link to <strong className="text-white/60">{email}</strong></p>
              <button onClick={() => { setMode('login'); setResetSent(false); }} className="text-amber-400 text-sm hover:text-amber-300 transition">
                Back to login
              </button>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-2xl font-black text-white mb-1">
                  {mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Reset password'}
                </h2>
                <p className="text-white/30 text-sm">
                  {mode === 'login' ? 'Sign in to your dashboard' :
                   mode === 'signup' ? 'Get started with your social AI dashboard' :
                   'Enter your email and we\'ll send a reset link'}
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="text-xs text-white/40 font-semibold block mb-1.5">Email</label>
                  <div className="relative">
                    <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/20" />
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      placeholder="you@example.com"
                      className="w-full bg-black/40 border border-white/8 rounded-xl pl-10 pr-4 py-3 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40"
                    />
                  </div>
                </div>

                {mode !== 'reset' && (
                  <div>
                    <label className="text-xs text-white/40 font-semibold block mb-1.5">Password</label>
                    <div className="relative">
                      <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/20" />
                      <input
                        type={showPass ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                        placeholder={mode === 'signup' ? 'Min. 6 characters' : '••••••••'}
                        className="w-full bg-black/40 border border-white/8 rounded-xl pl-10 pr-10 py-3 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-amber-500/40"
                      />
                      <button type="button" onClick={() => setShowPass(p => !p)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/40 transition">
                        {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </div>
                )}

                {error && (
                  <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2.5">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black py-3.5 rounded-xl hover:opacity-90 transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loading ? <Loader2 size={16} className="animate-spin" /> : (
                    <>
                      {mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Link'}
                      <ArrowRight size={16} />
                    </>
                  )}
                </button>
              </form>

              <div className="mt-5 space-y-3 text-center">
                {mode === 'login' && (
                  <>
                    <button onClick={() => { setMode('reset'); setError(''); }} className="text-xs text-white/25 hover:text-white/40 transition block w-full">
                      Forgot password?
                    </button>
                    <p className="text-xs text-white/25">
                      Don't have an account?{' '}
                      <button onClick={onShowLanding} className="text-amber-400/70 hover:text-amber-400 transition font-semibold">
                        View plans
                      </button>
                    </p>
                  </>
                )}
                {mode === 'signup' && (
                  <p className="text-xs text-white/25">
                    Already have an account?{' '}
                    <button onClick={() => { setMode('login'); setError(''); }} className="text-amber-400/70 hover:text-amber-400 transition font-semibold">
                      Sign in
                    </button>
                  </p>
                )}
                {mode === 'reset' && (
                  <button onClick={() => { setMode('login'); setError(''); }} className="text-xs text-white/25 hover:text-white/40 transition">
                    Back to login
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-white/15 mt-5">
          Powered by{' '}
          <a href={CLIENT.salesUrl} target="_blank" rel="noopener noreferrer" className="hover:text-white/30 transition">
            {CLIENT.poweredBy || 'Penny Wise I.T'}
          </a>
        </p>
      </div>
    </div>
  );
};

import React from 'react';
import { CLIENT } from '../client.config';
import type { SocialPost } from '../types';
import { Sparkles, Lock, ArrowRight, X, CheckCircle, Image as ImageIcon } from 'lucide-react';

interface Props {
  /** All of the user's posts. We slice the most recent N as their trial gallery. */
  posts: SocialPost[];
  /** From CLIENT.freeTrialPosts. Used for "your 4th post is ready" framing. */
  freeTrialPosts: number;
  /** Dismiss the paywall. They can still bounce — but we built this to convert. */
  onClose: () => void;
  /** Open the pricing modal with Growth pre-selected. Wired in App.tsx. */
  onChoosePlan: () => void;
}

/**
 * Full-screen contextual paywall fired when an unsubscribed trial user hits
 * the post-cap. Replaces the previous toast + generic pricing modal pattern.
 *
 * Why a dedicated component instead of just opening PricingTable:
 *  • Loss aversion — the user just made N posts and is mid-creative-flow.
 *    Showing those posts back to them ("keep them all when you upgrade")
 *    converts ~2-4× better than a price grid.
 *  • Single anchor — Growth is pre-positioned with concrete benefit
 *    framing. One-click decision, not a four-card pricing scan.
 *  • Trust microcopy at the moment of choice — "cancel anytime", "keep
 *    your trial posts", "secure via PayPal" — not buried in a modal header.
 */
export const TrialPaywall: React.FC<Props> = ({ posts, freeTrialPosts, onClose, onChoosePlan }) => {
  // Show the user's most recent N posts. If they generated less than the
  // trial cap (rare, but possible if posts were deleted) we still show what's
  // there — the gallery stays visually balanced because we adapt the grid.
  const trialPosts = posts.slice(-freeTrialPosts);
  const growthPlan = CLIENT.plans.find(p => p.id === 'growth');
  // Friendly ordinal for the headline. "4th" lands harder than "next" when
  // freeTrialPosts is 3 (which is the default and likely to stay).
  const nextPostOrdinal = (() => {
    const n = freeTrialPosts + 1;
    if (n === 4) return '4th';
    if (n === 11 || n === 12 || n === 13) return `${n}th`;
    const last = n % 10;
    if (last === 1) return `${n}st`;
    if (last === 2) return `${n}nd`;
    if (last === 3) return `${n}rd`;
    return `${n}th`;
  })();

  return (
    <div className="fixed inset-0 z-[1000] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4 md:p-6 overflow-y-auto">
      <div className="w-full max-w-3xl my-auto">
        <div className="relative bg-[#0e0e16] border border-amber-500/25 rounded-3xl overflow-hidden shadow-[0_40px_120px_-30px_rgba(245,158,11,0.4)]">

          {/* Dismiss — they CAN bounce. Funnel data tells us if too many do. */}
          <button
            onClick={onClose}
            className="absolute top-5 right-5 z-10 w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/60 hover:text-white transition-all press"
            aria-label="Close"
          >
            <X size={16} />
          </button>

          {/* Header — celebrate the work, then frame the choice */}
          <div className="relative px-6 sm:px-8 pt-10 pb-6 border-b border-white/[0.05]">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(245,158,11,0.18),transparent_70%)]" />
            <div className="relative max-w-xl mx-auto text-center">
              <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs font-semibold px-3 py-1.5 rounded-full mb-5">
                <Sparkles size={12} /> Your free trial is up
              </div>
              <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-white mb-3 leading-[1.12]">
                Your {nextPostOrdinal} post is ready —{' '}
                <span className="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
                  pick a plan to unlock it.
                </span>
              </h2>
              <p className="text-sm sm:text-base text-white/65 leading-relaxed">
                You've generated {freeTrialPosts} full posts on us. Continue with Growth and your AI calendar runs every week — writing, designing, scheduling, publishing.
              </p>
            </div>
          </div>

          {/* Trial-posts gallery — proof of value + loss aversion. The user
              just made these. The "keep them all when you upgrade" line is
              the implicit threat (and the explicit reassurance). */}
          {trialPosts.length > 0 && (
            <div className="px-6 sm:px-8 py-6 border-b border-white/[0.05]">
              <p className="text-[10px] font-bold text-white/35 uppercase tracking-wider text-center mb-4">
                Your {trialPosts.length} trial post{trialPosts.length === 1 ? '' : 's'} — keep them all when you upgrade
              </p>
              <div className={`grid gap-3 ${
                trialPosts.length === 1 ? 'grid-cols-1 max-w-xs mx-auto'
                : trialPosts.length === 2 ? 'grid-cols-2 max-w-md mx-auto'
                : 'grid-cols-3'
              }`}>
                {trialPosts.map((post, i) => (
                  <div key={i} className="glass-card border border-white/[0.08] rounded-2xl p-3">
                    {post.image ? (
                      <div className="aspect-square rounded-xl overflow-hidden mb-2 bg-white/[0.02]">
                        <img src={post.image} alt="" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="aspect-square rounded-xl bg-gradient-to-br from-amber-500/10 to-purple-500/10 flex items-center justify-center mb-2">
                        <ImageIcon size={20} className="text-white/30" />
                      </div>
                    )}
                    <p className="text-[11px] text-white/65 line-clamp-3 leading-relaxed">{post.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Anchor — Growth, pre-framed. Single CTA + secondary "compare". */}
          <div className="px-6 sm:px-8 py-7">
            {growthPlan && (
              <div className="bg-gradient-to-br from-amber-500/[0.10] to-amber-500/[0.02] border border-amber-500/25 rounded-2xl px-5 py-5 mb-5">
                <div className="flex items-start justify-between gap-4 mb-3 flex-wrap sm:flex-nowrap">
                  <div className="min-w-0">
                    <span className="inline-block text-[10px] font-black bg-gradient-to-r from-amber-500 to-orange-500 text-black px-2 py-0.5 rounded-full mb-1.5">MOST POPULAR</span>
                    <h3 className="text-lg sm:text-xl font-black text-white">Growth — {growthPlan.postsPerWeek} posts/week</h3>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-2xl sm:text-3xl font-black text-white leading-none">
                      ${growthPlan.price}
                      <span className="text-white/40 text-sm font-bold">/mo</span>
                    </p>
                    {growthPlan.yearlyPrice && (
                      <p className="text-[10px] text-green-400 font-semibold mt-1">or ${Math.round(growthPlan.yearlyPrice / 12)}/mo billed yearly · save ${growthPlan.price * 12 - growthPlan.yearlyPrice}</p>
                    )}
                  </div>
                </div>
                <ul className="space-y-2 text-sm text-white/70">
                  <li className="flex gap-2 items-start"><CheckCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" /><span>{growthPlan.postsPerWeek} posts a week — Facebook + Instagram, hands-off</span></li>
                  <li className="flex gap-2 items-start"><CheckCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" /><span>AI-generated image with every post — not stock, not Canva</span></li>
                  <li className="flex gap-2 items-start"><CheckCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" /><span>Smart Scheduler auto-plans 2 weeks at a time</span></li>
                </ul>
              </div>
            )}

            <button
              onClick={onChoosePlan}
              className="group w-full bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black py-4 rounded-2xl text-base hover:opacity-90 transition flex items-center justify-center gap-2 shadow-2xl shadow-amber-500/25"
            >
              Continue with Growth
              <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </button>

            <button
              onClick={onChoosePlan}
              className="w-full text-center text-xs text-white/40 hover:text-white/70 transition mt-3 py-1.5"
            >
              Or compare all plans →
            </button>

            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 mt-5 text-[11px] text-white/40">
              <span className="flex items-center gap-1.5"><Lock size={10} /> Secure via PayPal</span>
              <span className="flex items-center gap-1.5"><CheckCircle size={10} /> Cancel in 2 clicks</span>
              <span className="flex items-center gap-1.5"><CheckCircle size={10} /> Keep your trial posts</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

import React from 'react';

/**
 * HowItActuallyWorks — light cream tonal-break slab.
 *
 * Replaces the previous "Choose a plan / Set up profile / Connect FB / You're
 * live!" 4-step setup checklist (which explained ONBOARDING EFFORT, not the
 * AI black box that's the actual unknown for SMB customers).
 *
 * Three steps explaining the MENTAL MODEL: input → AI thinking → output.
 *
 * Visual role: this is the page's tonal break. The hero, gallery, cinematic
 * tour, and close are all dark. This slab is cream + warm grain — Linear /
 * Stripe / Webflow alternating-tone pattern. Without this, the home tab is
 * dark slab → dark slab → dark slab and reads as monotonous.
 */

const STEPS = [
  {
    number: '01',
    title: 'Tell us about your business',
    body: 'Industry, location, tone, what makes you different. Sixty seconds, one time. We read your existing posts to learn your voice — so the AI sounds like you, not like a robot.',
    pull: '60 seconds · one time',
  },
  {
    number: '02',
    title: 'AI writes and designs every post',
    body: 'Caption in your voice. Custom image — not stock, not Canva. Hashtags. Best post time. You review the calendar before anything goes live.',
    pull: '7–21 posts a week',
  },
  {
    number: '03',
    title: 'Posts publish automatically',
    body: 'Direct to your Facebook and Instagram pages on schedule. You stay in control — edit, reschedule, or delete any post in two clicks. Cancel any time, take everything you made with you.',
    pull: 'You stay in control',
  },
];

export const HowItActuallyWorks: React.FC = () => {
  return (
    <section className="relative py-20 sm:py-28 px-6 bg-[#f4f1ea] text-stone-900 overflow-hidden">
      {/* Subtle tonal warmth — no neon, no glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_-10%,rgba(245,158,11,0.06),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_85%_100%,rgba(190,108,53,0.05),transparent_60%)]" />
      <div className="absolute inset-0 grain-bg opacity-60 mix-blend-multiply pointer-events-none" />

      <div className="relative max-w-6xl mx-auto">
        {/* Header — left-aligned editorial */}
        <div className="mb-14 sm:mb-20 max-w-2xl">
          <div className="inline-flex items-center gap-2 text-[10px] sm:text-[11px] font-bold tracking-[0.22em] text-stone-500 uppercase mb-5">
            <span className="w-6 h-px bg-stone-400/70" />
            How this actually works
          </div>
          <h2 className="text-3xl sm:text-4xl md:text-[3.2rem] font-black tracking-[-0.02em] leading-[1.04] text-stone-900">
            Three steps.
            <span className="block italic font-serif font-light text-stone-500">No agency calls. No Canva.</span>
          </h2>
          <p className="mt-6 text-base text-stone-700 leading-[1.65] max-w-xl">
            Most "AI tools" make you fight a chatbot. This one runs in the background. You see the posts before they go live; you change anything you want; the rest just works.
          </p>
        </div>

        {/* Steps — magazine grid. Numbers are typographic, oversized,
            warm-toned. Pull copy is small caps to feel editorial. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-10 gap-y-14">
          {STEPS.map((step, i) => (
            <div key={i} className="relative">
              <div className="flex items-baseline gap-4 mb-5">
                <span className="text-6xl sm:text-7xl font-black text-amber-700/90 tracking-[-0.04em] leading-none">
                  {step.number}
                </span>
                <span className="text-[10px] font-bold tracking-[0.18em] text-stone-500 uppercase whitespace-nowrap">
                  {step.pull}
                </span>
              </div>
              <h3 className="text-xl sm:text-2xl font-black text-stone-900 mb-3 leading-[1.15] tracking-tight">
                {step.title}
              </h3>
              <p className="text-[15px] text-stone-700 leading-[1.65]">
                {step.body}
              </p>
            </div>
          ))}
        </div>

        {/* Editorial closer — quiet line, not a CTA. The cream slab's
            job is to slow the reader down, not push them. */}
        <div className="mt-16 sm:mt-20 pt-10 border-t border-stone-300/60 flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-stone-600 italic font-serif">
            "Most small businesses post once, then go quiet for weeks. This stops that."
          </p>
          <p className="text-[10px] tracking-[0.22em] text-stone-500 uppercase font-bold">
            From $29/mo · cancel any time
          </p>
        </div>
      </div>
    </section>
  );
};

import React, { useState } from 'react';
import { CLIENT } from '../client.config';
import { PricingTable } from './PricingTable';
import {
  Sparkles, CheckCircle, Zap, Image as ImageIcon, Calendar,
  BarChart3, Facebook, Instagram, ArrowRight, Star, Clock,
  Shield, Headphones, ChevronDown, ChevronUp, Brain
} from 'lucide-react';

interface Props {
  onActivate: (plan: 'starter' | 'growth' | 'pro') => void;
}

const faqs = [
  {
    q: 'What happens after I purchase?',
    a: `You'll receive an email with a short setup form within 30 minutes. Once you fill it in, our team connects your Facebook Business page to your personalised dashboard — usually within 1–3 business days. You'll get an email the moment you're live.`,
  },
  {
    q: 'Do I need a Facebook Business page?',
    a: 'Yes — you need an active Facebook Business page. We handle the technical connection for you as part of the $99 setup. No technical knowledge needed on your end.',
  },
  {
    q: 'What is the $99 setup fee for?',
    a: 'The one-time setup covers: connecting your Facebook page to the AI system, configuring your brand profile, training the AI on your tone and industry, and making sure everything is publishing correctly before we hand it over to you.',
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
  { step: '1', title: 'Purchase a plan', desc: 'Choose the plan that fits your business. One-time $99 setup applies to all plans.', icon: Star },
  { step: '2', title: 'Fill in the setup form', desc: "We email you a short form asking for your business details and Facebook page info.", icon: Clock },
  { step: '3', title: 'We connect everything', desc: 'Our team sets up your Facebook connection and brand profile within 1–3 business days.', icon: Shield },
  { step: '4', title: "You're live!", desc: 'Log in and the AI starts generating your posts. Review, schedule, and publish with one click.', icon: Zap },
];

export const LandingPage: React.FC<Props> = ({ onActivate }) => {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [showPricing, setShowPricing] = useState(false);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white overflow-x-hidden">
      {showPricing && <PricingTable onClose={() => setShowPricing(false)} />}

      {/* NAV */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-black/60 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-gradient-to-br from-amber-400 to-orange-500 rounded-lg flex items-center justify-center">
              <Sparkles size={16} className="text-white" />
            </div>
            <span className="font-bold text-lg">{CLIENT.appName}</span>
          </div>
          <button
            onClick={() => setShowPricing(true)}
            className="text-sm bg-gradient-to-r from-amber-500 to-orange-500 text-black font-bold px-5 py-2 rounded-full hover:opacity-90 transition"
          >
            Get Started
          </button>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative pt-32 pb-20 px-6 text-center overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(245,158,11,0.15),transparent_70%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_50%,rgba(168,85,247,0.08),transparent_60%)]" />
        <div className="relative max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-semibold px-4 py-2 rounded-full mb-8">
            <Sparkles size={12} /> AI-Powered Social Media — Done For You
          </div>
          <h1 className="text-5xl md:text-7xl font-black mb-6 leading-[1.05] tracking-tight">
            Stop worrying about{' '}
            <span className="bg-gradient-to-r from-amber-400 via-orange-400 to-pink-400 bg-clip-text text-transparent">
              social media.
            </span>
          </h1>
          <p className="text-xl text-white/50 mb-10 max-w-2xl mx-auto leading-relaxed">
            We connect your Facebook business page to AI that writes, designs, and schedules posts automatically — every single week.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <button
              onClick={() => setShowPricing(true)}
              className="group bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black px-8 py-4 rounded-2xl text-lg hover:opacity-90 transition flex items-center gap-2 shadow-2xl shadow-amber-500/30"
            >
              Start Today — $99 Setup
              <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
            </button>
            <p className="text-sm text-white/30">Then from $29/month · Cancel anytime</p>
          </div>
        </div>

        {/* Social proof badges */}
        <div className="relative max-w-2xl mx-auto mt-16 grid grid-cols-3 gap-4">
          {[
            { icon: Facebook, label: 'Facebook', sub: 'Auto-publish' },
            { icon: Instagram, label: 'Instagram', sub: 'Auto-schedule' },
            { icon: Brain, label: 'Gemini AI', sub: 'Writes & designs' },
          ].map((item, i) => (
            <div key={i} className="bg-white/5 border border-white/8 rounded-2xl p-4 flex flex-col items-center gap-2">
              <item.icon size={24} className="text-amber-400" />
              <p className="font-bold text-sm">{item.label}</p>
              <p className="text-xs text-white/40">{item.sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-black mb-3">Up and running in 3 days</h2>
            <p className="text-white/40">We do all the hard work — you just review your posts</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {howItWorks.map((step, i) => (
              <div key={i} className="relative">
                {i < howItWorks.length - 1 && (
                  <div className="hidden md:block absolute top-8 left-[60%] w-full h-px bg-gradient-to-r from-amber-500/30 to-transparent z-0" />
                )}
                <div className="relative z-10 bg-white/3 border border-white/8 rounded-2xl p-6 text-center hover:bg-white/5 transition">
                  <div className="w-14 h-14 mx-auto mb-4 bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/20 rounded-2xl flex items-center justify-center">
                    <step.icon size={22} className="text-amber-400" />
                  </div>
                  <div className="text-xs font-bold text-amber-500 mb-1">Step {step.step}</div>
                  <h3 className="font-bold text-white mb-2">{step.title}</h3>
                  <p className="text-xs text-white/40 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="py-20 px-6" id="pricing">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 text-white/60 text-xs font-semibold px-4 py-2 rounded-full mb-6">
              One-time $99 setup · then monthly
            </div>
            <h2 className="text-3xl md:text-4xl font-black mb-3">Simple, honest pricing</h2>
            <p className="text-white/40">No lock-in contracts. Cancel anytime.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {CLIENT.plans.map((plan) => (
              <div
                key={plan.id}
                className={`relative rounded-3xl border p-8 flex flex-col ${
                  plan.badge === 'Most Popular'
                    ? 'bg-gradient-to-b from-amber-500/10 to-orange-500/5 border-amber-500/30 scale-[1.02]'
                    : 'bg-white/3 border-white/10 hover:bg-white/5'
                } transition`}
              >
                {plan.badge && (
                  <div className={`absolute -top-3.5 left-1/2 -translate-x-1/2 bg-gradient-to-r ${plan.color} text-white text-[11px] font-black px-4 py-1 rounded-full whitespace-nowrap shadow-lg`}>
                    {plan.badge}
                  </div>
                )}
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${plan.color} flex items-center justify-center mb-5 shadow-lg`}>
                  <Zap size={18} className="text-white" />
                </div>
                <h3 className="text-2xl font-black mb-1">{plan.name}</h3>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-4xl font-black">${plan.price}</span>
                  <span className="text-white/40 text-sm">/month</span>
                </div>
                <p className="text-xs text-white/30 mb-6">+ $99 one-time setup</p>

                <ul className="space-y-2.5 mb-8 flex-1">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      <CheckCircle size={15} className="text-green-400 shrink-0 mt-0.5" />
                      <span className="text-white/70">{f}</span>
                    </li>
                  ))}
                  {plan.limitations.map((f, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      <span className="text-white/20 shrink-0 mt-0.5 w-[15px] text-center">—</span>
                      <span className="text-white/25 line-through">{f}</span>
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => setShowPricing(true)}
                  className={`w-full bg-gradient-to-r ${plan.color} text-white font-black py-3.5 rounded-xl text-center hover:opacity-90 transition flex items-center justify-center gap-2 shadow-lg`}
                >
                  Get {plan.name} <ArrowRight size={16} />
                </button>
              </div>
            ))}
          </div>

          <p className="text-center text-sm text-white/25 mt-8">
            All plans include the $99 one-time setup fee · Secure payment via{' '}
            <a href={CLIENT.salesUrl} target="_blank" rel="noopener noreferrer" className="text-amber-400/60 hover:text-amber-400 transition">
              pennywiseit.com.au
            </a>
          </p>
        </div>
      </section>

      {/* FEATURES GRID */}
      <section className="py-20 px-6 bg-white/[0.02] border-y border-white/5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-black mb-3">Everything your socials need</h2>
            <p className="text-white/40">Built for busy Australian small businesses</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
            {[
              { icon: Brain, title: 'AI Caption Writing', desc: 'Google Gemini writes captions in your brand voice, with hashtags included.' },
              { icon: ImageIcon, title: 'AI Image Generation', desc: 'Every post gets a custom AI-generated image matched to your content.' },
              { icon: Calendar, title: 'Smart Scheduling', desc: 'AI picks the best times to post based on your audience and industry.' },
              { icon: Facebook, title: 'Direct Facebook Publishing', desc: 'Posts publish straight to your Facebook page. No copying and pasting.' },
              { icon: BarChart3, title: 'Live Stats', desc: 'See your follower count, reach, and engagement rate — updated in real time.' },
              { icon: Zap, title: 'Saturation Mode', desc: 'Launch a 21-post blitz campaign to rapidly grow your page reach (Pro plan).' },
            ].map((f, i) => (
              <div key={i} className="bg-white/3 border border-white/8 rounded-2xl p-6 hover:bg-white/5 transition group">
                <div className="w-10 h-10 bg-gradient-to-br from-amber-500/20 to-orange-500/10 border border-amber-500/20 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <f.icon size={18} className="text-amber-400" />
                </div>
                <h3 className="font-bold mb-1.5">{f.title}</h3>
                <p className="text-sm text-white/40 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-black mb-3">Common questions</h2>
          </div>
          <div className="space-y-3">
            {faqs.map((faq, i) => (
              <div key={i} className="bg-white/3 border border-white/8 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-6 py-5 text-left hover:bg-white/3 transition"
                >
                  <span className="font-semibold text-sm md:text-base pr-4">{faq.q}</span>
                  {openFaq === i ? <ChevronUp size={16} className="text-amber-400 shrink-0" /> : <ChevronDown size={16} className="text-white/30 shrink-0" />}
                </button>
                {openFaq === i && (
                  <div className="px-6 pb-5 text-sm text-white/50 leading-relaxed border-t border-white/5 pt-4">
                    {faq.a}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BOTTOM CTA */}
      <section className="py-20 px-6 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,rgba(245,158,11,0.12),transparent_70%)]" />
        <div className="relative max-w-2xl mx-auto">
          <h2 className="text-3xl md:text-5xl font-black mb-4">Ready to put social media on autopilot?</h2>
          <p className="text-white/40 mb-10">Join Australian businesses already saving hours every week.</p>
          <button
            onClick={() => setShowPricing(true)}
            className="group inline-flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 text-black font-black px-10 py-5 rounded-2xl text-xl hover:opacity-90 transition shadow-2xl shadow-amber-500/30"
          >
            Get Started Today <ArrowRight size={22} className="group-hover:translate-x-1 transition-transform" />
          </button>
          <p className="text-white/20 text-sm mt-6">$99 setup · then from $29/month · No lock-in contract</p>
        </div>
      </section>

      {/* ALREADY HAVE ACCESS */}
      <div className="border-t border-white/5 py-6 px-6 text-center">
        <p className="text-sm text-white/30">
          Already a customer?{' '}
          <button
            onClick={() => onActivate('growth')}
            className="text-amber-400 hover:text-amber-300 underline underline-offset-2 transition"
          >
            Access your dashboard
          </button>
        </p>
      </div>

      {/* FOOTER */}
      <footer className="border-t border-white/5 py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/20">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 bg-gradient-to-br from-amber-400 to-orange-500 rounded flex items-center justify-center">
              <Sparkles size={10} className="text-white" />
            </div>
            <span>{CLIENT.appName}</span>
          </div>
          <span>
            <a href={CLIENT.poweredByUrl} target="_blank" rel="noopener noreferrer" className="hover:text-white/40 transition">
              {CLIENT.poweredBy}
            </a>
            {' · '}
            <a href={`mailto:${CLIENT.supportEmail}`} className="hover:text-white/40 transition">{CLIENT.supportEmail}</a>
          </span>
        </div>
      </footer>
    </div>
  );
};

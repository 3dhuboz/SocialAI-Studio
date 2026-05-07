import React from 'react';
import { Heart, ThumbsUp, MessageCircle } from 'lucide-react';

/**
 * LiveGallery — full-bleed two-row marquee of post mockups across many
 * Aussie SMB industries. Sits below the hero and acts as the proof slab:
 * "this is what AI generates for businesses like yours, all day, every day."
 *
 * Two rows scroll in opposite directions (60s loop each, paused on hover).
 * Twelve unique posts; each row duplicates the set so the loop is seamless.
 *
 * Design intent: drop the "abstract AI demo" feel and replace with concrete
 * variety — diverse industries, diverse tones, diverse images. The motion
 * is calm enough to read but cinematic enough to feel alive.
 */

type GalleryPost = {
  brand: string;
  caption: string;
  /** Real Unsplash photo. Falls back to gradient + emoji if it 404s. */
  image: string;
  imageGradient: string;
  imageEmoji: string;
  platform: 'instagram' | 'facebook';
  industry: string;
};

// Smaller crop than PostShowcase since gallery cards are ~260px wide max
const unsplash = (id: string) => `https://images.unsplash.com/photo-${id}?w=520&h=520&fit=crop&q=70&auto=format`;

const POSTS_ROW_A: GalleryPost[] = [
  { brand: 'Bondi Surf School', caption: 'Sunrise lesson cancelled — but here\'s a gentle 2pm session for the brave 🌊', image: unsplash('1502602898657-3e91760cbb34'), imageGradient: 'from-cyan-200 via-sky-300 to-blue-300', imageEmoji: '🏄', platform: 'instagram', industry: 'Lessons' },
  { brand: 'Slate & Sage', caption: 'New autumn menu drops Friday. Roast pumpkin gnocchi back by request.', image: unsplash('1505740420928-5e560c06d30e'), imageGradient: 'from-orange-300 via-rose-300 to-pink-300', imageEmoji: '🍝', platform: 'instagram', industry: 'Restaurant' },
  { brand: 'Mike\'s Plumbing & Gas', caption: 'Hot water gone? Same-day callouts across Brisbane. Fixed quotes, no callout fee.', image: unsplash('1607400201515-c2c41c07d307'), imageGradient: 'from-blue-300 via-cyan-300 to-sky-200', imageEmoji: '🔧', platform: 'facebook', industry: 'Tradie' },
  { brand: 'The Beard Room', caption: 'Saturday slots almost full. Fades, beards, the works. Tap to book.', image: unsplash('1503951914875-452162b0f3f1'), imageGradient: 'from-stone-300 via-amber-200 to-orange-200', imageEmoji: '💈', platform: 'instagram', industry: 'Barber' },
  { brand: 'Coast Hair Co.', caption: 'Sarah\'s July diary is open — gloss, balayage, the lot.', image: unsplash('1560066984-138dadb4c035'), imageGradient: 'from-pink-300 via-rose-300 to-purple-300', imageEmoji: '✂️', platform: 'instagram', industry: 'Salon' },
  { brand: 'Harbour Real Estate', caption: 'Just listed Manly — 3 bed, 2 bath, the view does the talking.', image: unsplash('1568605114967-8130f3a36994'), imageGradient: 'from-blue-200 via-indigo-200 to-purple-300', imageEmoji: '🏡', platform: 'facebook', industry: 'Real estate' },
];

const POSTS_ROW_B: GalleryPost[] = [
  { brand: 'Green Thumb Garden', caption: 'Tulip bulbs are in. Plant before May for September bloom. Free guide with every bag.', image: unsplash('1416879595882-3373a0480b5b'), imageGradient: 'from-lime-200 via-green-300 to-emerald-300', imageEmoji: '🌷', platform: 'facebook', industry: 'Retail' },
  { brand: 'Bella\'s Cafe', caption: 'Sunday treat — cinnamon scrolls fresh from the oven. Open till 2.', image: unsplash('1551024601-bec78aea704b'), imageGradient: 'from-amber-200 via-orange-200 to-rose-300', imageEmoji: '🥐', platform: 'instagram', industry: 'Cafe' },
  { brand: 'FastFit Studio', caption: '6am crew — bring water, bring a mate. First class on us.', image: unsplash('1571019613454-1cb2f99b2d8b'), imageGradient: 'from-emerald-200 via-teal-300 to-cyan-300', imageEmoji: '🥊', platform: 'instagram', industry: 'Gym' },
  { brand: 'Coastal Pet Co.', caption: 'New stock in: Aussie-made dog beds. Two sizes. Made to last a decade.', image: unsplash('1583337130417-3346a1be7dee'), imageGradient: 'from-yellow-200 via-amber-200 to-orange-200', imageEmoji: '🐕', platform: 'instagram', industry: 'Retail' },
  { brand: 'Ridgeline Roofing', caption: 'Storm season prep — book a free roof check this month, no obligation.', image: unsplash('1558618666-fcd25c85cd64'), imageGradient: 'from-slate-300 via-stone-300 to-zinc-300', imageEmoji: '🏠', platform: 'facebook', industry: 'Tradie' },
  { brand: 'Bloom Photography', caption: 'Family session slots opened for July long weekend. 8 spots, gone fast.', image: unsplash('1606914501449-5a96b6ce24ca'), imageGradient: 'from-rose-200 via-pink-200 to-fuchsia-300', imageEmoji: '📷', platform: 'instagram', industry: 'Service' },
];

export const LiveGallery: React.FC = () => {
  return (
    <section className="relative py-16 sm:py-20 overflow-hidden">
      {/* Section label — editorial small caps, asymmetric */}
      <div className="max-w-6xl mx-auto px-6 mb-10">
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 text-[10px] sm:text-[11px] font-bold tracking-[0.18em] text-white/35 uppercase mb-4">
              <span className="w-6 h-px bg-white/20" />
              Made for businesses like yours
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-[-0.02em] leading-[1.05] max-w-2xl">
              Six industries.
              <span className="block italic font-serif font-light text-white/55">One small Australian team behind every post.</span>
            </h2>
          </div>
          <p className="text-sm text-white/45 max-w-sm">
            Real-feel sample posts across cafes, trades, salons, gyms, retail, and real estate — the kind of thing your AI calendar fills with each week.
          </p>
        </div>
      </div>

      {/* Two opposing marquee rows — gradient masks at edges so the loop
          fades softly instead of clipping. Pause on hover lets the eye stop
          on a post that catches it. */}
      <div className="space-y-5">
        <MarqueeRow posts={POSTS_ROW_A} direction="left" />
        <MarqueeRow posts={POSTS_ROW_B} direction="right" />
      </div>

      <p className="max-w-6xl mx-auto px-6 mt-10 text-center text-xs text-white/35">
        Sample post mockups · Real generated posts use your actual brand voice and AI-made imagery.
      </p>
    </section>
  );
};

// ──────────────────────────────────────────────────────────────────────────

interface MarqueeRowProps {
  posts: GalleryPost[];
  direction: 'left' | 'right';
}

const MarqueeRow: React.FC<MarqueeRowProps> = ({ posts, direction }) => {
  // Duplicate the set so the marquee loop is visually seamless. Animation
  // moves -50% (i.e. exactly one set width) over 60s, then snaps invisibly.
  const doubled = [...posts, ...posts];
  return (
    <div className="relative marquee-pause">
      {/* Edge fade masks — give it that "extends past the viewport" feel
          instead of looking like content cut off mid-card. */}
      <div className="absolute inset-y-0 left-0 w-16 sm:w-32 bg-gradient-to-r from-[var(--color-surface-0)] to-transparent z-10 pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-16 sm:w-32 bg-gradient-to-l from-[var(--color-surface-0)] to-transparent z-10 pointer-events-none" />
      <div
        className="flex gap-5 w-max animate-marquee"
        style={{ animationDirection: direction === 'right' ? 'reverse' : 'normal' }}
      >
        {doubled.map((post, i) => (
          <GalleryCard key={i} post={post} />
        ))}
      </div>
    </div>
  );
};

const FB_BLUE = '#1877F2';
const IG_GRAD = 'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)';

const GalleryCard: React.FC<{ post: GalleryPost }> = ({ post }) => {
  const isFb = post.platform === 'facebook';
  return (
    <div className="w-[220px] sm:w-[260px] flex-shrink-0 bg-white rounded-2xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.5)] overflow-hidden text-gray-900 font-sans border border-black/[0.04]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-white font-black text-[10px] flex-shrink-0 ring-2 ring-white"
          style={{ background: isFb ? FB_BLUE : IG_GRAD }}
        >
          {post.brand.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[10.5px] leading-tight truncate">{post.brand}</p>
          <p className="text-[9px] text-gray-400 truncate">{post.industry}</p>
        </div>
      </div>
      {/* Image — real photo with gradient + emoji fallback. The img tag
          hides itself onError so missing/blocked Unsplash content reveals
          the gradient + emoji underneath rather than a broken-image icon. */}
      <div className={`relative w-full aspect-square bg-gradient-to-br ${post.imageGradient} flex items-center justify-center overflow-hidden`}>
        <span className="text-5xl drop-shadow-[0_2px_8px_rgba(0,0,0,0.15)]">{post.imageEmoji}</span>
        {post.image && (
          <img
            src={post.image}
            alt=""
            loading="lazy"
            decoding="async"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_30%_20%,rgba(255,255,255,0.18),transparent_60%)]" />
      </div>
      {/* Action row */}
      <div className="px-3 pt-2 pb-1 flex items-center gap-2.5 text-gray-700">
        {isFb ? (
          <ThumbsUp size={14} className="text-blue-500 fill-blue-500" />
        ) : (
          <Heart size={15} className="text-rose-500 fill-rose-500" />
        )}
        <MessageCircle size={isFb ? 14 : 15} strokeWidth={1.8} />
      </div>
      {/* Caption */}
      <div className="px-3 pb-3">
        <p className="text-[10.5px] leading-snug text-gray-700 line-clamp-2">{post.caption}</p>
      </div>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { Heart, MessageCircle, Send, Bookmark, ThumbsUp } from 'lucide-react';

/**
 * PostShowcase — auto-rotating stack of realistic post mockups for the hero.
 *
 * Replaces the previous abstract `AnimatedDemo` (terminal-text aesthetic that
 * read as "generic AI demo"). This component shows the actual product OUTPUT
 * — captioned posts across multiple Aussie SMB industries — which is what
 * the customer is buying.
 *
 * Three cards visible at any moment: one in front (full opacity), two
 * tilted behind (slight rotation + offset). Front card cycles every 4.5s
 * with a smooth ease-out transition. Stacked-card pattern reads as "look
 * at all the posts the AI made for you" without any UI chrome that screams
 * "AI tool".
 */

interface MockPost {
  brand: string;
  handle: string;
  caption: string;
  /** Real product photo from Unsplash. Falls back to imageGradient + imageEmoji
      if the <img> errors so the section never renders broken-image icons. */
  image: string;
  imageGradient: string;
  imageEmoji: string;
  platform: 'instagram' | 'facebook';
  likes: string;
}

// Unsplash sizing: 800x800 square crop, q=72, format-auto. Mid-range size
// since these render at ~420px max in the hero — 800px gives 2x retina
// without overpaying on bandwidth.
const unsplash = (id: string) => `https://images.unsplash.com/photo-${id}?w=800&h=800&fit=crop&q=72&auto=format`;

// Six industries — each Aussie-flavoured, each in a different visual key so
// the rotation feels varied. Captions are deliberately specific (Brisbane,
// Gold Coast, Byron, Melbourne) to reinforce the persona signal: this was
// made for an Australian small business, not a generic SaaS.
const POSTS: MockPost[] = [
  {
    brand: "Bella's Cafe",
    handle: 'bellascafe',
    caption: "Sunday treat — cinnamon scrolls fresh from the oven. Drop in before they're gone, we're open till 2pm.",
    image: unsplash('1551024601-bec78aea704b'),
    imageGradient: 'from-amber-200 via-orange-200 to-rose-300',
    imageEmoji: '🥐',
    platform: 'instagram',
    likes: '847',
  },
  {
    brand: "Mike's Plumbing & Gas",
    handle: 'Mike\'s Plumbing & Gas',
    caption: 'Burst pipe? Hot water gone? 24/7 emergency callouts across Brisbane. Fixed-price quotes, no callout fee.',
    image: unsplash('1607400201515-c2c41c07d307'),
    imageGradient: 'from-sky-300 via-blue-300 to-cyan-200',
    imageEmoji: '🔧',
    platform: 'facebook',
    likes: '124',
  },
  {
    brand: 'Coast Hair Co.',
    handle: 'coasthairco',
    caption: 'New stylist Sarah is taking July bookings — gloss treatments, balayage, the lot. Tap to grab a slot.',
    image: unsplash('1560066984-138dadb4c035'),
    imageGradient: 'from-pink-300 via-rose-300 to-purple-300',
    imageEmoji: '✂️',
    platform: 'instagram',
    likes: '612',
  },
  {
    brand: 'FastFit Studio',
    handle: 'fastfitstudio',
    caption: 'Morning crew — 6am session in 30. Bring water, bring a mate. First class on us if you mention this post.',
    image: unsplash('1517836357463-d25dfeac3438'),
    imageGradient: 'from-emerald-200 via-teal-300 to-cyan-300',
    imageEmoji: '🥊',
    platform: 'instagram',
    likes: '932',
  },
  {
    brand: 'Green Thumb Garden Centre',
    handle: 'Green Thumb Garden Centre',
    caption: 'Autumn means tulip bulbs are in. Plant before May for a September bloom. Free planting guide with every bag.',
    image: unsplash('1416879595882-3373a0480b5b'),
    imageGradient: 'from-lime-200 via-green-300 to-emerald-300',
    imageEmoji: '🌷',
    platform: 'facebook',
    likes: '203',
  },
  {
    brand: 'Harbour Real Estate',
    handle: 'harbourrealestate',
    caption: 'Just listed in Manly — 3 bed, 2 bath, the view does the talking. Open Saturday 11am, we\'ll see you there.',
    image: unsplash('1568605114967-8130f3a36994'),
    imageGradient: 'from-blue-200 via-indigo-200 to-purple-300',
    imageEmoji: '🏡',
    platform: 'instagram',
    likes: '1.4k',
  },
];

const SCENE_DURATION_MS = 4500;

export const PostShowcase: React.FC = () => {
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setActiveIdx(i => (i + 1) % POSTS.length);
    }, SCENE_DURATION_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="relative w-full" style={{ perspective: '1400px' }}>
      {/* Stage — fixed aspect so the rotating cards don't reflow the page. */}
      <div className="relative w-full aspect-[4/5] max-w-[420px] mx-auto">
        {POSTS.map((post, i) => {
          // Compute "distance from active" — 0 = front, 1 = right tilt,
          // POSTS.length-1 = left tilt, others hidden.
          const offset = (i - activeIdx + POSTS.length) % POSTS.length;
          const isFront = offset === 0;
          const isRight = offset === 1;
          const isLeft = offset === POSTS.length - 1;
          const isVisible = isFront || isRight || isLeft;

          let transform = 'translate3d(0,24px,-80px) scale(0.85) rotate(0deg)';
          let opacity = 0;
          let zIndex = 0;

          if (isFront) {
            transform = 'translate3d(0,0,0) scale(1) rotate(0deg)';
            opacity = 1;
            zIndex = 30;
          } else if (isRight) {
            transform = 'translate3d(38px,12px,-60px) scale(0.94) rotate(5deg)';
            opacity = 0.55;
            zIndex = 20;
          } else if (isLeft) {
            transform = 'translate3d(-38px,12px,-60px) scale(0.94) rotate(-5deg)';
            opacity = 0.55;
            zIndex = 20;
          }

          return (
            <div
              key={i}
              aria-hidden={!isFront}
              className="absolute inset-0 transition-all duration-700 ease-out will-change-transform"
              style={{ transform, opacity, zIndex, pointerEvents: isVisible ? 'auto' : 'none' }}
            >
              <PostCard post={post} />
            </div>
          );
        })}
      </div>

      {/* Industry chip — labels what's currently shown. Swaps with a fade. */}
      <div className="mt-5 flex items-center justify-center gap-2 text-xs text-white/45">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        <span className="font-medium">Live preview</span>
        <span className="text-white/20">·</span>
        <span className="font-mono tracking-tight">{POSTS[activeIdx].brand}</span>
      </div>
    </div>
  );
};

// ──────────────────────────────────────────────────────────────────────────
// PostCard — a realistic Facebook/Instagram post mockup. Used inside the
// rotation stack above. Kept private to this file; export if reused.
// ──────────────────────────────────────────────────────────────────────────

const FB_BLUE = '#1877F2';
const IG_GRAD = 'linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)';

const PostCard: React.FC<{ post: MockPost }> = ({ post }) => {
  const isFb = post.platform === 'facebook';

  return (
    <div className="bg-white rounded-3xl shadow-[0_40px_120px_-30px_rgba(0,0,0,0.55),0_8px_24px_-12px_rgba(0,0,0,0.3)] overflow-hidden text-gray-900 font-sans h-full flex flex-col border border-black/[0.04]">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-3 pb-2.5">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white font-black text-sm flex-shrink-0 ring-2 ring-white"
          style={{ background: isFb ? FB_BLUE : IG_GRAD }}
        >
          {post.brand.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-[13px] leading-tight truncate">{post.brand}</p>
          <p className="text-[11px] text-gray-400 truncate">
            {isFb ? 'Sponsored · 🌐' : post.handle}
          </p>
        </div>
        <div className="text-gray-400 text-xl leading-none">···</div>
      </div>

      {/* Media — real photo with gradient + emoji as graceful fallback.
          If the Unsplash URL ever 404s or the user is offline, the image
          element hides itself and the gradient/emoji underneath shows
          through. The card never renders a broken-image icon. */}
      <div
        className={`relative w-full aspect-square bg-gradient-to-br ${post.imageGradient} flex items-center justify-center overflow-hidden`}
      >
        <span className="text-[5.5rem] sm:text-7xl drop-shadow-[0_4px_12px_rgba(0,0,0,0.15)] animate-[float_6s_ease-in-out_infinite]">
          {post.imageEmoji}
        </span>
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
      <div className="px-4 pt-3 pb-1 flex items-center justify-between">
        <div className="flex items-center gap-3.5 text-gray-800">
          {isFb ? (
            <ThumbsUp size={20} strokeWidth={1.8} className="text-blue-500 fill-blue-500" />
          ) : (
            <Heart size={22} strokeWidth={1.8} className="text-rose-500 fill-rose-500" />
          )}
          <MessageCircle size={isFb ? 20 : 22} strokeWidth={1.8} />
          <Send size={isFb ? 20 : 22} strokeWidth={1.8} />
        </div>
        {!isFb && <Bookmark size={22} strokeWidth={1.8} />}
      </div>

      {/* Likes + caption */}
      <div className="px-4 pb-3.5 flex-1">
        <p className="text-[12.5px] font-bold text-gray-900 leading-tight mb-1">
          {post.likes} {isFb ? 'people reacted' : 'likes'}
        </p>
        <p className="text-[12.5px] leading-snug text-gray-800 line-clamp-3">
          {!isFb && <span className="font-bold mr-1">{post.handle}</span>}
          {post.caption}
        </p>
      </div>
    </div>
  );
};

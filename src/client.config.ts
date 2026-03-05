/**
 * ─────────────────────────────────────────────────────────
 *  CLIENT CONFIG  —  edit this file for each white-label client
 *  Everything here is the ONLY thing you need to change when
 *  deploying a new branded instance of SocialAI Studio.
 * ─────────────────────────────────────────────────────────
 */
export const CLIENT = {
  /** Displayed in the browser tab and app header */
  appName: 'SocialAI Studio',

  /** Short tagline shown under the app name in the header */
  tagline: 'AI-powered social media for your business',

  /** Pre-filled business profile — the user can edit these in Settings */
  defaultBusinessName: 'My Business',
  defaultBusinessType: 'small business',
  defaultLocation: 'Australia',
  defaultTone: 'Friendly and professional',
  defaultDescription: '',

  /**
   * Accent colour used for highlights, active tabs, and buttons.
   * Use a valid CSS colour (hex, rgb, or Tailwind class keyword).
   * Currently the UI uses Tailwind amber-400/500 — to change the
   * colour, update the Tailwind classes in App.tsx as well.
   */
  accentColor: '#f59e0b',

  /** Footer / attribution line (leave empty to hide) */
  poweredBy: 'Powered by Penny Wise I.T',
  poweredByUrl: 'https://pennywiseit.com.au',
};

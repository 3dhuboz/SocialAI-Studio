# Reel Studio design specification

## Goal

Give Pete one focused production desk for uploading a finished phone video,
writing accurate Richo Road copy from verified website context, and saving,
scheduling, or publishing it without moving between tools.

## Visual system

- Canvas: `#0b0b0c`
- Work surfaces: `#141416` and `#1a1a1c`
- Primary text: `#f5f1e8`
- Secondary text: `#a6a29a`
- Richo action red: `#b51f2a`
- Production amber: `#d9a441`
- Borders: `rgba(255,255,255,0.10)`
- Corners: 8px maximum
- Controls: 44px minimum target
- Motion: short opacity/translate transitions only; no decorative looping
  animation and no layout-shifting entrances

## Desktop composition

1. Media desk: portrait video, upload/replace action, file metadata, and upload
   progress.
2. Copy desk: verified Richo context, footage notes, three AI caption options,
   editable caption, CTA, and hashtags.
3. Release desk: Facebook/Instagram choice, publish-now/schedule choice, date,
   save draft, and final release action.

## Mobile composition

The same workflow collapses to one column in task order: media, context, copy,
release. The primary release action remains visible at the bottom without
covering form fields.

## Product guardrails

- An upload is not considered ready until R2 returns a durable public URL.
- AI copy may use selected verified context and Pete's footage notes. It must
  not claim to understand unprovided visual or audio details.
- A scheduled Reel is blocked unless the selected workspace owns the upload
  and the target platform is connected.
- User-uploaded video does not consume an AI video-generation credit.
- Replacing a local preview never changes a previously saved post.

## Concept references

- `reel-studio-desktop.png`
- `reel-studio-mobile.png`

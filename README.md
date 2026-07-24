# SocialAI Studio

AI-powered social media content generator and scheduler for small businesses. Generate posts, images, and full content calendars using AI.

## Features

- **AI Content Generator** — Write platform-optimized posts for Facebook & Instagram
- **AI Image Generation** — Create marketing images from text prompts
- **Smart AI Scheduler** — Auto-generate a 2-week content calendar optimized for engagement
- **Content Calendar** — Manage drafts, scheduled, and posted content
- **AI Insights** — Get posting time recommendations and strategy advice
- **Business Profile** — AI tailors all content to your brand, tone, and industry
- **Export** — Download all data as JSON

## Tech Stack

React 19 · TypeScript · TailwindCSS 4 · Vite 6 · Cloudflare Workers · D1 Database · Clerk Authentication

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5174` → Sign up with Clerk → Start creating content.

**Note**: AI features are powered by OpenRouter via Cloudflare Workers. No API keys required on the client.

## Architecture

- **Frontend**: React app deployed on Cloudflare Pages
- **Authentication**: Clerk (JWT-based)
- **Database**: Cloudflare D1 (SQLite)
- **AI**: OpenRouter API proxied through Cloudflare Workers
- **Social Media**: Late.dev integration for scheduling

## Deploy

```bash
npm run build
```

Deploy to Cloudflare Pages with environment variables:
- `VITE_AI_WORKER_URL`: Your Cloudflare Worker URL
- `VITE_LEARNING_PILOT_WORKER_URL`: Isolated staging Worker for admin-only, record-only pilot operations
- `VITE_CLERK_PUBLISHABLE_KEY`: Clerk publishable key

## Richo Road Integration

The Worker exposes a server-to-server endpoint for the Richo Road Butchery ordering backend:

```text
POST /api/integrations/richo-road/events
Authorization: Bearer <RICHO_ROAD_INGEST_API_KEY>
```

It creates or updates a SocialAI draft post and writes a verified `client_facts` context row. Configure the Worker with:

```bash
wrangler secret put RICHO_ROAD_INGEST_API_KEY --config workers/api/wrangler.toml
wrangler secret put RICHO_ROAD_AGENT_ACCOUNT_ID --config workers/api/wrangler.toml
wrangler secret put RICHO_ROAD_WORKSPACE_ID --config workers/api/wrangler.toml
```

The matching Richo Pages project should use the same ingest key as `SOCIALAI_STUDIO_API_KEY`, the SocialAI owner user id as `RICHO_AGENT_ACCOUNT_ID`, and the Richo client id as `SOCIALAI_STUDIO_WORKSPACE_ID`.

## License

Private. Contact for licensing.

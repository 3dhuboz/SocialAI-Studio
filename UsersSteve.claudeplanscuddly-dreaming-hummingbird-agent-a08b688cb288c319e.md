# Campaigns Feature - Implementation Plan

## Overview
Add a Campaigns feature: time-boxed rule sets that inject extra instructions into the AI Smart Schedule prompt. Campaigns are per-workspace, stored in D1, and auto-disable after their end date.

---

## Step 1: Types (src/types.ts)

Add after the ClientWorkspace interface (line ~89). Campaign interface with: id (string uuid), name (string), type (countdown|promo|launch|event|custom), startDate (ISO string), endDate (ISO string), rules (string free-text), postsPerDay (number 1-3), enabled (boolean), createdAt (string).

---

## Step 2: Worker API (workers/api/src/index.ts)

### 2a. D1 Table
Create via wrangler CLI. Table: campaigns. Columns: id TEXT PK, user_id TEXT NOT NULL, client_id TEXT, name TEXT NOT NULL, type TEXT DEFAULT custom, start_date TEXT, end_date TEXT, rules TEXT DEFAULT empty, posts_per_day INTEGER DEFAULT 1, enabled INTEGER DEFAULT 1, created_at TEXT.

### 2b. CRUD endpoints
Insert after clients CRUD (~line 448), before Social Tokens (~line 450).

GET /api/db/campaigns - clientId query param, SELECT WHERE user_id AND client_id, return { campaigns }
POST /api/db/campaigns - body with clientId/name/type/dates/rules/postsPerDay, uuid(), return { id }
PUT /api/db/campaigns/:id - dynamic SET builder (colMap pattern from clients PUT lines 415-438), enabled as boolField
DELETE /api/db/campaigns/:id - DELETE WHERE id AND user_id, return { ok: true }

---

## Step 3: DB Service (src/services/db.ts)

### 3a. DbCampaign interface after DbClient (~line 90)
Snake_case fields matching D1 columns. enabled as number (0/1).

### 3b. Methods in createDb() return object (before closing at ~line 231)
getCampaigns(clientId?) - GET, returns DbCampaign[]
createCampaign({clientId,name,type,startDate,endDate,rules,postsPerDay}) - POST, returns id
updateCampaign(id, fields) - PUT
deleteCampaign(id) - DELETE
Uses existing f(), j(), put(), del() helpers.

---

## Step 4: Gemini Prompt Injection (src/services/gemini.ts)

### 4a. Add optional activeCampaigns param to generateSmartSchedule after onPhase (line 708)

### 4b. Build campaignBlock after profileBlock (after line 744)
Format: ACTIVE CAMPAIGNS header + each campaign as name/type/dates/rules (truncated 500 chars)

### 4c. Inject campaignBlock into both prompt paths
Saturation prompt (~line 757): after profileBlock interpolation
Normal prompt (line 995): between profileBlock and quick24hExtra
Purely additive - no existing text changes.

---

## Step 5: App.tsx - State, Loading, UI

### 5a. State
Import Campaign from types. Add useState for campaigns (Campaign[]), editingCampaign (Partial or null), isSavingCampaign (boolean).

### 5b. Load in D1 sync (~line 432 after setPosts)
db.getCampaigns(), map snake_case to camelCase, setCampaigns.

### 5c. Load on workspace switch (~line 630 after client posts)
db.getCampaigns(activeClientId), same mapping.

### 5d. Auto-disable expired campaigns
useEffect on campaigns.length: for each enabled campaign with endDate < today, db.updateCampaign disable + update state.

### 5e. Pass to generateSmartSchedule (~line 1357)
Filter: enabled AND startDate <= today AND endDate >= today. Pass as last argument.

### 5f. CRUD handlers
handleSaveCampaign: create or update based on editingCampaign.id existing
handleDeleteCampaign(id): delete + filter state
handleToggleCampaign(id): toggle enabled

### 5g. Settings UI - between Business Profile end (~4400) and fal.ai Key (~4402)

Section divider: text-[10px] font-black text-white/20 uppercase "Campaigns" with h-px bg-white/6

Campaign list card (bg-white/3 border border-white/8 rounded-2xl p-6 space-y-4):
- Header: Zap icon (amber bg), title, subtitle, + New Campaign button
- Empty: muted text
- Each row: name bold, type pill badge, date range, toggle/edit/delete buttons
- Expired campaigns: red Expired badge instead of toggle

Edit form (conditional on editingCampaign):
- Name input, type pill buttons (5 options), date inputs side by side
- Rules textarea, posts/day pill buttons (1/2/3)
- Save (amber) + Cancel buttons
- All inputs: bg-black/40 border-white/8 rounded-xl standard classes

---

## Sequence
1. types.ts (no deps)
2. D1 table via wrangler (no code dep)
3. workers/api CRUD (needs 2)
4. db.ts client methods (needs 3)
5. gemini.ts prompt injection (needs 1)
6. App.tsx everything (needs 1,4,5)

## Risks
- Prompt bloat: truncate rules to 500 chars
- Stale state: auto-disable on load + date filter in prompt = double safety
- No breaking changes: optional trailing parameter

# O'Connor Client Setup Instructions

## Method 1: Through App UI (Recommended)

1. **Login to SocialAI Studio** as admin (steve@pennywiseit.com.au)
2. **Go to Clients tab** in the main navigation
3. **Click "Add Client" button** (blue button with + icon)
4. **Enter client details:**
   - **Client name:** `O'Connor Butcher`
   - **Business type:** `Butcher Shop & Meat Provider`
5. **Click "Add Client"** to confirm

## Method 2: Client Configuration File

The O'Connor client configuration has been created at:
```
client-configs/oconnor.ts
```

This file contains:
- Business-specific AI prompts for butcher shop content
- Relevant hashtags (#OConnorButcher, #GIPButcher, #FreshMeatDaily)
- Content topics (daily specials, butcher tips, behind-the-scenes)
- Red color theme matching butcher branding

## Method 3: Manual Database Entry (Advanced)

If needed, you can add the client directly to the D1 database:

```sql
INSERT INTO clients (
  id, 
  user_id, 
  name, 
  business_type, 
  created_at, 
  plan
) VALUES (
  'oconnor-' || uuid_generate(),
  'USER_ID_HERE', -- Replace with actual user ID
  'O''Connor Butcher',
  'Butcher Shop & Meat Provider',
  CURRENT_TIMESTAMP,
  'growth'
);
```

## Post-Setup Steps

1. **Assign Plan:** Set to "Growth" plan ($497/mo)
2. **Setup Status:** Mark as "In Progress"
3. **Contact Client:** Send setup form link
4. **Connect Social:** Help connect Facebook page
5. **Customize Profile:** Use butcher-specific AI prompts

## Content Strategy for O'Connor Butcher

### Recommended Content Pillars:
- **Daily Specials:** Fresh meat arrivals and daily deals
- **Behind the Scenes:** Meat preparation and butchery techniques
- **Educational Content:** Cooking tips and meat storage advice
- **Community Focus:** Local sourcing and farm partnerships
- **Customer Spotlights:** Reviews and success stories

### Posting Schedule:
- **Frequency:** 3-4 posts per week
- **Best Times:** 7-8am (breakfast planning) and 4-5pm (dinner planning)
- **Platforms:** Facebook (primary), Instagram (secondary)

### Hashtag Strategy:
- **Primary:** #OConnorButcher #GIPButcher
- **Location:** #GIP #LocalButcher
- **Content:** #FreshMeatDaily #QualityMeats #ButcherTips
- **Community:** #SupportLocal #MeatLovers

## Notes

- Setup fee waived for existing client
- Use red color theme in client portal
- Focus on quality, freshness, and local service
- Highlight premium meats and special offers
- Emphasize expertise and customer service

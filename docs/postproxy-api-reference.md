# Overview

Postproxy is a unified API for posting content to social media platforms with built-in scheduling, error handling, and retry management.

## Core concepts

#### Profile

A connected social media account (X, Facebook, Instagram, etc.) that you can post content to. Each profile represents an authenticated connection to a specific platform.

#### Post

A piece of content published through one or more profiles. Can include text, media (images or videos), or both. Platform-specific parameters let you customize how content appears on each platform.

#### Profile Group

A collection of profiles grouped together for organizational purposes. Use profile groups to separate brands, clients, or projects. API keys can be scoped to specific profile groups for access control.

## Supported platforms

| Platform | Content Types |
|----------|--------------|
| Facebook | Posts, Reels, Stories |
| Instagram | Posts, Reels, Stories |
| TikTok | Videos |
| LinkedIn | Posts |
| YouTube | Videos |
| X (Twitter) | Posts |
| Threads | Posts |
| Pinterest | Pins |
| Bluesky | Posts |
| Telegram | Posts (channels via [bring-your-own-bot](/guides/telegram-byo-bot/)) |
| Google Business | Local posts, events, offers, and [review replies](/reference/profile-comments/) |

## Media handling

When creating a post with media, provide URLs to your images or videos. Postproxy downloads and processes the media, then uploads it to each platform according to their requirements.

Each platform has specific constraints for media (file size, formats, dimensions). See [Platform Parameters](/reference/platform-parameters/) for details.

## Rate limits and retries

Social networks have rate limits that Postproxy handles automatically. If a post hits a rate limit, Postproxy queues it and retries when possible. You don't need to implement retry logic in your application.

---

# Authentication

All Postproxy API requests require authentication using a Bearer token in the `Authorization` header.

```
Authorization: Bearer YOUR_API_KEY
```

You can get your API key from your Postproxy dashboard.

## API key types

| Type | Scope |
|------|-------|
| Full Access | Access all profile groups, create/delete profile groups |
| Profile Group Scoped | Access only the specified profile group |

## Example request

```bash
curl -X GET "https://api.postproxy.dev/api/profiles" \
     -H "Authorization: Bearer YOUR_API_KEY"
```

## Profile group context

API requests operate within a profile group context:

1. **Explicit parameter**: Pass `?profile_group_id=<id>` as a query parameter
2. **API key scope**: If your API key is scoped to a profile group, that group is used automatically
3. **Default**: If neither is specified and the key has full access, the first profile group is used

---

# post-lifecycle

When you create a post through Postproxy, it moves through a predictable lifecycle. This guide explains each state, what to expect, and how to handle different scenarios.

## Lifecycle overview

<div class="lifecycle-flow">
  <div class="lf-node lf-draft">Draft</div>
  <div class="lf-arrow"><span>publish / schedule</span></div>
  <div class="lf-node lf-pending">Pending<small>media processing</small></div>
  <div class="lf-arrow-short"></div>
  <div class="lf-branch">
    <div class="lf-branch-left">
      <div class="lf-arrow"><span>media ok</span></div>
      <div class="lf-node lf-scheduled">Scheduled</div>
      <div class="lf-arrow"><span>at scheduled time</span></div>
      <div class="lf-node lf-processing">Processing<small>&lt; 1 sec</small></div>
      <div class="lf-arrow"><span>jobs initiated</span></div>
      <div class="lf-node lf-processed">Processed</div>
    </div>
    <div class="lf-branch-right">
      <div class="lf-arrow"><span>media failed</span></div>
      <div class="lf-node lf-failed">Media Processing Failed</div>
    </div>
  </div>
</div>

<style>{`
  .lifecycle-flow {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    padding: 2rem 1rem;
    margin: 1.5rem 0;
    background: var(--sl-color-gray-6, #1a1a2e);
    border: 1px solid var(--sl-color-gray-5, #2a2a3e);
    border-radius: 12px;
  }
  :root[data-theme="light"] .lifecycle-flow {
    background: var(--sl-color-gray-7, #f5f5f8);
    border-color: var(--sl-color-gray-5, #ddd);
  }
  .lf-node {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 10px 24px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 0.95rem;
    border: 2px solid;
    text-align: center;
    min-width: 140px;
  }
  .lf-node small {
    font-weight: 400;
    font-size: 0.78rem;
    opacity: 0.7;
  }
  .lf-draft {
    border-color: #6b7280;
    background: rgba(107, 114, 128, 0.12);
    color: var(--sl-color-white);
  }
  .lf-pending {
    border-color: #f59e0b;
    background: rgba(245, 158, 11, 0.12);
    color: var(--sl-color-white);
  }
  .lf-scheduled {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.12);
    color: var(--sl-color-white);
  }
  .lf-processing {
    border-color: #f59e0b;
    background: rgba(245, 158, 11, 0.12);
    color: var(--sl-color-white);
  }
  .lf-processed {
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.12);
    color: var(--sl-color-white);
  }
  .lf-failed {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.12);
    color: var(--sl-color-white);
  }
  .lf-arrow {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 4px 0;
    position: relative;
  }
  .lf-arrow::before {
    content: '';
    display: block;
    width: 2px;
    height: 18px;
    background: var(--sl-color-gray-3, #666);
  }
  .lf-arrow::after {
    content: '';
    display: block;
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 8px solid var(--sl-color-gray-3, #666);
  }
  .lf-arrow span {
    font-size: 0.75rem;
    color: var(--sl-color-gray-3, #888);
    margin-top: 2px;
    margin-bottom: 2px;
  }
  .lf-arrow-short {
    width: 2px;
    height: 18px;
    background: var(--sl-color-gray-3, #666);
  }
  .lf-branch {
    display: flex;
    gap: 2rem;
    width: 100%;
    justify-content: center;
    position: relative;
    margin-top: 0;
  }
  .lf-branch::before {
    content: '';
    position: absolute;
    top: 0;
    left: calc(50% - var(--branch-half, 120px));
    right: calc(50% - var(--branch-half, 120px));
    height: 2px;
    background: var(--sl-color-gray-3, #666);
  }
  .lf-branch-left,
  .lf-branch-right {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    flex: 1;
    max-width: 220px;
  }
  @media (max-width: 540px) {
    .lf-branch {
      flex-direction: column;
      align-items: center;
      gap: 0;
    }
    .lf-branch::before {
      display: none;
    }
    .lf-branch-left,
    .lf-branch-right {
      max-width: 100%;
    }
  }
`}</style>

:::tip[Key concepts]
- **Pending** — Media processing happens here (if you have media)
- **Processed** — Set immediately after publishing jobs are *initiated*, not after they complete
- **No "failed" post status** — Once `processed`, the post stays `processed` even if platforms fail (check platform statuses instead)
- **Media failure** — The only time a post fails at the post level is `media_processing_failed`
:::

---

## Three layers of status

Every post has three independent status layers. Understanding these is essential for building reliable integrations.

<CardGrid>
  <Card title="Post status" icon="document">
    Overall state of the post: `draft`, `pending`, `scheduled`, `processing`, `processed`, or `media_processing_failed`
  </Card>
  <Card title="Platform status" icon="rocket">
    Individual status for each social platform: `pending`, `processing`, `published`, `failed`, or `failed_waiting_for_retry`
  </Card>
  <Card title="Media status" icon="download">
    Processing state of each attachment: `pending`, `processed`, or `failed`
  </Card>
</CardGrid>

---

## Post states

### <Badge text="Draft" variant="note" size="large" /> Draft

Your post is saved but not scheduled for publication. It's a work in progress.

```json
{
  "status": "draft",
  "draft": true,
  "scheduled_at": null
}
```

**Next step:** Call `POST /api/posts/:id/publish` to publish immediately, or update the post with `scheduled_at` to schedule it.

**Can edit/delete:** Yes

---

### <Badge text="Pending" variant="caution" size="large" /> Pending

Your post has been created and media is being processed. The post is not yet ready for publication.

```json
{
  "status": "pending",
  "draft": false,
  "media": [
    { "status": "pending", "content_type": "image/jpeg" }
  ]
}
```

**What happens:**

<Steps>
1. Media files are downloaded from URLs or processed from uploads
2. Files are validated and prepared for each platform
3. Media status transitions: `pending` → `processed` or `failed`
</Steps>

**Next step:**
- All media processed successfully → status becomes `scheduled`
- Any media failed → status becomes `media_processing_failed`

**Typical duration:** Images 1–15 seconds. Videos 10–120 seconds depending on size.

**Can edit/delete:** Cannot edit. Can delete.

---

### <Badge text="Scheduled" variant="success" size="large" /> Scheduled

Your post is ready and queued for publication at the specified time. All media has been successfully processed.

```json
{
  "status": "scheduled",
  "draft": false,
  "scheduled_at": "2024-01-15T10:00:00Z",
  "media": [
    { "status": "processed", "url": "https://cdn.postproxy.dev/..." }
  ]
}
```

**Next step:** At the scheduled time, the system changes status to `processing`, initiates publishing jobs, and immediately transitions to `processed`.

**Can edit/delete:** Cannot edit. Can delete.

---

### <Badge text="Processing" variant="caution" size="large" /> Processing

A brief intermediate state while platform publishing jobs are being enqueued.

```json
{
  "status": "processing",
  "draft": false
}
```

**Duration:** Usually less than 1 second.

**Can edit/delete:** No

---

### <Badge text="Processed" variant="success" size="large" /> Processed

Platform publishing jobs have been **initiated**. The post is now in the hands of each platform's publishing system.

```json
{
  "status": "processed",
  "draft": false
}
```

:::caution
`status: "processed"` does **not** mean all platforms have successfully published. It means jobs have been started. Always check individual platform statuses for actual results.
:::

At the platform level, you may see various states:

```json
{
  "platforms": [
    { "network": "twitter", "status": "published" },
    { "network": "instagram", "status": "processing" },
    { "network": "youtube", "status": "failed" }
  ]
}
```

**Can edit/delete:** Cannot edit. Can delete from Postproxy (does not remove from social platforms).

---

### <Badge text="Media Processing Failed" variant="danger" size="large" /> Media Processing Failed

One or more media attachments failed to download or process. This is the **only** failure state at the post level.

```json
{
  "status": "media_processing_failed",
  "media": [
    {
      "id": "abc123",
      "status": "failed",
      "error_message": "Media file not found (404)",
      "source_url": "https://example.com/missing.jpg"
    }
  ]
}
```

**Recovery:** Create a new post with correct media URLs and delete the failed post.

---

## Platform-level states

Even if a post has `status: "processed"`, individual platforms can succeed or fail independently.

### Platform status flow

<div class="platform-flow">
  <span class="pf-node">pending</span>
  <span class="pf-sep">→</span>
  <span class="pf-node">processing</span>
  <span class="pf-sep">→</span>
  <span class="pf-node pf-success">published</span>
  <div class="pf-row-gap"></div>
  <span class="pf-indent"></span>
  <span class="pf-sep">↘</span>
  <span class="pf-node pf-danger">failed</span>
  <span class="pf-sep">→</span>
  <span class="pf-node pf-warn">failed_waiting_for_retry</span>
  <span class="pf-sep">→</span>
  <span class="pf-node">processing</span>
  <span class="pf-label">(retry)</span>
</div>

<style>{`
  .platform-flow {
    padding: 1.5rem 1.5rem;
    background: var(--sl-color-gray-6, #1a1a2e);
    border: 1px solid var(--sl-color-gray-5, #2a2a3e);
    border-radius: 10px;
    margin: 1rem 0;
    font-family: var(--sl-font-mono, monospace);
    font-size: 0.85rem;
    line-height: 2.2;
    overflow-x: auto;
    overflow-y: visible;
    white-space: nowrap;
    min-height: fit-content;
  }
  .pf-row-gap {
    display: block;
    height: 0.75rem;
  }
  :root[data-theme="light"] .platform-flow {
    background: var(--sl-color-gray-7, #f5f5f8);
    border-color: var(--sl-color-gray-5, #ddd);
  }
  .pf-node {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 5px;
    background: rgba(107, 114, 128, 0.15);
    border: 1px solid rgba(107, 114, 128, 0.3);
    color: var(--sl-color-white);
  }
  .pf-success {
    background: rgba(16, 185, 129, 0.15);
    border-color: rgba(16, 185, 129, 0.4);
  }
  .pf-danger {
    background: rgba(239, 68, 68, 0.15);
    border-color: rgba(239, 68, 68, 0.4);
  }
  .pf-warn {
    background: rgba(245, 158, 11, 0.15);
    border-color: rgba(245, 158, 11, 0.4);
  }
  .pf-sep {
    margin: 0 6px;
    color: var(--sl-color-gray-3, #888);
  }
  .pf-indent {
    display: inline-block;
    width: 8.5rem;
  }
  .pf-label {
    margin-left: 6px;
    color: var(--sl-color-gray-3);
    font-size: 0.8rem;
  }
`}</style>

### Status definitions

| Status | Meaning |
|--------|---------|
| `pending` | Waiting to be processed |
| `processing` | Currently publishing — active API call in progress |
| `published` | Successfully live on the social network |
| `failed` | Permanent failure — check `error_message` |
| `failed_waiting_for_retry` | Temporary failure, retry scheduled — see `retry_after` |

### Partial success example

Post to 3 platforms where 2 succeed and 1 fails:

```json
{
  "status": "processed",
  "platforms": [
    { "network": "twitter", "status": "published" },
    { "network": "linkedin", "status": "published" },
    {
      "network": "instagram",
      "status": "failed",
      "error_message": "Instagram account disconnected"
    }
  ]
}
```

---

## Retry behavior

Postproxy automatically retries transient failures so you don't have to.

<CardGrid>
  <Card title="Retried automatically" icon="approve-check">
    Network timeouts, temporary rate limits, platform API temporarily unavailable, quota errors
  </Card>
  <Card title="Not retried" icon="close">
    Invalid credentials, account disconnected, content policy violations, invalid media format
  </Card>
</CardGrid>

### Retry schedule

Retries use exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1st retry | 1 minute |
| 2nd retry | 5 minutes |
| 3rd retry | 15 minutes |
| 4th retry | 30 minutes |
| 5th retry | 60 minutes |

Maximum: **5 retry attempts**

### During a retry

```json
{
  "network": "twitter",
  "status": "failed_waiting_for_retry",
  "error_message": "Rate limit exceeded",
  "retry_attempts": 2,
  "retry_after": "2024-01-15T10:20:00Z"
}
```

---

## Media processing

When you include media in a post, it must be processed before publishing can begin.

### Media states

| Status | Meaning | Duration |
|--------|---------|----------|
| `pending` | Downloading/processing | 1–30 seconds |
| `processed` | Ready for publication | — |
| `failed` | Could not process | Check `error_message` |

### Processing timeline

| Media type | Typical duration |
|-----------|-----------------|
| Small image (< 1 MB) | 1–5 seconds |
| Large image (1–10 MB) | 5–15 seconds |
| Short video (< 100 MB) | 10–30 seconds |
| Large video (> 100 MB) | 30–120 seconds |

### Common media errors

| Error | Cause |
|-------|-------|
| `Media file not found (404)` | URL doesn't exist |
| `Access denied to media file (403)` | URL requires authentication |
| `Connection timed out` | Server too slow or unreachable |
| `Unsupported format` | File type not supported by platform |

:::note
If any media fails, the entire post is blocked. The post status becomes `media_processing_failed` and publishing does not start.
:::

---

## Webhook events

Subscribe to webhooks to receive real-time updates about your posts. See [Webhooks](/reference/webhooks/) for setup.

| Event | When it fires |
|-------|---------------|
| `post.processed` | Post finished processing, jobs initiated |
| `platform_post.published` | Individual platform published successfully |
| `platform_post.failed` | Individual platform failed |
| `platform_post.failed_waiting_for_retry` | Retry scheduled for a platform |
| `media.failed` | Media processing error |
| `platform_post.insights` | New analytics available |

### Example: post.processed

```json
{
  "event_type": "post.processed",
  "data": {
    "id": "abc123",
    "body": "Hello world!",
    "status": "processed",
    "platforms": [
      { "platform": "twitter", "status": "published" },
      { "platform": "instagram", "status": "published" }
    ]
  }
}
```

### Example: platform_post.failed

```json
{
  "event_type": "platform_post.failed",
  "data": {
    "id": "pp_456",
    "post_id": "abc123",
    "platform": "instagram",
    "status": "failed",
    "error": "Invalid credentials"
  }
}
```

---

## Common scenarios

### Scenario 1: Scheduled post (text only)

```bash
POST /api/posts
{
  "post": {
    "body": "Big announcement tomorrow!",
    "scheduled_at": "2024-01-16T09:00:00Z"
  },
  "profiles": ["twitter", "linkedin"]
}
```

<Steps>
1. Immediate response: `status: "scheduled"` (no media to process)
2. At scheduled time: `processing` → `processed` (jobs enqueued, < 1 second)
3. Platform jobs run asynchronously — Twitter and LinkedIn publish independently
</Steps>

---

### Scenario 2: Scheduled post (with media)

```bash
POST /api/posts
{
  "post": {
    "body": "Big announcement tomorrow!",
    "scheduled_at": "2024-01-16T09:00:00Z"
  },
  "profiles": ["instagram", "facebook"],
  "media": ["https://example.com/photo.jpg"]
}
```

<Steps>
1. Immediate response: `status: "pending"`, media `status: "pending"`
2. Media processing: 5–15 seconds
3. Media processed → post becomes `scheduled`
4. At scheduled time: `processing` → `processed` (jobs initiated)
5. Platform jobs run asynchronously
</Steps>

---

### Scenario 3: Immediate publish

```bash
POST /api/posts
{
  "post": { "body": "Live now!" },
  "profiles": ["twitter"]
}
```

<Steps>
1. System sets `scheduled_at` to current time
2. Status: `scheduled` → `processing` → `processed` (< 1 second)
3. Twitter platform job runs (1–5 seconds)
</Steps>

**Total time:** 2–10 seconds

---

### Scenario 4: Draft workflow

```bash
# Step 1: Create draft
POST /api/posts
{
  "post": { "body": "Work in progress", "draft": true },
  "profiles": ["twitter"]
}
# Response: status: "draft"
```

```bash
# Step 2: Publish when ready (hours or days later)
POST /api/posts/abc123/publish
# Response: status: "processing"
```

The draft stays in `draft` status with no automatic publishing until you explicitly call `/publish`.

---

### Scenario 5: Partial platform failure

<Steps>
1. Post status: `processing` → `processed` (< 1 second)
2. Platform jobs run independently:
   - Twitter: published (2 sec)
   - LinkedIn: published (3 sec)
   - Instagram: **failed** — account disconnected (4 sec)
3. Post remains `processed` — platform statuses show mixed results
</Steps>

**After platforms finish:**

```json
{
  "status": "processed",
  "platforms": [
    { "network": "twitter", "status": "published" },
    { "network": "linkedin", "status": "published" },
    {
      "network": "instagram",
      "status": "failed",
      "error_message": "Instagram account disconnected"
    }
  ]
}
```

**Recovery:** Fix Instagram connection in your dashboard, then create a new post for Instagram if needed.

---

### Scenario 6: Automatic retry

<Steps>
1. Post status: `processing` → `processed` (job initiated)
2. Twitter API returns rate limit error
3. Platform status: `failed_waiting_for_retry`
4. System waits 1 minute, retries automatically
5. Twitter publishes successfully
</Steps>

**During retry:**
```json
{
  "status": "processed",
  "platforms": [{
    "network": "twitter",
    "status": "failed_waiting_for_retry",
    "retry_after": "2024-01-15T10:01:00Z"
  }]
}
```

---

## Timeline reference

| Phase | Duration | Notes |
|-------|----------|-------|
| Post creation | < 1 sec | Post created with initial status |
| Media processing (images) | 1–15 sec | Post in `pending` status |
| Media processing (video) | 10–120 sec | Depends on file size |
| Scheduling | Instant | Post → `scheduled` after media ready |
| Job initiation | < 1 sec | `processing` → `processed` |
| Platform publishing (text) | 1–5 sec | Per platform |
| Platform publishing (images) | 5–15 sec | Per platform |
| Platform publishing (video) | 10–60 sec | Per platform |
| Retries | 1–60 min | Exponential backoff, max 5 attempts |
| First insights | 1+ hour | After platform reports `published` |
| Insight updates | 2–12 hours | Varies by platform |

### Platform-specific notes

- **TikTok** — May take 1–5 minutes for video processing on their end
- **YouTube** — Large videos may take longer to upload
- **Instagram / Twitter / Facebook / LinkedIn** — Usually fastest (1–10 seconds)

---

## Filtering posts by status

Use the `status` query parameter to filter posts:

```bash
GET /api/posts?status=draft
GET /api/posts?status=scheduled
GET /api/posts?status=published
GET /api/posts?status=failed
```

| Filter | What you get |
|--------|--------------|
| `draft` | All draft posts |
| `scheduled` | Posts scheduled for the future |
| `published` | Successfully published posts (`status: "processed"`) |
| `failed` | Posts with at least one failed platform |

---

## Best practices

<CardGrid>
  <Card title="Check platform statuses" icon="information">
    `processed` means jobs started, not completed. Always check individual platform statuses for actual publishing state.
  </Card>
  <Card title="Handle retries gracefully" icon="approve-check">
    Don't alert users on first failure. Check for `failed_waiting_for_retry` and wait for automatic retries before reporting permanent failures.
  </Card>
  <Card title="Use webhooks" icon="rocket">
    Instead of polling the API, subscribe to webhook events for instant notifications and fewer API calls.
  </Card>
  <Card title="Plan for partial failures" icon="warning">
    Posts can partially succeed — some platforms publish while others fail. Handle this in your UI and allow users to retry failed platforms.
  </Card>
</CardGrid>

---

## Related

- [Posts API Reference](/reference/posts/) — Endpoint details for creating and managing posts
- [Platform Parameters](/reference/platform-parameters/) — Platform-specific options
- [Webhooks](/reference/webhooks/) — Webhook setup and event types

---

# sdks

PostProxy provides official SDKs for 7 languages. Each SDK wraps the REST API with idiomatic methods, type definitions, and built-in error handling.

## Installation

<Tabs>
  <TabItem label="Node">
    <Code code="npm install postproxy-sdk" lang="bash" />
  </TabItem>
  <TabItem label="Python">
    <Code code="pip install postproxy-sdk" lang="bash" />
  </TabItem>
  <TabItem label="Go">
    <Code code="go get github.com/postproxy/postproxy-go" lang="bash" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code="gem install postproxy-sdk" lang="bash" />
  </TabItem>
  <TabItem label="PHP">
    <Code code="composer require postproxy/postproxy-php" lang="bash" />
  </TabItem>
  <TabItem label="Java">
    <Code code={`// Gradle
implementation 'dev.postproxy:postproxy-java:1.+'

// Maven
<dependency>
  <groupId>dev.postproxy</groupId>
  <artifactId>postproxy-java</artifactId>
  <version>1.+</version>
</dependency>`} lang="groovy" />
  </TabItem>
  <TabItem label=".NET">
    <Code code="dotnet add package PostProxy" lang="bash" />
  </TabItem>
</Tabs>

## Initialization

<Tabs>
  <TabItem label="Node">
    <Code code={`import PostProxy from "postproxy-sdk";

const client = new PostProxy("YOUR_API_KEY");`} lang="typescript" />
  </TabItem>
  <TabItem label="Python">
    <Code code={`from postproxy import PostProxy

client = PostProxy("YOUR_API_KEY")`} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={`import postproxy "github.com/postproxy/postproxy-go"

client := postproxy.New("YOUR_API_KEY")`} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={`require "postproxy"

client = PostProxy::Client.new("YOUR_API_KEY")`} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={`use PostProxy\\PostProxy;

$client = new PostProxy("YOUR_API_KEY");`} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={`import dev.postproxy.PostProxy;

PostProxy client = new PostProxy("YOUR_API_KEY");`} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={`using PostProxy;

var client = new PostProxyClient("YOUR_API_KEY");`} lang="csharp" />
  </TabItem>
</Tabs>

## Available SDKs

| Language | Package | GitHub |
|----------|---------|--------|
| Node / TypeScript | [`postproxy-sdk`](https://www.npmjs.com/package/postproxy-sdk) | [postproxy/postproxy-node](https://github.com/postproxy/postproxy-node) |
| Python | [`postproxy-sdk`](https://pypi.org/project/postproxy-sdk/) | [postproxy/postproxy-python](https://github.com/postproxy/postproxy-python) |
| Go | `postproxy-go` | [postproxy/postproxy-go](https://github.com/postproxy/postproxy-go) |
| Ruby | [`postproxy-sdk`](https://rubygems.org/gems/postproxy-sdk) | [postproxy/postproxy-ruby](https://github.com/postproxy/postproxy-ruby) |
| PHP | [`postproxy/postproxy-php`](https://packagist.org/packages/postproxy/postproxy-php) | [postproxy/postproxy-php](https://github.com/postproxy/postproxy-php) |
| Java | [`dev.postproxy:postproxy-java`](https://central.sonatype.com/artifact/dev.postproxy/postproxy-java) | [postproxy/postproxy-java](https://github.com/postproxy/postproxy-java) |
| .NET | [`PostProxy`](https://www.nuget.org/packages/PostProxy/) | [postproxy/postproxy-dotnet](https://github.com/postproxy/postproxy-dotnet) |

## Features

| Feature | Node | Python | Go | Ruby | PHP | Java | .NET |
|---------|------|--------|----|------|-----|------|------|
| Typed responses | ✓ | ✓ | ✓ | — | — | ✓ | ✓ |
| Async support | ✓ | ✓ | ✓ | — | — | ✓ | ✓ |
| File uploads | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Profile group scoping | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

All SDKs support passing a `profileGroupId` (or equivalent) at the client level or per-request.

---

# Quickstart

Postproxy creates your first profile group automatically when you sign up. Connect your social media accounts through the dashboard, then you're ready to make API calls.

## Step 1: Get your profiles

First, retrieve your connected profiles to get their IDs.


<Tabs>
  <TabItem label="cURL">
    <Code code={getProfilesBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={getProfilesJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={getProfilesPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={getProfilesGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={getProfilesRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={getProfilesPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={getProfilesJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={getProfilesCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={getProfilesResult} lang="json" />

Note the profile IDs and platform types - you'll use these when creating posts.

## Step 2: Create a post

Post content to one or more profiles. You can specify profiles by their ID or by platform name (uses the first profile for that platform).


<Tabs>
  <TabItem label="cURL">
    <Code code={postNowBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={postNowJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={postNowPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={postNowGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={postNowRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={postNowPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={postNowJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={postNowCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={postNowResult} lang="json" />

Your post will be published to the specified platforms almost immediately.

## Step 3: Schedule a post (optional)

To schedule a post for later, add `scheduled_at` with an ISO 8601 timestamp.


<Tabs>
  <TabItem label="cURL">
    <Code code={postLaterBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={postLaterJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={postLaterPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={postLaterGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={postLaterRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={postLaterPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={postLaterJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={postLaterCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={postLaterResult} lang="json" />

Postproxy handles the scheduling - your post will be published at the specified time.

## Next steps

- [Posts API Reference](/reference/posts/) - Full documentation for creating and managing posts
- [Platform Parameters](/reference/platform-parameters/) - Platform-specific options and media constraints
- [Profiles API Reference](/reference/profiles/) - Managing connected profiles

---

# Examples

Ready-to-use examples for the most common API workflows. Each example includes code in 8 languages with full request and response samples. You can also download all examples as a ready-to-run collection for [Bruno](https://www.usebruno.com/): [postproxy/postproxy-api-collection](https://github.com/postproxy/postproxy-api-collection).

---

## List posts

Fetch a paginated list of your posts.


<Tabs>
  <TabItem label="cURL">
    <Code code={listPostsBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={listPostsJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={listPostsPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={listPostsGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={listPostsRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={listPostsPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={listPostsJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={listPostsCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={listPostsResult} lang="json" />

See [Posts API Reference](/reference/posts/#list-posts) for all query parameters including filtering by status, platform, and schedule date.

---

## Get a single post

Retrieve full details for a post including media, platform results, and insights.


<Tabs>
  <TabItem label="cURL">
    <Code code={getPostBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={getPostJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={getPostPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={getPostGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={getPostRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={getPostPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={getPostJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={getPostCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={getPostResult} lang="json" />

---

## Create a post

Publish a simple post with an image to a single platform.


<Tabs>
  <TabItem label="cURL">
    <Code code={createPostBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={createPostJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={createPostPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={createPostGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={createPostRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={createPostPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={createPostJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={createPostCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={createPostResult} lang="json" />

---

## Update a post

Modify an existing draft or scheduled post. You can update the body, profiles, media, or any other field. Only send the fields you want to change — everything else stays the same.


<Tabs>
  <TabItem label="cURL">
    <Code code={updatePostBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={updatePostJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={updatePostPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={updatePostGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={updatePostRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={updatePostPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={updatePostJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={updatePostCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={updatePostResult} lang="json" />

Only draft posts and scheduled posts (more than 5 minutes before publish time) can be updated. When sending `profiles` or `media`, the existing values are fully replaced. See [Update post](/reference/posts/#update-post) for full details on update behavior.

---

## Create a post with a local file

Instead of passing media URLs, you can upload files directly from your computer. Use `multipart/form-data` with form fields `post[body]`, `profiles[]`, and `media[]`. This example uses an image from `~/Downloads`:


<Tabs>
  <TabItem label="cURL">
    <Code code={createPostFileBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={createPostFileJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={createPostFilePython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={createPostFileGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={createPostFileRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={createPostFilePhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={createPostFileJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={createPostFileCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={createPostFileResult} lang="json" />

Replace the file path with your own — for example, `$HOME/Downloads/your-image.png` on macOS/Linux or `%USERPROFILE%\Downloads\your-image.png` on Windows.

---

## Cover Images

Some platforms (Instagram Reels, YouTube, Pinterest) support a cover image. Postproxy downloads and stores cover images to ensure they're available at publish time, even if the original URL becomes unavailable.

- **`cover_url`** (string) — URL of the image. Postproxy downloads and stores it.
- **`cover_file`** — File upload (multipart) or base64-encoded image (data URI or `{"base64": "...", "content_type": "image/png"}`).

Use `cover_url` when sending `platforms` as JSON, `cover_file` when sending as multipart form fields or base64.

**JSON example** (cover as URL):

```json
{
  "platforms": {
    "youtube": {
      "privacy_status": "public",
      "cover_url": "https://example.com/thumbnail.jpg"
    }
  }
}
```

**JSON example** (cover as base64):

```json
{
  "platforms": {
    "youtube": {
      "privacy_status": "public",
      "cover_file": {
        "base64": "iVBORw0KGgo...",
        "content_type": "image/png",
        "filename": "thumbnail.png"
      }
    }
  }
}
```

**Multipart example** (cover as file upload):

```bash
curl -X POST https://api.postproxy.dev/api/posts \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "post[body]=My post" \
  -F "profiles[]=youtube" \
  -F "media[]=@video.mp4" \
  -F "platforms[youtube][privacy_status]=public" \
  -F "platforms[youtube][title]=My Video" \
  -F "platforms[youtube][cover_file]=@thumbnail.jpg"
```

When sending platform parameters as form fields, string values are automatically cast to their expected types (e.g. `"false"` → `false`, `"22"` → `22`).

**Multipart with `platforms` as a JSON string:** if you'd rather keep `platforms` as a single JSON blob alongside your multipart media uploads, that also works. Nested values keep their original types (no casting needed), and you can still reference uploaded files by path:

```bash
curl -X POST https://api.postproxy.dev/api/posts \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F 'post[body]=Hello world from API!' \
  -F 'post[draft]=true' \
  -F 'media[]=@/path/to/video.mp4' \
  -F 'profiles[]=youtube' \
  -F 'platforms={"youtube":{"made_for_kids":false,"privacy_status":"public","title":"My Video","tags":["launch","product"],"category_id":"22"}}'
```

---

## Cross-post to multiple platforms

Post a video to YouTube, TikTok, and Instagram simultaneously with platform-specific parameters for each.


<Tabs>
  <TabItem label="cURL">
    <Code code={crossPostBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={crossPostJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={crossPostPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={crossPostGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={crossPostRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={crossPostPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={crossPostJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={crossPostCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={crossPostResult} lang="json" />

Each platform gets its own `params` — YouTube gets a title and privacy setting, TikTok gets its privacy status, and Instagram is published as a reel with a first comment. See [Platform Parameters](/reference/platform-parameters/) for all available options.

---

## Create a thread

Post a multi-part thread to X (Twitter) and Threads. Each item in the `thread` array becomes a reply to the previous post. Thread children can also include media.


<Tabs>
  <TabItem label="cURL">
    <Code code={threadPostBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={threadPostJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={threadPostPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={threadPostGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={threadPostRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={threadPostPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={threadPostJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={threadPostCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={threadPostResult} lang="json" />

:::note
Threads are only supported on X (Twitter) and Threads. The array order determines the posting sequence. Per-platform chains run independently — a failure on X does not block the Threads chain.
:::

---

## Schedule a post

Set `scheduled_at` with an ISO 8601 timestamp to publish a post at a specific time. Postproxy handles the scheduling automatically.


<Tabs>
  <TabItem label="cURL">
    <Code code={scheduledPostBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={scheduledPostJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={scheduledPostPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={scheduledPostGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={scheduledPostRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={scheduledPostPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={scheduledPostJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={scheduledPostCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={scheduledPostResult} lang="json" />

The post status is `scheduled` and `attempted_at` is `null` until the scheduled time arrives.

---

## Create a draft and publish later

Set `draft: true` to create a post without publishing it. Review the content, then publish it with a separate API call when ready.


**Step 1:** Create the draft.

<Tabs>
  <TabItem label="cURL">
    <Code code={draftPostBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={draftPostJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={draftPostPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={draftPostGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={draftPostRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={draftPostPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={draftPostJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={draftPostCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={draftPostResult} lang="json" />

**Step 2:** Publish when ready.

```bash
curl -X POST "https://api.postproxy.dev/api/posts/drf456abc/publish" \
     -H "Authorization: Bearer YOUR_API_KEY"
```

The SDK examples above show both steps. See [Publish post](/reference/posts/#publish-post) for details.

---

## Get post stats

Retrieve engagement metrics (impressions, likes, comments, etc.) for one or more posts. Stats are collected periodically and returned as time-series snapshots. You can filter by platform and date range.


<Tabs>
  <TabItem label="cURL">
    <Code code={postStatsBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={postStatsJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={postStatsPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={postStatsGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={postStatsRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={postStatsPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={postStatsJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={postStatsCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={postStatsResult} lang="json" />

The `stats` fields vary by platform. See [Stats fields by platform](/reference/posts/#stats-fields-by-platform) for the full breakdown.

---

## Get profiles

List all connected social media profiles in your account.


<Tabs>
  <TabItem label="cURL">
    <Code code={listProfilesBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={listProfilesJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={listProfilesPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={listProfilesGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={listProfilesRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={listProfilesPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={listProfilesJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={listProfilesCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={listProfilesResult} lang="json" />

Use the `id` from the response when creating posts with specific profiles. You can also use platform names like `"twitter"` as a shorthand — Postproxy will pick the first connected profile for that platform.

---

## Connect a new profile

Use the Initialize Connection endpoint to generate an OAuth URL for connecting a new social media account. Redirect the user to the returned URL — after they authenticate, they'll be sent back to your `redirect_url` and the profile is created automatically.


<Tabs>
  <TabItem label="cURL">
    <Code code={initConnBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={initConnJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={initConnPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={initConnGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={initConnRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={initConnPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={initConnJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={initConnCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={initConnResult} lang="json" />

Redirect the user to the `url` in the response. Supported platforms: `facebook`, `instagram`, `tiktok`, `linkedin`, `youtube`, `twitter`, `threads`, `pinterest`. See [Initialize Connection](/reference/profile-groups/#initialize-connection) for full details.

---

## List comments on a post

Fetch comments on a published post, including nested replies. Currently supported on Instagram and Facebook, with Threads, YouTube, and LinkedIn coming very soon.


<Tabs>
  <TabItem label="cURL">
    <Code code={listCommentsBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={listCommentsJs} lang="js" />
  </TabItem>
  <TabItem label="Go">
    <Code code={listCommentsGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={listCommentsRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={listCommentsPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={listCommentsJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={listCommentsCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={listCommentsResult} lang="json" />

Each top-level comment includes a `replies` array with all nested replies. See [Comments API Reference](/reference/comments/#list-comments) for pagination and filtering options.

---

## Create a comment

Post a comment on a published post. The comment is stored immediately and published to the platform asynchronously.


<Tabs>
  <TabItem label="cURL">
    <Code code={createCommentBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={createCommentJs} lang="js" />
  </TabItem>
  <TabItem label="Go">
    <Code code={createCommentGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={createCommentRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={createCommentPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={createCommentJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={createCommentCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={createCommentResult} lang="json" />

The comment starts with `status: "pending"` and updates to `"published"` once it's live on the platform.

---

## Reply to a comment

Reply to an existing comment by passing `parent_id`. Works the same as creating a comment, but nests the reply under the specified parent.


<Tabs>
  <TabItem label="cURL">
    <Code code={replyCommentBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={replyCommentJs} lang="js" />
  </TabItem>
  <TabItem label="Go">
    <Code code={replyCommentGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={replyCommentRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={replyCommentPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={replyCommentJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={replyCommentCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={replyCommentResult} lang="json" />

You can also hide, unhide, like, unlike, and delete comments. See the [Comments API Reference](/reference/comments/) for all available actions.

---

# overview

The Postproxy API allows you to programmatically create and manage social media posts across multiple platforms including Facebook, Instagram, TikTok, LinkedIn, YouTube, X (Twitter), Threads, Pinterest, Bluesky, Telegram, and Google Business.

## Base URL

All API requests should be made to:

```
https://api.postproxy.dev
```

## Authentication

All API requests require authentication using a Bearer token in the `Authorization` header.

```http
Authorization: Bearer your_api_key_here
```

### API Key Types

| Type | Scope | Capabilities |
|------|-------|--------------|
| Full Access | Entire account | Access all profile groups, create/delete profile groups |
| Profile Group Scoped | Single profile group | Access only the specified profile group, cannot create/delete profile groups |

### Profile Group Context

API requests operate within a profile group context. The profile group is determined by:

1. **Explicit parameter**: Pass `?profile_group_id=<id>` as a query parameter
2. **API key scope**: If your API key is scoped to a profile group, that group is used automatically
3. **Default**: If neither is specified and the key has full access, the first profile group in your account is used

## Response Format

All responses are JSON. IDs are returned as string IDs.

### Successful Responses

**Single resource:**

```json
{
  "id": "abc123xyz",
  "name": "My Profile Group",
  "profiles_count": 3
}
```

**Collection with pagination:**

```json
{
  "total": 150,
  "page": 0,
  "per_page": 10,
  "data": [
    { "id": "..." },
    { "id": "..." }
  ]
}
```

### Error Responses

| Code | Response |
|------|----------|
| `401` | `{"error": "Invalid API key"}` |
| `404` | `{"error": "Not found"}` |
| `400` | `{"status": 400, "error": "Bad Request", "message": "..."}` |
| `422` | `{"errors": ["Validation error message"]}` |

## HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200 OK` | Request succeeded |
| `201 Created` | Resource was created successfully |
| `400 Bad Request` | Missing required parameters |
| `401 Unauthorized` | Invalid, missing, or insufficient API key permissions |
| `404 Not Found` | Resource does not exist or is not accessible |
| `422 Unprocessable Entity` | Validation failed |

## Pagination

List endpoints support pagination with the following query parameters:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `0` | Page number (zero-indexed) |
| `per_page` | integer | `10` | Number of items per page |

## API Resources

| Resource | Description |
|----------|-------------|
| [Posts](/reference/posts/) | Create, list, and delete posts |
| [Queues](/reference/queues/) | Manage posting queues with recurring timeslots and priority |
| [Profiles](/reference/profiles/) | List connected social media profiles |
| [Profile Groups](/reference/profile-groups/) | Manage profile groups |
| [Comments](/reference/comments/) | Read and reply to comments on published posts |
| [Profile Comments](/reference/profile-comments/) | Read and reply to profile-scoped comments (Google Business reviews) |
| [Webhooks](/reference/webhooks/) | Subscribe to post events |
| [Calendar](/reference/calendar/) | View scheduled posts calendar |

## Supported Platforms

| Platform | Platform ID | Available Formats |
|----------|------------|-------------------|
| Facebook | `facebook` | `post`, `story` |
| Instagram | `instagram` | `post`, `reel`, `story` |
| TikTok | `tiktok` | `post` |
| LinkedIn | `linkedin` | `post` |
| YouTube | `youtube` | `post` (channel video) |
| X (Twitter) | `twitter` | `post` |
| Threads | `threads` | `post` |
| Pinterest | `pinterest` | `pin` |
| Bluesky | `bluesky` | `post` |
| Telegram | `telegram` | `post` (publishes to channels via [bring-your-own-bot](/guides/telegram-byo-bot/)) |
| Google Business | `google_business` | `standard`, `event`, `offer` (local posts to Business Profile locations; replies to reviews via [Profile Comments](/reference/profile-comments/)) |

---

# posts

The Posts API allows you to create, retrieve, update, and delete social media posts across multiple platforms.

:::note
All calls require authentication.
:::

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/posts` | List all posts |
| `GET` | `/api/posts/:id` | Get a single post |
| `GET` | `/api/posts/stats` | Get stats snapshots for posts |
| `POST` | `/api/posts` | Create a new post |
| `PATCH` | `/api/posts/:id` | Update an existing post |
| `POST` | `/api/posts/:id/publish` | Publish a draft post |
| `DELETE` | `/api/posts/:id` | Delete a post |
| `POST` | `/api/posts/:id/delete_on_platform` | Delete a post from social media platforms |

---

## List posts

<span class="method get">GET</span> `/api/posts`

Retrieves a paginated list of all posts in the current profile group. Thread children are not returned as top-level items — only parent posts appear. Use the Get Post endpoint to retrieve thread children for a specific post.

### Query parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `page` | integer | No | `0` | Page number (zero-indexed) |
| `per_page` | integer | No | `10` | Number of posts per page |
| `profile_group_id` | string | No | - | Filter by profile group (id) |
| `status` | string | No | - | Filter by status: `draft`, `scheduled`, `published`, `failed` |
| `platforms` | array | No | - | Array of platforms (e.g., `platforms[]=instagram&platforms[]=tiktok`) |
| `source` | string | No | - | Filter by source: `postproxy` (created via app or API) or `imported` (imported from a connected platform) |
| `scheduled_after` | string | No | - | ISO 8601 date to filter posts scheduled after that date |

### Example


<Tabs>
  <TabItem label="cURL">
    <Code code={listPostsBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={listPostsJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={listPostsPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={listPostsGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={listPostsRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={listPostsPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={listPostsJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={listPostsCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={listPostsResult} lang="json" />

### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `total` | integer | Total number of posts |
| `page` | integer | Current page number |
| `per_page` | integer | Items per page |
| `data` | array | Array of post objects |

---

## Get post

<span class="method get">GET</span> `/api/posts/:id`

Retrieves a single post by its ID.

### Path parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | Yes | Post id |

### Query parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `profile_group_id` | string | No | Scope the lookup to a specific profile group |

### Example


<Tabs>
  <TabItem label="cURL">
    <Code code={getPostBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={getPostJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={getPostPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={getPostGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={getPostRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={getPostPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={getPostJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={getPostCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={getPostResult} lang="json" />

### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique post identifier (id) |
| `body` | string | Post body/text content |
| `status` | string | Post status: `processing`, `processed`, `scheduled` |
| `source` | string | Origin of the post: `postproxy` (created via app or API) or `imported` (imported from a connected platform) |
| `scheduled_at` | string\|null | ISO 8601 timestamp if scheduled, null otherwise |
| `created_at` | string | ISO 8601 timestamp of creation |
| `queue_id` | string\|null | Queue ID if the post belongs to a queue |
| `queue_priority` | string\|null | Priority level (`high`, `medium`, `low`) if in a queue |
| `media` | array | Array of media attachment objects |
| `platforms` | array | Array of platform-specific posting results |
| `thread` | array | Array of thread child posts (only present for thread posts) |

### Media object fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique attachment identifier (id) |
| `status` | string | Processing status: `pending`, `processed`, `failed` |
| `error_message` | string\|null | Error details if processing failed |
| `content_type` | string | MIME type (e.g. `image/jpeg`, `video/mp4`) |
| `source_url` | string\|null | Original source URL if media was provided as a URL |
| `url` | string\|null | Hosted URL of the processed file (null if not yet processed) |
| `platforms` | array | Per-platform formatting/upload errors for this attachment. Only included when at least one platform had an error processing this specific media file. Omitted when there are no platform-level errors |

### Media platform object fields

Each entry in a media `platforms` array describes a platform-specific error for that attachment (e.g. format/aspect ratio rejected on Instagram, file size too large on Twitter):

| Field | Type | Description |
|-------|------|-------------|
| `platform` | string | Network identifier (`instagram`, `twitter`, etc.) |
| `status` | string | Per-platform attachment status |
| `error` | string | Error summary for this attachment on this platform |
| `error_details` | object\|null | Structured platform error (omitted when no platform error info is available) |
| `error_details.platform_error_code` | string\|null | Error code returned by the platform API |
| `error_details.platform_error_subcode` | string\|null | Error subcode returned by the platform API |
| `error_details.platform_error_message` | string\|null | Error message returned by the platform API |
| `error_details.postproxy_note` | string\|null | Additional context from Postproxy about the error |

### Thread child fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (id) of the child post |
| `body` | string | Text content of the child post |
| `media` | array | Array of media attachment objects (same structure as above) |

### Platform object fields

| Field | Type | Description |
|-------|------|-------------|
| `platform` | string | Platform identifier: `facebook`, `instagram`, `tiktok`, `linkedin`, `youtube`, `twitter`, `threads`, `pinterest` |
| `status` | string | Platform posting status: `processing`, `published`, `failed`, `pending_deletion`, `deleted` |
| `params` | object\|null | Platform-specific parameters used for this post |
| `error` | string\|null | Error summary (null on success) |
| `error_details` | object\|null | Structured error details from the platform (null when no platform error info is available) |
| `error_details.platform_error_code` | string\|null | Error code returned by the platform API |
| `error_details.platform_error_subcode` | string\|null | Error subcode returned by the platform API |
| `error_details.platform_error_message` | string\|null | Error message returned by the platform API |
| `error_details.postproxy_note` | string\|null | Additional context from Postproxy about the error |
| `attempted_at` | string\|null | ISO 8601 timestamp of posting attempt |
| `insights` | object | Engagement metrics (when available) |
| `permalink` | string\|null | Direct URL to the published post on the platform. Null if not published or permalink is unavailable |
| `insights.impressions` | integer | Number of impressions/views |
| `insights.on` | string | ISO 8601 timestamp when insights were captured |

---

## Post stats

<span class="method get">GET</span> `/api/posts/stats`

Retrieves stats snapshots for one or more posts. Returns all matching snapshots (not just the latest) so you can see trends over time. Supports filtering by profiles/networks and timespan.

For thread posts, stats from all posts in the thread (parent + children) are included under the parent post's ID. This means you get aggregated platform-level stats across the entire thread in a single request.

### Query parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `post_ids` | string | Yes | Comma-separated list of post ids (max 50) |
| `profiles` | string | No | Comma-separated list of profile ids or platform names (e.g. `instagram,twitter` or `abc123,def456` or mixed) |
| `from` | string | No | ISO 8601 timestamp — only include snapshots recorded at or after this time |
| `to` | string | No | ISO 8601 timestamp — only include snapshots recorded at or before this time |

Platform names are matched against known platforms (`facebook`, `instagram`, `tiktok`, `linkedin`, `youtube`, `twitter`, `threads`, `pinterest`). Anything else is treated as a profile id.

### Example


<Tabs>
  <TabItem label="cURL">
    <Code code={statsBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={statsJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={statsPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={statsGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={statsRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={statsPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={statsJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={statsCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={statsResult} lang="json" />

### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `data` | object | Keyed by post id |
| `data.<post_id>.platforms` | array | Array of platform objects for this post |
| `platforms[].profile_id` | string | Profile id |
| `platforms[].platform` | string | Platform name (`instagram`, `twitter`, etc.) |
| `platforms[].records` | array | Snapshots ordered by `recorded_at` ascending |
| `records[].stats` | object | Platform-specific metrics (varies by platform) |
| `records[].recorded_at` | string | ISO 8601 timestamp when the snapshot was captured |

### Stats fields by platform

| Platform | Fields |
|----------|--------|
| Instagram | `impressions`, `likes`, `comments`, `saved`, `profile_visits`, `follows` |
| Facebook | `impressions`, `clicks`, `likes` |
| Threads | `impressions`, `likes`, `replies`, `reposts`, `quotes`, `shares` |
| Twitter | `impressions`, `likes`, `retweets`, `comments`, `quotes`, `saved` |
| YouTube | `impressions`, `likes`, `comments`, `saved` |
| LinkedIn | `impressions` |
| TikTok | `impressions`, `likes`, `comments`, `shares` |
| Pinterest | `impressions`, `likes`, `comments`, `saved`, `outbound_clicks` |

:::note
Instagram stories do not return stats. TikTok stats require the post to have a public ID.
:::

### Error responses

**Missing post_ids parameter (400):**
```json
{
  "status": 400,
  "error": "Bad Request",
  "message": "param is missing or the value is empty: post_ids"
}
```

---

## Create post

<span class="method post">POST</span> `/api/posts`

Creates a new post and publishes it to the specified platforms.

### Request body

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `post[body]` | string | No* | Text content of the post |
| `post[scheduled_at]` | string | No | ISO 8601 timestamp to schedule the post |
| `post[draft]` | boolean | No | If `true`, creates a draft that won't publish until reviewed |
| `profiles` | array | Yes | Array of profile IDs or platform names |
| `media` | array | No* | Array of media URLs or file uploads |
| `platforms` | object | No | Platform-specific parameters |
| `thread` | array | No | Array of thread child posts (see [Threads](#threads)) |
| `profile_group_id` | string | No | Profile group ID |
| `queue_id` | string | No | Queue ID — adds the post to a queue (see [Queues](/reference/queues/)) |
| `queue_priority` | string | No | Queue priority: `high`, `medium` (default), or `low` |

*Some platforms require media (Instagram, TikTok, YouTube). Some platforms require text content.

### Draft posts

Set `draft: true` to create a post that won't be published automatically. Draft posts can be reviewed and then published using the [Publish endpoint](#publish-post).

```json
{
  "post": {
    "body": "Content to review before posting",
    "draft": true
  },
  "profiles": ["instagram"]
}
```

### Profiles parameter

The `profiles` array accepts either:

- **Platform names**: `"twitter"`, `"instagram"`, `"facebook"`, etc. - Uses the first connected profile for that platform
- **Profile IDs**: Hashid of a specific profile

### Media parameter

You can provide media in two ways:

**Option 1: URLs (JSON request)**

Pass URLs to images or videos that Postproxy will download:

```json
{
  "media": [
    "https://example.com/image1.jpg",
    "https://example.com/image2.png"
  ]
}
```

**Option 2: File upload (multipart form)**

Upload files directly using `multipart/form-data`:


<Tabs>
  <TabItem label="cURL">
    <Code code={uploadPostBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={uploadPostJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={uploadPostPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={uploadPostGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={uploadPostRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={uploadPostPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={uploadPostJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={uploadPostCsharp} lang="csharp" />
  </TabItem>
</Tabs>

When using file upload, use form field names with brackets: `post[body]`, `profiles[]`, `media[]`.

### Platform-specific parameters

Pass platform-specific options in the `platforms` object. See [Platform Parameters](/reference/platform-parameters/) for all available options.

```json
{
  "platforms": {
    "instagram": {
      "format": "reel",
      "first_comment": "Check the link in bio!"
    },
    "youtube": {
      "title": "My Video Title",
      "privacy_status": "public"
    }
  }
}
```

### Example


<Tabs>
  <TabItem label="cURL">
    <Code code={createPostBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={createPostJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={createPostPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={createPostGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={createPostRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={createPostPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={createPostJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={createPostCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Request body (JSON):

<Code code={JSON.stringify(createPostRequestBody, null, 2)} lang="json" />

Response (201 Created):

<Code code={createPostResult} lang="json" />

### Error responses

**Missing profiles parameter (400):**
```json
{
  "status": 400,
  "error": "Bad Request",
  "message": "param is missing or the value is empty: Missing profiles parameter"
}
```

**Validation errors (422):**
```json
{
  "errors": [
    "Post profiles must have at least one profile selected",
    "Media is required for feed post on Instagram"
  ]
}
```

---

## Update post

<span class="method patch">PATCH</span> `/api/posts/:id`

Updates an existing post. Only draft posts and scheduled posts (more than 5 minutes before their publish time) can be updated.

All parameters are optional — only send the fields you want to change. Fields you omit are left unchanged.

### Path parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | Yes | Post id |

### Request body

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `post[body]` | string | No | Updated text content |
| `post[scheduled_at]` | string | No | Updated ISO 8601 schedule timestamp |
| `post[draft]` | boolean | No | Set or unset draft status |
| `profiles` | array | No | Replace all profiles (array of profile IDs or network names) |
| `platforms` | object | No | Update platform-specific parameters |
| `media` | array | No | Replace all media (array of media URLs or file uploads) |
| `thread` | array | No | Replace all thread children |
| `queue_id` | string | No | Assign the post to a queue |
| `queue_priority` | string | No | Queue priority: `high`, `medium`, or `low` |
| `profile_group_id` | string | No | Scope the lookup to a specific profile group |

### Update behavior

Each parameter has specific update semantics:

**`post` (body, scheduled_at, draft)** — Merged with existing values. Only the fields you include are changed.

**`profiles`** — **Full replace.** When sent, all existing profile assignments are removed and replaced with the new set. If omitted, existing profiles are kept. Accepts the same values as create (profile IDs or network names).

**`platforms`** — **Merged with existing params.** When sent without `profiles`, the platform parameters are merged into the existing profile assignments. For example, sending `{"platforms": {"youtube": {"privacy_status": "unlisted"}}}` updates the YouTube privacy status without changing other params or profiles. When sent together with `profiles`, platform params are applied to the new profile set (same as create).

**`media`** — **Full replace.** When sent, all existing media attachments are destroyed and replaced with the new set. Send an empty array `[]` to remove all media. If omitted, existing media is kept.

**`thread`** — **Full replace.** When sent, all existing thread children are destroyed and rebuilt from the new array. Send an empty array `[]` to remove all thread children. If omitted, existing thread is kept. Thread children automatically inherit the parent's profiles, scheduling, and draft status.

### Example


<Tabs>
  <TabItem label="cURL">
    <Code code={updatePostBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={updatePostJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={updatePostPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={updatePostGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={updatePostRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={updatePostPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={updatePostJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={updatePostCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Request body (JSON):

<Code code={JSON.stringify(updatePostRequestBody, null, 2)} lang="json" />

Response (200 OK):

<Code code={updatePostResult} lang="json" />

### Error responses

**Post not editable (422):**
```json
{
  "error": "Post cannot be edited (only drafts or scheduled posts more than 5 minutes before publish time)"
}
```

**Profile not found (422):**
```json
{
  "error": "Profile not found for invalid_id"
}
```

**Invalid platform params (422):**
```json
{
  "error": "Invalid platform params for youtube: bad_key. Allowed: title, privacy_status, format"
}
```

**Post not found (404):**
```json
{
  "error": "Not found"
}
```

---

## Delete post

<span class="method delete">DELETE</span> `/api/posts/:id`

Deletes a post from the database. By default, this does not remove the post from social media platforms. Pass `delete_on_platform: true` to also delete the post from platforms before removing it from the database.

### Path parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | Yes | Post id |

### Query parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `delete_on_platform` | boolean | No | `false` | If `true`, also deletes the post from all published platforms before removing it from the database |
| `profile_group_id` | string | No | - | Scope the lookup to a specific profile group |

### Example


<Tabs>
  <TabItem label="cURL">
    <Code code={deletePostBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={deletePostJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={deletePostPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={deletePostGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={deletePostRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={deletePostPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={deletePostJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={deletePostCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={deletePostResult} lang="json" />

---

## Delete on platform

<span class="method post">POST</span> `/api/posts/:id/delete_on_platform`

Deletes a published post from one or more social media platforms without removing it from the database. The deletion happens asynchronously via a background job.

Optionally provide `post_profile_id`, `profile_id`, or `network` to target specific platform(s). If no parameter is provided, the post is deleted from all published platforms. When using `post_profile_id`, the deletion covers all post profiles for the same profile across the entire thread (parent + children).

### Supported platforms

Platform deletion is supported on: **Facebook**, **Threads**, **X (Twitter)**, **LinkedIn**, **Pinterest**, **YouTube**.

Platform deletion is **not** supported on: **Instagram**, **TikTok**.

### Path parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | Yes | Post id |

### Request body

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `post_profile_id` | string | No | ID of a specific post profile. Resolves to the underlying profile and deletes across the entire thread |
| `profile_id` | string | No | ID of a profile. Deletes all post profiles for this profile on the post |
| `network` | string | No | Network name (e.g. `twitter`, `facebook`). Deletes all post profiles for this network on the post |
| `profile_group_id` | string | No | Scope the lookup to a specific profile group |

If none of these parameters are provided, the post is deleted from all published platforms.

### Example: Delete from all platforms

```bash
curl -X POST "https://api.postproxy.dev/api/posts/abc123xyz/delete_on_platform" \
  -H "Authorization: Bearer your_api_key"
```

### Example: By network

```bash
curl -X POST "https://api.postproxy.dev/api/posts/abc123xyz/delete_on_platform" \
  -H "Authorization: Bearer your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"network": "twitter"}'
```

### Example: By profile id

```bash
curl -X POST "https://api.postproxy.dev/api/posts/abc123xyz/delete_on_platform" \
  -H "Authorization: Bearer your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"profile_id": "prof_abc123"}'
```

### Example: By post profile id

```bash
curl -X POST "https://api.postproxy.dev/api/posts/abc123xyz/delete_on_platform" \
  -H "Authorization: Bearer your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"post_profile_id": "pp_abc123"}'
```

### Response (200 OK)

```json
{
  "success": true,
  "deleting": [
    {
      "post_profile_id": "pp_abc123",
      "platform": "twitter"
    }
  ]
}
```

### Error responses

**No eligible profiles (422):**

```json
{
  "error": "No profiles eligible for deletion: platform deletion is not supported for instagram"
}
```

**Post not found (404):**

```json
{
  "error": "Not found"
}
```

---

## Publish post

<span class="method post">POST</span> `/api/posts/:id/publish`

Publishes a draft post. Only posts with `status: "draft"` can be published using this endpoint.

### Path parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | Yes | Post id |

### Query parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `profile_group_id` | string | No | Scope the lookup to a specific profile group |

### Example


<Tabs>
  <TabItem label="cURL">
    <Code code={publishPostBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={publishPostJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={publishPostPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={publishPostGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={publishPostRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={publishPostPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={publishPostJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={publishPostCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={publishPostResult} lang="json" />

### Error responses

**Post not found (404):**
```json
{
  "error": "Not found"
}
```

**Post is not a draft (422):**
```json
{
  "error": "Post is not a draft"
}
```

---

## Post statuses

### Post-level status

| Status | Description |
|--------|-------------|
| `draft` | Post is saved but not published, awaiting review |
| `processing` | Post is being published to platforms |
| `processed` | All platform publishing attempts completed |
| `scheduled` | Post is scheduled for future publishing |
| `media_processing_failed` | One or more media attachments failed to process |

### Platform-level status

| Status | Description |
|--------|-------------|
| `processing` | Currently being published to this platform |
| `published` | Successfully published |
| `failed` | Publishing failed (check error message) |
| `pending_deletion` | Deletion from platform is in progress |
| `deleted` | Successfully deleted from platform |

---

## Threads

Threads allow you to create a sequence of posts that are published as replies to each other, forming a conversation thread on supported platforms.

### Supported platforms

Threads are only supported on:

- **X (Twitter)** — each post is published as a reply to the previous tweet
- **Threads** — each post is published as a reply to the previous Threads post

Attempting to create a thread with other platforms (Instagram, Facebook, LinkedIn, etc.) will return a `422` error.

### How threads work

1. The parent post (`post[body]`) is published first on each platform
2. Each child post in the `thread` array is published sequentially as a reply to the previous post
3. Per-platform chains are independent — the X chain and Threads chain run in parallel
4. Position is determined by the array order (first item = first reply, etc.)

### Thread parameter

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `body` | string | Yes | Text content for this thread post |
| `media` | array | No | Array of media URLs (same format as top-level `media`) |

### Error handling

- If a post in the thread chain fails, subsequent posts in that chain will **wait** (they are not published)
- Each platform chain is independent — a failure on X does not block the Threads chain

---

# queues

The Queues API lets you create and manage posting queues. Queues automatically schedule posts into recurring weekly timeslots, with priority-based ordering.

:::note
All calls require authentication.
:::

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/post_queues` | List all queues |
| `GET` | `/api/post_queues/:id` | Get a single queue |
| `GET` | `/api/post_queues/:id/next_slot` | Get next available timeslot |
| `POST` | `/api/post_queues` | Create a new queue |
| `PATCH` | `/api/post_queues/:id` | Update a queue |
| `DELETE` | `/api/post_queues/:id` | Delete a queue |

---

## Concepts

### Timeslots

Each queue has a set of weekly timeslots that define when posts are published. A timeslot is a combination of a day of the week (0=Sunday through 6=Saturday) and a time in 24-hour `HH:MM` format. Times are interpreted in the queue's timezone.

### Priority

Posts added to a queue have a priority level that determines scheduling order:

| Priority | Description |
|----------|-------------|
| `high` | Scheduled first — gets the earliest available slot |
| `medium` | Default priority |
| `low` | Scheduled last — fills remaining slots |

Within the same priority level, posts are ordered by creation time (oldest first).

### Dynamic rearrangement

The queue automatically rearranges all scheduled posts when:

- A new post is added to the queue
- A post is removed from the queue
- Timeslots are added or removed
- The queue's timezone is changed
- The queue is unpaused

### Jitter

Queues support a `jitter` parameter (0–60 minutes) that randomly shifts each post's scheduled time by +/- the specified number of minutes. This makes posting patterns look more natural and less automated.

For example, with `jitter: 10` and a timeslot at `09:00`, posts will be scheduled anywhere between `08:50` and `09:10`.

Jitter is applied when the queue is arranged — when posts are added, removed, or when queue settings change.

### Pausing

When a queue is paused (`enabled: false`), posts in the queue will **not** be published even if their scheduled time arrives. When the queue is unpaused, all posts (including those that became past-due while paused) are rearranged into future timeslots.

---

## List queues

<span class="method get">GET</span> `/api/post_queues`

Retrieves all queues for the current account.

### Query parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `profile_group_id` | string | No | Filter by profile group (ID) |

### Example

```bash
curl -X GET "https://api.postproxy.dev/api/post_queues" \
  -H "Authorization: Bearer your_api_key"
```

### Response

```json
{
  "data": [
    {
      "id": "q1abc",
      "name": "Morning Posts",
      "description": "Daily morning content",
      "timezone": "America/New_York",
      "enabled": true,
      "jitter": 10,
      "profile_group_id": "pg123",
      "timeslots": [
        { "id": 1, "day": 1, "time": "09:00" },
        { "id": 2, "day": 3, "time": "09:00" },
        { "id": 3, "day": 5, "time": "14:00" }
      ],
      "posts_count": 5
    }
  ]
}
```

---

## Get queue

<span class="method get">GET</span> `/api/post_queues/:id`

Retrieves a single queue by its ID.

### Example

```bash
curl -X GET "https://api.postproxy.dev/api/post_queues/q1abc" \
  -H "Authorization: Bearer your_api_key"
```

### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Queue identifier (ID) |
| `name` | string | Queue name |
| `description` | string\|null | Optional description |
| `timezone` | string | IANA timezone name (e.g. `America/New_York`) |
| `enabled` | boolean | Whether the queue is active |
| `jitter` | integer | Random offset in minutes (+/-) applied to scheduled times (0–60, default: 0) |
| `profile_group_id` | string | Associated profile group (ID) |
| `timeslots` | array | Weekly timeslot definitions |
| `posts_count` | integer | Number of currently scheduled posts |

### Timeslot fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | integer | Timeslot ID (used for deletion) |
| `day` | integer | Day of the week: `0`=Sunday, `1`=Monday, ..., `6`=Saturday |
| `time` | string | Time in 24-hour `HH:MM` format |

---

## Get next slot

<span class="method get">GET</span> `/api/post_queues/:id/next_slot`

Returns the next available timeslot for the queue.

### Example

```bash
curl -X GET "https://api.postproxy.dev/api/post_queues/q1abc/next_slot" \
  -H "Authorization: Bearer your_api_key"
```

### Response

```json
{
  "next_slot": "2026-03-11T14:00:00Z"
}
```

### Error response

**No timeslots configured (422):**
```json
{
  "error": "No available slots found. Add timeslots to your queue."
}
```

---

## Create queue

<span class="method post">POST</span> `/api/post_queues`

Creates a new posting queue connected to a profile group.

### Request body

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `profile_group_id` | string | Yes | Profile group ID to connect the queue to |
| `post_queue[name]` | string | Yes | Queue name |
| `post_queue[description]` | string | No | Optional description |
| `post_queue[timezone]` | string | No | IANA timezone (default: `UTC`) |
| `post_queue[jitter]` | integer | No | Random offset in minutes (0–60, default: `0`) |
| `post_queue[queue_timeslots_attributes]` | array | No | Initial timeslots |

### Example

```bash
curl -X POST "https://api.postproxy.dev/api/post_queues" \
  -H "Authorization: Bearer your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "profile_group_id": "pg123",
    "post_queue": {
      "name": "Morning Posts",
      "description": "Weekday morning content",
      "timezone": "America/New_York",
      "queue_timeslots_attributes": [
        { "day": 1, "time": "09:00" },
        { "day": 2, "time": "09:00" },
        { "day": 3, "time": "09:00" },
        { "day": 4, "time": "09:00" },
        { "day": 5, "time": "09:00" }
      ]
    }
  }'
```

### Response (201 Created)

Returns the created queue object (same format as [Get Queue](#get-queue)).

---

## Update queue

<span class="method post">PATCH</span> `/api/post_queues/:id`

Updates a queue's settings, timeslots, or enabled state. Any changes to timezone or timeslots will trigger a rearrangement of all queued posts.

### Request body

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `post_queue[name]` | string | No | Queue name |
| `post_queue[description]` | string | No | Description |
| `post_queue[timezone]` | string | No | IANA timezone |
| `post_queue[enabled]` | boolean | No | Pause (`false`) or unpause (`true`) the queue |
| `post_queue[jitter]` | integer | No | Random offset in minutes (0–60) |
| `post_queue[queue_timeslots_attributes]` | array | No | Add/remove timeslots |

### Managing timeslots

**Add a timeslot:**
```json
{
  "post_queue": {
    "queue_timeslots_attributes": [
      { "day": 2, "time": "10:00" }
    ]
  }
}
```

**Remove a timeslot** (pass `id` and `_destroy: true`):
```json
{
  "post_queue": {
    "queue_timeslots_attributes": [
      { "id": 42, "_destroy": true }
    ]
  }
}
```

### Example: Pause a queue

```bash
curl -X PATCH "https://api.postproxy.dev/api/post_queues/q1abc" \
  -H "Authorization: Bearer your_api_key" \
  -H "Content-Type: application/json" \
  -d '{ "post_queue": { "enabled": false } }'
```

### Example: Change timezone

```bash
curl -X PATCH "https://api.postproxy.dev/api/post_queues/q1abc" \
  -H "Authorization: Bearer your_api_key" \
  -H "Content-Type: application/json" \
  -d '{ "post_queue": { "timezone": "America/Los_Angeles" } }'
```

:::note
All queued posts will be rearranged to match the new timezone's timeslots.
:::

### Response

Returns the updated queue object.

---

## Delete queue

<span class="method delete">DELETE</span> `/api/post_queues/:id`

Deletes a queue. Posts that were in the queue will have their queue reference removed but will not be deleted.

### Example

```bash
curl -X DELETE "https://api.postproxy.dev/api/post_queues/q1abc" \
  -H "Authorization: Bearer your_api_key"
```

### Response (200 OK)

```json
{
  "deleted": true
}
```

---

## Adding posts to a queue

To add a post to a queue, pass the `queue_id` parameter when creating a post via the [Posts API](/reference/posts/):

```bash
curl -X POST "https://api.postproxy.dev/api/posts" \
  -H "Authorization: Bearer your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "post": {
      "body": "Queued post content"
    },
    "profiles": ["twitter", "linkedin"],
    "queue_id": "q1abc",
    "queue_priority": "high"
  }'
```

### Queue parameters on post creation

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `queue_id` | string | Yes | - | Queue ID |
| `queue_priority` | string | No | `medium` | Priority: `high`, `medium`, or `low` |

The post will be assigned to the next available timeslot. After saving, the queue is rearranged so that higher-priority posts get earlier slots.

### Response fields on queued posts

Posts created via a queue include additional fields:

| Field | Type | Description |
|-------|------|-------------|
| `queue_id` | string | Queue ID the post belongs to |
| `queue_priority` | string | Priority level: `high`, `medium`, or `low` |
| `scheduled_at` | string | Assigned timeslot (ISO 8601) |

:::caution
Do not pass `scheduled_at` together with `queue_id` — the queue determines the scheduled time automatically.
:::

---

# profiles

The Profiles API allows you to retrieve and manage connected social media profiles. Profiles represent authenticated connections to social media platforms.

:::note
All calls require authentication.
:::

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/profiles` | List all profiles |
| `GET` | `/api/profiles/:id` | Get a single profile (with latest stats) |
| `GET` | `/api/profiles/:id/placements` | List placements for a profile |
| `GET` | `/api/profiles/:id/stats` | Get profile stats timeseries |
| `DELETE` | `/api/profiles/:id` | Delete/disconnect a profile |

---

## Profile object

A profile represents a connected social media account.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique profile identifier (id) |
| `name` | string | Display name of the connected account |
| `status` | string | Platform connection status: `active`, `expired`, `inactive` (might be disconnected or suspended on a platform) |
| `platform` | string | Platform identifier |
| `profile_group_id` | string | ID of the profile group this belongs to |
| `expires_at` | string\|null | ISO 8601 timestamp when the connection expires (if applicable) |
| `post_count` | integer | Number of posts made through this profile |
| `avatar_url` | string\|null | URL to the profile's avatar image (resized, hosted by Postproxy). `null` if not yet downloaded |

### Platform values

| Platform | Account type |
|---------|----------|
| `facebook` | Facebook Page |
| `instagram` | Instagram Business/Creator Account |
| `tiktok` | TikTok Account |
| `linkedin` | LinkedIn Profile or Company Page |
| `youtube` | YouTube Channel |
| `twitter` | X (Twitter) Account |
| `threads` | Threads Account |
| `pinterest` | Pinterest Account |
| `bluesky` | Bluesky Account |
| `telegram` | Telegram Bot (publishes to channels via [placements](#list-placements)) |

---

## List profiles

<span class="method get">GET</span> `/api/profiles`

Retrieves all profiles in the current profile group.

### Query parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `profile_group_id` | string | No | - | Filter by profile group (id) |

### Example


<Tabs>
  <TabItem label="cURL">
    <Code code={listProfilesBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={listProfilesJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={listProfilesPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={listProfilesGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={listProfilesRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={listProfilesPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={listProfilesJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={listProfilesCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={listProfilesResult} lang="json" />

---

## Get profile

<span class="method get">GET</span> `/api/profiles/:id`

Retrieves a single profile by its ID. The response includes the profile fields plus the latest stats snapshot per placement and (for placement networks) a `summary_stats` rollup.

For non-placement networks (e.g. `bluesky`, `twitter`), `latest_stats` contains a single entry with `placement_id: null` and `summary_stats` is `null`.

Snapshots are typically refreshed every 23 hours per profile. If `latest_stats` is empty, the profile has been connected but has not yet been polled for stats.

### Path parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | Yes | Profile id |

### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `latest_stats` | array | Latest snapshot per placement. One entry for non-placement networks (with `placement_id: null`). Empty array if no snapshots have been recorded yet. |
| `latest_stats[].placement_id` | string\|null | Platform-specific placement ID. `null` for non-placement networks. |
| `latest_stats[].stats` | object | Platform-specific metrics. See [Stats fields by network](#stats-fields-by-network). |
| `latest_stats[].recorded_at` | string | ISO 8601 timestamp when the snapshot was captured. |
| `summary_stats` | object\|null | For placement networks: numeric values summed across the latest snapshot of every placement. `null` for non-placement networks and when no snapshots exist. Non-numeric values (e.g. `channel_title`) are omitted from the summary. |
| `summary_stats.stats` | object | Summed metrics. |
| `summary_stats.recorded_at` | string | ISO 8601 timestamp of the most recent placement snapshot included in the summary. |

### Example


<Tabs>
  <TabItem label="cURL">
    <Code code={getProfileBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={getProfileJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={getProfilePython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={getProfileGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={getProfileRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={getProfilePhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={getProfileJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={getProfileCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={getProfileResult} lang="json" />

---

## List placements

<span class="method get">GET</span> `/api/profiles/:id/placements`

Retrieves the available placements for a profile. For Facebook profiles, placements are business pages. For LinkedIn profiles, placements include the personal profile and organizations. For Pinterest profiles, placements are boards. For Telegram profiles, placements are the channels the bot has been added to.

This endpoint is available for `facebook`, `linkedin`, `pinterest`, and `telegram` profiles.

If no placement is specified when creating a post:
- **LinkedIn**: defaults to the personal profile
- **Facebook**: defaults to a random connected page — if only one page is connected, there is no need to set a placement ID
- **Pinterest**: it fails
- **Telegram**: it fails — `chat_id` is always required

For Telegram, each placement is a channel the bot has been added to. The placement `id` is the Telegram `chat_id` you pass as `chat_id` when creating a post. The list is empty until the user adds the bot as administrator to a channel — Telegram pushes a `my_chat_member` event for each one and we record it. Poll this endpoint after connecting Telegram until the expected channels appear.

### Path parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | Yes | Profile id |

### Placement object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string\|null | Platform-specific placement ID. `null` for personal profile (LinkedIn) |
| `name` | string | Display name of the placement |

### Example


<Tabs>
  <TabItem label="cURL">
    <Code code={listPlacementsBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={listPlacementsJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={listPlacementsPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={listPlacementsGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={listPlacementsRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={listPlacementsPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={listPlacementsJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={listPlacementsCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={listPlacementsResult} lang="json" />

---

## Profile stats

<span class="method get">GET</span> `/api/profiles/:id/stats`

Retrieves the full stats timeseries for a profile. Mirrors [Post Stats](/reference/posts/#post-stats) in shape (`records[].stats + recorded_at`) — use this to plot follower growth and engagement trends over time.

Snapshots are captured roughly every 23 hours. For networks with multiple placements (Facebook pages, LinkedIn organizations, Telegram channels), each placement has its own timeseries — `placement_id` is **required** so the response is scoped to a single placement.

### Path parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | Yes | Profile id |

### Query parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `placement_id` | string | Conditional | **Required** for `facebook`, `linkedin`, and `telegram` profiles. The platform-specific ID returned by [List placements](#list-placements). Omit (or ignored) for other networks. |
| `from` | string | No | ISO 8601 timestamp — only include snapshots recorded at or after this time. |
| `to` | string | No | ISO 8601 timestamp — only include snapshots recorded at or before this time. |

### Example


<Tabs>
  <TabItem label="cURL">
    <Code code={getStatsBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={getStatsJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={getStatsPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={getStatsGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={getStatsRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={getStatsPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={getStatsJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={getStatsCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={getStatsResult} lang="json" />

### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `data.profile_id` | string | Profile ID. |
| `data.platform` | string | Network name (`facebook`, `linkedin`, `bluesky`, etc.). |
| `data.placement_id` | string\|null | The placement filter that was applied (echo of the request). `null` for non-placement networks. |
| `data.records` | array | Snapshots ordered by `recorded_at` ascending. |
| `records[].stats` | object | Platform-specific metrics. See [Stats fields by network](#stats-fields-by-network). |
| `records[].recorded_at` | string | ISO 8601 timestamp when the snapshot was captured. |

### Error responses

**Missing `placement_id` for a placement network (400):**

```json
{
  "error": "placement_id is required for linkedin profiles"
}
```

**Profile not found (404):**

```json
{
  "error": "Not found"
}
```

---

## Stats fields by network

The `stats` object's keys come straight from each platform's API — they are not normalized into a common schema, so each network exposes a different set.

| Network | Placement-scoped? | Typical fields |
|---------|-------------------|----------------|
| `facebook` | Yes (per page) | `fan_count`, `followers_count`, plus daily page insights (e.g. `page_impressions`, `page_views_total`, `page_fan_adds`, `page_fan_removes`) |
| `linkedin` | Yes (per organization) | `followerCount`, `shareCount`, `likeCount`, `commentCount`, `clickCount`, `engagement`, `allPageViews`, `overviewPageViews`, `aboutPageViews`, `careersPageViews`, `peoplePageViews`, `insightsPageViews` |
| `telegram` | Yes (per channel) | `followers_count`, `channel_title`, `channel_username` |
| `instagram` | No | `followers_count`, `follows_count`, `media_count`, `reach`, `profile_views`, `accounts_engaged`, `total_interactions`, `website_clicks`, `follower_count` |
| `threads` | No | `followers_count`, `views`, `likes`, `replies`, `reposts`, `quotes` |
| `youtube` | No | `subscriberCount`, `viewCount`, `videoCount` |
| `twitter` | No | `followers_count`, `following_count`, `tweet_count`, `listed_count`, `like_count` |
| `tiktok` | No | `follower_count`, `following_count`, `likes_count`, `video_count` |
| `pinterest` | No | `follower_count`, `following_count`, `pin_count`, `board_count`, `monthly_views`, `analytics_30d` (nested 30-day rollup) |
| `bluesky` | No | `followersCount`, `followsCount`, `postsCount` |

Notes:
- LinkedIn page-view metrics are filtered down to the rollups (we drop redundant mobile/desktop splits and dead sections like `productsPageViews` / `lifeAtPageViews`).
- Non-numeric fields (e.g. Telegram's `channel_title`) appear in `latest_stats[].stats` but are omitted from `summary_stats.stats`, which sums numeric values only.
- A stats key only appears in a snapshot if the platform returned a value for it on that polling cycle, so fields can come and go between records.

---

## Delete profile

<span class="method delete">DELETE</span> `/api/profiles/:id`

Disconnects and removes a profile from the account. This does not affect posts already published through this profile.

### Path parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | Yes | Profile id |

### Example


<Tabs>
  <TabItem label="cURL">
    <Code code={deleteProfileBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={deleteProfileJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={deleteProfilePython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={deleteProfileGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={deleteProfileRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={deleteProfilePhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={deleteProfileJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={deleteProfileCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={deleteProfileResult} lang="json" />

---

## Token expiration

Some platforms issue access tokens that expire. The `expires_at` field indicates when the connection will expire and require re-authentication.

| Behavior | Description |
|----------|-------------|
| `expires_at: null` | Token does not expire or has a refresh token |
| `expires_at: "2024-..."` | Token expires at the specified time |

When a token expires:
- Posts to that profile will fail
- The user needs to reconnect the profile through the web dashboard
- Use the [Initialize Connection](/reference/profile-groups/#initialize-connection) endpoint to generate a new connection URL

---

## Connecting new profiles

Profiles cannot be created directly via the API. To connect a new social media account:

1. Use the [Initialize Connection](/reference/profile-groups/#initialize-connection) endpoint to get an OAuth URL
2. Redirect the user to that URL to authenticate
3. User is redirected back to your `redirect_url` after authentication
4. The profile is automatically created and associated with the profile group

---

## Using profiles in posts

When creating posts, reference profiles by:

1. **Profile ID**: Use the `id` id directly
2. **Platform name**: Use the platform string (e.g., `"twitter"`) to automatically select the profile for that platform

```json
{
  "profiles": ["prof123abc", "twitter", "linkedin"]
}
```

If multiple profiles exist for the same platform in a profile group, using the platform name selects the first one. Use the profile ID for explicit selection.

---

# profile-groups

Profile Groups are organizational containers that group related social media profiles together. For example, you might have separate profile groups for different brands, clients, or projects.

:::note
All calls require authentication.
:::

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/profile_groups` | List all profile groups |
| `GET` | `/api/profile_groups/:id` | Get a single profile group |
| `POST` | `/api/profile_groups` | Create a new profile group |
| `DELETE` | `/api/profile_groups/:id` | Delete a profile group |
| `POST` | `/api/profile_groups/:id/initialize_connection` | Get OAuth URL to connect a profile |

---

## Profile group object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique profile group identifier (id) |
| `name` | string | Display name of the profile group |
| `profiles_count` | integer | Number of connected profiles in this group |

---

## List profile groups

<span class="method get">GET</span> `/api/profile_groups`

Retrieves all profile groups accessible with your API key.

### API key behavior

| API Key Type | Returns |
|--------------|---------|
| Full account access | All profile groups in the account |
| Profile group scoped | Only the scoped profile group |

### Example


<Tabs>
  <TabItem label="cURL">
    <Code code={listGroupsBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={listGroupsJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={listGroupsPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={listGroupsGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={listGroupsRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={listGroupsPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={listGroupsJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={listGroupsCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={listGroupsResult} lang="json" />

---

## Get profile group

<span class="method get">GET</span> `/api/profile_groups/:id`

Retrieves a single profile group by its ID.

### Path parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | Yes | Profile group id |

### Example


<Tabs>
  <TabItem label="cURL">
    <Code code={getGroupBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={getGroupJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={getGroupPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={getGroupGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={getGroupRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={getGroupPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={getGroupJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={getGroupCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={getGroupResult} lang="json" />

---

## Create profile group

<span class="method post">POST</span> `/api/profile_groups`

Creates a new profile group.

:::caution
This endpoint requires a **full account access** API key. Profile group scoped API keys cannot create new profile groups.
:::

### Request body

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `profile_group[name]` | string | Yes | Name for the new profile group |

### Example


<Tabs>
  <TabItem label="cURL">
    <Code code={createGroupBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={createGroupJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={createGroupPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={createGroupGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={createGroupRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={createGroupPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={createGroupJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={createGroupCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response (201 Created):

<Code code={createGroupResult} lang="json" />

### Error responses

**Permission denied (scoped API key) (422):**
```json
{
  "error": "Your API key has no such permission"
}
```

---

## Delete profile group

<span class="method delete">DELETE</span> `/api/profile_groups/:id`

Deletes a profile group and all its associated profiles.

:::caution
This endpoint requires a **full account access** API key. Profile group scoped API keys cannot delete profile groups.
:::

### Path parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | Yes | Profile group id |

### Example


<Tabs>
  <TabItem label="cURL">
    <Code code={deleteGroupBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={deleteGroupJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={deleteGroupPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={deleteGroupGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={deleteGroupRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={deleteGroupPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={deleteGroupJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={deleteGroupCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={deleteGroupResult} lang="json" />

---

## Initialize connection

<span class="method post">POST</span> `/api/profile_groups/:id/initialize_connection`

Generates a URL to connect a new social media profile to a profile group. This is used to initiate the OAuth flow for connecting social accounts as if it was inside your service.

:::note
**Bluesky** uses an app-password flow instead of OAuth. The payload is different — see [Connect Bluesky (App Password)](#connect-bluesky-app-password) below.

**Telegram** uses a bring-your-own-bot flow. The payload is different and channel discovery is asynchronous — see [Connect Telegram (Bring Your Own Bot)](#connect-telegram-bring-your-own-bot) below.
:::

### Path parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | string | Yes | Profile group id |

### Request body

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `platform` | string | Yes | Platform to connect |
| `redirect_url` | string | Yes (except `bluesky`, `telegram`) | URL to redirect to after OAuth completes |
| `identifier` | string | Yes for `bluesky` | Bluesky handle (e.g. `yourname.bsky.social`) |
| `app_password` | string | Yes for `bluesky` | Bluesky app password (generate at bsky.app/settings/app-passwords) |
| `bot_token` | string | Yes for `telegram` | Telegram bot token from [@BotFather](https://t.me/BotFather) |

### Supported platforms

| Platform | Account type | Auth type |
|---------|--------------|-----------|
| `facebook` | Facebook Page | OAuth |
| `instagram` | Instagram Business/Creator Account | OAuth |
| `tiktok` | TikTok Account | OAuth |
| `linkedin` | LinkedIn Profile | OAuth |
| `youtube` | YouTube Channel | OAuth |
| `twitter` | X (Twitter) Account | OAuth |
| `threads` | Threads Account | OAuth |
| `pinterest` | Pinterest Account | OAuth |
| `bluesky` | Bluesky Account | App password (no OAuth) |
| `telegram` | Telegram Channels (via bot) | Bring-your-own-bot (no OAuth) |

### Example


<Tabs>
  <TabItem label="cURL">
    <Code code={initConnBash} lang="bash" />
  </TabItem>
  <TabItem label="Node">
    <Code code={initConnJs} lang="js" />
  </TabItem>
  <TabItem label="Python">
    <Code code={initConnPython} lang="python" />
  </TabItem>
  <TabItem label="Go">
    <Code code={initConnGo} lang="go" />
  </TabItem>
  <TabItem label="Ruby">
    <Code code={initConnRuby} lang="ruby" />
  </TabItem>
  <TabItem label="PHP">
    <Code code={initConnPhp} lang="php" />
  </TabItem>
  <TabItem label="Java">
    <Code code={initConnJava} lang="java" />
  </TabItem>
  <TabItem label=".NET">
    <Code code={initConnCsharp} lang="csharp" />
  </TabItem>
</Tabs>

Response:

<Code code={initConnResult} lang="json" />

### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | URL to redirect the user to for OAuth authentication |
| `success` | boolean | Whether the invitation was created successfully |

### OAuth flow

1. Call this endpoint to get the connection URL
2. Redirect the user to the returned `url`
3. User authenticates with the social platform
4. User is redirected to your `redirect_url` after completion
5. A new profile is created in the specified profile group

If the user cancels or the OAuth flow fails, the user is redirected to your `redirect_url` with `?failure=true` and an `error_code` appended as query parameters. Any existing query parameters on your `redirect_url` are preserved.

| Error Code | Description |
|------------|-------------|
| `user_abandoned` | The user cancelled or dismissed the OAuth flow |
| `account_is_already_connected` | The social account is already connected to another profile |
| `update_failed` | Failed to update a previously disconnected profile during reconnection |

**Example:** If your `redirect_url` is `https://myapp.com/callback?org=123`, a cancelled connection redirects to `https://myapp.com/callback?org=123&failure=true&error_code=user_abandoned`.

### Error responses

**Missing redirect_url (422):**
```json
{
  "error": "Missing redirect_url"
}
```

**Missing platform (422):**
```json
{
  "error": "Missing platform"
}
```

**Platform already connected (422):**
```json
{
  "error": "Platform already connected"
}
```

---

## Connect Bluesky (App Password)

Bluesky does not support OAuth in the same way other platforms do. Instead of returning a redirect URL, the API authenticates synchronously with the user's Bluesky handle and an app password, then creates the profile in one call.

<span class="method post">POST</span> `/api/profile_groups/:id/initialize_connection`

### Request body

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `platform` | string | Yes | Must be `"bluesky"` |
| `identifier` | string | Yes | Bluesky handle. The `.bsky.social` suffix is added automatically if missing. Custom domains (e.g. `you.example.com`) are accepted as-is. |
| `app_password` | string | Yes | Bluesky **app password**, not the account password. Users generate one at https://bsky.app/settings/app-passwords |

:::caution
Always use an app password, never the user's main login password. Accounts protected by 2FA will reject the main password and return an error explaining that an app password is required.
:::

### Example

```bash
curl -X POST "https://api.postproxy.dev/api/profile_groups/grp123abc/initialize_connection" \
  -H "Authorization: Bearer your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "bluesky",
    "identifier": "yourname.bsky.social",
    "app_password": "xxxx-xxxx-xxxx-xxxx"
  }'
```

Response:

```json
{
  "success": true,
  "profile": {
    "id": "prof321zyx",
    "network": "bluesky",
    "name": "Your Display Name",
    "external_username": "yourname.bsky.social"
  }
}
```

### Error responses

**Missing credentials (422):**
```json
{
  "error": "Bluesky requires `identifier` (handle) and `app_password` in the payload. Generate an app password at https://bsky.app/settings/app-passwords",
  "error_code": "missing_credentials"
}
```

**Invalid credentials / 2FA required (401):**
```json
{
  "error": "This account requires 2FA. Generate an app password at bsky.app/settings/app-passwords and use that instead of your main password.",
  "error_code": "bluesky_login_failed"
}
```

**Account already connected to another profile group (422):**
```json
{
  "error": "This Bluesky profile is already connected to Postproxy.",
  "error_code": "account_is_already_connected"
}
```

---

## Connect Telegram (Bring Your Own Bot)

Telegram does not expose consumer OAuth for posting. Instead, the user creates their own bot via [@BotFather](https://t.me/BotFather) and adds it as administrator to the channel(s) they want to publish to. Postproxy uses that bot's token to publish.

A single Telegram `Profile` represents one bot. The channels it can publish to are exposed via the [placements](/reference/profiles/#list-placements) endpoint, and the destination channel for each post is selected per-post via the `chat_id` parameter — see [platform parameters](/reference/platform-parameters/#telegram).

For a step-by-step walkthrough (creating the bot, adding it to channels, publishing the first post), see the [Connect Telegram with your own bot](/guides/telegram-byo-bot/) guide.

### Three-step flow

1. **Submit the bot token** with this endpoint to create a `Profile`. Postproxy validates the token and registers a webhook with Telegram.
2. **User adds the bot as administrator** to each Telegram channel they want to publish to. As Telegram notifies us via the webhook, channels appear in the Profile's placements.
3. **Poll** [`GET /api/profiles/:id/placements`](/reference/profiles/#list-placements) to list discovered channels. Use `chat_id` (the placement's `id`) when creating posts.

<span class="method post">POST</span> `/api/profile_groups/:id/initialize_connection`

### Request body

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `platform` | string | Yes | Must be `"telegram"` |
| `bot_token` | string | Yes | Token issued by [@BotFather](https://t.me/BotFather). Get one with `/newbot`, then choose a name and username and copy the token. |

### Example

```bash
curl -X POST "https://api.postproxy.dev/api/profile_groups/grp123abc/initialize_connection" \
  -H "Authorization: Bearer your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "telegram",
    "bot_token": "123456789:ABCdef-GhIJklMnOpQrStUvWxYz"
  }'
```

Response:

```json
{
  "success": true,
  "profile": {
    "id": "prof321zyx",
    "network": "telegram",
    "name": "My Bot",
    "external_username": "my_bot"
  },
  "next_step": "Add @my_bot as administrator to the Telegram channel(s) you want to publish to. Channels will appear in GET /api/profiles/prof321zyx/placements once Telegram notifies us."
}
```

### Listing channels

After the bot has been added as administrator to one or more channels, list them via:

```bash
curl "https://api.postproxy.dev/api/profiles/prof321zyx/placements" \
  -H "Authorization: Bearer your_api_key"
```

```json
{
  "data": [
    { "id": "-1001234567890", "name": "My Channel (@mychannel)" },
    { "id": "-1009876543210", "name": "Private Channel" }
  ]
}
```

The list is empty until the user adds the bot to a channel. We recommend polling every few seconds while the user completes that step. If a channel never appears, ask the user to remove and re-add the bot — that re-fires the discovery event.

### Error responses

**Missing bot token (422):**
```json
{
  "error": "Telegram requires `bot_token` in the payload. Create a bot via @BotFather (https://t.me/BotFather) and pass the token."
}
```

**Invalid bot token (401):**
```json
{
  "error": "Telegram bot token is invalid or revoked — please reconnect the profile.",
  "error_code": "telegram_connect_failed"
}
```

**Bot already connected to another profile group (422):**
```json
{
  "error": "This Telegram bot is already connected to Postproxy.",
  "error_code": "account_is_already_connected"
}
```

---

## Use cases

### Multi-brand management

Create separate profile groups for different brands:

```bash
# Create brand profile groups
curl -X POST "https://api.postproxy.dev/api/profile_groups" \
  -H "Authorization: Bearer your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"profile_group": {"name": "Brand A"}}'

curl -X POST "https://api.postproxy.dev/api/profile_groups" \
  -H "Authorization: Bearer your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"profile_group": {"name": "Brand B"}}'
```

### Client onboarding

Generate connection URLs for clients to connect their accounts:

```bash
# Get OAuth URL for client to connect Instagram
curl -X POST "https://api.postproxy.dev/api/profile_groups/grp_client123/initialize_connection" \
  -H "Authorization: Bearer your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "network": "instagram",
    "redirect_url": "https://yourplatform.com/client/connected"
  }'
```

### Scoped API keys for partners

Issue profile-group-scoped API keys to partners, allowing them access only to their designated profile group while protecting other data.

---

# platform-parameters

This document details the platform-specific parameters, media constraints, and post formats available for each supported social network.

## Using platform parameters

Pass platform-specific options in the `platforms` object when creating a post:

```json
{
  "post": {
    "body": "My post content"
  },
  "profiles": ["instagram", "youtube"],
  "media": ["https://example.com/video.mp4"],
  "platforms": {
    "instagram": {
      "format": "reel",
      "first_comment": "Link in bio!"
    },
    "youtube": {
      "title": "My Video Title",
      "privacy_status": "public"
    }
  }
}
```

---

## Facebook

### Formats

| Format | Description |
|--------|-------------|
| `post` | Feed post (default) |
| `reel` | Facebook Reel |
| `story` | Facebook Story |

### Feed post parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | string | No | Set to `"post"` (default) |
| `first_comment` | string | No | Comment to add after posting |
| `page_id` | string | Yes | Page ID when you have multiple pages. Leave blank if you only have one page |

**Character limit:** 63,206 characters

### Reel parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | string | Yes | Set to `"reel"` |
| `title` | string | No | Title of the reel |
| `page_id` | string | Yes | Page ID when you have multiple pages. Use `/api/profiles/:id/placements` to get available pages |

**Character limit:** 2,200 characters

### Story parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | string | Yes | Set to `"story"` |
| `page_id` | string | Yes | Page ID when you have multiple pages. Use `/api/profiles/:id/placements` to get available pages |

### Media constraints

#### Feed post

| Media Type | Max Size | Formats | Max Count | Duration |
|------------|----------|---------|-----------|----------|
| Image | 10 MB | jpg, png, gif, webp | 10 | - |
| Video | 4 GB | mp4, mov | 1 | 1s - 4 hours |

- Text content: Optional
- Media required: No
- Mix video and image: No
- Minimum image dimensions: 200x200 pixels

#### Reel

| Media Type | Max Size | Formats | Max Count | Duration |
|------------|----------|---------|-----------|----------|
| Video | 300 MB | mp4, mov | 1 | 3s - 60s |

- Text content: Optional (caption)
- Media required: Yes (video only)
- Mix video and image: No

#### Story

| Media Type | Max Size | Formats | Max Count | Duration |
|------------|----------|---------|-----------|----------|
| Image | 10 MB | jpg, png | 1 | - |
| Video | 4 GB | mp4, mov | 1 | 3s - 60s |

- Text content: Not allowed
- Media required: Yes
- Mix video and image: No
- Minimum dimensions: 500x500 pixels

### Example

```json
{
  "platforms": {
    "facebook": {
      "format": "post",
      "first_comment": "What do you think? Let us know!",
      "page_id": "123456789"
    }
  }
}
```

---

## Instagram

### Formats

| Format | Description |
|--------|-------------|
| `post` | Feed post (default) |
| `reel` | Instagram Reel |
| `story` | Instagram Story |

### Feed post parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | string | No | Set to `"post"` (default) |
| `first_comment` | string | No | Comment to add after posting (max 2,196 characters) |
| `collaborators` | array | No | List of collaborator usernames |

**Character limit:** 2,200 characters

### Reel parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | string | Yes | Set to `"reel"` |
| `first_comment` | string | No | Comment to add after posting (max 2,196 characters) |
| `cover_url` / `cover_file` | string / file | No | Cover image for the reel. Pass `cover_url` (URL) in JSON or `cover_file` (file upload) in multipart. See [Cover Images](/getting-started/examples/#cover-images) |
| `audio_name` | string | No | Name of the audio |
| `trial_strategy` | string | No | Trial strategy for trial reels (`"MANUAL"` or `"SS_PERFORMANCE"`) |
| `collaborators` | array | No | List of up to 3 collaborator usernames |
| `thumb_offset` | string | No | Thumbnail offset in milliseconds. If both offset and cover_url are provided, cover_url takes precedence |

**Character limit:** 2,200 characters

### Story parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | string | Yes | Set to `"story"` |

### Rate limits

- **100 posts per day** per user (24-hour rolling window, across all Instagram formats)
- Instagram can also limit too frequent posting with an error saying "User is performing too many actions". In this case you need to slow down your posting and wait for some time.

### Media constraints

#### Feed post

| Media Type | Max Size | Formats | Max Count | Duration |
|------------|----------|---------|-----------|----------|
| Image | 8 MB | jpg, png | 10 | - |
| Video | 300 MB | mp4, mov | 1 | 3s - 60min |

- Text content: Optional (caption)
- Media required: Yes
- Mix video and image: Yes (carousel)
- Minimum dimensions: 200x200 pixels

#### Reel

| Media Type | Max Size | Formats | Max Count | Duration |
|------------|----------|---------|-----------|----------|
| Image | - | - | 0 | - |
| Video | 300 MB | mp4, mov | 1 | 3s - 90min |

- Text content: Optional (caption)
- Media required: Yes (video only)
- Mix video and image: No

#### Story

| Media Type | Max Size | Formats | Max Count | Duration |
|------------|----------|---------|-----------|----------|
| Image | 8 MB | jpg, png | 1 | - |
| Video | 100 MB | mp4, mov | 1 | 1s - 60min |

- Text content: Not allowed
- Media required: Yes
- Mix video and image: No
- Minimum dimensions: 200x200 pixels

### Examples

```json
// Feed post with carousel
{
  "platforms": {
    "instagram": {
      "format": "post",
      "first_comment": "Follow for more content!",
      "collaborators": ["username1", "username2"]
    }
  }
}

// Reel
{
  "platforms": {
    "instagram": {
      "format": "reel",
      "first_comment": "Full tutorial on our channel!",
      "cover_url": "https://example.com/thumbnail.jpg",
      "audio_name": "Trending Audio Track",
      "trial_strategy": "MANUAL",
      "collaborators": ["username1", "username2"],
      "thumb_offset": "5000"
    }
  }
}
```

---

## TikTok

### Formats

| Format | Description |
|--------|-------------|
| `video` | Video post (default) |
| `image` | Image post (up to 35 images) |

### Video parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | string | No | Set to `"video"` (default) |
| `privacy_status` | string | Yes | Privacy setting for the video |
| `made_with_ai` | boolean | No | Mark content as AI-generated |
| `disable_comment` | boolean | No | Disable comments |
| `disable_duet` | boolean | No | Disable duets |
| `disable_stitch` | boolean | No | Disable stitches |
| `brand_content_toggle` | boolean | No | Mark video as paid partnership promoting a third-party business |
| `brand_organic_toggle` | boolean | No | Mark video as paid partnership promoting your own brand |

**Character limit:** 2,200 characters

### Image parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | string | Yes | Set to `"image"` |
| `privacy_status` | string | Yes | Privacy setting for the post |
| `photo_cover_index` | integer | No | Index (0-based) of photo to use as cover |
| `auto_add_music` | boolean | No | Enable automatic music |
| `disable_comment` | boolean | No | Disable comments |
| `brand_content_toggle` | boolean | No | Mark post as paid partnership promoting a third-party business |
| `brand_organic_toggle` | boolean | No | Mark post as paid partnership promoting your own brand |

**Character limit:** 2,200 characters

### Privacy status values

| Value | Description |
|-------|-------------|
| `PUBLIC_TO_EVERYONE` | Visible to all users |
| `MUTUAL_FOLLOW_FRIENDS` | Visible to mutual followers |
| `FOLLOWER_OF_CREATOR` | Visible to followers only |
| `SELF_ONLY` | Private (only you) |

### Media constraints

#### Video

| Media Type | Max Size | Formats | Max Count | Duration |
|------------|----------|---------|-----------|----------|
| Video | 4 GB | mp4, mov, av, webm | 1 | 3s - 10min |

- Text content: Optional (caption)
- Media required: Yes
- Minimum video dimensions: 720x1280 pixels

#### Image

| Media Type | Max Size | Formats | Max Count | Duration |
|------------|----------|---------|-----------|----------|
| Image | 20 MB | jpg, gif | 35 | - |

- Text content: Optional (caption)
- Media required: Yes

### Examples

```json
// Video post
{
  "platforms": {
    "tiktok": {
      "format": "video",
      "privacy_status": "PUBLIC_TO_EVERYONE",
      "disable_comment": false,
      "disable_duet": false,
      "disable_stitch": false,
      "made_with_ai": false,
      "brand_content_toggle": false,
      "brand_organic_toggle": false
    }
  }
}

// Image post
{
  "platforms": {
    "tiktok": {
      "format": "image",
      "privacy_status": "PUBLIC_TO_EVERYONE",
      "photo_cover_index": 0,
      "auto_add_music": true
    }
  }
}
```

---

## LinkedIn

### Formats

| Format | Description |
|--------|-------------|
| `post` | Feed post (default) |

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `organization_id` | string | No | Post on behalf of an organization/company page |

**Character limit:** 3,000 characters

### Media constraints

| Media Type | Max Size | Formats | Max Count | Duration |
|------------|----------|---------|-----------|----------|
| Image | 8 MB | jpg, png, gif | 20 | - |
| Video | 5 GB | mp4, mov, avi | 1 | 0 - 15min |
| Document | 100 MB | pdf, doc, docx, ppt, pptx | 1 | - |

- Text content: Optional
- Media required: No
- Mix video and image: No
- Mix documents with images/videos: No
- Minimum image dimensions: 552x276 pixels
- Document max pages: 300

### Example

```json
// Post to personal profile
{
  "platforms": {
    "linkedin": {}
  }
}

// Post to company page
{
  "platforms": {
    "linkedin": {
      "organization_id": "12345678"
    }
  }
}

// Post with document
{
  "post": {
    "body": "Check out our latest report"
  },
  "profiles": ["linkedin"],
  "media": ["https://example.com/report.pdf"],
  "platforms": {
    "linkedin": {
      "organization_id": "12345678"
    }
  }
}
```

---

## YouTube

### Formats

| Format | Description |
|--------|-------------|
| `post` | Channel video (default) |

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | No | Video title (max 100 characters) |
| `privacy_status` | string | Yes | Video visibility setting |
| `cover_url` / `cover_file` | string / file | No | Custom thumbnail image (requires a verified YouTube account). Pass `cover_url` (URL) in JSON or `cover_file` (file upload) in multipart. See [Cover Images](/getting-started/examples/#cover-images) |
| `made_for_kids` | boolean | No | Whether the video is made for kids |
| `tags` | array | No | List of tags for the video |
| `category_id` | string | No | YouTube video category ID (defaults to `"22"` / People & Blogs) |
| `contains_synthetic_media` | boolean | No | Disclose if the video contains altered or synthetic (AI-generated) content |

**Character limit:** 5,000 characters (description)

### Privacy status values

| Value | Description |
|-------|-------------|
| `public` | Visible to everyone |
| `unlisted` | Only accessible via link |
| `private` | Only visible to you |

### Media constraints

| Media Type | Max Size | Formats | Max Count | Duration |
|------------|----------|---------|-----------|----------|
| Image | 0 | - | 0 | - |
| Video | 256 GB | mp4, mov, avi, wmv, flv, 3gp | 1 | 1s+ |

- Text content: Optional (description)
- Media required: Yes (video only)
- Mix video and image: No
- Note: The post body becomes the video description

### Example

```json
{
  "platforms": {
    "youtube": {
      "title": "How to Build an API Integration",
      "privacy_status": "public",
      "cover_url": "https://example.com/custom-thumbnail.jpg",
      "made_for_kids": false
    }
  }
}
```

---

## X (Twitter)

### Formats

| Format | Description |
|--------|-------------|
| `post` | Tweet (default) |

### Parameters

X (Twitter) does not have custom parameters. Content format is determined automatically based on media.

### Threads

X supports threads (tweet chains). See the [Threads section](/reference/posts/#threads) in the Posts API docs for details.

### Media constraints

| Media Type | Max Size | Formats | Max Count | Duration |
|------------|----------|---------|-----------|----------|
| Image | 5 MB | jpg, png, webp, gif | 4 | - |
| Video | 512 MB | mp4, mov | 1 | 1s - 140s |

- Text content: Optional
- Media required: No
- Mix video and image: No
- Minimum image dimensions: 4x4 pixels
- Minimum video dimensions: 32x32 pixels
- **Character limit:** 280 characters (free accounts) or 25,000 characters (paid accounts)

### Example

```json
{
  "platforms": {
    "twitter": {}
  }
}
```

---

## Threads

### Formats

| Format | Description |
|--------|-------------|
| `post` | Feed post (default) |

### Parameters

Threads does not have custom parameters.

**Character limit:** 500 characters

### Threads (Conversations)

Threads supports thread conversations (sequential replies). See the [Threads section](/reference/posts/#threads) in the Posts API docs for details.

### Media constraints

| Media Type | Max Size | Formats | Max Count | Duration |
|------------|----------|---------|-----------|----------|
| Image | 8 MB | jpg, png, gif, webp | 20 | - |
| Video | 1 GB | mp4, mov | 1 | 0 - 5min |

- Text content: Optional
- Media required: No
- Mix video and image: Yes
- Minimum dimensions: 200x200 pixels

### Example

```json
{
  "platforms": {
    "threads": {}
  }
}
```

---

## Pinterest

### Formats

| Format | Description |
|--------|-------------|
| `pin` | Pin (default) |

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | No | Title of the pin (max 100 characters) |
| `board_id` | string | Yes | ID of the board. Use `/api/profiles/:id/placements` to get available boards |
| `destination_link` | string | No | URL of the destination link (max 2,048 characters) |
| `cover_url` / `cover_file` | string / file | No | Cover image (video only). Pass `cover_url` (URL) in JSON or `cover_file` (file upload) in multipart. See [Cover Images](/getting-started/examples/#cover-images) |
| `thumb_offset` | integer | No | Thumbnail image offset in seconds (video only) |

**Character limit:** 500 characters (description)

### Media constraints

| Media Type | Max Size | Formats | Max Count | Duration |
|------------|----------|---------|-----------|----------|
| Image | 32 MB | jpg, gif, png, webp | 1 | - |
| Video | 2 GB | mp4, mov | 1 | 4s - 15min |

- Text content: Optional (description)
- Media required: Yes
- Mix video and image: No

### Example

```json
{
  "platforms": {
    "pinterest": {
      "title": "10 Tips for Better Photography",
      "board_id": "987654321",
      "destination_link": "https://example.com/blog/photography-tips"
    }
  }
}
```

---

## Bluesky

### Formats

| Format | Description |
|--------|-------------|
| `post` | Feed post (default) |

### Parameters

Bluesky does not have custom parameters.

**Character limit:** 300 characters (graphemes — emoji and combining sequences count as one character on Bluesky's side).

### Threads (conversations)

Bluesky supports thread conversations (sequential replies). See the [Threads section](/reference/posts/#threads) in the Posts API docs for details.

### Media constraints

| Media Type | Max Size | Formats | Max Count | Duration |
|------------|----------|---------|-----------|----------|
| Image | 1 MB | jpg, png, webp, gif | 4 | - |
| Video | 50 MB | mp4, mov | 1 | 1s - 60s |

- Text content: Optional
- Media required: No
- Mix video and image: No

### Example

```json
{
  "platforms": {
    "bluesky": {}
  }
}
```

---

## Telegram

Telegram is a **bring-your-own-bot** integration: each connected profile represents one bot (created via [@BotFather](https://t.me/BotFather)) and can publish to any Telegram channel where that bot has been added as administrator. See the [Telegram BYO bot guide](/guides/telegram-byo-bot/) for the full setup.

### Formats

| Format | Description |
|--------|-------------|
| `post` | Channel post (default) |

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chat_id` | string | Yes | ID of the destination Telegram chat (channel/group). Use `/api/profiles/:id/placements` to list channels the bot can post to. |
| `parse_mode` | string | No | Message formatting: `"HTML"` or `"MarkdownV2"`. Omit for plain text. |
| `disable_link_preview` | boolean | No | Don't render a preview for links in the message. |
| `disable_notification` | boolean | No | Send the message silently (no notification sound). |

**Character limit:** 4,096 characters

### Media constraints

| Media Type | Max Size | Formats | Max Count | Duration |
|------------|----------|---------|-----------|----------|
| Image | 10 MB | jpg, png, webp, gif | 10 | - |
| Video | 50 MB | mp4, mov | 10 | - |
| Document | 50 MB | pdf, doc, docx, zip, mp3, wav | 1 | - |

- Text content: Optional
- Media required: No
- Mix video and image: Yes (media group)

### Example

```json
{
  "post": {
    "body": "Latest update — check it out 👀"
  },
  "profiles": ["telegram"],
  "platforms": {
    "telegram": {
      "chat_id": "-1001234567890",
      "parse_mode": "HTML",
      "disable_link_preview": true
    }
  }
}
```

---

## Google Business

Google Business posts are **local updates attached to a specific Business Profile location**. Each connected profile may manage multiple Google accounts and any number of locations — every post must specify which location it targets via `location_id`. List available locations with `/api/profiles/:id/placements`.

Three formats share the same endpoint: standard local posts, event announcements, and promotional offers. Each format accepts only its relevant parameters — fields are scoped per-format.

### Formats

| Format | Description |
|--------|-------------|
| `standard` | Plain local post (default) |
| `event` | Event with a title and date range |
| `offer` | Promotion with a validity window and optional coupon |

### Shared parameters (all formats)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `format` | string | No | `standard` (default), `event`, or `offer` |
| `location_id` | string | Yes | Full location resource path (e.g. `accounts/123456789/locations/987654321`) |
| `language_code` | string | No | BCP 47 code (e.g. `en`, `de`). Defaults to `en`. Metadata only — does not translate the body. |
| `cta_action_type` | string | No | `LEARN_MORE`, `BOOK`, `ORDER`, `SHOP`, `SIGN_UP`, or `CALL` |
| `cta_url` | string | Conditional | HTTPS URL the CTA button opens. Required for every CTA type except `CALL`. |

### `event` format — additional parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `event_title` | string | Yes | Event title shown on the local-post card |
| `event_start_date` | string | Yes | `YYYY-MM-DD` |
| `event_end_date` | string | Yes | `YYYY-MM-DD` |
| `event_start_time` | string | No | `HH:MM` in 24-hour format |
| `event_end_time` | string | No | `HH:MM` in 24-hour format |

### `offer` format — additional parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `event_start_date` | string | Yes | `YYYY-MM-DD`. Start of the offer validity window. |
| `event_end_date` | string | Yes | `YYYY-MM-DD`. End of the offer validity window. |
| `event_start_time` | string | No | `HH:MM` in 24-hour format |
| `event_end_time` | string | No | `HH:MM` in 24-hour format |
| `event_title` | string | No | Offer headline (defaults to `"Special Offer"` if blank) |
| `offer_coupon_code` | string | No | Promo code rendered with the offer |
| `offer_redeem_url` | string | No | URL where the offer can be redeemed |
| `offer_terms` | string | No | Terms and conditions for the offer |

**Character limit:** 1,500 characters (post body)

### Media constraints

| Media Type | Max Size | Formats | Max Count | Notes |
|------------|----------|---------|-----------|-------|
| Image | 5 MB | jpg, png | 1 | Min 400×300 px (recommended 1200×900, 4:3) |
| Video | — | — | 0 | Not supported by Google Business local posts |

- Text content: Optional
- Media required: No (text-only posts allowed)
- Mix video and image: No
- Categories: certain verticals (e.g. lodging) have local posts disabled by Google and will return a validation error

### Examples

`standard` post with CTA:

```json
{
  "post": {
    "body": "We're now open on Sundays from 10am to 4pm — come visit!"
  },
  "profiles": ["google_business"],
  "platforms": {
    "google_business": {
      "format": "standard",
      "location_id": "accounts/123456789/locations/987654321",
      "cta_action_type": "LEARN_MORE",
      "cta_url": "https://acme.example.com/hours"
    }
  }
}
```

`event` post:

```json
{
  "post": {
    "body": "Join us for our 5-year anniversary party — live music, free coffee, prizes."
  },
  "profiles": ["google_business"],
  "platforms": {
    "google_business": {
      "format": "event",
      "location_id": "accounts/123456789/locations/987654321",
      "event_title": "Acme Coffee 5-Year Anniversary",
      "event_start_date": "2026-06-15",
      "event_start_time": "18:00",
      "event_end_date": "2026-06-15",
      "event_end_time": "22:00",
      "cta_action_type": "LEARN_MORE",
      "cta_url": "https://acme.example.com/anniversary"
    }
  }
}
```

`offer` post:

```json
{
  "post": {
    "body": "20% off all whole-bean coffee through the end of the month."
  },
  "profiles": ["google_business"],
  "platforms": {
    "google_business": {
      "format": "offer",
      "location_id": "accounts/123456789/locations/987654321",
      "event_start_date": "2026-06-01",
      "event_end_date": "2026-06-30",
      "offer_coupon_code": "BEANS20",
      "offer_redeem_url": "https://acme.example.com/shop",
      "offer_terms": "One per customer. Cannot be combined with other offers."
    }
  }
}
```

### Reviews

Reviews on a Google Business location surface through the [Profile Comments API](/reference/profile-comments/), not the post-level [Comments API](/reference/comments/) — reviews live on the location, not on a post. Reply with `POST /api/profiles/:profile_id/comments` and the review's external ID as `parent_id`. Reviews sync twice daily (06:00 and 18:00 UTC).

---

## Cross-platform posting tips

### Text-only posts

Supported on: Twitter, LinkedIn, Facebook, Threads, Bluesky, Telegram, Google Business

```json
{
  "post": {
    "body": "Exciting announcement coming soon!"
  },
  "profiles": ["twitter", "linkedin", "threads"]
}
```

### Image carousel

Supported on: Instagram, Facebook, Twitter (up to 4), LinkedIn (up to 20), Threads (up to 20), Telegram (up to 10), Bluesky (up to 4)

```json
{
  "post": {
    "body": "Check out these photos!"
  },
  "profiles": ["instagram", "facebook"],
  "media": [
    "https://example.com/photo1.jpg",
    "https://example.com/photo2.jpg",
    "https://example.com/photo3.jpg"
  ]
}
```

### Video content

When posting the same video to multiple platforms, use platform-specific parameters:

```json
{
  "post": {
    "body": "New video is live!"
  },
  "profiles": ["youtube", "tiktok", "instagram"],
  "media": ["https://example.com/video.mp4"],
  "platforms": {
    "youtube": {
      "title": "Tutorial: Getting Started",
      "privacy_status": "public"
    },
    "tiktok": {
      "privacy_status": "PUBLIC_TO_EVERYONE"
    },
    "instagram": {
      "format": "reel"
    }
  }
}
```

### Thread posts

Supported on: X (Twitter), Threads, Bluesky

```json
{
  "post": {
    "body": "1/ Here is a thread about our launch"
  },
  "profiles": ["twitter", "threads"],
  "thread": [
    {
      "body": "2/ First, we built the foundation...",
      "media": ["https://example.com/screenshot.jpg"]
    },
    { "body": "3/ Then we added the features..." },
    { "body": "4/ Check it out at example.com" }
  ]
}
```

Thread children can also include `media` arrays. See the [Threads section](/reference/posts/#threads) in the Posts API docs for full details.

---

## Validation errors

The API validates media against platform constraints before publishing. Common validation errors:

| Error | Cause |
|-------|-------|
| "Media is required for feed post on Instagram" | Instagram posts need at least one image or video |
| "Too many images for Feed post on Twitter (max: 4)" | Twitter allows max 4 images |
| "Content is not allowed for story on Instagram" | Stories don't support text content |
| "Cannot mix video and image for feed post on Facebook" | Some platforms don't allow mixed media |
| "Documents are not supported for feed post on Twitter" | Platform doesn't support document uploads |
| "Too many documents for Feed post on LinkedIn (max: 1)" | LinkedIn allows max 1 document per post |
| "Cannot mix documents with images or videos for feed post on LinkedIn" | Documents must be posted alone |

---

# calendar

The Calendar API provides a public social media event calendar for 2026, covering public holidays, awareness days, cultural events, commerce dates, and sensitive/no-post dates across the world's 20 largest economies.

:::tip
This is a public endpoint — no authentication required.
:::

## Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/calendar` | List calendar events |

---

## List calendar events

<span class="method get">GET</span> `/api/calendar`

Retrieves a filtered, paginated list of calendar events for 2026.

### Query parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `category` | string | No | - | Filter by category. Comma-separated. Values: `post_trigger`, `sensitive`, `no_post` |
| `type` | string | No | - | Filter by event type. Comma-separated. Values: `public_holiday`, `fun_holiday`, `awareness_day`, `cultural_event`, `sporting_event`, `commerce_event`, `religious_event`, `seasonal`, `remembrance` |
| `country` | string | No | - | Filter by country code (ISO 3166-1 alpha-2). Comma-separated. Also includes global events |
| `tag` | string | No | - | Filter by tag. Comma-separated. Examples: `sports`, `food`, `pets`, `commerce`, `environment` |
| `month` | integer | No | - | Filter by month (1–12) |
| `q` | string | No | - | Search event names (case-insensitive) |
| `from` | string | No | - | Start of date range (YYYY-MM-DD) |
| `to` | string | No | - | End of date range (YYYY-MM-DD) |
| `page` | integer | No | `0` | Page number (zero-indexed) |
| `per_page` | integer | No | `50` | Results per page (1–100) |

### Examples

**Get all events:**

```bash
curl -X GET "https://api.postproxy.dev/api/calendar"
```

**Get no-post / sensitive dates:**

```bash
curl -X GET "https://api.postproxy.dev/api/calendar?category=no_post,sensitive"
```

**Get Black Friday week events for US:**

```bash
curl -X GET "https://api.postproxy.dev/api/calendar?country=US&from=2026-11-25&to=2026-12-01"
```

**Get all sporting events:**

```bash
curl -X GET "https://api.postproxy.dev/api/calendar?type=sporting_event"
```

**Search by name:**

```bash
curl -X GET "https://api.postproxy.dev/api/calendar?q=coffee"
```

**Combine filters — fun holidays in December with food tag:**

```bash
curl -X GET "https://api.postproxy.dev/api/calendar?type=fun_holiday&month=12&tag=food"
```

### Response

```json
{
  "total": 284,
  "page": 0,
  "per_page": 50,
  "filters": {},
  "data": [
    {
      "date": "2026-01-01",
      "name": "New Year's Day",
      "type": "public_holiday",
      "category": "post_trigger",
      "countries": ["US", "CN", "DE", "JP", "FR", "IT", "CA", "BR", "KR", "AU", "MX", "ES", "ID", "NL", "TR", "CH"],
      "tags": []
    }
  ]
}
```

### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `total` | integer | Total number of events matching the filters |
| `page` | integer | Current page number |
| `per_page` | integer | Number of results per page |
| `filters` | object | Echo of active filters applied to the request |
| `data` | array | Array of event objects |

### Event object

| Field | Type | Description |
|-------|------|-------------|
| `date` | string | Event date (YYYY-MM-DD) |
| `name` | string | Event name |
| `type` | string | Event type (see values below) |
| `category` | string | One of `post_trigger`, `sensitive`, `no_post` |
| `countries` | array\|null | Country codes where applicable, or null for global events |
| `tags` | array | Descriptive tags for filtering |
| `posting_tip` | string\|null | Optional social media posting guidance |

---

## Event types

| Type | Description |
|------|-------------|
| `public_holiday` | Official government holidays |
| `fun_holiday` | Quirky/informal holidays (National Pizza Day, etc.) |
| `awareness_day` | Awareness and advocacy days (World Mental Health Day, etc.) |
| `cultural_event` | Cultural celebrations and awards (Oscars, Halloween, etc.) |
| `sporting_event` | Major sporting events (Super Bowl, FIFA World Cup, etc.) |
| `commerce_event` | Shopping/commerce events (Black Friday, Cyber Monday, etc.) |
| `religious_event` | Religious observances (Ramadan, Diwali, etc.) |
| `seasonal` | Seasonal markers (solstices, equinoxes, etc.) |
| `remembrance` | Memorial and remembrance dates |

---

## Categories

| Category | Description |
|----------|-------------|
| `post_trigger` | Good opportunity to post — plan content around these dates |
| `sensitive` | Post with care — be respectful, avoid commercial tie-ins |
| `no_post` | Brands should stay silent or share only respectful acknowledgment |

---

## Available countries

The calendar covers public holidays for 16 countries (top 20 economies; India and Saudi Arabia are not yet available):

`US`, `CN`, `DE`, `JP`, `GB`, `FR`, `IT`, `CA`, `BR`, `KR`, `AU`, `MX`, `ES`, `ID`, `NL`, `TR`, `CH`

---

# webhooks

Webhooks allow your application to receive real-time HTTP notifications when events occur in your Postproxy account, such as a post being processed, a platform post being published or failing, or a profile being disconnected.

When an event occurs, Postproxy sends a `POST` request to your configured URL with a JSON payload describing the event.

:::note
All API calls require authentication.
:::

## Event types

| Event | Description |
|-------|-------------|
| `post.processed` | A post has been processed and is ready for publishing |
| `post.imported` | A post was imported from a connected platform during sync |
| `platform_post.published` | A post was successfully published to a platform |
| `platform_post.failed` | A post failed to publish to a platform |
| `platform_post.failed_waiting_for_retry` | A post failed but will be retried |
| `platform_post.insights` | New insights/analytics are available for a platform post |
| `profile.disconnected` | A connected social profile was disconnected |
| `profile.connected` | A new social profile was connected |
| `profile.stats` | A new profile stats snapshot was recorded (fires once per placement) |
| `media.failed` | A media attachment failed to process or download |
| `comment.created` | A comment was successfully created on a platform post |
| `profile_comment.created` | A profile-scoped comment appeared (e.g. a new Google Business review or a published reply) |

You can subscribe to all events using `*` or select individual event types.

---

## Event payload

Every webhook delivery uses a consistent envelope structure:

```json
{
  "id": "evt_a1b2c3d4e5",
  "type": "platform_post.published",
  "created_at": "2025-01-15T10:30:00Z",
  "data": {
    // Event-specific data
  }
}
```

### Headers

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `User-Agent` | `Postproxy-Webhooks/1.0` |
| `X-Postproxy-Event` | The event type (e.g. `platform_post.published`) |
| `X-Postproxy-Delivery` | Unique delivery ID for this event |
| `X-Postproxy-Signature` | HMAC signature for verification |

### Payloads by event

#### `post.processed`

Uses the **Post** payload shape.

```json
{
  "id": "evt_abc123",
  "type": "post.processed",
  "created_at": "2025-01-15T10:30:00Z",
  "data": {
    "id": "abc123xyz",
    "body": "Check out our latest update!",
    "status": "processed",
    "scheduled_at": null,
    "created_at": "2025-01-15T10:30:00Z",
    "platforms": [
      {
        "id": "prof_xyz",
        "platform": "twitter",
        "name": "My Twitter"
      }
    ]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.id` | string | Post id |
| `data.body` | string | Post content |
| `data.status` | string | Post status |
| `data.scheduled_at` | string \| null | ISO 8601 scheduled time |
| `data.created_at` | string | ISO 8601 creation time |
| `data.platforms` | array | Profiles attached to the post |
| `data.platforms[].id` | string | Profile id |
| `data.platforms[].platform` | string | Network name (e.g. `twitter`, `linkedin`) |
| `data.platforms[].name` | string | Profile display name |

---

#### `post.imported`

Sent when Postproxy imports a post from a connected social platform (i.e. a post that was published outside Postproxy and discovered during a profile sync).

```json
{
  "id": "k9m2x7",
  "type": "post.imported",
  "created_at": "2025-01-15T10:30:00Z",
  "data": {
    "id": "q7d3k8",
    "body": "Check out our latest update!",
    "source": "imported",
    "posted_at": "2025-01-14T18:22:00Z",
    "created_at": "2025-01-15T10:30:00Z",
    "platform": "instagram",
    "profile": {
      "id": "m1x5b9",
      "name": "Acme Brand",
      "platform": "instagram"
    },
    "platform_post_id": "17841405822304914",
    "public_id": "DEF456abc"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.id` | string | Post ID |
| `data.body` | string | Post content |
| `data.source` | string | Always `"imported"` for imported posts |
| `data.posted_at` | string \| null | ISO 8601 timestamp the post was originally published on the platform |
| `data.created_at` | string | ISO 8601 timestamp the post was imported into Postproxy |
| `data.platform` | string | Network name (e.g. `instagram`, `twitter`) |
| `data.profile` | object | Profile the post was imported from |
| `data.profile.id` | string | Profile ID |
| `data.profile.name` | string | Profile display name |
| `data.profile.platform` | string | Network name |
| `data.platform_post_id` | string | Platform's internal post ID |
| `data.public_id` | string \| null | Platform's public-facing post ID/shortcode (used in permalinks) |

---

#### `platform_post.published`, `platform_post.failed`, `platform_post.failed_waiting_for_retry`

These three events share the **Platform Post** payload shape. The `status` and `error` fields reflect the outcome.

```json
{
  "id": "evt_def456",
  "type": "platform_post.published",
  "created_at": "2025-01-15T10:30:01Z",
  "data": {
    "id": "pp_abc123",
    "post_id": "abc123xyz",
    "platform": "twitter",
    "profile_id": "prof_xyz",
    "profile_name": "My Twitter",
    "status": "published",
    "error": null,
    "error_details": null,
    "platform_id": "1234567890"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.id` | string | Platform post id |
| `data.post_id` | string | Parent post id |
| `data.platform` | string | Network name |
| `data.profile_id` | string | Profile id |
| `data.profile_name` | string | Profile display name |
| `data.status` | string | `published`, `failed`, or `failed_waiting_for_retry` |
| `data.error` | string \| null | Error summary (null on success) |
| `data.error_details` | object \| null | Structured error details from the platform (null when no platform error info is available) |
| `data.error_details.platform_error_code` | string \| null | Error code returned by the platform API |
| `data.error_details.platform_error_subcode` | string \| null | Error subcode returned by the platform API |
| `data.error_details.platform_error_message` | string \| null | Error message returned by the platform API |
| `data.error_details.postproxy_note` | string \| null | Additional context from Postproxy about the error |
| `data.platform_id` | string \| null | External post ID on the platform (null until published) |

---

#### `platform_post.insights`

Uses the **Platform Post** payload shape plus an `insights` field containing the latest analytics snapshot.

```json
{
  "id": "evt_ins789",
  "type": "platform_post.insights",
  "created_at": "2025-01-15T18:00:00Z",
  "data": {
    "id": "pp_abc123",
    "post_id": "abc123xyz",
    "platform": "twitter",
    "profile_id": "prof_xyz",
    "profile_name": "My Twitter",
    "status": "published",
    "error": null,
    "error_details": null,
    "platform_id": "1234567890",
    "insights": {
      "impressions": 1523,
      "likes": 42,
      "comments": 7,
      "shares": 3
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.insights` | object | Key-value stats from the platform (varies by network) |

All other fields are identical to the Platform Post shape above.

---

#### `profile.connected`, `profile.disconnected`

These two events share the **Profile** payload shape.

```json
{
  "id": "evt_prof01",
  "type": "profile.disconnected",
  "created_at": "2025-01-15T12:00:00Z",
  "data": {
    "id": "prof_xyz",
    "name": "My Twitter",
    "platform": "twitter",
    "profile_group_id": "grp456xyz",
    "status": "disconnected",
    "uid": "twitter_456",
    "username": "myhandle"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.id` | string | Profile id |
| `data.name` | string | Profile display name |
| `data.platform` | string | Network name |
| `data.profile_group_id` | string | Profile group ID |
| `data.status` | string | `active` or `disconnected` |
| `data.uid` | string | External ID on the platform |
| `data.username` | string \| null | External username on the platform |

---

#### `profile.stats`

Sent each time a new profile stats snapshot is recorded for a profile. Snapshots are captured roughly every 23 hours per profile. For networks with placements (`facebook`, `linkedin`, `telegram`) the event fires once per placement on each polling cycle.

```json
{
  "id": "evt_stats01",
  "type": "profile.stats",
  "created_at": "2026-05-11T08:00:00Z",
  "data": {
    "profile_id": "prof_xyz",
    "platform": "linkedin",
    "placement_id": "108520199",
    "stats": {
      "followerCount": 4567,
      "shareCount": 10,
      "likeCount": 99,
      "allPageViews": 12728
    },
    "recorded_at": "2026-05-11T08:00:00Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.profile_id` | string | Profile ID |
| `data.platform` | string | Network name (e.g. `linkedin`, `bluesky`) |
| `data.placement_id` | string \| null | Platform-specific placement ID. `null` for networks without placements. |
| `data.stats` | object | Platform-specific metrics. Shape varies by network — see [Profiles · Stats fields by network](/reference/profiles/#stats-fields-by-network). |
| `data.recorded_at` | string | ISO 8601 timestamp when the snapshot was captured |

---

#### `media.failed`

Uses the **Attachment** payload shape.

```json
{
  "id": "evt_med01",
  "type": "media.failed",
  "created_at": "2025-01-15T10:30:02Z",
  "data": {
    "id": "att_xyz",
    "post_id": "abc123xyz",
    "content_type": "image/jpeg",
    "status": "failed",
    "error_message": "Media file not found"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.id` | string | Attachment id |
| `data.post_id` | string | Parent post id |
| `data.content_type` | string | MIME type of the attachment |
| `data.status` | string | Always `failed` for this event |
| `data.error_message` | string | Human-readable error description |

---

#### `comment.created`

Uses the **Comment** payload shape.

```json
{
  "id": "h2c8f3",
  "type": "comment.created",
  "created_at": "2025-01-15T10:30:05Z",
  "data": {
    "id": "n5y1z7",
    "post_id": "q7d3k8",
    "platform_post_id": "j4r9v2",
    "platform": "instagram",
    "external_id": "ig_comment_456",
    "parent_external_id": null,
    "body": "Great post!",
    "status": "published",
    "author_external_id": "user_789",
    "author_name": "Jane Doe",
    "author_username": "janedoe",
    "author_avatar_url": "https://example.com/avatar.jpg",
    "like_count": 0,
    "reply_count": 0,
    "is_hidden": false,
    "permalink": "https://instagram.com/p/abc123/c/456",
    "platform_data": {},
    "posted_at": null,
    "created_at": "2025-01-15T10:30:05Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.id` | string | Comment ID |
| `data.post_id` | string | Parent post ID |
| `data.platform_post_id` | string | Platform post ID |
| `data.platform` | string | Network name (e.g. `instagram`, `facebook`) |
| `data.external_id` | string \| null | Comment ID on the platform |
| `data.parent_external_id` | string \| null | Parent comment ID (null for top-level comments) |
| `data.body` | string | Comment text |
| `data.status` | string | `published` |
| `data.author_external_id` | string \| null | Author's ID on the platform |
| `data.author_name` | string \| null | Author's display name |
| `data.author_username` | string \| null | Author's username |
| `data.author_avatar_url` | string \| null | Author's avatar URL |
| `data.like_count` | integer | Number of likes |
| `data.reply_count` | integer | Number of replies |
| `data.is_hidden` | boolean | Whether the comment is hidden |
| `data.permalink` | string \| null | Direct link to the comment |
| `data.platform_data` | object \| null | Platform-specific metadata |
| `data.posted_at` | string \| null | ISO 8601 time when posted on the platform |
| `data.created_at` | string | ISO 8601 creation time |

---

#### `profile_comment.created`

Fires when a new profile-scoped comment appears — either a newly synced incoming review (e.g. a Google Business review pulled during the twice-daily sync) or an outgoing reply that has just been published. See the [Profile Comments API](/reference/profile-comments/) for the full resource.

```json
{
  "id": "evt_pcm01",
  "type": "profile_comment.created",
  "created_at": "2026-05-13T06:00:01Z",
  "data": {
    "id": "abc123",
    "profile_id": "prof123abc",
    "platform": "google_business",
    "placement_id": "accounts/1234/locations/5678",
    "external_id": "accounts/1234/locations/5678/reviews/AbFvOq",
    "parent_external_id": null,
    "body": "Great coffee, friendly staff!",
    "status": "synced",
    "author_username": "Jane D.",
    "author_avatar_url": "https://lh3.googleusercontent.com/...",
    "platform_data": { "star_rating": 5, "update_time": "2026-05-10T12:00:00Z" },
    "posted_at": "2026-05-10T11:55:00Z",
    "created_at": "2026-05-13T06:00:01Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `data.id` | string | Profile comment ID |
| `data.profile_id` | string | Profile that owns the comment |
| `data.platform` | string | Network name (currently `google_business`) |
| `data.placement_id` | string | Location path (e.g. `accounts/X/locations/Y`) |
| `data.external_id` | string \| null | Platform's native resource ID |
| `data.parent_external_id` | string \| null | Parent review external ID (null for top-level reviews) |
| `data.body` | string | Comment/review text |
| `data.status` | string | `synced`, `published`, `pending`, `failed`, or `failed_waiting_for_retry` |
| `data.author_username` | string \| null | Reviewer display name (null for your own replies) |
| `data.author_avatar_url` | string \| null | Reviewer avatar URL |
| `data.platform_data` | object \| null | Platform-specific metadata (e.g. `star_rating`) |
| `data.posted_at` | string \| null | ISO 8601 time when posted on the platform |
| `data.created_at` | string | ISO 8601 creation time |

---

## Signature verification

Every webhook request includes an `X-Postproxy-Signature` header for verifying that the request came from Postproxy.

The signature format is:

```
t=1705312200,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
```

- `t` — Unix timestamp when the signature was generated
- `v1` — HMAC-SHA256 hex digest

The signed payload is `{timestamp}.{body}` where `body` is the raw JSON request body.

### Verification examples

**Ruby**
```ruby
def verify_webhook(payload, signature_header, secret)
  parts = signature_header.split(",").map { |p| p.split("=", 2) }.to_h
  timestamp = parts["t"]
  expected = parts["v1"]

  signed_payload = "#{timestamp}.#{payload}"
  computed = OpenSSL::HMAC.hexdigest("SHA256", secret, signed_payload)

  ActiveSupport::SecurityUtils.secure_compare(computed, expected)
end
```

**Node.js**
```javascript
const crypto = require("crypto");

function verifyWebhook(payload, signatureHeader, secret) {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.split("=", 2))
  );
  const timestamp = parts.t;
  const expected = parts.v1;

  const signedPayload = `${timestamp}.${payload}`;
  const computed = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(computed),
    Buffer.from(expected)
  );
}
```

**Python**
```python
import hmac
import hashlib

def verify_webhook(payload: str, signature_header: str, secret: str) -> bool:
    parts = dict(p.split("=", 1) for p in signature_header.split(","))
    timestamp = parts["t"]
    expected = parts["v1"]

    signed_payload = f"{timestamp}.{payload}"
    computed = hmac.new(
        secret.encode(), signed_payload.encode(), hashlib.sha256
    ).hexdigest()

    return hmac.compare_digest(computed, expected)
```

---

## Retry policy

If your endpoint returns a non-2xx status code or the request fails, Postproxy retries the delivery up to 5 times with exponential backoff:

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 1 minute |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5 | 2 hours |

After all attempts are exhausted, the delivery is marked as failed. You can view delivery history via the API.

Your endpoint should return a `2xx` response within 30 seconds. Connections that take longer than 10 seconds to establish will time out.

---

## API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/webhooks` | List all webhooks |
| `GET` | `/api/webhooks/:id` | Get a single webhook |
| `POST` | `/api/webhooks` | Create a webhook |
| `PATCH` | `/api/webhooks/:id` | Update a webhook |
| `DELETE` | `/api/webhooks/:id` | Delete a webhook |
| `GET` | `/api/webhooks/:id/deliveries` | List delivery attempts |

---

## List webhooks

<span class="method get">GET</span> `/api/webhooks`

### Example

```bash
curl -X GET "https://api.postproxy.dev/api/webhooks" \
  -H "Authorization: Bearer your_api_key"
```

### Response

```json
{
  "data": [
    {
      "id": "wh_abc123",
      "url": "https://example.com/webhooks",
      "events": ["post.processed", "platform_post.published"],
      "enabled": true,
      "description": "Production webhook",
      "created_at": "2025-01-15T10:00:00Z",
      "updated_at": "2025-01-15T10:00:00Z"
    }
  ]
}
```

---

## Get webhook

<span class="method get">GET</span> `/api/webhooks/:id`

### Example

```bash
curl -X GET "https://api.postproxy.dev/api/webhooks/wh_abc123" \
  -H "Authorization: Bearer your_api_key"
```

### Response

```json
{
  "id": "wh_abc123",
  "url": "https://example.com/webhooks",
  "events": ["post.processed", "platform_post.published"],
  "enabled": true,
  "description": "Production webhook",
  "secret": "whsec_a1b2c3d4e5f6...",
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:00:00Z"
}
```

The `secret` field is only included when fetching a single webhook or immediately after creation.

---

## Create webhook

<span class="method post">POST</span> `/api/webhooks`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | HTTPS URL to receive webhook events |
| `events` | array | Yes | Event types to subscribe to (use `["*"]` for all) |
| `description` | string | No | Description for the webhook |

### Example

```bash
curl -X POST "https://api.postproxy.dev/api/webhooks" \
  -H "Authorization: Bearer your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com/webhooks",
    "events": ["post.processed", "platform_post.published"],
    "description": "Production webhook"
  }'
```

### Response (201 Created)

```json
{
  "id": "wh_abc123",
  "url": "https://example.com/webhooks",
  "events": ["post.processed", "platform_post.published"],
  "enabled": true,
  "description": "Production webhook",
  "secret": "whsec_a1b2c3d4e5f6...",
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T10:00:00Z"
}
```

:::tip
Save the `secret` from the response — you'll need it to verify webhook signatures. It's only shown on creation and when fetching a single webhook.
:::

---

## Update webhook

<span class="method patch">PATCH</span> `/api/webhooks/:id`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | No | New HTTPS URL |
| `events` | array | No | New event types |
| `enabled` | boolean | No | Enable or disable the webhook |
| `description` | string | No | Updated description |

### Example

```bash
curl -X PATCH "https://api.postproxy.dev/api/webhooks/wh_abc123" \
  -H "Authorization: Bearer your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "enabled": false
  }'
```

### Response

```json
{
  "id": "wh_abc123",
  "url": "https://example.com/webhooks",
  "events": ["post.processed", "platform_post.published"],
  "enabled": false,
  "description": "Production webhook",
  "secret": "whsec_a1b2c3d4e5f6...",
  "created_at": "2025-01-15T10:00:00Z",
  "updated_at": "2025-01-15T12:00:00Z"
}
```

---

## Delete webhook

<span class="method delete">DELETE</span> `/api/webhooks/:id`

### Example

```bash
curl -X DELETE "https://api.postproxy.dev/api/webhooks/wh_abc123" \
  -H "Authorization: Bearer your_api_key"
```

### Response

```json
{
  "deleted": true
}
```

---

## List deliveries

<span class="method get">GET</span> `/api/webhooks/:id/deliveries`

Retrieve delivery attempts for a specific webhook, useful for debugging.

### Query parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `page` | integer | No | `0` | Page number (zero-indexed) |
| `per_page` | integer | No | `20` | Number of deliveries per page |

### Example

```bash
curl -X GET "https://api.postproxy.dev/api/webhooks/wh_abc123/deliveries" \
  -H "Authorization: Bearer your_api_key"
```

### Response

```json
{
  "total": 15,
  "page": 0,
  "per_page": 20,
  "data": [
    {
      "id": "abc123",
      "event_id": "evt_abc123",
      "event_type": "post.processed",
      "response_status": 200,
      "attempt_number": 1,
      "success": true,
      "attempted_at": "2025-01-15T10:30:01Z",
      "created_at": "2025-01-15T10:30:01Z"
    }
  ]
}
```

---

# mcp-server

The Postproxy MCP Server provides tools for publishing posts, checking statuses, managing social media profiles, and retrieving post statistics through Claude Code. This server implements the Model Context Protocol (MCP) to enable seamless integration between Postproxy and Claude Code.

You can use **Postproxy’s hosted remote MCP** (no install) or run the **`postproxy-mcp` npm package** locally with stdio transport—both expose the same tools.

:::note
**Remote MCP:** no Node.js or npm install required; you only need a Postproxy API key and a client that supports HTTP transport. **Local package:** requires Node.js >= 18.0.0 and a valid Postproxy API key.
:::

---

## Remote MCP

Postproxy runs the MCP server for you at a public HTTPS endpoint. Point your client at that URL and authenticate with your API key. You skip installing Node, `postproxy-mcp`, and maintaining a local stdio process.

### Claude Code

Register the hosted server with HTTP transport:

<Code code={`claude mcp add --transport http postproxy \\
  https://mcp.postproxy.dev/mcp?api_key=YOUR_KEY`} lang="bash" />

Replace `YOUR_KEY` with your Postproxy API key.

### Authentication

- **Query parameter:** append `api_key=YOUR_KEY` to the MCP URL (as in the example above).
- **Header:** alternatively, many clients can send `X-Postproxy-API-Key: YOUR_KEY` instead of putting the key in the URL.

Use whichever method your MCP client supports.

### After connecting

1. Restart your Claude Code session if the client requires it.
2. Test with a prompt such as: “Check my Postproxy authentication status.”
3. If the Postproxy tools appear, you can publish and manage posts the same way as with the local server.

---

## Installation

### Global Installation

Install the MCP server globally using npm:

<Code code={`npm install -g postproxy-mcp`} lang="bash" />

### Local Installation

Install the MCP server locally in your project:

<Code code={`npm install postproxy-mcp`} lang="bash" />

Claude Code stores MCP server configuration under `~/.claude/plugins/`. After installing postproxy-mcp, Claude will automatically detect the server on restart.

---

## Configuration

The steps below apply to the **local** `postproxy-mcp` package (stdio transport). If you use the [hosted remote MCP](#remote-mcp) instead, you only need the HTTP URL and API key—no `npm install` or env vars on your machine.

### Register MCP Server

After installing postproxy-mcp, register it with Claude Code using the `claude mcp add` command:

<Code code={`claude mcp add --transport stdio postproxy-mcp --env POSTPROXY_API_KEY=your-api-key --env POSTPROXY_BASE_URL=https://api.postproxy.dev/api -- postproxy-mcp`} lang="bash" />

Replace `your-api-key` with your actual Postproxy API key.

The configuration will be automatically saved to `~/.claude/plugins/`. After running this command:

1. Restart your Claude Code session
2. Test the connection by asking Claude: "Check my Postproxy authentication status"
3. If tools are available, Claude will be able to use them automatically

### Alternative: Interactive Setup

For non-technical users, you can use the interactive setup command:

<Tabs>
  <TabItem label="Command">
    <Code code={`postproxy-mcp setup`} lang="bash" />
  </TabItem>
  <TabItem label="Alternative">
    <Code code={`postproxy-mcp-setup`} lang="bash" />
  </TabItem>
</Tabs>

This will guide you through the setup process step by step and register the server using `claude mcp add` automatically.

---

## Available Tools

The MCP server provides the following tools for interacting with Postproxy:

| Tool | Description |
|------|-------------|
| `auth_status` | Check authentication status and API configuration |
| `profiles_list` | List all available social media profiles |
| `profiles_placements` | List available placements for a profile (Facebook pages, LinkedIn orgs, Pinterest boards) |
| `profiles_stats` | Get follower/engagement timeseries (daily snapshots) for a profile |
| `post_publish` | Publish a post to specified profiles |
| `post_status` | Get status of a published post by post ID |
| `post_update` | Update an existing draft or scheduled post |
| `post_publish_draft` | Publish a draft post |
| `post_delete` | Delete a post by post ID |
| `post_delete_on_platform` | Delete a post from a specific platform without removing it from Postproxy |
| `post_stats` | Get stats snapshots for one or more posts |
| `queues_list` | List all posting queues |
| `queues_get` | Get details of a single posting queue |
| `queues_create` | Create a new posting queue with weekly timeslots |
| `queues_update` | Update a queue's settings, timeslots, or pause/unpause it |
| `queues_delete` | Delete a posting queue |
| `queues_next_slot` | Get the next available timeslot for a queue |
| `comments_list` | List comments on a published post |
| `comments_get` | Get a single comment with its replies |
| `comments_create` | Create a comment or reply on a published post |
| `comments_delete` | Delete a comment from the platform |
| `comments_hide` | Hide a comment on the platform |
| `comments_unhide` | Unhide a previously hidden comment |
| `comments_like` | Like a comment on the platform |
| `comments_unlike` | Remove a like from a comment |
| `history_list` | List recent post jobs |

---

## Authentication Tools

### `auth_status`

Check authentication status, API configuration, and workspace information.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| None | - | - | This tool requires no parameters |

#### Response

<Code code={`{
  "authenticated": true,
  "base_url": "https://api.postproxy.dev/api",
  "profile_groups_count": 2
}`} lang="json" />

#### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `authenticated` | boolean | Whether the API key is valid and authenticated |
| `base_url` | string | Base URL of the Postproxy API |
| `profile_groups_count` | integer | Number of profile groups in the account |

---

## Profile Management

### `profiles_list`

List all available social media profiles (targets) for posting.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| None | - | - | This tool requires no parameters |

#### Response

<Code code={`{
  "targets": [
    {
      "id": "profile-123",
      "name": "My Twitter Account",
      "platform": "twitter",
      "profile_group_id": 1
    }
  ]
}`} lang="json" />

#### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `targets` | array | Array of available profile objects |
| `targets[].id` | string | Unique profile identifier |
| `targets[].name` | string | Display name of the connected account |
| `targets[].platform` | string | Platform identifier (twitter, facebook, instagram, etc.) |
| `targets[].profile_group_id` | integer | ID of the profile group this profile belongs to |

---

### `profiles_placements`

List available placements for a profile. For Facebook profiles, placements are business pages. For LinkedIn profiles, placements include the personal profile and organizations. For Pinterest profiles, placements are boards. Available for `facebook`, `linkedin`, and `pinterest` profiles.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `profile_id` | string | Yes | Profile ID |

#### Response (LinkedIn example)

<Code code={`{
  "placements": [
    {
      "id": null,
      "name": "Personal Profile"
    },
    {
      "id": "108520199",
      "name": "Acme Marketing"
    }
  ]
}`} lang="json" />

#### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `placements` | array | Array of placement objects |
| `placements[].id` | string\|null | Placement identifier (null for personal profiles) |
| `placements[].name` | string | Display name of the placement |

:::note
If no placement is specified when creating a post:
- **LinkedIn**: defaults to the personal profile
- **Facebook**: defaults to a random connected page (if only one page is connected, no need to set a placement ID)
- **Pinterest**: it fails
:::

---

## Post Management

### `post_publish`

Publish a post to specified social media profiles. Supports text content, media attachments, scheduling, drafts, threads (X and Threads only), and platform-specific customization.

#### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `content` | string | Yes | - | Post content text |
| `profiles` | string[] | Yes | - | Array of profile IDs or platform names (e.g., `"linkedin"`, `"instagram"`, `"twitter"`). When using platform names, posts to the first connected profile for that platform. |
| `schedule` | string | No | - | ISO 8601 scheduled time. Do not use together with `queue_id`. |
| `media` | string[] | No | - | Array of media URLs or local file paths (absolute, relative, or `~/` paths) |
| `idempotency_key` | string | No | - | Idempotency key for deduplication |
| `require_confirmation` | boolean | No | `false` | If true, return summary without publishing (dry run) |
| `draft` | boolean | No | `false` | If true, creates a draft post that won't publish automatically |
| `thread` | array | No | - | Array of thread child posts (X/Twitter and Threads only). Each item has `body` (string, required) and `media` (string[], optional). The parent post is published first, then each child is published as a reply in order. |
| `queue_id` | string | No | - | Queue ID to add the post to. The queue will automatically assign a timeslot. Do not use together with `schedule`. |
| `queue_priority` | string | No | `"medium"` | Priority when adding to a queue: `"high"`, `"medium"`, or `"low"`. Higher priority posts get earlier timeslots. |
| `platforms` | object | No | - | Platform-specific parameters. Key is platform name (e.g., "instagram", "youtube", "tiktok"), value is object with platform-specific options. See [Platform Parameters Reference](/reference/platform-parameters/) for full documentation. |

#### Platform Parameters Example

<Code code={`{
  "instagram": {
    "format": "reel",
    "collaborators": ["username1", "username2"],
    "first_comment": "Link in bio!"
  },
  "youtube": {
    "title": "My Video Title",
    "privacy_status": "public"
  },
  "tiktok": {
    "privacy_status": "PUBLIC_TO_EVERYONE",
    "auto_add_music": true
  }
}`} lang="json" />

#### Response

<Code code={`{
  "post_id": "job-123",
  "status": "pending",
  "draft": true,
  "scheduled_at": null,
  "created_at": "2024-01-01T12:00:00Z"
}`} lang="json" />

#### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `post_id` | string | Unique post identifier for tracking the post |
| `status` | string | Initial status of the post: `pending`, `processing`, `processed` |
| `draft` | boolean | Whether the post was created as a draft |
| `scheduled_at` | string\|null | ISO 8601 timestamp if scheduled |
| `created_at` | string | ISO 8601 timestamp when the post was created |
| `warning` | string\|null | Warning message if the API may have ignored the draft parameter |

:::note
If you request a draft post (`draft: true`) but the API returns `draft: false`, a `warning` field will be included in the response indicating that the API may have ignored the draft parameter. This can happen if the API does not support drafts with certain parameters (e.g., media attachments) or under specific conditions.
:::

---

### `post_status`

Get status of a published post by post ID.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `post_id` | string | Yes | Post ID from post.publish response |

#### Response

<Code code={`{
  "post_id": "job-123",
  "overall_status": "complete",
  "draft": false,
  "status": "processed",
  "platforms": [
    {
      "platform": "twitter",
      "status": "published",
      "url": "https://twitter.com/status/123",
      "post_id": "123",
      "error": null,
      "attempted_at": "2024-01-01T12:00:00Z"
    }
  ]
}`} lang="json" />

#### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `post_id` | string | Postproxy post identifier |
| `overall_status` | string | Overall status: `draft`, `pending`, `processing`, `complete`, `failed`, `media_processing_failed` |
| `draft` | boolean | Whether the post is a draft |
| `status` | string | Post status: `pending`, `processing`, `processed`, `draft`, `scheduled`, `media_processing_failed` |
| `platforms` | array | Array of platform-specific posting results |
| `platforms[].platform` | string | Platform identifier |
| `platforms[].status` | string | Platform posting status: `pending`, `processing`, `published`, `failed`, `deleted` |
| `platforms[].url` | string\|null | URL of the published post (if available) |
| `platforms[].post_id` | string\|null | Platform-specific post ID (if available) |
| `platforms[].error` | string\|null | Error message if publishing failed (null if successful) |
| `platforms[].attempted_at` | string | ISO 8601 timestamp when posting was attempted |
| `platforms[].insights` | object\|null | Platform-specific insights (if available) |
| `media` | array\|undefined | Array of media objects (only present if the post has media) |
| `thread` | array\|undefined | Array of thread child posts (only present if the post has thread children) |

---

### `post_update`

Update an existing post. Only drafts or scheduled posts (more than 5 minutes before publish) can be updated. Only send fields you want to change — omitted fields are left unchanged.

#### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `post_id` | string | Yes | - | Post ID to update |
| `content` | string | No | - | Updated text content |
| `profiles` | string[] | No | - | Replace all profiles (array of profile IDs or platform names). Full replace — omit to keep existing. |
| `schedule` | string | No | - | Updated ISO 8601 scheduled time |
| `draft` | boolean | No | - | Set or unset draft status |
| `media` | string[] | No | - | Replace all media (array of media URLs). Full replace — send empty array to remove all. Omit to keep existing. |
| `platforms` | object | No | - | Platform-specific parameters (merged with existing). Same structure as `post_publish`. |
| `thread` | array | No | - | Replace all thread children (full replace). Send empty array to remove all. Omit to keep existing. |
| `queue_id` | string | No | - | Queue ID to assign the post to |
| `queue_priority` | string | No | - | Queue priority: `"high"`, `"medium"`, or `"low"` |

#### Response

<Code code={`{
  "post_id": "job-123",
  "status": "draft",
  "draft": true,
  "scheduled_at": null,
  "created_at": "2024-01-01T12:00:00Z",
  "message": "Post updated successfully"
}`} lang="json" />

#### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `post_id` | string | Post identifier |
| `status` | string | Post status after update |
| `draft` | boolean | Whether the post is a draft |
| `scheduled_at` | string\|null | ISO 8601 timestamp if scheduled |
| `created_at` | string | ISO 8601 timestamp when the post was created |
| `message` | string | Success message |

---

### `post_delete`

Delete a post by post ID.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `post_id` | string | Yes | Post ID to delete |

#### Response

<Code code={`{
  "post_id": "job-123",
  "deleted": true
}`} lang="json" />

#### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `post_id` | string | Post identifier that was deleted |
| `deleted` | boolean | Whether the deletion was successful |

---

### `post_publish_draft`

Publish a draft post. Only posts with `draft: true` status can be published using this endpoint.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `post_id` | string | Yes | Post ID of the draft post to publish |

#### Response

<Code code={`{
  "post_id": "job-123",
  "status": "processed",
  "draft": false,
  "scheduled_at": null,
  "created_at": "2024-01-01T12:00:00Z",
  "message": "Draft post published successfully"
}`} lang="json" />

#### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `post_id` | string | Post identifier |
| `status` | string | Post status after publishing |
| `draft` | boolean | Will be `false` after publishing |
| `scheduled_at` | string\|null | ISO 8601 timestamp if scheduled |
| `created_at` | string | ISO 8601 timestamp when the post was created |
| `message` | string | Success message |

---

### `post_stats`

Get stats snapshots for one or more posts. Returns all matching snapshots so you can see trends over time. Supports filtering by profiles/networks and timespan.

#### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `post_ids` | string[] | Yes | - | Array of post IDs (max 50) |
| `profiles` | string | No | - | Comma-separated list of profile IDs or network names (e.g. `instagram,twitter` or `abc123,def456` or mixed) |
| `from` | string | No | - | ISO 8601 timestamp — only include snapshots recorded at or after this time |
| `to` | string | No | - | ISO 8601 timestamp — only include snapshots recorded at or before this time |

#### Response

<Code code={`{
  "data": {
    "abc123": {
      "platforms": [
        {
          "profile_id": "prof_abc",
          "platform": "instagram",
          "records": [
            {
              "stats": {
                "impressions": 1200,
                "likes": 85,
                "comments": 12,
                "saved": 8
              },
              "recorded_at": "2026-02-20T12:00:00Z"
            }
          ]
        }
      ]
    }
  }
}`} lang="json" />

#### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `data` | object | Object keyed by post ID |
| `data[].platforms` | array | Array of platform-specific stats |
| `data[].platforms[].profile_id` | string | Profile identifier |
| `data[].platforms[].platform` | string | Platform name |
| `data[].platforms[].records` | array | Array of stat snapshots over time |
| `data[].platforms[].records[].stats` | object | Stats object (fields vary by platform) |
| `data[].platforms[].records[].recorded_at` | string | ISO 8601 timestamp when stats were recorded |

#### Stats fields by platform

| Platform | Available Fields |
|----------|-----------------|
| Instagram | `impressions`, `likes`, `comments`, `saved`, `profile_visits`, `follows` |
| Facebook | `impressions`, `clicks`, `likes` |
| Threads | `impressions`, `likes`, `replies`, `reposts`, `quotes`, `shares` |
| Twitter | `impressions`, `likes`, `retweets`, `comments`, `quotes`, `saved` |
| YouTube | `impressions`, `likes`, `comments`, `saved` |
| LinkedIn | `impressions` |
| TikTok | `impressions`, `likes`, `comments`, `shares` |
| Pinterest | `impressions`, `likes`, `comments`, `saved`, `outbound_clicks` |

:::note
Instagram stories do not return stats. TikTok stats require the post to have a public ID.
:::

---

## History

### `history_list`

List recent post jobs.

#### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `limit` | number | No | `10` | Maximum number of jobs to return |

#### Response

<Code code={`{
  "jobs": [
    {
      "post_id": "job-123",
      "content_preview": "Post content preview...",
      "created_at": "2024-01-01T12:00:00Z",
      "overall_status": "complete",
      "draft": false,
      "platforms_count": 2
    }
  ]
}`} lang="json" />

#### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `jobs` | array | Array of job objects |
| `jobs[].post_id` | string | Unique post identifier |
| `jobs[].content_preview` | string | Preview of the post content |
| `jobs[].created_at` | string | ISO 8601 timestamp when the job was created |
| `jobs[].overall_status` | string | Overall status of the job |
| `jobs[].draft` | boolean | Whether the post is a draft |
| `jobs[].platforms_count` | integer | Number of platforms the post was published to |

---

## Queue Management

Queues automatically schedule posts into recurring weekly timeslots with priority-based ordering.

### `queues_list`

List all posting queues.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `profile_group_id` | string | No | Filter queues by profile group |

#### Response

<Code code={`{
  "queues": [
    {
      "id": "q1abc",
      "name": "Morning Posts",
      "description": "Daily morning content",
      "timezone": "America/New_York",
      "enabled": true,
      "jitter": 10,
      "profile_group_id": "pg123",
      "timeslots": ["Monday at 09:00 (id: 1)", "Wednesday at 09:00 (id: 2)"],
      "posts_count": 5
    }
  ]
}`} lang="json" />

---

### `queues_get`

Get details of a single posting queue including its timeslots and post count.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `queue_id` | string | Yes | Queue ID |

---

### `queues_create`

Create a new posting queue with weekly timeslots.

#### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `profile_group_id` | string | Yes | - | Profile group ID to connect the queue to (use `profiles_list` to find this) |
| `name` | string | Yes | - | Queue name |
| `description` | string | No | - | Optional description |
| `timezone` | string | No | `"UTC"` | IANA timezone name (e.g. `"America/New_York"`) |
| `jitter` | number | No | `0` | Random offset in minutes (0-60) applied to scheduled times for natural posting patterns |
| `timeslots` | array | No | - | Initial weekly timeslots. Each object has `day` (0=Sunday through 6=Saturday) and `time` (24-hour `HH:MM` format). |

#### Example

<Code code={`{
  "profile_group_id": "pg123",
  "name": "Weekday Mornings",
  "timezone": "America/New_York",
  "jitter": 10,
  "timeslots": [
    { "day": 1, "time": "09:00" },
    { "day": 2, "time": "09:00" },
    { "day": 3, "time": "09:00" },
    { "day": 4, "time": "09:00" },
    { "day": 5, "time": "09:00" }
  ]
}`} lang="json" />

---

### `queues_update`

Update a queue's settings, timeslots, or pause/unpause it. Changes to timezone or timeslots trigger rearrangement of all queued posts.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `queue_id` | string | Yes | Queue ID to update |
| `name` | string | No | New queue name |
| `description` | string | No | New description |
| `timezone` | string | No | IANA timezone name |
| `enabled` | boolean | No | Set to `false` to pause the queue, `true` to unpause |
| `jitter` | number | No | Random offset in minutes (0-60) |
| `timeslots` | array | No | Timeslots to add or remove. To add: `{ "day": 1, "time": "09:00" }`. To remove: `{ "id": 42, "_destroy": true }`. |

---

### `queues_delete`

Delete a posting queue. Posts in the queue will have their queue reference removed but will not be deleted.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `queue_id` | string | Yes | Queue ID to delete |

---

### `queues_next_slot`

Get the next available timeslot for a queue.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `queue_id` | string | Yes | Queue ID |

#### Response

<Code code={`{
  "next_slot": "2026-03-11T14:00:00Z"
}`} lang="json" />

---

### Adding Posts to a Queue

When publishing a post with `post_publish`, you can add it to a queue instead of scheduling it manually using the `queue_id` and `queue_priority` parameters:

<Code code={`{
  "content": "Queued post content",
  "profiles": ["twitter", "linkedin"],
  "queue_id": "q1abc",
  "queue_priority": "high"
}`} lang="json" />

---

## Comment Management

### `comments_list`

List comments on a published post. Returns paginated top-level comments with nested replies.

#### Parameters

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `post_id` | string | Yes | - | Post ID |
| `profile_id` | string | Yes | - | Profile ID to identify which platform's comments to retrieve |
| `page` | number | No | `0` | Page number, zero-indexed |
| `per_page` | number | No | `20` | Number of top-level comments per page |

#### Response

<Code code={`{
  "total": 42,
  "page": 0,
  "per_page": 20,
  "data": [
    {
      "id": "cmt_abc123",
      "external_id": "17858893269123456",
      "body": "Great post!",
      "status": "synced",
      "author_username": "someuser",
      "like_count": 3,
      "is_hidden": false,
      "posted_at": "2026-03-25T10:00:00.000Z",
      "replies": [
        {
          "id": "cmt_def456",
          "body": "Thanks!",
          "author_username": "author",
          "parent_external_id": "17858893269123456"
        }
      ]
    }
  ]
}`} lang="json" />

---

### `comments_get`

Get a single comment with its replies.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `post_id` | string | Yes | Post ID |
| `comment_id` | string | Yes | Comment ID (Postproxy ID or platform external ID) |
| `profile_id` | string | Yes | Profile ID |

---

### `comments_create`

Create a comment or reply on a published post. The comment is published to the platform asynchronously.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `post_id` | string | Yes | Post ID |
| `profile_id` | string | Yes | Profile ID |
| `text` | string | Yes | Comment text content |
| `parent_id` | string | No | ID of comment to reply to (Postproxy ID or external ID). Omit to comment on the post itself. |

#### Response

<Code code={`{
  "id": "cmt_ghi789",
  "body": "Thanks for the feedback everyone!",
  "status": "pending",
  "external_id": null
}`} lang="json" />

The comment is created with `status: "pending"`. Once published to the platform, it becomes `"published"`. If publishing fails, it becomes `"failed"`.

---

### `comments_delete`

Delete a comment from the platform asynchronously. Supported on Instagram, Facebook, YouTube, and LinkedIn. Not supported on Threads.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `post_id` | string | Yes | Post ID |
| `comment_id` | string | Yes | Comment ID (Postproxy ID or external ID) |
| `profile_id` | string | Yes | Profile ID |

---

### `comments_hide`

Hide a comment on the platform asynchronously. Supported on Instagram, Facebook, and Threads.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `post_id` | string | Yes | Post ID |
| `comment_id` | string | Yes | Comment ID |
| `profile_id` | string | Yes | Profile ID |

---

### `comments_unhide`

Unhide a previously hidden comment. Supported on Instagram, Facebook, and Threads.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `post_id` | string | Yes | Post ID |
| `comment_id` | string | Yes | Comment ID |
| `profile_id` | string | Yes | Profile ID |

---

### `comments_like`

Like a comment on the platform asynchronously. Currently only supported on Facebook.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `post_id` | string | Yes | Post ID |
| `comment_id` | string | Yes | Comment ID |
| `profile_id` | string | Yes | Profile ID |

---

### `comments_unlike`

Remove a like from a comment. Currently only supported on Facebook.

#### Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `post_id` | string | Yes | Post ID |
| `comment_id` | string | Yes | Comment ID |
| `profile_id` | string | Yes | Profile ID |

---

### Comment Platform Support

| Action | Instagram | Facebook | Threads | YouTube | LinkedIn |
|--------|-----------|----------|---------|---------|----------|
| List | Yes | Yes | Yes | Yes | Yes |
| Reply | Yes | Yes | Yes | Yes | Yes |
| Delete | Yes | Yes | No | Yes | Yes |
| Hide/Unhide | Yes | Yes | Yes | No | No |
| Like/Unlike | No | Yes | No | No | No |

---

## Platform Parameters

The `platforms` parameter in `post_publish` allows you to specify platform-specific options for each social media platform. This enables advanced features like Instagram Reels, YouTube video titles, TikTok privacy settings, and more.

### Instagram Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `format` | string | Post format: `"post"`, `"reel"`, or `"story"` |
| `collaborators` | string[] | Array of usernames (max 10 for posts, 3 for reels) |
| `first_comment` | string | Comment to add after posting |
| `cover_url` | string | Thumbnail URL for reels |
| `audio_name` | string | Audio track name for reels |
| `trial_strategy` | string | Trial strategy for reels: `"MANUAL"` or `"SS_PERFORMANCE"` |
| `thumb_offset` | string | Thumbnail offset in milliseconds for reels |

#### Instagram Examples

<Code code={`{
  "content": "Amazing content!",
  "profiles": ["instagram"],
  "media": ["https://example.com/image.jpg"],
  "platforms": {
    "instagram": {
      "format": "post",
      "collaborators": ["username1", "username2"],
      "first_comment": "What do you think? 🔥"
    }
  }
}`} lang="json" />

<Code code={`{
  "content": "Check out this reel! #viral",
  "profiles": ["instagram"],
  "media": ["https://example.com/video.mp4"],
  "platforms": {
    "instagram": {
      "format": "reel",
      "collaborators": ["collaborator_username"],
      "cover_url": "https://example.com/thumbnail.jpg",
      "audio_name": "Trending Audio",
      "first_comment": "Link in bio!"
    }
  }
}`} lang="json" />

### YouTube Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `title` | string | Video title |
| `privacy_status` | string | Privacy setting: `"public"`, `"unlisted"`, or `"private"` |
| `cover_url` | string | Custom thumbnail URL |
| `made_for_kids` | boolean | Mark content as made for kids |

#### YouTube Examples

<Code code={`{
  "content": "This is the video description with links and details",
  "profiles": ["youtube"],
  "media": ["https://example.com/video.mp4"],
  "platforms": {
    "youtube": {
      "title": "My Tutorial: How to Build an API",
      "privacy_status": "public",
      "cover_url": "https://example.com/custom-thumbnail.jpg"
    }
  }
}`} lang="json" />

### TikTok Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `format` | string | Content format: `"video"` or `"image"` |
| `privacy_status` | string | Privacy setting: `"PUBLIC_TO_EVERYONE"`, `"MUTUAL_FOLLOW_FRIENDS"`, `"FOLLOWER_OF_CREATOR"`, or `"SELF_ONLY"` |
| `photo_cover_index` | integer | Index of photo to use as cover (0-based, image only) |
| `auto_add_music` | boolean | Enable automatic music (image only) |
| `made_with_ai` | boolean | Mark content as AI-generated (video only) |
| `disable_comment` | boolean | Disable comments |
| `disable_duet` | boolean | Disable duets (video only) |
| `disable_stitch` | boolean | Disable stitches (video only) |
| `brand_content_toggle` | boolean | Mark as paid partnership (third-party) |
| `brand_organic_toggle` | boolean | Mark as paid partnership (own brand) |

#### TikTok Examples

<Code code={`{
  "content": "Check this out! #fyp",
  "profiles": ["tiktok"],
  "media": ["https://example.com/video.mp4"],
  "platforms": {
    "tiktok": {
      "privacy_status": "PUBLIC_TO_EVERYONE",
      "auto_add_music": true,
      "disable_comment": false,
      "disable_duet": false,
      "disable_stitch": false
    }
  }
}`} lang="json" />

### Facebook Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `format` | string | Post format: `"post"`, `"story"`, or `"reel"` |
| `title` | string | Title for reels (reel format only) |
| `first_comment` | string | Comment to add after posting |
| `page_id` | string | Page ID for posting to company pages (use `profiles_placements` to get available pages) |

#### Facebook Examples

<Code code={`{
  "content": "Check out our new product!",
  "profiles": ["facebook"],
  "media": ["https://example.com/product.jpg"],
  "platforms": {
    "facebook": {
      "format": "post",
      "first_comment": "Link to purchase: https://example.com/shop"
    }
  }
}`} lang="json" />

### LinkedIn Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `organization_id` | string | Organization ID for company page posts |

#### LinkedIn Examples

<Code code={`{
  "content": "We're hiring! Join our team",
  "profiles": ["linkedin"],
  "media": ["https://example.com/careers.jpg"],
  "platforms": {
    "linkedin": {
      "organization_id": "company-id-12345"
    }
  }
}`} lang="json" />

### Cross-Platform Example

<Code code={`{
  "content": "Product launch video",
  "profiles": ["instagram", "youtube", "tiktok"],
  "media": ["https://example.com/video.mp4"],
  "platforms": {
    "instagram": {
      "format": "reel",
      "first_comment": "Link in bio!"
    },
    "youtube": {
      "title": "Product Launch 2024",
      "privacy_status": "public",
      "cover_url": "https://example.com/yt-thumbnail.jpg"
    },
    "tiktok": {
      "privacy_status": "PUBLIC_TO_EVERYONE",
      "auto_add_music": true
    }
  }
}`} lang="json" />

:::note
Twitter/X and Threads do not have platform-specific parameters available.
:::

For complete documentation, see the [Platform Parameters Reference](/reference/platform-parameters/).

---

## Example Prompts

Here are some example prompts you can use with Claude Code:

### Check Authentication

<Code code={`Check my Postproxy authentication status`} lang="text" />

### List Profiles

<Code code={`Show me all my available social media profiles`} lang="text" />

### Publish a Post

Using profile IDs:

<Code code={`Publish this post: "Check out our new product!" to profiles ["profile-123"]`} lang="text" />

Using platform names:

<Code code={`Publish "Exciting news!" to linkedin and twitter`} lang="text" />

### Create a Draft Post

<Code code={`Create a draft post: "Review this before publishing" to linkedin`} lang="text" />

### Publish a Draft Post

<Code code={`Publish draft post job-123`} lang="text" />

### Check Post Status

<Code code={`What's the status of post job-123?`} lang="text" />

This will show detailed status including draft status, platform-specific errors, and publishing results.

### Get Post Stats

<Code code={`Show me the stats for post abc123`} lang="text" />

<Code code={`Get stats for posts abc123 and def456 filtered to Instagram only, from February 1st to today`} lang="text" />

### List Placements

<Code code={`Show me the placements for my LinkedIn profile prof123`} lang="text" />

### Update a Post

<Code code={`Update the content of draft post job-123 to "Updated content here"`} lang="text" />

### Delete a Post

<Code code={`Delete post job-123`} lang="text" />

### Queue Management

<Code code={`Show me all my posting queues`} lang="text" />

<Code code={`Create a queue called "Weekday Mornings" for profile group pg123, timezone America/New_York, with timeslots Monday through Friday at 9am`} lang="text" />

<Code code={`Add a post to queue q1abc with high priority: "Check out our latest feature!"`} lang="text" />

<Code code={`Pause queue q1abc`} lang="text" />

<Code code={`What's the next available slot for queue q1abc?`} lang="text" />

### Comment Management

<Code code={`Show me the comments on post abc123 for my Instagram profile prof456`} lang="text" />

<Code code={`Reply to comment cmt_abc123 on post abc123 with "Thanks for the feedback!" using profile prof456`} lang="text" />

<Code code={`Hide comment cmt_abc123 on post abc123 for profile prof456`} lang="text" />

### Publish a Thread

<Code code={`Publish a thread on Twitter: first post "Part 1: Introduction to our new feature", then "Part 2: Here's how it works", then "Part 3: Try it out today!"`} lang="text" />

### View History

<Code code={`Show me the last 5 posts I published`} lang="text" />

---

## Troubleshooting

### Server Won't Start

- **Check API Key**: Ensure `POSTPROXY_API_KEY` is set when registering with `claude mcp add`
- **Check Node Version**: Requires Node.js >= 18.0.0
- **Check Installation**: Verify `postproxy-mcp` is installed and in PATH
- **Check Registration**: Ensure the server is registered via `claude mcp add` and configuration is saved in `~/.claude/plugins/`

### Authentication Errors

- **AUTH_MISSING**: API key is not configured. Make sure you included `--env POSTPROXY_API_KEY=...` when running `claude mcp add`
- **AUTH_INVALID**: API key is invalid. Verify your API key is correct.

### Validation Errors

- **TARGET_NOT_FOUND**: One or more profile IDs don't exist. Use `profiles_list` to see available profiles.
- **VALIDATION_ERROR**: Post content or parameters are invalid. The API now returns detailed error messages:
  - **400 errors**: `{"status":400,"error":"Bad Request","message":"..."}`
  - **422 errors**: `{"errors": ["Error 1", "Error 2"]}` - Array of validation error messages
  - Check the error message for specific validation issues

### API Errors

- **API_ERROR**: Postproxy API returned an error. Check the error message for details.
- **Timeout**: Request took longer than 30 seconds. Check your network connection and API status.

### Platform Errors

When checking post status with `post_status`, platform-specific errors are now available in the `error` field of each platform object:
- `error: null` - Post published successfully
- `error: "Error message"` - Detailed error message from the platform API
- Common errors include authentication issues, rate limits, content violations, etc.

### Draft Post Issues

If you create a draft post (`draft: true`) but receive `draft: false` in the response:
- The response will include a `warning` field explaining that the API may have ignored the draft parameter
- This can happen if:
  - The API does not support drafts with media attachments
  - The API has specific limitations for draft posts under certain conditions
- Check the `warning` field in the response for details
- Enable debug mode (`POSTPROXY_MCP_DEBUG=1`) to see detailed logging about draft parameter handling

### Debug Mode

Enable debug logging by setting `POSTPROXY_MCP_DEBUG=1` when registering the server:

<Code code={`claude mcp add --transport stdio postproxy-mcp --env POSTPROXY_API_KEY=your-api-key --env POSTPROXY_BASE_URL=https://api.postproxy.dev/api --env POSTPROXY_MCP_DEBUG=1 -- postproxy-mcp`} lang="bash" />
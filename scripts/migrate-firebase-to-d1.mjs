/**
 * One-time migration: Firebase Firestore → Cloudflare D1
 *
 * Usage:
 *   node scripts/migrate-firebase-to-d1.mjs <email> <password>
 *
 * What it does:
 *   1. Signs in to Firebase with your old credentials
 *   2. Reads all clients + posts from Firestore
 *   3. Imports them into D1 via the Worker API (using a Clerk token)
 *
 * Prerequisites:
 *   npm install firebase node-fetch  (one-time, in project root)
 *   Set CLERK_TOKEN env var OR be signed in — see step 3 notes below.
 */

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, query, orderBy } from 'firebase/firestore';

// ── Config ────────────────────────────────────────────────────────────────────

const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyDEBOsFhVSuP2jjDU6RR6IcNNmW4o8n6fA',
  authDomain:        'socialai-e22c2.firebaseapp.com',
  projectId:         'socialai-e22c2',
  storageBucket:     'socialai-e22c2.firebasestorage.app',
  messagingSenderId: '176799681610',
  appId:             '1:176799681610:web:c7ae2eaac6ee525077eab3',
};

const WORKER_URL = 'https://socialai-api.steve-700.workers.dev';

// ── Auth ──────────────────────────────────────────────────────────────────────

const [,, email, password] = process.argv;
if (!email || !password) {
  console.error('Usage: node scripts/migrate-firebase-to-d1.mjs <email> <password>');
  process.exit(1);
}

// Clerk token — needed to authenticate with the Worker
// Pass as env var: CLERK_TOKEN=... node scripts/migrate-firebase-to-d1.mjs ...
const clerkToken = process.env.CLERK_TOKEN || '';
if (!clerkToken) {
  console.warn('⚠️  No CLERK_TOKEN set — Worker calls will be unauthenticated and may fail.');
  console.warn('   Get a short-lived token from: Clerk Dashboard → Users → your user → Sessions → Copy JWT');
  console.warn('   Then run: CLERK_TOKEN=<token> node scripts/migrate-firebase-to-d1.mjs ...\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function workerFetch(path, body) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(clerkToken ? { Authorization: `Bearer ${clerkToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Worker ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔥 Connecting to Firebase…');
  const app = initializeApp(FIREBASE_CONFIG);
  const auth = getAuth(app);
  const fsDb = getFirestore(app);

  console.log(`🔑 Signing in as ${email}…`);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const uid = cred.user.uid;
  console.log(`✅ Signed in — Firebase UID: ${uid}\n`);

  // ── Read clients ────────────────────────────────────────────────────────────
  console.log('📦 Reading clients from Firestore…');
  const clientsSnap = await getDocs(collection(fsDb, 'users', uid, 'clients'));
  const clients = clientsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`   Found ${clients.length} client(s)\n`);

  // ── Read agency posts ───────────────────────────────────────────────────────
  console.log('📝 Reading agency posts from Firestore…');
  const agencyPostsSnap = await getDocs(
    query(collection(fsDb, 'users', uid, 'posts'), orderBy('scheduledFor', 'asc'))
  );
  const agencyPosts = agencyPostsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`   Found ${agencyPosts.length} agency post(s)\n`);

  // ── Read client posts ────────────────────────────────────────────────────────
  const clientPostsMap = {};
  for (const client of clients) {
    try {
      const snap = await getDocs(
        query(collection(fsDb, 'users', uid, 'clients', client.id, 'posts'), orderBy('scheduledFor', 'asc'))
      );
      clientPostsMap[client.id] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      console.log(`   Client "${client.name}" — ${clientPostsMap[client.id].length} post(s)`);
    } catch {
      clientPostsMap[client.id] = [];
    }
  }

  if (!clerkToken) {
    console.log('\n⚠️  Skipping D1 import — no CLERK_TOKEN provided.');
    console.log('   Data summary printed above. Set CLERK_TOKEN and re-run to import.\n');
    console.log('── Firestore data snapshot ──────────────────────');
    console.log(JSON.stringify({ clients, agencyPosts, clientPostsMap }, null, 2));
    return;
  }

  // ── Import clients into D1 ──────────────────────────────────────────────────
  console.log('\n⬆️  Importing clients into D1…');
  const clientIdMap = {}; // old Firestore ID → new D1 ID
  for (const client of clients) {
    try {
      const result = await workerFetch('/api/db/clients', {
        name: client.name || 'Unknown',
        businessType: client.businessType || client.business_type || '',
        createdAt: client.createdAt?.toDate?.()?.toISOString?.() ?? client.createdAt ?? new Date().toISOString(),
        plan: client.plan ?? null,
      });
      clientIdMap[client.id] = result.id;
      console.log(`   ✅ "${client.name}" → D1 id: ${result.id}`);
    } catch (e) {
      console.error(`   ❌ Failed to import client "${client.name}": ${e.message}`);
    }
  }

  // ── Import agency posts into D1 ─────────────────────────────────────────────
  console.log(`\n⬆️  Importing ${agencyPosts.length} agency post(s) into D1…`);
  let agencyOk = 0;
  for (const post of agencyPosts) {
    try {
      await workerFetch('/api/db/posts', mapPost(post, null));
      agencyOk++;
    } catch (e) {
      console.error(`   ❌ Post ${post.id}: ${e.message}`);
    }
  }
  console.log(`   ✅ ${agencyOk}/${agencyPosts.length} agency posts imported`);

  // ── Import client posts into D1 ─────────────────────────────────────────────
  for (const client of clients) {
    const posts = clientPostsMap[client.id] || [];
    const newClientId = clientIdMap[client.id];
    if (!newClientId || !posts.length) continue;
    console.log(`\n⬆️  Importing ${posts.length} post(s) for client "${client.name}"…`);
    let ok = 0;
    for (const post of posts) {
      try {
        await workerFetch('/api/db/posts', mapPost(post, newClientId));
        ok++;
      } catch (e) {
        console.error(`   ❌ Post ${post.id}: ${e.message}`);
      }
    }
    console.log(`   ✅ ${ok}/${posts.length} posts imported`);
  }

  console.log('\n🎉 Migration complete!');
  console.log('   Refresh socialaistudio.au — your clients and posts should appear.');
  process.exit(0);
}

function mapPost(post, clientId) {
  return {
    clientId: clientId ?? null,
    content: post.content ?? '',
    platform: post.platform ?? null,
    status: post.status ?? 'Draft',
    scheduledFor: post.scheduledFor ?? null,
    hashtags: post.hashtags ?? [],
    imageUrl: post.image ?? post.imageUrl ?? null,
    topic: post.topic ?? null,
    pillar: post.pillar ?? null,
    latePostId: post.latePostId ?? null,
    imagePrompt: post.imagePrompt ?? null,
    reasoning: post.reasoning ?? null,
    postType: post.postType ?? null,
    videoScript: post.videoScript ?? null,
    videoShots: post.videoShots ?? null,
    videoMood: post.videoMood ?? null,
  };
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});

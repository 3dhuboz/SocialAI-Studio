/**
 * One-time script: seed Street Meats, Pickle Nick & Hughes Q as agency client
 * workspaces under Steve's socialaistudio.au account.
 *
 * HOW TO RUN:
 *   1. Open https://socialaistudio.au in Chrome and log in as steve@3dhub.au
 *   2. Open DevTools → Console and run:
 *        (await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js'))
 *      ... actually just run this one-liner to copy your token:
 *        copy(await firebase.auth().currentUser?.getIdToken?.())
 *      OR if that doesn't work, run:
 *        const { getAuth } = await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js');
 *      Simpler: just open the Network tab, find any Firestore request, and copy
 *      the Authorization header value (the part after "Bearer ").
 *
 *   EASIEST METHOD — run this in the browser console at socialaistudio.au:
 *        const token = await window.__firebaseToken?.() ?? 'paste-manually';
 *        console.log(token);
 *      Then copy the token and run:
 *        node scripts/seed-agency-clients.mjs <TOKEN>
 *
 *   Alternatively paste the token into the TOKEN variable below and run:
 *        node scripts/seed-agency-clients.mjs
 */

const TOKEN = process.argv[2] || '';

const FIREBASE_API_KEY = 'AIzaSyDEBOsFhVSuP2jjDU6RR6IcNNmW4o8n6fA';
const FIREBASE_PROJECT = 'socialai-e22c2';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

const CLIENTS = [
  { name: 'Street Meats BBQ',  businessType: 'BBQ food truck & catering' },
  { name: 'Pickle Nick',        businessType: 'Food truck' },
  { name: "Uzi's Q",            businessType: 'BBQ restaurant & catering' },
];

async function getUid(idToken) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );
  const json = await res.json();
  if (!json.users?.[0]?.localId) throw new Error(`Token lookup failed: ${JSON.stringify(json.error)}`);
  return json.users[0].localId;
}

function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = { stringValue: String(v) };
  }
  return { fields };
}

async function createClient(uid, clientData, idToken) {
  const url = `${FS_BASE}/users/${uid}/clients?key=${FIREBASE_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(toFields({
      ...clientData,
      createdAt: new Date().toISOString(),
    })),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Firestore error: ${JSON.stringify(json.error)}`);
  const docId = json.name.split('/').pop();
  return docId;
}

async function run() {
  if (!TOKEN) {
    console.error('\n❌  No ID token provided.\n');
    console.error('Usage: node scripts/seed-agency-clients.mjs <FIREBASE_ID_TOKEN>\n');
    console.error('Get your token from the browser console at socialaistudio.au:');
    console.error('  1. Log in as steve@3dhub.au');
    console.error('  2. Open DevTools → Console and run:');
    console.error('       (await firebase.auth().currentUser.getIdToken())');
    console.error('  3. Copy the token string and pass it as the argument above.\n');
    process.exit(1);
  }

  console.log('\n🔍  Verifying token...');
  const uid = await getUid(TOKEN);
  console.log(`✅  Authenticated as UID: ${uid}\n`);

  for (const client of CLIENTS) {
    try {
      const docId = await createClient(uid, client, TOKEN);
      console.log(`✅  Created "${client.name}" → doc ID: ${docId}`);
    } catch (err) {
      console.error(`❌  Failed to create "${client.name}": ${err.message}`);
    }
  }

  console.log('\n🎉  Done! Refresh socialaistudio.au and your 3 client workspaces will appear in the switcher.\n');
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });

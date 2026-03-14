/**
 * One-time script: seed Street Meats, Pickle Nick & Hughes Q as agency client
 * workspaces under Steve's socialaistudio.au account.
 *
 * HOW TO RUN (no browser needed):
 *   node scripts/seed-agency-clients.mjs steve@3dhub.au YOUR_PASSWORD
 */

const [EMAIL, PASSWORD] = process.argv.slice(2);

const FIREBASE_API_KEY = 'AIzaSyDEBOsFhVSuP2jjDU6RR6IcNNmW4o8n6fA';
const FIREBASE_PROJECT = 'socialai-e22c2';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

const CLIENTS = [
  { name: 'Street Meats BBQ',  businessType: 'BBQ food truck & catering' },
  { name: 'Pickle Nick',        businessType: 'Food truck' },
  { name: "Uzi's Q",            businessType: 'BBQ restaurant & catering' },
];

async function signIn(email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  const json = await res.json();
  if (!json.idToken) throw new Error(`Sign-in failed: ${json.error?.message || JSON.stringify(json)}`);
  return { uid: json.localId, idToken: json.idToken };
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
  if (!EMAIL || !PASSWORD) {
    console.error('\n❌  Usage: node scripts/seed-agency-clients.mjs <email> <password>\n');
    console.error('Example: node scripts/seed-agency-clients.mjs steve@3dhub.au mypassword\n');
    process.exit(1);
  }

  console.log(`\n�  Signing in as ${EMAIL}...`);
  const { uid, idToken } = await signIn(EMAIL, PASSWORD);
  console.log(`✅  Authenticated as UID: ${uid}\n`);

  for (const client of CLIENTS) {
    try {
      const docId = await createClient(uid, client, idToken);
      console.log(`✅  Created "${client.name}" → doc ID: ${docId}`);
    } catch (err) {
      console.error(`❌  Failed to create "${client.name}": ${err.message}`);
    }
  }

  console.log('\n🎉  Done! Refresh socialaistudio.au and your 3 client workspaces will appear in the switcher.\n');
}

run().catch(err => { console.error('Fatal:', err.message); process.exit(1); });

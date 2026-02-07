const admin = require("firebase-admin");
const serviceAccount = require("./service-account.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const auth = admin.auth();
const db = admin.firestore();

async function upsertUser(u) {
  const ref = db.collection("users").doc(u.uid);
  await ref.set({
    name: u.displayName || "Client",
    email: u.email || "",
    phone: u.phoneNumber || "",
    banned: false,
    lastLoginAt: u.metadata && u.metadata.lastSignInTime || null,
    createdAt: u.metadata && u.metadata.creationTime || null
  }, { merge: true });
}

async function run() {
  let nextPageToken = undefined;
  let count = 0;
  do {
    const res = await auth.listUsers(1000, nextPageToken);
    for (const u of res.users) {
      await upsertUser(u);
      count++;
    }
    nextPageToken = res.pageToken;
  } while (nextPageToken);

  console.log(`Imported ${count} users.`);
  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

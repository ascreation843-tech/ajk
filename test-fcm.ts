import 'dotenv/config'

let rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
if ((rawKey.startsWith('"') && rawKey.endsWith('"')) || (rawKey.startsWith("'") && rawKey.endsWith("'"))) {
  rawKey = rawKey.substring(1, rawKey.length - 1);
}
const cleanPrivateKey = rawKey.replace(/\\n/g, '\n').trim();

console.log("ACTUAL STRING:\n---START---\n" + cleanPrivateKey + "\n---END---");

// Who may use the friends' Echo, and who is signed in. A learner is an allowed Google email with its own Echo
// (a port and a folder); removing one keeps their folder, so adding the same email again continues where they left
// off. A session is a random token in a cookie; only its SHA-256 is stored, so a copy of this database signs no one in.
// A Google account that signed in while not on the list is kept as a request, with the name Google gave, until the
// owner adds or dismisses it: friends try first and are approved afterwards.
import { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'node:crypto';

export type Learner = { id: string; email: string; name: string; port: number };
export type Friend = Learner & { createdAt: string; removedAt: string | null; lastSeenAt: string | null; devices: number };
export type SignInRequest = { email: string; name: string; firstAt: string; lastAt: string; attempts: number };

// A session lasts this long after its last use: each visit renews it.
export const SESSION_DAYS = 180;
const DAY_MS = 86_400_000;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createAccounts(options: { dbPath: string; firstPort: number; now?: () => Date }) {
  const now = options.now ?? (() => new Date());
  const db = new Database(options.dbPath, { create: true, strict: true });
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS learners (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, port INTEGER NOT NULL UNIQUE,
      created_at TEXT NOT NULL, removed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(id), created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL, device TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS requests (
      email TEXT PRIMARY KEY, name TEXT NOT NULL, first_at TEXT NOT NULL, last_at TEXT NOT NULL, attempts INTEGER NOT NULL
    );`);
  const byEmail = db.query<Learner & { removed_at: string | null }, [string]>('SELECT id, email, name, port, removed_at FROM learners WHERE email = ?');
  const byId = db.query<Learner, [string]>('SELECT id, email, name, port FROM learners WHERE id = ? AND removed_at IS NULL');
  const insert = db.query('INSERT INTO learners (id, email, name, port, created_at) VALUES (?, ?, ?, ?, ?)');
  const restore = db.query('UPDATE learners SET removed_at = NULL, name = ? WHERE id = ?');
  const markRemoved = db.query('UPDATE learners SET removed_at = ? WHERE id = ? AND removed_at IS NULL');
  const highestPort = db.query<{ port: number | null }, []>('SELECT max(port) AS port FROM learners');
  const takenIds = db.query<{ id: string }, []>('SELECT id FROM learners');
  const all = db.query<{ id: string; email: string; name: string; port: number; created_at: string; removed_at: string | null; last_seen_at: string | null; devices: number }, [string]>(`
    SELECT learners.*, max(sessions.last_seen_at) AS last_seen_at, count(sessions.token_hash) AS devices
    FROM learners LEFT JOIN sessions ON sessions.learner_id = learners.id AND sessions.last_seen_at >= ?
    GROUP BY learners.id ORDER BY learners.removed_at IS NOT NULL, learners.created_at`);
  const saveSession = db.query('INSERT INTO sessions (token_hash, learner_id, created_at, last_seen_at, device) VALUES (?, ?, ?, ?, ?)');
  const findSession = db.query<{ learner_id: string; last_seen_at: string }, [string]>('SELECT learner_id, last_seen_at FROM sessions WHERE token_hash = ?');
  const touch = db.query('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?');
  const endSession = db.query('DELETE FROM sessions WHERE token_hash = ?');
  const endSessionsOf = db.query('DELETE FROM sessions WHERE learner_id = ?');
  const dropExpired = db.query('DELETE FROM sessions WHERE last_seen_at < ?');
  const noteRequest = db.query(`INSERT INTO requests (email, name, first_at, last_at, attempts) VALUES (?1, ?2, ?3, ?3, 1)
    ON CONFLICT (email) DO UPDATE SET name = excluded.name, last_at = excluded.last_at, attempts = attempts + 1`);
  const allRequests = db.query<{ email: string; name: string; first_at: string; last_at: string; attempts: number }, []>('SELECT * FROM requests ORDER BY last_at DESC');
  const dropRequest = db.query('DELETE FROM requests WHERE email = ?');

  const normalEmail = (email: unknown) => (typeof email === 'string' ? email.trim().toLowerCase() : '');
  const oldestLive = () => new Date(now().getTime() - SESSION_DAYS * DAY_MS).toISOString();
  // A folder-safe id from the email's name part: dana.cohen@gmail.com -> dana-cohen, then dana-cohen-2 if taken.
  function newId(email: string): string {
    const base = email.split('@')[0]!.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'friend';
    const taken = new Set(takenIds.all().map((row) => row.id));
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  return {
    // The learner allowed for a Google email, or null: removed and unknown emails are not let in.
    allowed(email: string): Learner | null {
      const row = byEmail.get(normalEmail(email));
      return row && !row.removed_at ? { id: row.id, email: row.email, name: row.name, port: row.port } : null;
    },
    learner: (id: string): Learner | null => byId.get(id) ?? null,
    friends(): Friend[] {
      return all.all(oldestLive()).map((row) => ({ id: row.id, email: row.email, name: row.name, port: row.port, createdAt: row.created_at, removedAt: row.removed_at, lastSeenAt: row.last_seen_at, devices: row.devices }));
    },
    // Allows an email; an email removed before is allowed again with its old folder.
    add(input: { email: unknown; name: unknown }): Learner {
      const email = normalEmail(input.email);
      if (!EMAIL.test(email)) throw new Error('Type the Google email address your friend signs in with.');
      const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 40) : email.split('@')[0]!;
      const existing = byEmail.get(email);
      if (existing) {
        if (!existing.removed_at) throw new Error(`${email} is already on the list.`);
        restore.run(name, existing.id);
        dropRequest.run(email);
        return { id: existing.id, email, name, port: existing.port };
      }
      const learner = { id: newId(email), email, name, port: Math.max(options.firstPort - 1, highestPort.get()?.port ?? 0) + 1 };
      insert.run(learner.id, learner.email, learner.name, learner.port, now().toISOString());
      dropRequest.run(email);
      return learner;
    },
    // Takes an email off the list and signs it out everywhere; its folder stays.
    remove(id: string): boolean {
      const removed = markRemoved.run(now().toISOString(), id).changes > 0;
      endSessionsOf.run(id);
      return removed;
    },
    // Remembers a Google account that signed in while not on the list.
    request(identity: { email: string; name: string }) {
      const email = normalEmail(identity.email);
      noteRequest.run(email, identity.name.trim().slice(0, 40) || email.split('@')[0]!, now().toISOString());
    },
    requests(): SignInRequest[] {
      return allRequests.all().map((row) => ({ email: row.email, name: row.name, firstAt: row.first_at, lastAt: row.last_at, attempts: row.attempts }));
    },
    dismiss(email: unknown): boolean { return dropRequest.run(normalEmail(email)).changes > 0; },
    startSession(learnerId: string, device: string): string {
      const token = randomBytes(32).toString('base64url');
      const at = now().toISOString();
      saveSession.run(hash(token), learnerId, at, at, device.slice(0, 120));
      return token;
    },
    // The signed-in learner for a session token, renewing the session; null when unknown, expired or removed.
    session(token: string | undefined): Learner | null {
      if (!token) return null;
      const key = hash(token);
      const row = findSession.get(key);
      if (!row) return null;
      if (row.last_seen_at < oldestLive()) { endSession.run(key); return null; }
      const learner = byId.get(row.learner_id);
      if (!learner) { endSession.run(key); return null; }
      touch.run(now().toISOString(), key);
      return learner;
    },
    endSession: (token: string) => { endSession.run(hash(token)); },
    dropExpired: () => { dropExpired.run(oldestLive()); },
    close: () => db.close(),
  };
}
export type Accounts = ReturnType<typeof createAccounts>;

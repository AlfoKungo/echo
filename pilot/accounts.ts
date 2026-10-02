// Who uses the friends' Echo, and who is signed in. A learner is a Google email with its own Echo (a port and a
// folder), made at that email's first sign-in; removing one keeps their folder and refuses that email from then on,
// until it is added back, which continues where they left off. A session is a random token in a cookie; only its
// SHA-256 is stored, so a copy of this database signs no one in.
import { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'node:crypto';

export type Learner = { id: string; email: string; name: string; port: number };
export type Friend = Learner & { createdAt: string; removedAt: string | null; lastSeenAt: string | null; devices: number };

// A session lasts this long after its last use: each visit renews it.
export const SESSION_DAYS = 180;
const DAY_MS = 86_400_000;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

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
    );`);
  const byEmail = db.query<Learner & { removed_at: string | null }, [string]>('SELECT id, email, name, port, removed_at FROM learners WHERE email = ?');
  const byId = db.query<Learner, [string]>('SELECT id, email, name, port FROM learners WHERE id = ? AND removed_at IS NULL');
  const insert = db.query('INSERT INTO learners (id, email, name, port, created_at) VALUES (?, ?, ?, ?, ?)');
  const restore = db.query('UPDATE learners SET removed_at = NULL WHERE id = ? AND removed_at IS NOT NULL');
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
    // The learner for a Google sign-in, made on the email's first one with the name Google gives; null for an email
    // that was removed. Who may reach this at all is Google's test-user list (the OAuth app stays in Testing).
    admit(identity: { email: string; name: string }): Learner | null {
      const email = normalEmail(identity.email);
      const row = byEmail.get(email);
      if (row) return row.removed_at ? null : { id: row.id, email: row.email, name: row.name, port: row.port };
      const name = identity.name.trim().slice(0, 40) || email.split('@')[0]!;
      const learner = { id: newId(email), email, name, port: Math.max(options.firstPort - 1, highestPort.get()?.port ?? 0) + 1 };
      insert.run(learner.id, learner.email, learner.name, learner.port, now().toISOString());
      return learner;
    },
    learner: (id: string): Learner | null => byId.get(id) ?? null,
    friends(): Friend[] {
      return all.all(oldestLive()).map((row) => ({ id: row.id, email: row.email, name: row.name, port: row.port, createdAt: row.created_at, removedAt: row.removed_at, lastSeenAt: row.last_seen_at, devices: row.devices }));
    },
    // Lets a removed email sign in again, with its old folder.
    restore(email: unknown): Learner {
      const row = byEmail.get(normalEmail(email));
      if (!row?.removed_at) throw new Error('That email is not among the removed friends.');
      restore.run(row.id);
      return { id: row.id, email: row.email, name: row.name, port: row.port };
    },
    // Takes an email off the list and signs it out everywhere; its folder stays.
    remove(id: string): boolean {
      const removed = markRemoved.run(now().toISOString(), id).changes > 0;
      endSessionsOf.run(id);
      return removed;
    },
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

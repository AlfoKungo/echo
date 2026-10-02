// The friends' Echo allow-list from a shell on this Mac, through the router's admin door (pilot/router.ts):
//   bun pilot/friends.ts                       who is on the list
//   bun pilot/friends.ts add <email> [name]    let a Google email in (an email removed before comes back with its progress)
//   bun pilot/friends.ts remove <email>        take it off the list and sign it out everywhere; its progress is kept
const admin = `http://127.0.0.1:${process.env.PILOT_ADMIN_PORT ?? 7898}`;
type Friend = { id: string; email: string; name: string; removedAt: string | null; lastSeenAt: string | null; devices: number };

async function call<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${admin}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch { throw new Error(`The friends' Echo is not running on this Mac (nothing at ${admin}).`); }
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `The friends' Echo answered ${response.status}.`);
  return data;
}

const [command, email, ...nameWords] = process.argv.slice(2);
try {
  if (!command || command === 'list') {
    const { friends, origin } = await call<{ friends: Friend[]; origin: string }>('/friends');
    for (const friend of friends) console.log(`${friend.removedAt ? 'removed ' : ''}${friend.email}  ${friend.name}  ${friend.lastSeenAt ? `last in ${friend.lastSeenAt.slice(0, 10)}, ${friend.devices} device(s)` : 'not signed in yet'}`);
    console.log(friends.length ? `\nTheir link: ${origin}/` : `Nobody on the list. Their link will be ${origin}/`);
  } else if (command === 'add' && email) {
    const { friend } = await call<{ friend: Friend }>('/friends', { email, name: nameWords.join(' ') });
    console.log(`${friend.email} (${friend.name}) can sign in now.`);
  } else if (command === 'remove' && email) {
    const { friends } = await call<{ friends: Friend[] }>('/friends');
    const friend = friends.find((entry) => entry.email === email.trim().toLowerCase() && !entry.removedAt);
    if (!friend) throw new Error(`${email} is not on the list.`);
    await call('/friends/remove', { id: friend.id });
    console.log(`${friend.email} is off the list and signed out everywhere; their progress is kept.`);
  } else {
    console.error('Usage: bun pilot/friends.ts [list | add <email> [name] | remove <email>]');
    process.exit(2);
  }
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
export {};

// The friends' Echo allow-list from a shell on this Mac, through the router's admin door (pilot/router.ts):
//   bun pilot/friends.ts                       who is on the list, and who tried to sign in while not on it
//   bun pilot/friends.ts add <email> [name]    let a Google email in (an email removed before comes back with its progress);
//                                              without a name, one who tried keeps the name Google gave
//   bun pilot/friends.ts remove <email>        take it off the list and sign it out everywhere; its progress is kept
//   bun pilot/friends.ts dismiss <email>       forget that someone tried to sign in
//   bun pilot/friends.ts open [minutes]        let anyone who signs in with Google join, for an hour or `minutes`
//   bun pilot/friends.ts close                 back to the list only
const admin = `http://127.0.0.1:${process.env.PILOT_ADMIN_PORT ?? 7898}`;
type Friend = { id: string; email: string; name: string; removedAt: string | null; lastSeenAt: string | null; devices: number };
type SignInRequest = { email: string; name: string; lastAt: string; attempts: number };
type Listing = { friends: Friend[]; requests: SignInRequest[]; openUntil: string | null; origin: string };
const clock = (at: string) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

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
    const { friends, requests, openUntil, origin } = await call<Listing>('/friends');
    console.log(openUntil ? `The door is open until ${clock(openUntil)}: anyone who signs in with Google joins.\n` : 'The door is closed: only the list below can sign in.\n');
    if (requests.length) {
      console.log('Tried to sign in:');
      for (const request of requests) console.log(`  ${request.email}  ${request.name}  last tried ${new Date(request.lastAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}${request.attempts > 1 ? `, ${request.attempts} times` : ''}`);
      console.log('');
    }
    for (const friend of friends) console.log(`${friend.removedAt ? 'removed ' : ''}${friend.email}  ${friend.name}  ${friend.lastSeenAt ? `last in ${friend.lastSeenAt.slice(0, 10)}, ${friend.devices} device(s)` : 'not signed in yet'}`);
    console.log(friends.length ? `\nTheir link: ${origin}/` : `Nobody on the list. Their link will be ${origin}/`);
  } else if (command === 'add' && email) {
    const { requests } = await call<Listing>('/friends');
    const name = nameWords.join(' ') || requests.find((request) => request.email === email.trim().toLowerCase())?.name || '';
    const { friend } = await call<{ friend: Friend }>('/friends', { email, name });
    console.log(`${friend.email} (${friend.name}) can sign in now.`);
  } else if (command === 'remove' && email) {
    const { friends } = await call<{ friends: Friend[] }>('/friends');
    const friend = friends.find((entry) => entry.email === email.trim().toLowerCase() && !entry.removedAt);
    if (!friend) throw new Error(`${email} is not on the list.`);
    await call('/friends/remove', { id: friend.id });
    console.log(`${friend.email} is off the list and signed out everywhere; their progress is kept.`);
  } else if (command === 'dismiss' && email) {
    await call('/friends/dismiss', { email });
    console.log(`Forgot that ${email.trim().toLowerCase()} tried to sign in.`);
  } else if (command === 'open') {
    const { openUntil } = await call<{ openUntil: string }>('/friends/door', email === undefined ? {} : { minutes: Number(email) });
    console.log(`The door is open until ${clock(openUntil)}: anyone who signs in with Google joins. It closes by itself then, or run: bun pilot/friends.ts close`);
  } else if (command === 'close') {
    await call('/friends/door', { minutes: 0 });
    console.log('The door is closed: only the list can sign in.');
  } else {
    console.error('Usage: bun pilot/friends.ts [list | add <email> [name] | remove <email> | dismiss <email> | open [minutes] | close]');
    process.exit(2);
  }
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
export {};

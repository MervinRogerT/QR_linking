// Verifies the backend actually enforces permissions — not just the UI.
// Run the server first (`npm start`), then in another terminal: `npm test`.

const BASE = process.env.BASE_URL || 'http://localhost:3001';

let pass = 0, fail = 0;

async function call(userId, method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-user-id': userId || '' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch (e) {}
  return { status: res.status, body: json };
}

function check(desc, condition, extra) {
  if (condition) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${desc}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${desc}\x1b[0m` + (extra ? ` — ${extra}` : '')); }
}

async function main() {
  console.log('\nSealine backend permission tests\n' + '='.repeat(40));

  // ---- Reject unauthenticated / unknown users ----
  console.log('\nAuth');
  let r = await call(null, 'GET', '/api/groups/g1');
  check('No x-user-id header -> 401', r.status === 401);

  r = await call('nonexistent', 'GET', '/api/groups/g1');
  check('Unknown user id -> 401', r.status === 401);

  // ---- Group visibility: any member can view ----
  console.log('\nGroup Info — viewable by every member');
  for (const u of ['u_ss', 'u_am', 'u_si']) {
    r = await call(u, 'GET', '/api/groups/g1');
    check(`${u} (member of group) can view group info -> 200`, r.status === 200);
  }
  r = await call('u_ps', 'GET', '/api/groups/g1'); // Priya is not in the group
  check('Non-member (u_ps) cannot view group info -> 403', r.status === 403);

  // ---- Settings changes: owner/admin only ----
  console.log('\nGroup settings — owner/admin only');
  r = await call('u_si', 'PATCH', '/api/groups/g1/settings', { sendPermission: 'admins' });
  check('Regular member (Sneha) cannot change send permission -> 403', r.status === 403);

  r = await call('u_am', 'PATCH', '/api/groups/g1/settings', { sendPermission: 'admins' });
  check('Admin (Arjun) CAN change send permission -> 200', r.status === 200 && r.body.sendPermission === 'admins');

  // With sendPermission now 'admins', a regular member's message should be rejected
  r = await call('u_si', 'POST', '/api/groups/g1/messages', { text: 'hi everyone' });
  check('Member blocked from sending once group is admins-only -> 403', r.status === 403);
  r = await call('u_am', 'POST', '/api/groups/g1/messages', { text: 'admins can still post' });
  check('Admin can still send when group is admins-only -> 201', r.status === 201);

  // restore for later tests / demo state
  await call('u_ss', 'PATCH', '/api/groups/g1/settings', { sendPermission: 'everyone' });

  r = await call('u_si', 'PATCH', '/api/groups/g1/name', { name: 'Hacked Name' });
  check('Regular member cannot rename group -> 403', r.status === 403);

  r = await call('u_ss', 'PATCH', '/api/groups/g1/name', { name: 'Intern Track — Web' });
  check('Owner CAN rename group -> 200', r.status === 200);

  // ---- Owner protection ----
  console.log('\nOwner protection');
  r = await call('u_am', 'POST', '/api/groups/g1/members/u_ss/promote', {});
  check('Admin cannot touch the owner (promote no-op target) -> 403', r.status === 403);
  r = await call('u_am', 'DELETE', '/api/groups/g1/members/u_ss');
  check('Admin cannot remove the owner -> 403', r.status === 403);
  r = await call('u_ss', 'DELETE', '/api/groups/g1/members/u_ss');
  check('Owner cannot remove themself either -> 403', r.status === 403);

  // ---- Admin managing members ----
  console.log('\nAdmin can manage regular members, not other admins');
  r = await call('u_am', 'POST', '/api/groups/g1/members/u_rk/promote', {});
  check('Admin (Arjun) can promote a regular member (Rahul) -> 200', r.status === 200 && r.body.role === 'admin');

  // Rahul is now an admin — another admin should NOT be able to demote him
  r = await call('u_am', 'POST', '/api/groups/g1/members/u_rk/demote', {});
  check('Admin cannot demote a fellow admin -> 403', r.status === 403);

  // Only the owner can demote an admin
  r = await call('u_ss', 'POST', '/api/groups/g1/members/u_rk/demote', {});
  check('Owner CAN demote an admin -> 200', r.status === 200 && r.body.role === 'member');

  // Member (not admin/owner) cannot promote/remove anyone
  r = await call('u_si', 'POST', '/api/groups/g1/members/u_md/promote', {});
  check('Regular member cannot promote another member -> 403', r.status === 403);
  r = await call('u_si', 'DELETE', '/api/groups/g1/members/u_md');
  check('Regular member cannot remove another member -> 403', r.status === 403);

  // Admin CAN remove a regular member
  r = await call('u_am', 'DELETE', '/api/groups/g1/members/u_ak');
  check('Admin can remove a regular member -> 200', r.status === 200);

  // ---- 1:1 chat flow, fully separate from group logic ----
  console.log('\n1:1 chat — separate flow');
  r = await call('u_ss', 'POST', '/api/dm/start', { contactId: 'u_ps' });
  check('Start a DM with a contact -> 201', r.status === 201);
  const dmChatId = r.body && r.body.chatId;

  r = await call('u_ss', 'POST', `/api/dm/${dmChatId}/messages`, { text: 'hey!' });
  check('Participant can send a DM message -> 201', r.status === 201);

  r = await call('u_am', 'GET', `/api/dm/${dmChatId}/messages`);
  check("Non-participant cannot read someone else's DM -> 403", r.status === 403);

  r = await call('u_ss', 'POST', '/api/dm/start', { contactId: 'u_ps' });
  const r2 = await call('u_ss', 'POST', '/api/dm/start', { contactId: 'u_ps' });
  check('Starting a DM twice reuses the same chat (idempotent)', r.body.chatId === r2.body.chatId);

  console.log('\n' + '='.repeat(40));
  console.log(`${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });

// Sealine — minimal backend for the "New 1:1 Chat" + "Group Info" flows.
//
// The important thing this server demonstrates: permission checks are
// enforced HERE, not in the browser. A client could hide/disable buttons,
// but every write endpoint re-checks the requester's real role against the
// stored group membership before doing anything. If you're not allowed,
// you get a 403 no matter what the UI showed you.
//
// "Login" is simulated with an `x-user-id` header (no passwords needed for
// this prototype) — see /api/users for the list of demo users you can act as.

const express = require('express');
const path = require('path');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// In-memory data store
// ---------------------------------------------------------------------------
const users = {
  u_ss: { id: 'u_ss', name: 'Samson S.', initials: 'SS', color: '' },
  u_am: { id: 'u_am', name: 'Arjun Mehta', initials: 'AM', color: 'linear-gradient(135deg,#EF4444,#FCA5A5)' },
  u_si: { id: 'u_si', name: 'Sneha Iyer', initials: 'SI', color: 'linear-gradient(135deg,#0F9C90,#3FC6B8)' },
  u_rk: { id: 'u_rk', name: 'Rahul K.', initials: 'RK', color: 'linear-gradient(135deg,#8B5CF6,#C4B5FD)' },
  u_md: { id: 'u_md', name: 'Meera D.', initials: 'MD', color: 'linear-gradient(135deg,#F59E0B,#FCD34D)' },
  u_ak: { id: 'u_ak', name: 'Alex K.', initials: 'AK', color: 'linear-gradient(135deg,#6B7280,#9AA0A6)' },
  u_ps: { id: 'u_ps', name: 'Priya Sharma', initials: 'PS', color: '' }, // not in the group — DM-only contact
};

const groups = {
  g1: {
    id: 'g1',
    name: 'Intern Track — Web',
    avatar: 'IT',
    avatarColor: 'linear-gradient(135deg,#6B7280,#9AA0A6)',
    sendPermission: 'everyone', // 'everyone' | 'admins'
    members: [
      { userId: 'u_ss', role: 'owner' },
      { userId: 'u_am', role: 'admin' },
      { userId: 'u_si', role: 'member' },
      { userId: 'u_rk', role: 'member' },
      { userId: 'u_md', role: 'member' },
      { userId: 'u_ak', role: 'member' },
    ],
  },
};

const groupMessages = {
  g1: [
    { id: 'm1', authorId: 'u_am', text: 'pushed the QR flow fix, PR is up', ts: Date.now() - 1000 * 60 * 90 },
    { id: 'm2', authorId: 'u_si', text: 'reviewing now', ts: Date.now() - 1000 * 60 * 88 },
    { id: 'm3', authorId: 'u_ss', text: 'Good — merge once Testing rotation signs off, not before', ts: Date.now() - 1000 * 60 * 85 },
  ],
};

// DM chats, keyed by sorted "userA|userB"
const dmChats = {};
function dmKey(a, b) { return [a, b].sort().join('|'); }

let nextMsgId = 100;
let nextDmId = 1;

// ---------------------------------------------------------------------------
// Auth (simulated) + permission helpers
// ---------------------------------------------------------------------------
function requireUser(req, res, next) {
  const userId = req.header('x-user-id');
  if (!userId || !users[userId]) {
    return res.status(401).json({ error: 'Unauthorized. Send a valid x-user-id header (see GET /api/users).' });
  }
  req.userId = userId;
  next();
}

function getMembership(groupId, userId) {
  const group = groups[groupId];
  if (!group) return null;
  return group.members.find(m => m.userId === userId) || null;
}

function requireGroupMember(req, res, next) {
  const group = groups[req.params.groupId];
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const membership = getMembership(req.params.groupId, req.userId);
  if (!membership) return res.status(403).json({ error: 'You are not a member of this group.' });
  req.group = group;
  req.membership = membership;
  next();
}

function requireGroupAdmin(req, res, next) {
  if (req.membership.role !== 'owner' && req.membership.role !== 'admin') {
    return res.status(403).json({ error: 'Only owners and admins can change group settings.' });
  }
  next();
}

// Server-side source of truth for who can act on whom.
// - The owner can never be managed by anyone (owner protection).
// - Admins can only be demoted/removed by the owner.
// - Regular members can be managed by any owner or admin.
function canManageMember(viewerRole, targetRole) {
  if (targetRole === 'owner') return false;
  if (targetRole === 'admin') return viewerRole === 'owner';
  return viewerRole === 'owner' || viewerRole === 'admin';
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
app.get('/api/users', (req, res) => {
  res.json(Object.values(users));
});

app.get('/api/me', requireUser, (req, res) => {
  res.json(users[req.userId]);
});

// ---------------------------------------------------------------------------
// Chat list (DMs the user is part of + groups the user belongs to)
// ---------------------------------------------------------------------------
app.get('/api/chats', requireUser, (req, res) => {
  const result = [];

  Object.values(dmChats)
    .filter(c => c.participants.includes(req.userId))
    .forEach(c => {
      const otherId = c.participants.find(id => id !== req.userId);
      const other = users[otherId];
      const last = c.messages[c.messages.length - 1];
      result.push({
        chatKey: 'dm:' + c.id, kind: 'dm', chatId: c.id,
        name: other.name, avatar: other.initials, avatarColor: other.color,
        preview: last ? last.text : 'Say hello 👋',
        ts: last ? last.ts : c.createdAt,
      });
    });

  Object.values(groups)
    .filter(g => g.members.some(m => m.userId === req.userId))
    .forEach(g => {
      const msgs = groupMessages[g.id] || [];
      const last = msgs[msgs.length - 1];
      result.push({
        chatKey: 'group:' + g.id, kind: 'group', chatId: g.id,
        name: g.name, avatar: g.avatar, avatarColor: g.avatarColor,
        preview: last ? (users[last.authorId].name.split(' ')[0] + ': ' + last.text) : 'No messages yet',
        ts: last ? last.ts : 0,
      });
    });

  result.sort((a, b) => b.ts - a.ts);
  res.json(result);
});

// ---------------------------------------------------------------------------
// 1:1 chat — "New Chat" flow, kept entirely separate from group logic
// ---------------------------------------------------------------------------
app.post('/api/dm/start', requireUser, (req, res) => {
  const { contactId } = req.body || {};
  if (!contactId || !users[contactId]) return res.status(400).json({ error: 'Unknown contact.' });
  if (contactId === req.userId) return res.status(400).json({ error: "You can't start a chat with yourself." });

  const key = dmKey(req.userId, contactId);
  let chat = dmChats[key];
  if (!chat) {
    chat = { id: 'dm' + nextDmId++, key, participants: [req.userId, contactId], messages: [], createdAt: Date.now() };
    dmChats[key] = chat;
  }
  const other = users[contactId];
  res.status(201).json({ chatId: chat.id, chatKey: 'dm:' + chat.id, name: other.name, avatar: other.initials, avatarColor: other.color });
});

function findDmById(chatId) {
  return Object.values(dmChats).find(c => c.id === chatId);
}

app.get('/api/dm/:chatId/messages', requireUser, (req, res) => {
  const chat = findDmById(req.params.chatId);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  if (!chat.participants.includes(req.userId)) return res.status(403).json({ error: 'Not your chat.' });
  res.json(chat.messages);
});

app.post('/api/dm/:chatId/messages', requireUser, (req, res) => {
  const chat = findDmById(req.params.chatId);
  if (!chat) return res.status(404).json({ error: 'Chat not found' });
  if (!chat.participants.includes(req.userId)) return res.status(403).json({ error: 'Not your chat.' });
  const text = (req.body && req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message text required.' });
  const msg = { id: 'm' + nextMsgId++, authorId: req.userId, text, ts: Date.now() };
  chat.messages.push(msg);
  res.status(201).json(msg);
});

// ---------------------------------------------------------------------------
// Group — viewable by any member, editable only by owner/admin (enforced here)
// ---------------------------------------------------------------------------
app.get('/api/groups/:groupId', requireUser, requireGroupMember, (req, res) => {
  const canEditSettings = req.membership.role === 'owner' || req.membership.role === 'admin';
  res.json({
    id: req.group.id,
    name: req.group.name,
    avatar: req.group.avatar,
    avatarColor: req.group.avatarColor,
    sendPermission: req.group.sendPermission,
    yourRole: req.membership.role,
    canEditSettings, // convenience flag for the UI — the real gate is server-side on the write routes below
    members: req.group.members.map(m => ({
      ...users[m.userId],
      role: m.role,
      isYou: m.userId === req.userId,
      manageable: m.userId !== req.userId && canManageMember(req.membership.role, m.role),
    })),
  });
});

app.get('/api/groups/:groupId/messages', requireUser, requireGroupMember, (req, res) => {
  res.json(groupMessages[req.group.id] || []);
});

app.post('/api/groups/:groupId/messages', requireUser, requireGroupMember, (req, res) => {
  if (req.group.sendPermission === 'admins' && req.membership.role === 'member') {
    return res.status(403).json({ error: 'Only admins can send messages in this group right now.' });
  }
  const text = (req.body && req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Message text required.' });
  const msg = { id: 'm' + nextMsgId++, authorId: req.userId, text, ts: Date.now() };
  (groupMessages[req.group.id] = groupMessages[req.group.id] || []).push(msg);
  res.status(201).json(msg);
});

app.patch('/api/groups/:groupId/settings', requireUser, requireGroupMember, requireGroupAdmin, (req, res) => {
  const { sendPermission } = req.body || {};
  if (!['everyone', 'admins'].includes(sendPermission)) {
    return res.status(400).json({ error: "sendPermission must be 'everyone' or 'admins'." });
  }
  req.group.sendPermission = sendPermission;
  res.json({ ok: true, sendPermission: req.group.sendPermission });
});

app.patch('/api/groups/:groupId/name', requireUser, requireGroupMember, requireGroupAdmin, (req, res) => {
  const name = (req.body && req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name required.' });
  req.group.name = name;
  res.json({ ok: true, name: req.group.name });
});

app.post('/api/groups/:groupId/members/:memberId/promote', requireUser, requireGroupMember, requireGroupAdmin, (req, res) => {
  const target = req.group.members.find(m => m.userId === req.params.memberId);
  if (!target) return res.status(404).json({ error: 'Member not found.' });
  if (!canManageMember(req.membership.role, target.role)) {
    return res.status(403).json({ error: 'You cannot manage this member.' });
  }
  target.role = 'admin';
  res.json({ ok: true, userId: target.userId, role: target.role });
});

app.post('/api/groups/:groupId/members/:memberId/demote', requireUser, requireGroupMember, requireGroupAdmin, (req, res) => {
  const target = req.group.members.find(m => m.userId === req.params.memberId);
  if (!target) return res.status(404).json({ error: 'Member not found.' });
  // Only the owner may demote an admin — enforced here regardless of what the client sent.
  if (target.role !== 'admin' || req.membership.role !== 'owner') {
    return res.status(403).json({ error: 'Only the owner can remove admin status from another admin.' });
  }
  target.role = 'member';
  res.json({ ok: true, userId: target.userId, role: target.role });
});

app.delete('/api/groups/:groupId/members/:memberId', requireUser, requireGroupMember, requireGroupAdmin, (req, res) => {
  const idx = req.group.members.findIndex(m => m.userId === req.params.memberId);
  if (idx === -1) return res.status(404).json({ error: 'Member not found.' });
  const target = req.group.members[idx];
  if (!canManageMember(req.membership.role, target.role)) {
    return res.status(403).json({ error: 'You cannot remove this member.' });
  }
  req.group.members.splice(idx, 1);
  res.json({ ok: true, removed: target.userId });
});

// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3001;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Sealine backend listening on http://localhost:${PORT}`));
}
module.exports = app;

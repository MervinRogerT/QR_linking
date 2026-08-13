let currentUserId = null;
let users = [];
let activeChat = null; // { kind:'dm'|'group', chatId, chatKey }

// ---------- API helper: every call sends x-user-id, and every non-2xx is surfaced, not swallowed ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'x-user-id': currentUserId || '',
      ...(opts.headers || {}),
    },
  });
  let body = null;
  try { body = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const err = new Error((body && body.error) || res.statusText);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { t.className = 'toast'; }, 2600);
}

// ---------- Bootstrap ----------
async function init() {
  users = await api('/api/users');
  const sel = document.getElementById('userSelect');
  sel.innerHTML = users.map(u => `<option value="${u.id}">${u.name}</option>`).join('');
  currentUserId = users[0].id; // default: Samson S. (group owner)
  sel.value = currentUserId;
  sel.onchange = () => { currentUserId = sel.value; onUserSwitched(); };
  await onUserSwitched();
}

async function onUserSwitched() {
  activeChat = null;
  document.getElementById('mainChat').style.display = 'none';
  document.getElementById('mainEmpty').style.display = 'flex';
  closeNewChatPanel();
  closeGroupInfoPanel();
  await refreshRolePill();
  await loadChatList();
}

async function refreshRolePill() {
  const pill = document.getElementById('rolePill');
  try {
    const group = await api('/api/groups/g1');
    pill.textContent = 'Group role: ' + group.yourRole;
  } catch (e) {
    pill.textContent = 'Not in group (DM only)';
  }
}

// ---------- Chat list ----------
async function loadChatList(selectKey) {
  const chats = await api('/api/chats');
  const list = document.getElementById('chatList');
  if (chats.length === 0) {
    list.innerHTML = `<div class="empty-hint">No chats yet. Use the ✎ button to start a 1:1 chat.</div>`;
    return;
  }
  list.innerHTML = chats.map(c => `
    <div class="chat-row ${c.chatKey === selectKey ? 'selected' : ''}" data-key="${c.chatKey}"
         onclick="openChatFromList('${c.kind}','${c.chatId}')">
      <div class="avatar" style="${c.avatarColor ? 'background:' + c.avatarColor + ';' : ''}">${c.avatar}</div>
      <div class="meta">
        <div class="name">${c.name}</div>
        <div class="preview">${escapeHtml(c.preview)}</div>
      </div>
    </div>`).join('');
}

function markSelected(key) {
  document.querySelectorAll('.chat-row').forEach(r => r.classList.toggle('selected', r.dataset.key === key));
}

// ---------- Opening a chat (dm or group) ----------
async function openChatFromList(kind, chatId) {
  if (kind === 'dm') await openDmChat(chatId);
  else await openGroupChat(chatId);
}

async function openDmChat(chatId) {
  const [messages, chats] = await Promise.all([
    api(`/api/dm/${chatId}/messages`),
    api('/api/chats'),
  ]);
  const meta = chats.find(c => c.kind === 'dm' && c.chatId === chatId);
  activeChat = { kind: 'dm', chatId, chatKey: 'dm:' + chatId };
  renderChatHeader({ name: meta.name, sub: '1:1 chat', avatar: meta.avatar, avatarColor: meta.avatarColor, isGroup: false });
  renderMessages(messages, null);
  markSelected(activeChat.chatKey);
}

async function openGroupChat(groupId) {
  const [group, messages] = await Promise.all([
    api(`/api/groups/${groupId}`),
    api(`/api/groups/${groupId}/messages`),
  ]);
  activeChat = { kind: 'group', chatId: groupId, chatKey: 'group:' + groupId };
  renderChatHeader({ name: group.name, sub: `${group.members.length} members · ${group.yourRole}`, avatar: group.avatar, avatarColor: group.avatarColor, isGroup: true, groupId });
  renderMessages(messages, group);
  markSelected(activeChat.chatKey);
}

function renderChatHeader({ name, sub, avatar, avatarColor, isGroup, groupId }) {
  document.getElementById('mainEmpty').style.display = 'none';
  document.getElementById('mainChat').style.display = 'flex';
  document.getElementById('chatAvatar').textContent = avatar;
  document.getElementById('chatAvatar').style.background = avatarColor || '';
  document.getElementById('chatName').textContent = name;
  document.getElementById('chatSub').textContent = sub;
  document.getElementById('chatActions').innerHTML = isGroup
    ? `<button class="icon-btn" title="Group info" onclick="openGroupInfoPanel('${groupId}')">ⓘ</button>` : '';
}

function renderMessages(messages, group) {
  const area = document.getElementById('messagesArea');
  const userMap = Object.fromEntries(users.map(u => [u.id, u]));
  area.innerHTML = messages.length
    ? messages.map(m => {
        const own = m.authorId === currentUserId;
        const authorName = userMap[m.authorId] ? userMap[m.authorId].name : m.authorId;
        return `<div class="msg-row ${own ? 'own' : 'other'}">
          ${(!own && group) ? `<div class="sender">${authorName}</div>` : ''}
          <div class="bubble">${escapeHtml(m.text)}</div>
        </div>`;
      }).join('')
    : `<div class="sys-msg">No messages yet — say hello 👋</div>`;
  area.scrollTop = area.scrollHeight;
}

async function sendCurrentMessage() {
  const input = document.getElementById('composerInput');
  const text = input.value.trim();
  if (!text || !activeChat) return;
  input.value = '';
  try {
    if (activeChat.kind === 'dm') {
      await api(`/api/dm/${activeChat.chatId}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
      const messages = await api(`/api/dm/${activeChat.chatId}/messages`);
      renderMessages(messages, null);
    } else {
      await api(`/api/groups/${activeChat.chatId}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
      const [group, messages] = await Promise.all([
        api(`/api/groups/${activeChat.chatId}`), api(`/api/groups/${activeChat.chatId}/messages`),
      ]);
      renderMessages(messages, group);
    }
    await loadChatList(activeChat.chatKey);
  } catch (e) {
    // Real server-side rejection — e.g. group locked to admins-only sending
    showToast(e.body?.error || e.message, true);
  }
}

// ======================================================================
// NEW CHAT PANEL — starts/opens a 1:1 chat only. No group logic lives here.
// ======================================================================
async function openNewChatPanel() {
  const all = await api('/api/users');
  const contacts = all.filter(u => u.id !== currentUserId);
  document.getElementById('contactList').innerHTML = contacts.map(c => `
    <div class="contact-row" onclick="startDmWith('${c.id}')">
      <div class="avatar" style="${c.color ? 'background:' + c.color + ';' : ''}">${c.initials}</div>
      <div class="name">${c.name}</div>
    </div>`).join('');
  document.getElementById('panel-newchat').classList.add('open');
  document.getElementById('scrim-newchat').classList.add('show');
}
function closeNewChatPanel() {
  document.getElementById('panel-newchat').classList.remove('open');
  document.getElementById('scrim-newchat').classList.remove('show');
}
async function startDmWith(contactId) {
  try {
    const chat = await api('/api/dm/start', { method: 'POST', body: JSON.stringify({ contactId }) });
    closeNewChatPanel();
    await loadChatList(chat.chatKey);
    await openDmChat(chat.chatId);
  } catch (e) {
    showToast(e.body?.error || e.message, true);
  }
}

// ======================================================================
// GROUP INFO PANEL — viewable by any member; every write is re-checked
// server-side, so even a tampered client can't bypass the owner/admin gate.
// ======================================================================
async function openGroupInfoPanel(groupId) {
  document.getElementById('panel-groupinfo').classList.add('open');
  document.getElementById('scrim-groupinfo').classList.add('show');
  await renderGroupInfoPanel(groupId);
}
function closeGroupInfoPanel() {
  document.getElementById('panel-groupinfo').classList.remove('open');
  document.getElementById('scrim-groupinfo').classList.remove('show');
}

async function renderGroupInfoPanel(groupId) {
  const body = document.getElementById('groupInfoBody');
  let group;
  try {
    group = await api(`/api/groups/${groupId}`);
  } catch (e) {
    body.innerHTML = `<div class="err-msg">${e.body?.error || e.message}</div>`;
    return;
  }
  const canEdit = group.canEditSettings; // UI convenience only — server re-checks every write below

  body.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:6px 0 16px;border-bottom:1px solid var(--border);margin-bottom:14px;">
      <div class="avatar" style="width:64px;height:64px;font-size:20px;background:${group.avatarColor};">${group.avatar}</div>
      <div style="font-family:var(--font-display);font-weight:600;font-size:15.5px;">${group.name}</div>
      <div style="font-size:11.5px;color:var(--text-sub);">${group.members.length} members · you are ${group.yourRole}</div>
    </div>

    <div class="field-group">
      <label>Who can send messages</label>
      ${canEdit
        ? `<select class="field-input" id="sendPermSelect" onchange="updateSendPermission('${groupId}', this.value)">
             <option value="everyone" ${group.sendPermission === 'everyone' ? 'selected' : ''}>Everyone</option>
             <option value="admins" ${group.sendPermission === 'admins' ? 'selected' : ''}>Only admins</option>
           </select>`
        : `<div class="field-input" style="background:var(--card2);">${group.sendPermission === 'everyone' ? 'Everyone' : 'Only admins'}
             <span style="color:var(--text-sub);font-size:11px;"> — only owners/admins can change this</span></div>`}
    </div>

    <div class="section-label">Members</div>
    <div id="membersWrap">
      ${group.members.map(m => `
        <div class="contact-row">
          <div class="avatar" style="width:32px;height:32px;font-size:12px;${m.color ? 'background:' + m.color + ';' : ''}">${m.initials}</div>
          <div style="flex:1;">${m.name}${m.isYou ? ' <span style="color:var(--text-sub);font-size:10.5px;">(You)</span>' : ''}
            ${m.role === 'owner' ? '<span class="badge owner">OWNER</span>' : ''}
            ${m.role === 'admin' ? '<span class="badge admin">ADMIN</span>' : ''}
          </div>
          ${m.manageable ? `
            <button class="icon-btn" onclick="event.stopPropagation();toggleMemberMenu('${m.id}')">⋮</button>
            <div class="member-menu" id="menu-${m.id}">
              ${m.role === 'member'
                ? `<button onclick="promoteMember('${groupId}','${m.id}')">Make admin</button>`
                : `<button onclick="demoteMember('${groupId}','${m.id}')">Remove as admin</button>`}
              <button class="danger" onclick="removeMember('${groupId}','${m.id}')">Remove from group</button>
            </div>` : ''}
        </div>`).join('')}
    </div>
    <div class="flag-note">${canEdit
      ? 'Owner protection is active — no admin can remove or demote the owner.'
      : 'Group info is visible to every member. Only owners and admins can change settings, promote members, or remove people. Every action here is re-checked by the server, not just hidden in this screen.'}</div>
  `;
}

function toggleMemberMenu(id) {
  document.querySelectorAll('.member-menu').forEach(el => {
    if (el.id !== 'menu-' + id) el.classList.remove('open');
  });
  document.getElementById('menu-' + id).classList.toggle('open');
}

async function updateSendPermission(groupId, value) {
  try {
    await api(`/api/groups/${groupId}/settings`, { method: 'PATCH', body: JSON.stringify({ sendPermission: value }) });
    showToast('Message permission updated');
  } catch (e) {
    showToast(e.body?.error || e.message, true);
  }
  renderGroupInfoPanel(groupId);
}
async function promoteMember(groupId, memberId) {
  try {
    await api(`/api/groups/${groupId}/members/${memberId}/promote`, { method: 'POST' });
    showToast('Member promoted to admin');
  } catch (e) { showToast(e.body?.error || e.message, true); }
  renderGroupInfoPanel(groupId);
}
async function demoteMember(groupId, memberId) {
  try {
    await api(`/api/groups/${groupId}/members/${memberId}/demote`, { method: 'POST' });
    showToast('Admin status removed');
  } catch (e) { showToast(e.body?.error || e.message, true); }
  renderGroupInfoPanel(groupId);
}
async function removeMember(groupId, memberId) {
  try {
    await api(`/api/groups/${groupId}/members/${memberId}`, { method: 'DELETE' });
    showToast('Member removed');
  } catch (e) { showToast(e.body?.error || e.message, true); }
  renderGroupInfoPanel(groupId);
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

init();

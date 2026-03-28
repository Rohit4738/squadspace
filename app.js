/* ═══════════════════════════════════════════════
   SQUADSPACE · APP.JS
   Auth: Supabase Magic Link
   Storage: Supabase Storage (avatars bucket)
   Persistence: Supabase session (survives refresh/close)
═══════════════════════════════════════════════ */

let db = null;
let currentUser   = null;  // our users table row
let currentFamily = null;
let realtimeSubs  = [];
let pendingAvatarFile = null; // for profile setup
let pendingEditAvatarFile = null; // for edit modal

// ═══════════════════════════════════
// 🚀 BOOT
// ═══════════════════════════════════
window.addEventListener('load', async () => {
  let cfg;
  try {
    const res = await fetch('/api/config');
    cfg = await res.json();
  } catch {
    showToast('Failed to load. Refresh.', 'err');
    return;
  }

  db = supabase.createClient(cfg.url, cfg.key);

  // Listen for auth state changes (handles magic link redirect too)
  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      if (session) {
        await handleSignedInSession(session);
      } else {
        hideLoader();
        showScreen('screen-landing');
      }
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      currentFamily = null;
      hideLoader();
      showScreen('screen-landing');
    }
  });
});

async function handleSignedInSession(session) {
  const authUser = session.user;

  // Check if they have a profile in our users table
  const { data: profile } = await db
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .single();

  if (!profile || !profile.username) {
    // New user — needs to set up profile
    hideLoader();
    showScreen('screen-profile');
    return;
  }

  currentUser = profile;
  updateAllAvatars(profile.avatar_url);

  if (currentUser.family_id) {
    await loadFamilyAndEnter(currentUser.family_id);
  } else {
    hideLoader();
    document.getElementById('display-username').textContent = currentUser.username;
    showScreen('screen-home');
  }
}

function hideLoader() {
  document.getElementById('loader').classList.add('hidden');
}

// ═══════════════════════════════════
// 🔐 AUTH — Magic Link
// ═══════════════════════════════════
async function sendMagicLink() {
  const email = document.getElementById('email-input').value.trim();
  if (!email || !email.includes('@')) {
    showToast('Enter a valid email', 'err'); return;
  }

  const btn = document.getElementById('magic-btn');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'Sending...';

  const { error } = await db.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin }
  });

  if (error) {
    showToast('Could not send link. Try again.', 'err');
    btn.disabled = false;
    btn.querySelector('span').textContent = 'Send Magic Link';
    return;
  }

  document.getElementById('sent-email').textContent = email;
  document.getElementById('auth-form').classList.add('hidden');
  document.getElementById('auth-sent').classList.remove('hidden');
}

function resetAuth() {
  document.getElementById('auth-form').classList.remove('hidden');
  document.getElementById('auth-sent').classList.add('hidden');
  document.getElementById('email-input').value = '';
  const btn = document.getElementById('magic-btn');
  btn.disabled = false;
  btn.querySelector('span').textContent = 'Send Magic Link';
}

async function signOut() {
  realtimeSubs.forEach(s => db.removeChannel(s));
  realtimeSubs = [];
  await db.auth.signOut();
  currentUser = null;
  currentFamily = null;
  showScreen('screen-landing');
  showToast('Signed out', 'ok');
}

// ═══════════════════════════════════
// 👤 PROFILE SETUP (first time)
// ═══════════════════════════════════
function previewAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('Image must be under 2MB', 'err'); return; }
  pendingAvatarFile = file;
  const url = URL.createObjectURL(file);
  const preview = document.getElementById('avatar-preview');
  preview.innerHTML = `<img src="${url}" alt="avatar"/>`;
}

async function saveProfile() {
  const username = document.getElementById('profile-username').value.trim();
  if (!username || username.length < 2) { showToast('Name needs 2+ characters', 'err'); return; }

  const { data: { user: authUser } } = await db.auth.getUser();
  if (!authUser) { showToast('Not signed in', 'err'); return; }

  let avatar_url = null;

  // Upload avatar if provided
  if (pendingAvatarFile) {
    avatar_url = await uploadAvatar(authUser.id, pendingAvatarFile);
  }

  // Upsert into users table using auth user ID
  const { data, error } = await db.from('users')
    .upsert({
      id: authUser.id,
      email: authUser.email,
      username,
      avatar_url,
      family_id: null
    })
    .select().single();

  if (error) { showToast('Could not save profile', 'err'); console.error(error); return; }

  currentUser = data;
  updateAllAvatars(currentUser.avatar_url);
  document.getElementById('display-username').textContent = currentUser.username;
  showScreen('screen-home');
  showToast(`Welcome, ${username}! 🎉`, 'ok');
}

// ═══════════════════════════════════
// ✏️ EDIT PROFILE MODAL
// ═══════════════════════════════════
function openEditProfile() {
  document.getElementById('edit-username').value = currentUser.username;
  // Show current avatar
  const preview = document.getElementById('edit-avatar-preview');
  if (currentUser.avatar_url) {
    preview.innerHTML = `<img src="${currentUser.avatar_url}" alt="avatar"/>`;
  } else {
    preview.innerHTML = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
  }
  pendingEditAvatarFile = null;
  document.getElementById('modal-profile').classList.remove('hidden');
}

function closeEditProfile(e) {
  if (e && e.target !== document.getElementById('modal-profile')) return;
  document.getElementById('modal-profile').classList.add('hidden');
}

function previewEditAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('Image must be under 2MB', 'err'); return; }
  pendingEditAvatarFile = file;
  const url = URL.createObjectURL(file);
  const preview = document.getElementById('edit-avatar-preview');
  preview.innerHTML = `<img src="${url}" alt="avatar"/>`;
}

async function saveEditProfile() {
  const username = document.getElementById('edit-username').value.trim();
  if (!username || username.length < 2) { showToast('Name needs 2+ characters', 'err'); return; }

  let avatar_url = currentUser.avatar_url;

  if (pendingEditAvatarFile) {
    const uploaded = await uploadAvatar(currentUser.id, pendingEditAvatarFile);
    if (uploaded) avatar_url = uploaded;
  }

  const { data, error } = await db.from('users')
    .update({ username, avatar_url })
    .eq('id', currentUser.id)
    .select().single();

  if (error) { showToast('Update failed', 'err'); return; }

  currentUser = data;
  updateAllAvatars(currentUser.avatar_url);
  document.getElementById('display-username').textContent = username;
  document.getElementById('header-username').textContent  = username;
  document.getElementById('modal-profile').classList.add('hidden');
  showToast('Profile updated ✓', 'ok');
}

// ── Upload avatar to Supabase Storage ──
async function uploadAvatar(userId, file) {
  const ext  = file.name.split('.').pop();
  const path = `${userId}/avatar.${ext}`;

  const { error } = await db.storage.from('avatars').upload(path, file, {
    upsert: true, contentType: file.type
  });

  if (error) { showToast('Avatar upload failed', 'err'); console.error(error); return null; }

  const { data } = db.storage.from('avatars').getPublicUrl(path);
  // Add cache-busting to force browser reload of new avatar
  return data.publicUrl + '?t=' + Date.now();
}

// ── Update all avatar elements on screen ──
function updateAllAvatars(url) {
  const els = ['home-avatar', 'dash-avatar'];
  els.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (url) {
      el.innerHTML = `<img src="${url}" alt="avatar"/>`;
    } else {
      el.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
    }
  });
}

// ═══════════════════════════════════
// 🏠 HOME NAV
// ═══════════════════════════════════
function toggleSection(which) {
  const ids  = { create: 'create-section', join: 'join-section' };
  const btns = {
    create: document.querySelector('#card-create .choice-toggle'),
    join:   document.querySelector('#card-join .choice-toggle')
  };
  const target = document.getElementById(ids[which]);
  const isOpen = target.classList.contains('open');

  Object.values(ids).forEach(id => document.getElementById(id).classList.remove('open'));
  Object.values(btns).forEach(b => b && b.classList.remove('hidden-btn'));

  if (!isOpen) {
    target.classList.add('open');
    if (btns[which]) btns[which].classList.add('hidden-btn');
  }
}

// ═══════════════════════════════════
// 👨‍👩‍👧‍👦 FAMILY
// ═══════════════════════════════════
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function createFamily() {
  const name = document.getElementById('family-name-input').value.trim();
  if (!name) { showToast('Enter a squad name!', 'err'); return; }

  const invite_code = genCode();
  const { data: fam, error: e1 } = await db.from('families')
    .insert({ name, invite_code, created_by: currentUser.id, member_count: 1 })
    .select().single();

  if (e1) { showToast('Error creating squad.', 'err'); console.error(e1); return; }

  await db.from('users').update({ family_id: fam.id }).eq('id', currentUser.id);

  currentUser.family_id = fam.id;
  currentFamily = fam;
  enterDashboard();
  showToast(`"${name}" created! Code: ${invite_code}`, 'ok');
}

async function joinFamily() {
  const code = document.getElementById('invite-code-input').value.trim().toUpperCase();
  if (code.length !== 6) { showToast('Code must be 6 characters', 'err'); return; }

  const { data: fam, error } = await db.from('families').select('*').eq('invite_code', code).single();
  if (error || !fam) { showToast('Invalid code!', 'err'); return; }
  if (fam.member_count >= 6) { showToast('Squad is full! (max 6)', 'err'); return; }

  const newCount = fam.member_count + 1;
  await db.from('families').update({ member_count: newCount }).eq('id', fam.id);
  await db.from('users').update({ family_id: fam.id }).eq('id', currentUser.id);

  currentUser.family_id = fam.id;
  currentFamily = { ...fam, member_count: newCount };
  enterDashboard();
  showToast(`Joined "${fam.name}"! 🎉`, 'ok');
}

async function loadFamilyAndEnter(familyId) {
  const { data: fam, error } = await db.from('families').select('*').eq('id', familyId).single();

  if (error || !fam) {
    await db.from('users').update({ family_id: null }).eq('id', currentUser.id);
    currentUser.family_id = null;
    hideLoader();
    document.getElementById('display-username').textContent = currentUser.username;
    showScreen('screen-home');
    return;
  }

  currentFamily = fam;
  enterDashboard();
}

async function leaveFamily() {
  if (!confirm('Leave squad?')) return;

  await db.from('families').update({
    member_count: Math.max(0, currentFamily.member_count - 1)
  }).eq('id', currentFamily.id);
  await db.from('users').update({ family_id: null }).eq('id', currentUser.id);

  realtimeSubs.forEach(s => db.removeChannel(s));
  realtimeSubs = [];
  currentUser.family_id = null;
  currentFamily = null;

  document.getElementById('display-username').textContent = currentUser.username;
  showScreen('screen-home');
  showToast('Left the squad.', 'ok');
}

function copyInviteCode() {
  navigator.clipboard.writeText(currentFamily.invite_code)
    .then(() => showToast('Code copied! 📋', 'ok'))
    .catch(() => showToast(currentFamily.invite_code, 'ok'));
}

// ═══════════════════════════════════
// 🎮 GAME REQUESTS
// ═══════════════════════════════════
async function addGameRequest() {
  const input = document.getElementById('game-input');
  const game_name = input.value.trim();
  if (!game_name) { showToast('Enter a game name!', 'err'); return; }

  const { error } = await db.from('game_requests').insert({
    family_id:    currentFamily.id,
    requested_by: currentUser.id,
    username:     currentUser.username,
    game_name
  });
  if (error) { showToast('Failed to add.', 'err'); return; }
  input.value = '';
}

function gameHTML(r) {
  const avatarHTML = r.avatar_url
    ? `<div class="feed-avatar"><img src="${r.avatar_url}" alt=""/></div>`
    : `<div class="feed-avatar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg></div>`;
  return `<div class="feed-item">
    <div class="meta">${avatarHTML}<span class="who">${esc(r.username)}</span><span>·</span><span>${ago(r.created_at)}</span></div>
    <div class="content">${esc(r.game_name)}</div>
  </div>`;
}

async function loadGames() {
  // Join with users to get avatar
  const { data } = await db.from('game_requests')
    .select('*, users(avatar_url)')
    .eq('family_id', currentFamily.id)
    .order('created_at', { ascending: false });

  const el = document.getElementById('game-list');
  if (!data || !data.length) {
    el.innerHTML = '<div class="empty-msg">no requests yet — suggest one!</div>';
    updateCount('games-count', 0); return;
  }
  // Merge avatar_url from joined users table
  const enriched = data.map(r => ({ ...r, avatar_url: r.users?.avatar_url || null }));
  el.innerHTML = enriched.map(gameHTML).join('');
  updateCount('games-count', data.length);
}

// ═══════════════════════════════════
// 📝 CHECKPOINTS
// ═══════════════════════════════════
async function addCheckpoint() {
  const input = document.getElementById('checkpoint-input');
  const content = input.value.trim();
  if (!content) { showToast('Write something!', 'err'); return; }

  const { error } = await db.from('checkpoints').insert({
    family_id: currentFamily.id,
    user_id:   currentUser.id,
    username:  currentUser.username,
    content
  });
  if (error) { showToast('Failed to post.', 'err'); return; }
  input.value = '';
}

function checkpointHTML(c) {
  const avatarHTML = c.avatar_url
    ? `<div class="feed-avatar"><img src="${c.avatar_url}" alt=""/></div>`
    : `<div class="feed-avatar"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg></div>`;
  return `<div class="feed-item">
    <div class="meta">${avatarHTML}<span class="who">${esc(c.username)}</span><span>·</span><span>${ago(c.created_at)}</span></div>
    <div class="content">${esc(c.content)}</div>
  </div>`;
}

async function loadCheckpoints() {
  const { data } = await db.from('checkpoints')
    .select('*, users(avatar_url)')
    .eq('family_id', currentFamily.id)
    .order('created_at', { ascending: false });

  const el = document.getElementById('checkpoint-list');
  if (!data || !data.length) {
    el.innerHTML = '<div class="empty-msg">no checkpoints yet — be first!</div>';
    updateCount('checkpoints-count', 0); return;
  }
  const enriched = data.map(c => ({ ...c, avatar_url: c.users?.avatar_url || null }));
  el.innerHTML = enriched.map(checkpointHTML).join('');
  updateCount('checkpoints-count', data.length);
}

// ═══════════════════════════════════
// ⚡ REALTIME
// ═══════════════════════════════════
function subscribeRealtime() {
  const fid = currentFamily.id;

  const gameSub = db.channel('games-' + fid)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public',
      table: 'game_requests', filter: `family_id=eq.${fid}`
    }, async p => {
      // Fetch poster's avatar
      const { data: u } = await db.from('users').select('avatar_url').eq('id', p.new.requested_by).single();
      const enriched = { ...p.new, avatar_url: u?.avatar_url || null };
      const el = document.getElementById('game-list');
      el.querySelector('.empty-msg')?.remove();
      el.insertAdjacentHTML('afterbegin', gameHTML(enriched));
      updateCount('games-count', el.querySelectorAll('.feed-item').length);
    }).subscribe();

  const cpSub = db.channel('cp-' + fid)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public',
      table: 'checkpoints', filter: `family_id=eq.${fid}`
    }, async p => {
      const { data: u } = await db.from('users').select('avatar_url').eq('id', p.new.user_id).single();
      const enriched = { ...p.new, avatar_url: u?.avatar_url || null };
      const el = document.getElementById('checkpoint-list');
      el.querySelector('.empty-msg')?.remove();
      el.insertAdjacentHTML('afterbegin', checkpointHTML(enriched));
      updateCount('checkpoints-count', el.querySelectorAll('.feed-item').length);
    }).subscribe();

  realtimeSubs = [gameSub, cpSub];
}

// ═══════════════════════════════════
// 🖥️ DASHBOARD
// ═══════════════════════════════════
function enterDashboard() {
  document.getElementById('family-name-display').textContent  = currentFamily.name;
  document.getElementById('invite-code-display').textContent  = currentFamily.invite_code;
  document.getElementById('member-count-display').textContent = `${currentFamily.member_count}/6`;
  document.getElementById('header-username').textContent      = currentUser.username;
  updateAllAvatars(currentUser.avatar_url);
  hideLoader();
  showScreen('screen-family');
  loadGames();
  loadCheckpoints();
  subscribeRealtime();
}

// ═══════════════════════════════════
// 🛠️ UTILITIES
// ═══════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

let _tt;
function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(_tt);
  _tt = setTimeout(() => t.classList.remove('show'), 3200);
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

function ago(ts) {
  const m = Math.floor((Date.now() - new Date(ts)) / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function updateCount(id, n) {
  const el = document.getElementById(id);
  if (el) el.textContent = n;
}

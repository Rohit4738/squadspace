/* ═══════════════════════════════════════════════
   SQUADSPACE · APP.JS
   v3 — bulletproof loader, never gets stuck
═══════════════════════════════════════════════ */

let db = null;
let currentUser       = null;
let currentFamily     = null;
let realtimeSubs      = [];
let pendingAvatarFile = null;
let pendingEditFile   = null;
let googleAvatarUrl   = null;
let loaderDone        = false; // guard: only hide loader once

// ═══════════════════════════════════
// 🚀 BOOT
// ═══════════════════════════════════
window.addEventListener('load', async () => {

  // Hard timeout — no matter what happens, escape the loader in 5s
  setTimeout(escapeLoader, 5000);

  let cfg;
  try {
    const res = await fetch('/api/config');
    cfg = await res.json();
  } catch {
    escapeLoader();
    showToast('Connection error. Check your internet.', 'err');
    return;
  }

  if (!cfg?.url || !cfg?.key) {
    escapeLoader();
    showToast('App config missing.', 'err');
    return;
  }

  try {
    db = supabase.createClient(cfg.url, cfg.key);
  } catch {
    escapeLoader();
    return;
  }

  // onAuthStateChange fires immediately with INITIAL_SESSION
  // On mobile after Google OAuth it fires SIGNED_IN
  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      if (session) {
        await handleSession(session);
      } else {
        escapeLoader();
      }
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      currentFamily = null;
      realtimeSubs.forEach(s => db.removeChannel(s));
      realtimeSubs = [];
      escapeLoader();
    }
  });
});

// Always-safe loader hide — shows landing if no screen is active yet
function escapeLoader() {
  if (loaderDone) return;
  loaderDone = true;
  document.getElementById('loader').classList.add('hidden');
  // If no screen was activated yet, show landing
  const anyActive = document.querySelector('.screen.active');
  if (!anyActive) showScreen('screen-landing');
}

async function handleSession(session) {
  try {
    const authUser = session.user;
    googleAvatarUrl = authUser.user_metadata?.avatar_url || null;

    const { data: profile, error } = await db
      .from('users').select('*').eq('id', authUser.id).single();

    // PGRST116 = no row found = new user, that's fine
    if (error && error.code !== 'PGRST116') throw error;

    if (!profile?.username) {
      prefillProfileSetup(authUser);
      showScreen('screen-profile');
      escapeLoader();
      return;
    }

    currentUser = profile;
    renderAvatarEl('home-avatar', profile.avatar_url, profile.username);
    renderAvatarEl('dash-avatar', profile.avatar_url, profile.username);

    if (currentUser.family_id) {
      await loadFamilyAndEnter(currentUser.family_id);
    } else {
      document.getElementById('display-username').textContent = currentUser.username;
      showScreen('screen-home');
      escapeLoader();
    }
  } catch (e) {
    console.error('handleSession error:', e);
    escapeLoader();
    showToast('Something went wrong. Try signing in again.', 'err');
  }
}

function prefillProfileSetup(authUser) {
  const name = authUser.user_metadata?.full_name || authUser.user_metadata?.name || '';
  if (name) {
    const suggested = name.split(' ')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
    document.getElementById('profile-username').value = suggested;
  }
  const preview = document.getElementById('avatar-preview');
  preview.innerHTML = googleAvatarUrl
    ? `<img src="${googleAvatarUrl}" alt="avatar"/>`
    : defaultAvatarSVG(22);
}

// ═══════════════════════════════════
// 🔐 AUTH
// ═══════════════════════════════════
async function signInWithGoogle() {
  const btn = document.getElementById('google-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Opening Google...'; }

  try {
    const { error } = await db.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: { prompt: 'select_account' }
      }
    });
    if (error) throw error;
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = googleBtnHTML(); }
    showToast('Google sign-in failed. Try again.', 'err');
    console.error(e);
  }
}

function googleBtnHTML() {
  return `<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>Continue with Google`;
}

async function signOut() {
  realtimeSubs.forEach(s => db.removeChannel(s));
  realtimeSubs = [];
  loaderDone = false;
  await db.auth.signOut();
}

// ═══════════════════════════════════
// 👤 PROFILE SETUP
// ═══════════════════════════════════
function previewAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('Max 2MB', 'err'); return; }
  pendingAvatarFile = file;
  document.getElementById('avatar-preview').innerHTML =
    `<img src="${URL.createObjectURL(file)}" alt="avatar"/>`;
}

async function saveProfile(skipPhoto = false) {
  const username = document.getElementById('profile-username').value.trim();
  if (!username || username.length < 2) { showToast('Name needs 2+ characters', 'err'); return; }

  const { data: { user: authUser } } = await db.auth.getUser();
  if (!authUser) { showToast('Not signed in', 'err'); return; }

  let avatar_url = null;
  if (!skipPhoto && pendingAvatarFile) {
    avatar_url = await uploadAvatar(authUser.id, pendingAvatarFile);
  } else if (!skipPhoto && googleAvatarUrl) {
    avatar_url = googleAvatarUrl;
  }

  const { data, error } = await db.from('users')
    .upsert({ id: authUser.id, email: authUser.email, username, avatar_url, family_id: null })
    .select().single();

  if (error) { showToast('Could not save profile', 'err'); console.error(error); return; }

  currentUser = data;
  renderAvatarEl('home-avatar', currentUser.avatar_url, currentUser.username);
  document.getElementById('display-username').textContent = currentUser.username;
  showScreen('screen-home');
  showToast(`Welcome, ${username}! 🎉`, 'ok');
}

// ═══════════════════════════════════
// ✏️ EDIT PROFILE
// ═══════════════════════════════════
function openEditProfile() {
  document.getElementById('edit-username').value = currentUser.username;
  document.getElementById('edit-avatar-preview').innerHTML = currentUser.avatar_url
    ? `<img src="${currentUser.avatar_url}" alt="avatar"/>`
    : defaultAvatarSVG(20);
  pendingEditFile = null;
  document.getElementById('modal-profile').classList.remove('hidden');
}

function closeEditProfile(e) {
  if (e && e.target !== document.getElementById('modal-profile')) return;
  document.getElementById('modal-profile').classList.add('hidden');
}

function previewEditAvatar(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('Max 2MB', 'err'); return; }
  pendingEditFile = file;
  document.getElementById('edit-avatar-preview').innerHTML =
    `<img src="${URL.createObjectURL(file)}" alt="avatar"/>`;
}

async function saveEditProfile() {
  const username = document.getElementById('edit-username').value.trim();
  if (!username || username.length < 2) { showToast('Name needs 2+ characters', 'err'); return; }
  let avatar_url = currentUser.avatar_url;
  if (pendingEditFile) {
    const up = await uploadAvatar(currentUser.id, pendingEditFile);
    if (up) avatar_url = up;
  }
  const { data, error } = await db.from('users')
    .update({ username, avatar_url }).eq('id', currentUser.id).select().single();
  if (error) { showToast('Update failed', 'err'); return; }
  currentUser = data;
  renderAvatarEl('home-avatar', currentUser.avatar_url, currentUser.username);
  renderAvatarEl('dash-avatar', currentUser.avatar_url, currentUser.username);
  document.getElementById('display-username').textContent = username;
  document.getElementById('header-username').textContent  = username;
  document.getElementById('modal-profile').classList.add('hidden');
  showToast('Profile updated ✓', 'ok');
}

// ═══════════════════════════════════
// 📦 AVATAR
// ═══════════════════════════════════
async function uploadAvatar(userId, file) {
  const ext = file.name.split('.').pop();
  const path = `${userId}/avatar.${ext}`;
  const { error } = await db.storage.from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) { showToast('Upload failed', 'err'); return null; }
  const { data } = db.storage.from('avatars').getPublicUrl(path);
  return data.publicUrl + '?t=' + Date.now();
}

function renderAvatarEl(elId, avatarUrl, username) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (avatarUrl) {
    el.innerHTML = `<img src="${avatarUrl}" alt=""/>`;
    el.style.cssText = '';
  } else {
    el.textContent = (username || '?').slice(0, 2).toUpperCase();
    el.style.background = stringToColor(username || '');
    el.style.color = '#0a0a0c';
    el.style.fontSize = '0.65rem';
    el.style.fontWeight = '700';
  }
}

function feedAvatarHTML(avatarUrl, username) {
  if (avatarUrl) return `<div class="feed-avatar"><img src="${avatarUrl}" alt=""/></div>`;
  const i = (username || '?').slice(0, 2).toUpperCase();
  return `<div class="feed-avatar" style="background:${stringToColor(username)};color:#0a0a0c;font-size:0.55rem;font-weight:700">${i}</div>`;
}

function defaultAvatarSVG(s) {
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
}

function stringToColor(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360},65%,58%)`;
}

// ═══════════════════════════════════
// 🏠 HOME
// ═══════════════════════════════════
function toggleSection(which) {
  const ids = { create: 'create-section', join: 'join-section' };
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
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => c[Math.floor(Math.random() * c.length)]).join('');
}

async function createFamily() {
  const name = document.getElementById('family-name-input').value.trim();
  if (!name) { showToast('Enter a squad name!', 'err'); return; }
  const invite_code = genCode();
  const { data: fam, error } = await db.from('families')
    .insert({ name, invite_code, created_by: currentUser.id, member_count: 1 })
    .select().single();
  if (error) { showToast('Error creating squad.', 'err'); console.error(error); return; }
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
    document.getElementById('display-username').textContent = currentUser.username;
    showScreen('screen-home');
    escapeLoader();
    return;
  }
  currentFamily = fam;
  enterDashboard();
}

async function leaveFamily() {
  if (!confirm('Leave squad?')) return;
  await db.from('families').update({ member_count: Math.max(0, currentFamily.member_count - 1) }).eq('id', currentFamily.id);
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
    family_id: currentFamily.id, requested_by: currentUser.id,
    username: currentUser.username, game_name
  });
  if (error) { showToast('Failed to add.', 'err'); console.error(error); return; }
  input.value = '';
}

function gameHTML(r) {
  return `<div class="feed-item">
    <div class="meta">${feedAvatarHTML(r.avatar_url, r.username)}<span class="who">${esc(r.username)}</span><span>·</span><span>${ago(r.created_at)}</span></div>
    <div class="content">${esc(r.game_name)}</div>
  </div>`;
}

async function loadGames() {
  const { data } = await db.from('game_requests')
    .select('*, users(avatar_url)').eq('family_id', currentFamily.id)
    .order('created_at', { ascending: false });
  const el = document.getElementById('game-list');
  if (!data?.length) {
    el.innerHTML = '<div class="empty-msg">no requests yet — suggest one!</div>';
    updateCount('games-count', 0); return;
  }
  el.innerHTML = data.map(r => gameHTML({ ...r, avatar_url: r.users?.avatar_url || null })).join('');
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
    family_id: currentFamily.id, user_id: currentUser.id,
    username: currentUser.username, content
  });
  if (error) { showToast('Failed to post.', 'err'); console.error(error); return; }
  input.value = '';
}

function checkpointHTML(c) {
  return `<div class="feed-item">
    <div class="meta">${feedAvatarHTML(c.avatar_url, c.username)}<span class="who">${esc(c.username)}</span><span>·</span><span>${ago(c.created_at)}</span></div>
    <div class="content">${esc(c.content)}</div>
  </div>`;
}

async function loadCheckpoints() {
  const { data } = await db.from('checkpoints')
    .select('*, users(avatar_url)').eq('family_id', currentFamily.id)
    .order('created_at', { ascending: false });
  const el = document.getElementById('checkpoint-list');
  if (!data?.length) {
    el.innerHTML = '<div class="empty-msg">no checkpoints yet — be first!</div>';
    updateCount('checkpoints-count', 0); return;
  }
  el.innerHTML = data.map(c => checkpointHTML({ ...c, avatar_url: c.users?.avatar_url || null })).join('');
  updateCount('checkpoints-count', data.length);
}

// ═══════════════════════════════════
// ⚡ REALTIME
// ═══════════════════════════════════
function subscribeRealtime() {
  const fid = currentFamily.id;
  const gameSub = db.channel('games-' + fid)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'game_requests', filter: `family_id=eq.${fid}` },
      async p => {
        const { data: u } = await db.from('users').select('avatar_url').eq('id', p.new.requested_by).single();
        const el = document.getElementById('game-list');
        el.querySelector('.empty-msg')?.remove();
        el.insertAdjacentHTML('afterbegin', gameHTML({ ...p.new, avatar_url: u?.avatar_url || null }));
        updateCount('games-count', el.querySelectorAll('.feed-item').length);
      }).subscribe();

  const cpSub = db.channel('cp-' + fid)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'checkpoints', filter: `family_id=eq.${fid}` },
      async p => {
        const { data: u } = await db.from('users').select('avatar_url').eq('id', p.new.user_id).single();
        const el = document.getElementById('checkpoint-list');
        el.querySelector('.empty-msg')?.remove();
        el.insertAdjacentHTML('afterbegin', checkpointHTML({ ...p.new, avatar_url: u?.avatar_url || null }));
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
  renderAvatarEl('dash-avatar', currentUser.avatar_url, currentUser.username);
  renderAvatarEl('home-avatar', currentUser.avatar_url, currentUser.username);
  showScreen('screen-family');
  escapeLoader();
  loadGames();
  loadCheckpoints();
  subscribeRealtime();
}

// ═══════════════════════════════════
// 🛠️ UTILS
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
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function updateCount(id, n) {
  const el = document.getElementById(id);
  if (el) el.textContent = n;
}

// SquadSpace — app.js
// Supabase credentials are loaded from /api/config (server-side)
// They are NEVER hardcoded here

let db = null;
let currentUser   = null;
let currentFamily = null;
let realtimeSubs  = [];

// ── BOOT ──
window.addEventListener('load', async () => {
  let cfg;
  try {
    const res = await fetch('/api/config');
    cfg = await res.json();
  } catch (e) {
    showToast('Failed to load app. Refresh.', 'err');
    return;
  }

  if (!cfg.url || !cfg.key) {
    showToast('Config missing. Check Vercel env vars.', 'err');
    return;
  }

  db = supabase.createClient(cfg.url, cfg.key);

  const saved = loadLocal();
  if (!saved) { hideLoader(); showScreen('screen-username'); return; }

  const { data: dbUser, error } = await db
    .from('users').select('*').eq('id', saved.id).single();

  if (error || !dbUser) { hideLoader(); showScreen('screen-username'); return; }

  currentUser = dbUser;
  saveLocal(currentUser);

  if (currentUser.family_id) {
    await loadFamilyAndEnter(currentUser.family_id);
  } else {
    hideLoader();
    document.getElementById('display-username').textContent = currentUser.username;
    showScreen('screen-home');
  }
});

function hideLoader() {
  document.getElementById('loader').classList.add('hidden');
}

// ── LOCAL STORAGE ──
function loadLocal() {
  try { return JSON.parse(localStorage.getItem('sq_user')); }
  catch { return null; }
}
function saveLocal(u) {
  localStorage.setItem('sq_user', JSON.stringify(u));
}

// ── USER ──
function genId() {
  return 'u_' + Math.random().toString(36).slice(2, 11);
}

async function saveUsername() {
  const raw = document.getElementById('username-input').value.trim();
  if (!raw || raw.length < 2) { showToast('Name needs 2+ characters', 'err'); return; }

  const id = genId();
  const { data, error } = await db
    .from('users').insert({ id, username: raw, family_id: null })
    .select().single();

  if (error) { showToast('Could not save. Try again.', 'err'); return; }

  currentUser = data;
  saveLocal(currentUser);
  document.getElementById('display-username').textContent = currentUser.username;
  showScreen('screen-home');
  showToast(`Welcome, ${raw}! 🎉`, 'ok');
}

async function changeUsername() {
  const n = prompt('New username:', currentUser.username);
  if (!n || !n.trim()) return;
  const trimmed = n.trim().slice(0, 20);
  if (trimmed === currentUser.username) return;

  const { error } = await db.from('users')
    .update({ username: trimmed }).eq('id', currentUser.id);
  if (error) { showToast('Update failed.', 'err'); return; }

  currentUser.username = trimmed;
  saveLocal(currentUser);
  document.getElementById('display-username').textContent  = trimmed;
  document.getElementById('header-username').textContent   = trimmed;
  showToast('Name updated ✓', 'ok');
}

// ── HOME TOGGLES ──
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

// ── FAMILY ──
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length: 6}, () =>
    chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function createFamily() {
  const name = document.getElementById('family-name-input').value.trim();
  if (!name) { showToast('Enter a squad name!', 'err'); return; }

  const invite_code = genCode();
  const { data: fam, error: e1 } = await db
    .from('families')
    .insert({ name, invite_code, created_by: currentUser.id, member_count: 1 })
    .select().single();

  if (e1) { showToast('Error creating squad.', 'err'); return; }

  await db.from('users').update({ family_id: fam.id }).eq('id', currentUser.id);

  currentUser.family_id = fam.id;
  saveLocal(currentUser);
  currentFamily = fam;
  enterDashboard();
  showToast(`"${name}" created!  Code: ${invite_code}`, 'ok');
}

async function joinFamily() {
  const code = document.getElementById('invite-code-input').value.trim().toUpperCase();
  if (code.length !== 6) { showToast('Code must be 6 characters', 'err'); return; }

  const { data: fam, error } = await db
    .from('families').select('*').eq('invite_code', code).single();

  if (error || !fam) { showToast('Invalid code!', 'err'); return; }
  if (fam.member_count >= 6) { showToast('Squad is full! (max 6)', 'err'); return; }

  const newCount = fam.member_count + 1;
  await db.from('families').update({ member_count: newCount }).eq('id', fam.id);
  await db.from('users').update({ family_id: fam.id }).eq('id', currentUser.id);

  currentUser.family_id = fam.id;
  saveLocal(currentUser);
  currentFamily = { ...fam, member_count: newCount };
  enterDashboard();
  showToast(`Joined "${fam.name}"! 🎉`, 'ok');
}

async function loadFamilyAndEnter(familyId) {
  const { data: fam, error } = await db
    .from('families').select('*').eq('id', familyId).single();

  if (error || !fam) {
    currentUser.family_id = null;
    saveLocal(currentUser);
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
  saveLocal(currentUser);

  document.getElementById('display-username').textContent = currentUser.username;
  showScreen('screen-home');
  showToast('Left the squad.', 'ok');
}

function copyInviteCode() {
  navigator.clipboard.writeText(currentFamily.invite_code)
    .then(() => showToast('Code copied! 📋', 'ok'))
    .catch(()  => showToast(currentFamily.invite_code, 'ok'));
}

// ── GAME REQUESTS ──
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
  return `<div class="feed-item">
    <div class="meta"><span class="who">${esc(r.username)}</span><span>·</span><span>${ago(r.created_at)}</span></div>
    <div class="content">${esc(r.game_name)}</div>
  </div>`;
}

async function loadGames() {
  const { data } = await db.from('game_requests').select('*')
    .eq('family_id', currentFamily.id).order('created_at', { ascending: false });
  const el = document.getElementById('game-list');
  if (!data || !data.length) {
    el.innerHTML = '<div class="empty-msg">no requests yet — suggest one!</div>';
    updateCount('games-count', 0); return;
  }
  el.innerHTML = data.map(gameHTML).join('');
  updateCount('games-count', data.length);
}

// ── CHECKPOINTS ──
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
  return `<div class="feed-item">
    <div class="meta"><span class="who">${esc(c.username)}</span><span>·</span><span>${ago(c.created_at)}</span></div>
    <div class="content">${esc(c.content)}</div>
  </div>`;
}

async function loadCheckpoints() {
  const { data } = await db.from('checkpoints').select('*')
    .eq('family_id', currentFamily.id).order('created_at', { ascending: false });
  const el = document.getElementById('checkpoint-list');
  if (!data || !data.length) {
    el.innerHTML = '<div class="empty-msg">no checkpoints yet — be first!</div>';
    updateCount('checkpoints-count', 0); return;
  }
  el.innerHTML = data.map(checkpointHTML).join('');
  updateCount('checkpoints-count', data.length);
}

// ── REALTIME ──
function subscribeRealtime() {
  const fid = currentFamily.id;

  const gameSub = db.channel('games-' + fid)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public',
      table: 'game_requests', filter: `family_id=eq.${fid}`
    }, p => {
      const el = document.getElementById('game-list');
      el.querySelector('.empty-msg')?.remove();
      el.insertAdjacentHTML('afterbegin', gameHTML(p.new));
      updateCount('games-count', el.querySelectorAll('.feed-item').length);
    }).subscribe();

  const cpSub = db.channel('cp-' + fid)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public',
      table: 'checkpoints', filter: `family_id=eq.${fid}`
    }, p => {
      const el = document.getElementById('checkpoint-list');
      el.querySelector('.empty-msg')?.remove();
      el.insertAdjacentHTML('afterbegin', checkpointHTML(p.new));
      updateCount('checkpoints-count', el.querySelectorAll('.feed-item').length);
    }).subscribe();

  realtimeSubs = [gameSub, cpSub];
}

// ── DASHBOARD ──
function enterDashboard() {
  document.getElementById('family-name-display').textContent  = currentFamily.name;
  document.getElementById('invite-code-display').textContent  = currentFamily.invite_code;
  document.getElementById('member-count-display').textContent = `${currentFamily.member_count}/6`;
  document.getElementById('header-username').textContent      = currentUser.username;
  hideLoader();
  showScreen('screen-family');
  loadGames();
  loadCheckpoints();
  subscribeRealtime();
}

// ── UTILS ──
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

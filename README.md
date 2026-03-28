<div align="center">

<br/>

```
███████╗███████╗
██╔════╝██╔════╝
███████╗███████╗
╚════██║╚════██║
███████║███████║
╚══════╝╚══════╝
```

# SquadSpace

**Your private crew. Your world.**

[![Live](https://img.shields.io/badge/LIVE-squadspace.vercel.app-c8ff00?style=for-the-badge&labelColor=0a0a0c)](https://squadspace.vercel.app)
[![Vercel](https://img.shields.io/badge/Vercel-deployed-white?style=for-the-badge&logo=vercel&logoColor=black&labelColor=0a0a0c)](https://vercel.com)
[![Supabase](https://img.shields.io/badge/Supabase-postgres-3ecf8e?style=for-the-badge&logo=supabase&logoColor=white&labelColor=0a0a0c)](https://supabase.com)

<br/>

</div>

---

## What is this?

A private space for your friend group. No accounts. No algorithm. No strangers.

Create a squad, share a 6-letter code, and your crew gets a shared space to request games and post life updates — all syncing in real time across everyone's screen.

<br/>

## Features

```
👤  Instant identity      — pick a name, you're in. stored locally.
👨‍👩‍👧‍👦  Private squads        — up to 6 people per group
🔑  Invite codes          — 6-letter codes like XK92PL to join
🎮  Game requests          — suggest what to play next
📝  Checkpoints           — drop life updates for your crew
⚡  Realtime sync         — posts appear instantly for everyone
```

<br/>

## Stack

| | Tool | Role |
|---|---|---|
| 🖥️ | HTML · CSS · JS | Frontend — zero frameworks |
| 🚀 | Vercel | Hosting + serverless API |
| 🗄️ | Supabase | Postgres database + realtime |
| 📦 | GitHub | Source & auto-deploy trigger |

<br/>

## How It Works

```
Browser
  │
  ├─► GET /api/config ──► Vercel Serverless Fn
  │                              │
  │                     reads env vars securely
  │                              │
  │◄─────── { url, key } ────────┘
  │
  └─► Supabase Client initializes
            │
            ├─► REST API  ──► read/write data
            └─► Realtime  ──► live push events
```

Your Supabase key never touches the frontend source code. It lives in Vercel's environment and is served at runtime via `/api/config` — a server-side function the browser calls on load.

<br/>

## Database

```sql
families       — squads (id, name, invite_code, member_count)
users          — members (id, username, family_id)
game_requests  — suggestions (family_id, username, game_name)
checkpoints    — posts (family_id, username, content)
```

All tables have **Row Level Security** enabled.

<br/>

## Project Structure

```
squadspace/
├── index.html        ← 3 screens: username · home · dashboard
├── style.css         ← dark industrial theme · Syne + DM Mono
├── app.js            ← all logic · no framework · ~300 lines
├── vercel.json       ← deployment config
└── api/
    └── config.js     ← serverless fn · serves credentials safely
```

<br/>

---

<div align="center">

Built with HTML, CSS, JS, Vercel, and Supabase · 100% free to run

</div>

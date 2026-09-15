# 🚀 SaaSGateway

**Professional SaaS API Hub & Gateway** — Satu API key untuk ratusan endpoint.

Platform API gateway lengkap dengan admin panel, user dashboard, credit system, playground interaktif, dan sandbox handler_code untuk setiap route.

---

## ✨ Fitur

| Fitur | Deskripsi |
|-------|-----------|
| 🔑 **API Key Management** | Buat,ikelola, dan revoke API keys dengan scope granularity |
| 💳 **Credit System** | Pay-per-use dengan credit balance, top-up, dan transaksi |
| 🎮 **Playground** | Test API langsung dari browser tanpa setup apapun |
| 🛡️ **VM Sandbox** | Handler code dijalankan di isolasi — aman dari abuse |
| 📊 **Analytics** | Dashboard admin & user dengan logs, charts, dan stats |
| 🔒 **Security** | Rate limiting, IP block, security check, CSP headers |
| 🏷️ **Packages** | FREE, PRO, VIP + custom package dengan rate limit configur |
| 💰 **Transaksi** | Top-up via bank transfer dengan approval workflow |
| 🔗 **Referral** | Referral system untuk user acquisition |
| 🎨 **Responsive UI** | Tailwind CSS 4, clean & modern design |

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js v20+ |
| Framework | Express.js |
| Database | MariaDB 10.4+ (mysql2) |
| Template | EJS |
| Styling | Tailwind CSS 4 |
| Auth | express-session + bcrypt |
| Security | helmet, cors, rate-limit |

---

## 📁 Struktur Project

```
saas-gateway/
├── server.js                 # Entry point
├── app.js                    # Express app setup
├── package.json
├── .env                      # Environment config
│
├── config/                   # Konfigurasi
│   ├── allowedLibrary.js     # Allowed CJS/ESM modules + pre-loaded cache
│   ├── constants.js          # App-wide constants
│   ├── database.js           # MySQL connection pool
│   ├── db-init.js            # Database initializer
│   ├── session.js            # Session config
│   └── view.js               # View engine config
│
├── controllers/              # Request handlers
│   ├── admin/                # Admin panel
│   ├── auth/                 # Login, register, verification
│   ├── gateway/              # API gateway execution
│   ├── playground/           # API playground
│   ├── public/               # Public pages
│   └── user/                 # User dashboard
│
├── middleware/               # Express middleware
│   ├── auth.js               # Authentication
│   ├── creditGuard.js        # Credit check
│   ├── rateLimiter.js        # Rate limiting
│   ├── security.js           # IP block, security headers
│   └── ...
│
├── models/                   # Database models (Active Record)
│   ├── Api.js, ApiKey.js, ApiRoute.js, User.js, ...
│
├── routes/                   # Route definitions
│   ├── admin/                # /admin/*
│   ├── auth/                 # /login, /register, etc.
│   ├── gateway/              # /api/v1/:slug/*
│   ├── user/                 # /dashboard/*
│   └── public.js             # /, /about, /contact
│
├── script/                   # Script tools (FFmpeg & yt-dlp)
│   ├── concurrency.js        # Semaphore concurrency limiter
│   ├── ffmpeg.js             # FFmpeg wrapper
│   ├── ytdl.js               # yt-dlp wrapper
│   ├── setup.js              # Auto-install checker
│   └── index.js              # Unified exports
│
├── views/                    # EJS templates
│   ├── admin/                # Admin panel views
│   ├── auth/                 # Login, register
│   ├── gateway/              # API docs
│   ├── layouts/              # Base layouts
│   ├── partials/             # Shared components
│   └── user/                 # User dashboard views
│
├── public/                   # Static assets
│   ├── css/
│   ├── js/
│   └── images/
│
├── migrations/               # Database migrations
│   └── saas_gateway.sql      # Full schema
│
├── USAGE.md                  # Handler code guide
└── README.md                 # This file
```

---

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone <repo-url>
cd saas-gateway
npm install
```

> `node script/setup.js check` otomatis cek FFmpeg & yt-dlp. Kalau belum ada, jalankan:
> ```bash
> npm run scripts:setup
> ```

### 2. Setup Database

```bash
# Import schema ke MySQL
mysql -u root -p saas_gateway < migrations/saas_gateway.sql

# Atau pakai auto-init (buat DB + import)
npm run db:init
```

### 3. Konfigurasi `.env`

```env
# Database
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASS=yourpassword
DB_NAME=saas_gateway

# App
APP_URL=http://localhost:3000
SESSION_SECRET=your-random-secret

# Script Tools (optional)
SCRIPT_FFMPEG_PATH=ffmpeg
SCRIPT_YTDLP_PATH=yt-dlp
```

### 4. Jalankan

```bash
# Development (auto-reload)
npm run dev

# Production
npm start
```

Buka **http://localhost:3000**

---

## 🔐 Default Login

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@saasgateway.local | admin123 |
| User | demo@saasgateway.local | user123 |

---

## 📜 Available Scripts

| Command | Fungsi |
|---------|--------|
| `npm run dev` | Start dev server (auto-reload + tailwind watch) |
| `npm start` | Build CSS & start production server |
| `npm run db:init` | Initialize database (create + import schema) |
| `npm run scripts:check` | Cek FFmpeg & yt-dlp availability |
| `npm run scripts:setup` | Auto-install FFmpeg & yt-dlp |

---

## 🔌 API Gateway

### Endpoint Pattern

```
GET/POST /api/v1/:api-slug/:endpoint
```

### Flow

```
Client Request
    │
    ▼
┌─────────────┐
│  API Key     │ ← Authenticate (header: x-api-key)
│  Validation  │
├─────────────┤
│  Rate Limit  │ ← Per-key rate limiting
│  Check       │
├─────────────┤
│  Credit      │ ← Deduct credits
│  Check       │
├─────────────┤
│  VM Sandbox  │ ← Execute handler_code
│  Execution   │
├─────────────┤
│  Response    │ ← Return JSON + meta headers
│  + Logging   │
└─────────────┘
```

### Response Headers

| Header | Deskripsi |
|--------|-----------|
| `X-Request-Id` | Unique request identifier |
| `X-Response-Time` | Response time in ms |
| `X-Credits-Used` | Credits deducted |
| `X-RateLimit-Remaining` | Remaining rate limit |

---

## 🧩 Modules & Sandbox

Handler code bisa akses berbagai module via sandbox:

### CJS Modules (require)

```js
const { v4: uuid } = require('uuid');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
```

### ESM Modules (import)

```js
// import() otomatis ditransform oleh controller
const cheerio = await import('cheerio');
const axios = (await import('axios')).default;
const dayjs = (await import('dayjs')).default;
```

> **Note:** `import()` di handler code otomatis ditransform ke `__import__()` oleh controller sebelum dieksekusi di VM. Module di-load saat server startup dari `allowedLibrary.js`.

### Internal Modules

```js
// FFmpeg & yt-dlp
const { ffmpeg, ytdl } = require('script');

// QR Code
const qr = require('qrcode');

// Canvas
const canvas = require('canvas');
```

### HTTP Helper

```js
// GET request (otomatis kirim User-Agent)
const html = await httpGet('https://example.com');

// GET dengan headers custom
const data = await httpGet('https://api.github.com', {
  headers: { 'Accept': 'application/json' }
});

// POST dengan body
const result = await httpGet('https://api.example.com', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'test' })
});
```

**Installer:**

```bash
npm run scripts:check    # Cek status
npm run scripts:setup    # Auto-install
```

---

## 📖 Dokumentasi

| Dokumen | Deskripsi |
|---------|-----------|
| [USAGE.md](USAGE.md) | Panduan lengkap menulis handler_code (sandbox, modules, contoh) |

---

## ⚙️ Environment Variables

| Variable | Default | Deskripsi |
|----------|---------|-----------|
| `PORT` | 3000 | Server port |
| `HOST` | 0.0.0.0 | Server host |
| `NODE_ENV` | development | Environment |
| `DB_HOST` | 127.0.0.1 | MySQL host |
| `DB_PORT` | 3306 | MySQL port |
| `DB_USER` | root | MySQL user |
| `DB_PASS` | | MySQL password |
| `DB_NAME` | saas_gateway | Database name |
| `SESSION_SECRET` | | Session secret key |
| `APP_URL` | | Application URL |
| `DEFAULT_CREDIT` | 100 | Default credit balance |
| `CREDIT_VALUE_RP` | 50 | Value of 1 credit (IDR) |
| `SCRIPT_FFMPEG_PATH` | ffmpeg | FFmpeg binary path |
| `SCRIPT_YTDLP_PATH` | yt-dlp | yt-dlp binary path |
| `SCRIPT_FFMPEG_CONCURRENCY` | 3 | Max concurrent FFmpeg tasks |
| `SCRIPT_YTDLP_CONCURRENCY` | 3 | Max concurrent yt-dlp tasks |
| `SCRIPT_FFMPEG_TIMEOUT` | 300000 | FFmpeg timeout (ms) |
| `SCRIPT_YTDLP_TIMEOUT` | 600000 | yt-dlp timeout (ms) |

---

## 📝 Handler Code Quick Reference

```js
// Return success
return { status: 200, data: { message: 'OK' } };

// Return error
return { status: 400, data: { error: 'Bad request' } };

// Auto-wrap (status default 200)
return { name: 'test' };

// Database query
const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);

// Import ESM module
const cheerio = await import('cheerio');

// HTTP request
const data = await httpGet('https://api.example.com');
```

See [USAGE.md](USAGE.md) for full documentation.

---

## 📄 License

MIT

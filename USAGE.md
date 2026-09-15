# USAGE.md — Panduan Menulis handler_code

Panduan lengkap cara menulis `handler_code` di Admin Panel SaaS Gateway.

---

## 1. Apa Itu handler_code?

`handler_code` adalah potongan kode Node.js (async) yang ditulis admin untuk setiap API route. Kode ini dijalankan di **VM sandbox** — bukan server penuh — jadi hanya bisa mengakses API yang diizinkan.

Setiap request ke gateway akan:
1. Authenticate (API key)
2. Rate limit check
3. Credit deduction
4. **Jalankan handler_code** → return result ke user

---

## 2. Aturan Dasar

### Return Value

Handler **harus** return object dengan struktur:

```js
return { status: 200, data: { message: 'OK' } };
```

- `status` (number) — HTTP status code
- `data` (object/array) — payload yang dikirim ke user
- `error` (string, optional) — pesan error

**Jika return tanpa `status`, otomatis jadi `{ status: 200, data: <return value> }`**

### Return Format Alternatif

```js
// Bisa pakai "body" juga sebagai alias "data"
return { status: 201, body: { id: 1, name: 'Test' } };

// Atau langsung return value (otomatis status 200)
return { name: 'Test', value: 123 };
```

### Async Handler

Semua handler berjalan sebagai `async () => {}`, jadi bisa langsung pakai `await`:

```js
const [rows] = await db.query('SELECT * FROM users');
return { status: 200, data: rows };
```

### Timeout

- **VM timeout: 120 detik** — kode harus selesai dalam waktu ini
- FFMPEG/yt-dlp tasks punya timeout terpisah di limiter mereka

---

## 3. Yang Bisa Diakses (Sandbox Variables)

### Context Variables (langsung tersedia)

| Variable | Tipe | Deskripsi |
|----------|------|-----------|
| `req` | Object | Request data (lihat §4) |
| `user` | Object | `{ id, username }` user yang request |
| `api` | Object | `{ id, slug, name }` metadata API |
| `helpers` | Object | Utility functions (lihat §6) |
| `db` | Object | Database connection (MySQL2 pool) |

### Built-in Global

```
console, JSON, Math, Date, parseInt, parseFloat, isNaN, isFinite,
String, Number, Boolean, Array, Object, RegExp, Promise,
Buffer, Map, Set, WeakMap, WeakSet,
setTimeout, setInterval, clearTimeout, clearInterval,
fetch, URL, URLSearchParams, AbortController, AbortSignal,
TextEncoder, TextDecoder, atob, btoa, structuredClone
```

---

## 4. Object `req`

```js
req = {
  method: 'GET',              // HTTP method
  path: '/gateway/my-api/endpoint', // Full path
  query: { page: '1' },       // Query string (parsed)
  body: { name: 'test' },     // Request body (JSON)
  headers: { ... },           // Request headers
  params: { slug: 'my-api', 0: 'endpoint' } // Route params
}
```

**Contoh akses:**

```js
// GET /gateway/user-api/detail?id=5
const userId = req.query.id;

// POST /gateway/user-api/create
const { name, email } = req.body;

// Cek method
if (req.method !== 'POST') {
  return { status: 405, data: { error: 'POST only' } };
}
```

---

## 5. Database Queries (`db`)

Menggunakan **mysql2/promise** — semua query return `[rows, fields]`.

### SELECT

```js
// Single table
const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);

// JOIN
const [rows] = await db.query(`
  SELECT u.id, u.username, c.balance
  FROM users u
  JOIN credits c ON c.user_id = u.id
  WHERE u.id = ?
`, [userId]);

// Pagination
const page = parseInt(req.query.page) || 1;
const limit = 20;
const offset = (page - 1) * limit;
const [rows] = await db.query('SELECT * FROM users LIMIT ? OFFSET ?', [limit, offset]);
```

### INSERT

```js
const [result] = await db.query(
  'INSERT INTO users (uuid, username, email, password_hash) VALUES (?, ?, ?, ?)',
  [uuid, username, email, hash]
);
// result.insertId — ID yang baru dibuat
```

### UPDATE

```js
const [result] = await db.query(
  'UPDATE users SET full_name = ? WHERE id = ?',
  [fullName, userId]
);
// result.affectedRows — jumlah row yang terpengaruh
```

### DELETE

```js
const [result] = await db.query(
  'DELETE FROM posts WHERE id = ? AND user_id = ?',
  [postId, userId]
);
```

---

## 6. Helpers

`helpers` object tersedia langsung tanpa require:

```js
// Generate UUID
const id = helpers.uuid();

// Slugify
const slug = helpers.slugify('Hello World!'); // "hello-world"

// Format rupiah
const price = helpers.formatRupiah(50000); // "Rp 50.000"

// Format number
const views = helpers.formatNumber(1500000); // "1.5M"

// Time ago
const ago = helpers.timeAgo('2024-01-15'); // "3 months ago"

// Format date
const date = helpers.formatDate(new Date()); // "11 September 2026 08.30"
const short = helpers.formatDate(new Date(), 'short'); // "11/09/2026 08:30"

// Truncate text
const text = helpers.truncate('Hello World', 5); // "Hello..."

// Parse JSON safely
const obj = helpers.parseJSON('{"a":1}', {});
```

---

## 7. Module yang Diizinkan

### require() — CommonJS

```js
const { v4: uuid } = require('uuid');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const qs = require('querystring');
const urlLib = require('url');
const pathLib = require('path');
```

### import() — ESM

Handler code bisa langsung pakai `import()` syntax. Controller otomatis transform `import()` → `__import__()` sebelum dieksekusi di VM. Semua ESM module di-load saat server startup.

```js
// langsung pakai import() — otomatis ditransform oleh controller
const cheerio = await import('cheerio');
const axios = (await import('axios')).default;
const dayjs = (await import('dayjs')).default;
const _ = await import('lodash');
const { v4: uuid } = await import('uuid');
```

**Kenapa ditransform?**
Node.js `vm` module tidak bisa override `import()` keyword — selalu panggil native Node loader yang butuh flag `--experimental-vm-modules`. Controller mengganti `import(` → `__import__(` secara otomatis supaya module di-load dari pre-loaded cache.

**⚠️ Penting:**
- Jangan panggil `import()` dari dynamic string — harus static string
- `require()` tidak ditransform, tetap jalan normal

**Daftar ESM yang diizinkan:**
`node-fetch`, `axios`, `cheerio`, `dayjs`, `moment`, `lodash`, `ramda`, `mathjs`, `currency.js`, `fast-xml-parser`, `xml2js`, `he`, `uuid`, `bcryptjs`, `dotenv`, `form-data`, `querystring`

### Script Modules (FFmpeg & yt-dlp)

```js
const { ffmpeg, ytdl, concurrency } = require('script');

// Atau per module:
const ffmpeg = require('script/ffmpeg');
const ytdl = require('script/ytdl');
const { createLimiter } = require('script/concurrency');
```

**Lihat §11 untuk detail FFmpeg & yt-dlp.**

---

## 8. Yang DIBLOKIR (Tidak Bisa Diakses)

Kode yang mengandung pola berikut akan **ditolak sebelum dijalankan**:

```
process.     → process.exit(), process.env, dll
child_process → exec, spawn, fork
fs.          → fs.readFile, fs.writeFile, dll
eval(        → eval()
Function(    → Function constructor
__dirname    → path direktori
__filename   → path file
```

**Module yang tidak diizinkan** (via require/import) akan throw error.

**Note:** `import()` di handler code akan ditransform otomatis menjadi `__import__()` oleh controller. Jangan gunakan `loadModule()` — gunakan `import()` biasa.

---

## 9. HTTP Helper: `httpGet`

Fungsi built-in untuk HTTP request (tanpa perlu require axios). Otomatis kirim `User-Agent` header (diperlukan untuk GitHub, dll).

```js
// GET JSON
const data = await httpGet('https://api.github.com/users/octocat');
console.log(data.login); // "octocat"

// GET dengan custom timeout
const result = await httpGet('https://slow-api.com/data', { timeout: 15000 });

// GET yang return non-JSON (otomatis return string)
const html = await httpGet('https://example.com');

// GET dengan custom headers
const data = await httpGet('https://api.example.com', {
  headers: { 'Authorization': 'Bearer token123', 'Accept': 'application/json' }
});

// POST dengan body
const result = await httpGet('https://api.example.com/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'test' })
});
```

**Options:**

| Option | Default | Deskripsi |
|--------|---------|-----------|
| `timeout` | 10000 | Request timeout (ms) |
| `headers` | `{ 'User-Agent': '...' }` | Custom headers (di-merge dengan default User-Agent) |
| `method` | `'GET'` | HTTP method |

**Note:**
- `User-Agent` header otomatis ditambahkan (required untuk GitHub, TikTok, dll)
- Response otomatis parse JSON, jika gagal return raw string
- Untuk POST/PUT/DELETE, gunakan `method` + `body` di options

---

## 10. Contoh Lengkap: Basic CRUD API

### GET /list — List Users

```js
const page = parseInt(req.query.page) || 1;
const limit = Math.min(parseInt(req.query.limit) || 20, 100);
const offset = (page - 1) * limit;

const [rows] = await db.query(
  'SELECT id, username, email, full_name, created_at FROM users WHERE deleted_at IS NULL ORDER BY id DESC LIMIT ? OFFSET ?',
  [limit, offset]
);

const [countResult] = await db.query(
  'SELECT COUNT(*) as total FROM users WHERE deleted_at IS NULL'
);
const total = countResult[0].total;

return {
  status: 200,
  data: {
    users: rows,
    pagination: helpers.paginate(total, page, limit)
  }
};
```

### GET /detail — Get User by ID

```js
const userId = req.query.id;
if (!userId) {
  return { status: 400, data: { error: 'id is required' } };
}

const [rows] = await db.query(
  'SELECT id, uuid, username, email, full_name, role, created_at FROM users WHERE id = ? AND deleted_at IS NULL',
  [userId]
);

if (rows.length === 0) {
  return { status: 404, data: { error: 'User not found' } };
}

return { status: 200, data: rows[0] };
```

### POST /create — Create User

```js
const { username, email, full_name } = req.body;

// Validasi input
if (!username || !email) {
  return { status: 400, data: { error: 'username and email are required' } };
}

// Cek duplikat
const [existing] = await db.query(
  'SELECT id FROM users WHERE username = ? OR email = ?',
  [username, email]
);
if (existing.length > 0) {
  return { status: 409, data: { error: 'Username or email already exists' } };
}

// Buat user
const uuid = helpers.uuid();
const bcrypt = require('bcryptjs');
const hash = await bcrypt.hash('default123', 12);

const [result] = await db.query(
  `INSERT INTO users (uuid, username, email, password_hash, full_name, role)
   VALUES (?, ?, ?, ?, ?, 'user')`,
  [uuid, username, email, hash, full_name || username]
);

return {
  status: 201,
  data: {
    id: result.insertId,
    uuid,
    username,
    email,
    full_name: full_name || username
  }
};
```

### PUT /update — Update User

```js
const userId = req.body.id;
const { full_name, email } = req.body;

if (!userId) {
  return { status: 400, data: { error: 'id is required' } };
}

const fields = [];
const values = [];

if (full_name !== undefined) { fields.push('full_name = ?'); values.push(full_name); }
if (email !== undefined) { fields.push('email = ?'); values.push(email); }

if (fields.length === 0) {
  return { status: 400, data: { error: 'No fields to update' } };
}

values.push(userId);
const [result] = await db.query(
  `UPDATE users SET ${fields.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
  values
);

if (result.affectedRows === 0) {
  return { status: 404, data: { error: 'User not found' } };
}

return { status: 200, data: { message: 'Updated', id: Number(userId) } };
```

### DELETE /delete — Soft Delete User

```js
const userId = req.body.id || req.query.id;
if (!userId) {
  return { status: 400, data: { error: 'id is required' } };
}

const [result] = await db.query(
  'UPDATE users SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
  [userId]
);

if (result.affectedRows === 0) {
  return { status: 404, data: { error: 'User not found or already deleted' } };
}

return { status: 200, data: { message: 'User deleted', id: Number(userId) } };
```

---

## 11. Contoh: Fetch Data dari API Eksternal

### Weather API

```js
const city = req.query.city || 'Jakarta';

try {
  const data = await httpGet(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
  const current = data.current_condition?.[0];

  if (!current) {
    return { status: 404, data: { error: `Weather data for "${city}" not found` } };
  }

  return {
    status: 200,
    data: {
      city,
      temperature: current.temp_C + '°C',
      description: current.weatherDesc?.[0]?.value,
      humidity: current.humidity + '%',
      wind: current.windspeedKmph + ' km/h'
    }
  };
} catch (e) {
  return { status: 502, data: { error: 'Weather service unavailable' } };
}
```

### Scraping dengan Cheerio

```js
const cheerio = await import('cheerio');

const url = req.query.url;
if (!url) return { status: 400, data: { error: 'url is required' } };

const html = await httpGet(url);
const $ = cheerio.load(html);

const title = $('title').text();
const metaDesc = $('meta[name="description"]').attr('content') || '';
const h1 = $('h1').first().text();
const links = [];
$('a').each((i, el) => {
  const href = $(el).attr('href');
  const text = $(el).text().trim();
  if (href && text) links.push({ text, href });
});

return {
  status: 200,
  data: {
    title,
    description: metaDesc,
    h1,
    linkCount: links.length,
    links: links.slice(0, 20) // max 20 links
  }
};
```

**Note:** `httpGet` otomatis kirim `User-Agent` header, jadi bisa scrape GitHub, TikTok, dll tanpa error 403.

### GET Data dengan Axios + Pagination

```js
const axios = (await import('axios')).default;
const page = parseInt(req.query.page) || 1;

const response = await axios.get('https://jsonplaceholder.typicode.com/posts', {
  params: { _page: page, _limit: 10 }
});

return {
  status: 200,
  data: {
    posts: response.data,
    page,
    total: parseInt(response.headers['x-total-count']) || 0
  }
};
```

---

## 12. Contoh: Input Validation Pattern

```js
// Reusable validation
function validate(body, rules) {
  const errors = [];
  for (const [field, rule] of Object.entries(rules)) {
    const value = body[field];
    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push(`${field} is required`);
    }
    if (rule.type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors.push(`${field} must be a valid email`);
    }
    if (rule.minLength && value && value.length < rule.minLength) {
      errors.push(`${field} must be at least ${rule.minLength} characters`);
    }
    if (rule.max && value && Number(value) > rule.max) {
      errors.push(`${field} must not exceed ${rule.max}`);
    }
  }
  return errors;
}

// Pakai
const errors = validate(req.body, {
  name:     { required: true, minLength: 2 },
  email:    { required: true, type: 'email' },
  age:      { required: true, type: 'number', max: 150 },
  password: { required: true, minLength: 8 }
});

if (errors.length > 0) {
  return { status: 400, data: { error: 'Validation failed', details: errors } };
}
```

---

## 13. Contoh: Response Headers Custom

```js
// Return data + custom headers via response object
// NOTE: Custom headers harus di-set di gateway, bukan di handler.
// Handler cukup return data. Gateway otomatis set:
//   X-Request-Id, X-Response-Time, X-Credits-Used, X-RateLimit-Remaining

return {
  status: 200,
  data: { users: rows, total: count }
  // Gateway menambahkan meta otomatis
};
```

---

## 14. Contoh: Error Handling Pattern

```js
try {
  // Operasi yang mungkin gagal
  const result = await someAsyncOperation();
  return { status: 200, data: result };
} catch (err) {
  // Log error (akan muncul di console server)
  console.error('Operation failed:', err.message);

  // Return error ke user
  return {
    status: 500,
    data: {
      error: 'Operation failed',
      message: err.message
    }
  };
}
```

### Custom Error by Type

```js
try {
  const [rows] = await db.query('SELECT * FROM products WHERE id = ?', [req.query.id]);

  if (rows.length === 0) {
    return { status: 404, data: { error: 'Product not found' } };
  }

  return { status: 200, data: rows[0] };
} catch (err) {
  if (err.code === 'ER_DUP_ENTRY') {
    return { status: 409, data: { error: 'Duplicate entry' } };
  }
  if (err.code === 'ER_NO_SUCH_TABLE') {
    return { status: 500, data: { error: 'Table not configured' } };
  }
  return { status: 500, data: { error: 'Database error' } };
}
```

---

## 15. Contoh: Authentication Check dalam Handler

```js
// user object otomatis tersedia dari API key auth
// tapi bisa tambah validasi level aplikasi

const [rows] = await db.query(
  'SELECT role FROM users WHERE id = ? AND is_active = 1',
  [user.id]
);

if (rows.length === 0) {
  return { status: 403, data: { error: 'Account disabled' } };
}

if (rows[0].role !== 'admin') {
  return { status: 403, data: { error: 'Admin access required' } };
}

// Lanjut...
```

---

## 16. Contoh: Scrape & Return Structured Data

### Scraper dengan Cheerio + httpGet

```js
const cheerio = await import('cheerio');

const url = req.query.url;
if (!url) return { status: 400, data: { error: 'url is required' } };

try {
  const html = await httpGet(url, {
    headers: { 'Accept': 'text/html,application/xhtml+xml' },
    timeout: 15000
  });

  const $ = cheerio.load(html);

  // Extract metadata
  const result = {
    title: $('title').text().trim(),
    description: $('meta[name="description"]').attr('content') || '',
    ogTitle: $('meta[property="og:title"]').attr('content') || '',
    ogImage: $('meta[property="og:image"]').attr('content') || '',
    ogDescription: $('meta[property="og:description"]').attr('content') || '',
    links: []
  };

  $('a[href]').each((i, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (href && text && result.links.length < 50) {
      result.links.push({ text: text.substring(0, 100), href });
    }
  });

  return { status: 200, data: result };
} catch (err) {
  return { status: 502, data: { error: 'Failed to fetch URL', message: err.message } };
}
```

### TikTok Info Scraper

```js
const cheerio = await import('cheerio');

const url = req.query.url;
if (!url || !url.includes('tiktok.com')) {
  return { status: 400, data: { error: 'Valid TikTok URL required' } };
}

try {
  const html = await httpGet(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    timeout: 10000
  });

  const $ = cheerio.load(html);
  const jsonData = $('script#__UNIVERSAL_DATA_FOR_REHYDRATION__').html();

  if (jsonData) {
    const data = JSON.parse(jsonData);
    const detail = data?.__DEFAULT_SCOPE__?.['webapp.video-detail'];
    return { status: 200, data: detail || { message: 'Parsed but no detail found' } };
  }

  return { status: 404, data: { error: 'Could not parse TikTok page' } };
} catch (err) {
  return { status: 502, data: { error: 'Failed to fetch TikTok', message: err.message } };
}
```

---

## 17. Contoh: Currency Exchange API

```js
const axios = (await import('axios')).default;

const from = (req.query.from || 'USD').toUpperCase();
const to = (req.query.to || 'IDR').toUpperCase();
const amount = parseFloat(req.query.amount) || 1;

if (amount <= 0 || amount > 1000000) {
  return { status: 400, data: { error: 'Amount must be between 1 and 1,000,000' } };
}

try {
  const { data } = await axios.get(`https://api.exchangerate-api.com/v4/latest/${from}`, {
    timeout: 10000
  });

  if (!data.rates || !data.rates[to]) {
    return { status: 400, data: { error: `Currency "${to}" not supported` } };
  }

  const rate = data.rates[to];
  const converted = amount * rate;

  return {
    status: 200,
    data: {
      from,
      to,
      amount,
      rate,
      result: Math.round(converted * 100) / 100,
      resultFormatted: helpers.formatRupiah(Math.round(converted)),
      date: data.date
    }
  };
} catch (err) {
  return { status: 502, data: { error: 'Exchange rate service unavailable' } };
}
```

---

## 18. Contoh: YouTube to MP3 (via Script Module)

```js
const { ytdl } = require('script');

const url = req.query.url;
if (!url) return { status: 400, data: { error: 'url is required' } };

try {
  const info = await ytdl.getBasicInfo(url);
  return {
    status: 200,
    data: {
      title: info.title,
      duration: info.duration_string,
      thumbnail: info.thumbnail,
      uploader: info.uploader,
      views: helpers.formatNumber(info.view_count),
      formats: info.formats.slice(0, 10)
    }
  };
} catch (err) {
  return { status: 502, data: { error: 'Failed to get video info', message: err.message } };
}
```

---

## 19. Contoh: Puppeteer (Browser Automation)

Puppeteer tersedia via `browser` object di sandbox. Gunakan untuk screenshot, PDF, scraping dinamis, atau render HTML.

### 19.1 Screenshot URL

```js
const url = req.query.url;
if (!url) return { status: 400, data: { error: 'url is required' } };

try {
  const result = await browser.screenshot(url, {
    width: 1280,
    height: 720,
    fullPage: false,      // true = scroll full page
    format: 'png',        // 'png' | 'jpeg' | 'webp'
    delay: 1000           // tunggu 1s agar JS rendering selesai
  });

  // result = { filename, downloadUrl, size }
  return {
    status: 200,
    data: {
      screenshot: result.downloadUrl,
      size: result.size
    }
  };
} catch (err) {
  return { status: 500, data: { error: 'Screenshot failed', message: err.message } };
}
```

### 19.2 Screenshot Element Tertentu

```js
const url = req.query.url;
const selector = req.query.selector || 'body';

if (!url) return { status: 400, data: { error: 'url is required' } };

try {
  const result = await browser.screenshot(url, {
    selector: selector,   // CSS selector element
    format: 'png'
  });

  return {
    status: 200,
    data: {
      screenshot: result.downloadUrl,
      size: result.size
    }
  };
} catch (err) {
  return { status: 500, data: { error: 'Screenshot failed', message: err.message } };
}
```

### 19.3 Generate PDF dari URL

```js
const url = req.query.url;
if (!url) return { status: 400, data: { error: 'url is required' } };

try {
  const result = await browser.toPdf(url, {
    format: 'A4',           // 'A4' | 'Letter' | 'Legal'
    landscape: false,
    printBackground: true,   // include background colors/images
    margin: {
      top: '20mm',
      right: '15mm',
      bottom: '20mm',
      left: '15mm'
    }
  });

  // result = { filename, downloadUrl, size }
  return {
    status: 200,
    data: {
      pdf: result.downloadUrl,
      size: result.size
    }
  };
} catch (err) {
  return { status: 500, data: { error: 'PDF generation failed', message: err.message } };
}
```

### 19.4 Scrape Content (Dynamis / JS-rendered)

Bedanya dengan Cheerio: Puppeteer menjalankan JavaScript di halaman, jadi bisa scrape SPA (React, Vue, Angular).

```js
const url = req.query.url;
if (!url) return { status: 400, data: { error: 'url is required' } };

try {
  const result = await browser.getContent(url, {
    selector: 'article',     // ambil element <article>
    format: 'text',          // 'text' | 'html' | 'json'
    delay: 2000              // tunggu 2s agar JS rendering selesai
  });

  return {
    status: 200,
    data: {
      title: result.title,
      content: result.content,
      url: result.url,
      meta: result.meta      // description, image, author, keywords
    }
  };
} catch (err) {
  return { status: 500, data: { error: 'Scrape failed', message: err.message } };
}
```

### 19.5 Scrape JSON (Structured Data + Links + Images)

```js
const url = req.query.url;
if (!url) return { status: 400, data: { error: 'url is required' } };

try {
  const result = await browser.getContent(url, {
    selector: 'body',
    format: 'json',           // return structured JSON
    delay: 2000
  });

  // result.content berisi: { text, html, links, images }
  const data = typeof result.content === 'string' ? JSON.parse(result.content) : result.content;

  return {
    status: 200,
    data: {
      title: result.title,
      text: data.text,
      links: data.links,      // [{ text, href }]
      images: data.images,    // [{ src, alt, width, height }]
      meta: result.meta
    }
  };
} catch (err) {
  return { status: 500, data: { error: 'Scrape failed', message: err.message } };
}
```

### 19.6 Render HTML ke Screenshot

```js
const { width, height } = req.body;

const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: 'Segoe UI', sans-serif; padding: 40px; background: #f0f4f8; }
    .card { background: white; border-radius: 12px; padding: 30px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    h1 { color: #2d3748; }
    p { color: #4a5568; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Hello World</h1>
    <p>Ini contoh rendering HTML ke screenshot.</p>
    <p>Dibuat dengan Puppeteer!</p>
  </div>
</body>
</html>
`;

try {
  const result = await browser.renderHtml(html, {
    width: width || 800,
    height: height || 600,
    format: 'png'
  });

  // result = { filename, downloadUrl, size }
  return {
    status: 200,
    data: {
      screenshot: result.downloadUrl,
      size: result.size
    }
  };
} catch (err) {
  return { status: 500, data: { error: 'Render failed', message: err.message } };
}
```

### 19.7 Eksekusi JS di Halaman (Advanced)

```js
const url = req.query.url;
if (!url) return { status: 400, data: { error: 'url is required' } };

try {
  // Contoh: hitung jumlah semua link di halaman
  const result = await browser.evaluate(url, (args) => {
    // Code ini berjalan di browser context (bukan Node.js!)
    const links = document.querySelectorAll('a[href]');
    const headings = document.querySelectorAll('h1, h2, h3');
    return {
      totalLinks: links.length,
      totalHeadings: headings.length,
      title: document.title,
      url: window.location.href
    };
  });

  return {
    status: 200,
    data: {
      title: result.title,
      stats: result.result
    }
  };
} catch (err) {
  return { status: 500, data: { error: 'Evaluate failed', message: err.message } };
}
```

### 19.8 Custom User Agent & Mobile Simulation

```js
const url = req.query.url;
if (!url) return { status: 400, data: { error: 'url is required' } };

try {
  // Simulasi mobile device
  const result = await browser.screenshot(url, {
    width: 375,
    height: 812,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    format: 'png',
    delay: 2000
  });

  return {
    status: 200,
    data: {
      screenshot: result.downloadUrl,
      device: 'iPhone 14',
      size: result.size
    }
  };
} catch (err) {
  return { status: 500, data: { error: 'Screenshot failed', message: err.message } };
}
```

### 19.9 Ringkasan `browser` Object

| Fungsi | Return | Deskripsi |
|--------|--------|-----------|
| `browser.screenshot(url, opts)` | `{ filename, downloadUrl, size }` | Screenshot halaman |
| `browser.toPdf(url, opts)` | `{ filename, downloadUrl, size }` | Generate PDF |
| `browser.getContent(url, opts)` | `{ title, content, url, meta }` | Extract text/HTML/json |
| `browser.renderHtml(html, opts)` | `{ filename, downloadUrl, size }` | Render HTML ke gambar |
| `browser.evaluate(url, script, opts)` | `{ result, title }` | Eksekusi JS di halaman |

**Return format sama seperti `processFile` (FFmpeg/yt-dlp):**
- File-producing functions return `{ filename, downloadUrl, size }` — langsung bisa dikirim ke user
- Data-only functions return `{ ...data }` tanpa file
- Error otomatis cleanup temp file

**Common Options:**

| Option | Default | Deskripsi |
|--------|---------|-----------|
| `width` | 1280 | Viewport width |
| `height` | 720 | Viewport height |
| `fullPage` | false | Capture full scrollable page |
| `format` | 'png' | Output format: 'png' \| 'jpeg' \| 'webp' |
| `quality` | 80 | JPEG/WebP quality (1-100) |
| `delay` | 0 | Tunggu sebelum proses (ms) |
| `selector` | 'body' | CSS selector untuk element |
| `userAgent` | - | Custom user agent string |
| `waitUntil` | 'networkidle2' | Tunggu sampai navigasi selesai |
| `navigateTimeout` | 30000 | Timeout navigasi (ms) |
| `printBackground` | true | Include background (PDF) |
| `format` | 'A4' | Paper format (PDF) |
| `landscape` | false | Landscape orientation (PDF) |
| `margin` | 10mm all | Paper margins (PDF) |

---

## 20. Ringkasan: Pola Return

```js
// ✅ Berhasil
return { status: 200, data: { ... } };
return { status: 201, data: { id: 1 } };
return { status: 200, data: rows };

// ✅ Error
return { status: 400, data: { error: 'Bad request' } };
return { status: 404, data: { error: 'Not found' } };
return { status: 500, data: { error: 'Server error' } };

// ✅ Auto wrap (status default 200)
return { name: 'test' };
// → { status: 200, data: { name: 'test' } }

// ❌ Jangan return
return;                          // → status 200, data null
return null;                     // → status 200, data null
return { message: 'ok' };        // ✅ tanpa status → auto 200
return 'string';                 // → status 200, data "string"
```

---

## 21. Cheat Sheet Cepat

| Kebutuhan | Kode |
|-----------|------|
| Baca query param | `req.query.nama` |
| Baca body | `req.body.field` |
| Cek method | `req.method === 'POST'` |
| Query DB | `const [rows] = await db.query('...', [params])` |
| Insert DB | `const [r] = await db.query('INSERT ...', [...]); r.insertId` |
| Hash password | `require('bcryptjs').hash(pw, 12)` |
| UUID | `helpers.uuid()` |
| Fetch API | `await httpGet(url)` atau `axios` |
| Fetch + headers | `await httpGet(url, { headers: { ... } })` |
| POST request | `await httpGet(url, { method: 'POST', body: ... })` |
| Scrape HTML (statik) | `cheerio.load(html)` |
| Scrape HTML (dinamis) | `await browser.getContent(url, { delay: 2000 })` |
| Screenshot URL | `await browser.screenshot(url, { width: 1280 })` |
| Screenshot element | `await browser.screenshot(url, { selector: '.class' })` |
| Generate PDF | `await browser.toPdf(url, { format: 'A4' })` |
| Render HTML ke gambar | `await browser.renderHtml('<h1>Hi</h1>')` |
| Eksekusi JS di page | `await browser.evaluate(url, () => document.title)` |
| YouTube | `require('script/ytdl').getBasicInfo(url)` |
| FFmpeg | `require('script/ffmpeg').convert(in, out, opts)` |
| Return success | `return { status: 200, data: {...} }` |
| Return error | `return { status: 400, data: { error: 'msg' } }` |

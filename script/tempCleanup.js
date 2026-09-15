const fs = require('fs');
const path = require('path');

const TEMP_DIR = path.join(__dirname, '..', 'temp');
const MAX_AGE_MS = parseInt(process.env.TEMP_CLEANUP_MAX_AGE_MS) || 40000; // default 40s

function cleanup() {
  const now = Date.now();
  let deleted = 0;

  if (!fs.existsSync(TEMP_DIR)) return;

  const files = fs.readdirSync(TEMP_DIR);

  files.forEach(file => {
    // Skip hidden files and check scripts
    if (file.startsWith('_') || file.startsWith('.')) return;

    const filePath = path.join(TEMP_DIR, file);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return;

      // Cross-platform: use birthtime if valid, else ctime, else mtime
      let fileTime;
      if (stat.birthtimeMs && stat.birthtimeMs > 0 && stat.birthtime.getTime() > 0) {
        fileTime = stat.birthtimeMs; // Windows, macOS
      } else if (stat.ctimeMs && stat.ctimeMs > 0) {
        fileTime = stat.ctimeMs;     // Linux (ctime = change time)
      } else {
        fileTime = stat.mtimeMs;     // Fallback
      }
      const age = now - fileTime;
      if (age > MAX_AGE_MS) {
        fs.unlinkSync(filePath);
        deleted++;
      }
    } catch (e) {
      // Skip files that can't be accessed
    }
  });

  if (deleted > 0) {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, timeZone: 'Asia/Jakarta' });
    console.log(`[${time}] Cleanup: deleted ${deleted} expired file(s) from temp/`);
  }
}

// One-shot cleanup (run via cron every 1 minute)
cleanup();
process.exit(0);

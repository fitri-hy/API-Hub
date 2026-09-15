/**
 * yt-dlp Wrapper with Concurrency Control
 *
 * Provides high-level functions for downloading and extracting info from
 * YouTube, TikTok, Instagram, Twitter, and 1000+ other sites.
 *
 * Requires: yt-dlp installed on the system and accessible in PATH.
 * Install: pip install yt-dlp  OR  pipx install yt-dlp
 *
 * Usage:
 *   const ytdl = require('../script/ytdl');
 *
 *   // Set concurrency limit (default 3)
 *   ytdl.setConcurrency(3);
 *
 *   // Get video info (no download)
 *   const info = await ytdl.getInfo('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
 *
 *   // Download audio only
 *   const audio = await ytdl.downloadAudio(url, '/tmp/audio.mp3');
 *
 *   // Download best quality
 *   const video = await ytdl.download(url, '/tmp/video.mp4');
 *
 *   // Batch download with concurrency control
 *   const results = await ytdl.batchDownload([...], '/tmp/downloads');
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const { createLimiter } = require('./concurrency');
const fileTtl = require('./fileTtl');

const execFileAsync = promisify(execFile);

// Default concurrency for download operations (from env or 3)
let limiter = createLimiter(parseInt(process.env.SCRIPT_YTDLP_CONCURRENCY) || 3, { timeout: parseInt(process.env.SCRIPT_YTDLP_TIMEOUT) || 600_000 }); // 10 min default timeout

/**
 * yt-dlp binary path
 */
let ytdlpPath = process.env.SCRIPT_YTDLP_PATH || 'yt-dlp';

/**
 * Temporary directory for downloads (project temp/ folder)
 */
let tempDir = path.join(__dirname, '..', 'temp');
// Ensure temp directory exists
try { if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true }); } catch {}

/**
 * Build a public download URL for a temp file
 */
function buildDownloadUrl(filename) {
  const base = (process.env.APP_URL || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const safe = fileTtl.sanitizeFilename(filename);
  return `${base}/gateway/download/${encodeURIComponent(safe)}`;
}

/**
 * Check if yt-dlp is available
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
  try {
    await execFileAsync(ytdlpPath, ['--version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get yt-dlp version
 * @returns {Promise<string>}
 */
async function getVersion() {
  const { stdout } = await execFileAsync(ytdlpPath, ['--version'], { timeout: 5000 });
  return stdout.trim();
}

/**
 * Set concurrency limit
 * @param {number} n
 */
function setConcurrency(n) {
  limiter = createLimiter(n, { timeout: limiter._timeout });
}

/**
 * Set timeout per task
 * @param {number} ms
 */
function setTimeout(ms) {
  limiter = createLimiter(limiter.limit, { timeout: ms });
}

/**
 * Set custom paths
 * @param {{ ytdlp?: string, tempDir?: string }} paths
 */
function setPaths(paths) {
  if (paths.ytdlp) ytdlpPath = paths.ytdlp;
  if (paths.tempDir) tempDir = paths.tempDir;
}

/**
 * Get video/audio info without downloading
 * @param {string} url - Video URL
 * @param {object} [opts]
 * @param {string[]} [opts.cookies] - Additional yt-dlp arguments
 * @returns {Promise<object>} Parsed info object
 */
async function getInfo(url, opts = {}) {
  const result = await limiter.add(async () => {
    // Use minimal args for metadata — no anti-403 needed for --dump-json
    const args = [
      '--dump-json',
      '--no-download',
      '--no-warnings',
      '--no-playlist',
      '--no-check-certificates',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      url
    ];
    if (opts.cookies) args.push('--cookies', opts.cookies);
    if (opts.extraArgs) args.push(...opts.extraArgs);
    const { stdout } = await execFileAsync(ytdlpPath, args, { timeout: 60_000 });
    return JSON.parse(stdout);
  });
  return result;
}

/**
 * Get basic info (title, duration, thumbnail, formats)
 * @param {string} url
 * @returns {Promise<object>}
 */
async function getBasicInfo(url) {
  const info = await getInfo(url);
  return {
    id: info.id,
    title: info.title,
    description: info.description,
    duration: info.duration,
    duration_string: info.duration_string,
    thumbnail: info.thumbnail,
    uploader: info.uploader,
    upload_date: info.upload_date,
    view_count: info.view_count,
    like_count: info.like_count,
    webpage_url: info.webpage_url,
    extractor: info.extractor,
    formats: (info.formats || []).map(f => ({
      format_id: f.format_id,
      ext: f.ext,
      resolution: f.resolution,
      fps: f.fps,
      vcodec: f.vcodec,
      acodec: f.acodec,
      filesize: f.filesize,
      tbr: f.tbr
    }))
  };
}

/**
 * Get available formats
 * @param {string} url
 * @returns {Promise<object[]>}
 */
async function getFormats(url) {
  const info = await getInfo(url);
  return (info.formats || []).map(f => ({
    format_id: f.format_id,
    ext: f.ext,
    resolution: f.resolution,
    fps: f.fps,
    vcodec: f.vcodec,
    acodec: f.acodec,
    filesize: f.filesize,
    tbr: f.tbr,
    note: f.format_note
  }));
}

/**
 * Find the most recently modified file in a directory matching given extensions
 * @param {string} dir - Directory to scan
 * @param {string[]} extensions - File extensions to match (e.g. ['mp4', 'mkv'])
 * @returns {string|null} Full path to the most recent matching file, or null
 */
function findMostRecentFile(dir, extensions) {
  try {
    if (!fs.existsSync(dir)) return null;
    const extPattern = new RegExp(`\\.(${extensions.join('|')})$`, 'i');
    const files = fs.readdirSync(dir)
      .filter(f => extPattern.test(f) && !/^\./.test(f))
      .map(f => {
        const fullPath = path.join(dir, f);
        try { return { name: f, time: fs.statSync(fullPath).mtimeMs }; } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => b.time - a.time);
    return files.length > 0 ? path.join(dir, files[0].name) : null;
  } catch {
    return null;
  }
}

/**
 * Parse yt-dlp output to extract the destination file path.
 * yt-dlp writes download progress to stderr and merge info to stdout,
 * so we must search BOTH streams.
 * @param {string} stdout
 * @param {string} stderr
 * @returns {string|null}
 */
function parseDestPath(stdout, stderr) {
  const all = (stdout || '') + '\n' + (stderr || '');
  // Check merger line first (merged file is the final output)
  const mergerMatch = all.match(/\[Merger\]\s+Merging formats into "(.+?)"/i);
  if (mergerMatch) return mergerMatch[1].trim();
  const destMatch = all.match(/\[download\]\s+Destination:\s+(.+)/i) ||
                    all.match(/\[ExtractAudio\]\s+Destination:\s+(.+)/i) ||
                    all.match(/\[download\]\s+(.+?)\s+has already been downloaded/i);
  return destMatch ? destMatch[1].trim() : null;
}

/**
 * Download video (best quality by default)
 * @param {string} url
 * @param {string} [outputPath] - Output file path (auto-named if omitted)
 * @param {object} [opts]
 * @param {string} [opts.format] - Format ID or selector (e.g., 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best')
 * @param {string} [opts.outputTemplate] - Output filename template
 * @param {boolean} [opts.noPlaylist] - Don't download playlist (default: true)
 * @param {string} [opts.cookies] - Path to cookies file
 * @param {string[]} [opts.extraArgs] - Additional yt-dlp arguments
 * @returns {Promise<{success: boolean, path: string, filename: string, size: number, info: object}>}
 */
async function download(url, outputPath, opts = {}) {
  return limiter.add(async () => {
    const outputTemplate = outputPath || path.join(tempDir, '%(title)s.%(ext)s');
    const format = opts.format || 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best';

    // Build args helper — only use merge-output-format for mergeable formats
    const buildDlArgs = (fmt) => {
      const args = [
        '-f', fmt,
        '-o', outputTemplate,
        '--no-warnings',
        '--merge-output-format', 'mp4',
        ...(opts.noPlaylist !== false ? ['--no-playlist'] : []),
        ...buildArgs(opts),
        url
      ];
      return args;
    };

    // Try primary format, then fallback on error
    const formats = [
      format,
      'bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio',
      'bestvideo+bestaudio',
      'best[ext=mp4]/best'
    ];

    // Check if file already exists from a previous download
    let existingInfo = null;
    try { existingInfo = await getInfo(url); } catch {}
    if (existingInfo && existingInfo.title) {
      const safeTitle = fileTtl.sanitizeFilename(existingInfo.title);
      const existingFiles = fs.readdirSync(tempDir).filter(f => f.startsWith(safeTitle));
      if (existingFiles.length > 0) {
        const existingFile = path.join(tempDir, existingFiles[0]);
        if (fs.existsSync(existingFile)) {
          const stat = fs.statSync(existingFile);
          const registered = fileTtl.register(existingFile);
          return {
            success: true,
            path: registered.path,
            filename: registered.filename,
            downloadUrl: buildDownloadUrl(registered.filename),
            size: stat.size,
            info: { title: existingInfo.title, duration: existingInfo.duration, uploader: existingInfo.uploader }
          };
        }
      }
    }

    let lastErr = null;
    for (const fmt of formats) {
      try {
        const { stdout, stderr } = await execFileAsync(ytdlpPath, buildDlArgs(fmt), { timeout: limiter._timeout || 600_000 });

        // Parse destination from BOTH stdout and stderr
        let finalPath = parseDestPath(stdout, stderr);

        if (outputPath && !finalPath) finalPath = outputPath;

        // Check for common yt-dlp filename patterns
        if (finalPath && !fs.existsSync(finalPath)) {
          const cleaned = finalPath.replace(/\.f\d+\./, '.');
          if (fs.existsSync(cleaned)) {
            finalPath = cleaned;
          } else {
            const partPath = finalPath + '.part';
            if (fs.existsSync(partPath)) finalPath = partPath;
          }
        }

        // Fallback: scan output dir
        if (!finalPath || !fs.existsSync(finalPath)) {
          const scanDir = outputPath ? path.dirname(path.resolve(outputPath)) : tempDir;
          const found = findMostRecentFile(scanDir, ['mp4', 'mkv', 'webm']);
          if (found) finalPath = found;
        }

        if (!finalPath || !fs.existsSync(finalPath)) {
          throw new Error('Output file not found after download');
        }

        const stat = fs.statSync(finalPath);
        let info = {};
        try {
          info = await getInfo(url);
        } catch (infoErr) {
          // Fallback: try getBasicInfo
          try {
            const basic = await getBasicInfo(url);
            info = basic;
          } catch {}
        }

        const registered = fileTtl.register(finalPath);

        return {
          success: true,
          path: registered.path,
          filename: registered.filename,
          downloadUrl: buildDownloadUrl(registered.filename),
          size: stat.size,
          info: {
            title: info.title,
            duration: info.duration,
            uploader: info.uploader
          }
        };
      } catch (err) {
        lastErr = err;
        cleanupTempOnFailure();
        // If this was the last format, throw
        if (fmt === formats[formats.length - 1]) throw err;
        // Otherwise continue to next fallback format
      }
    }

    throw lastErr || new Error('Download failed');
  });
}

/**
 * Download audio only (extract and convert to MP3)
 * @param {string} url
 * @param {string} [outputPath] - Output file path
 * @param {object} [opts]
 * @param {string} [opts.bitrate] - Audio bitrate (default: '192k')
 * @param {string} [opts.format] - Output format: 'mp3' | 'flac' | 'opus' | 'm4a' (default: 'mp3')
 * @returns {Promise<{success: boolean, path: string, filename: string, size: number, info: object}>}
 */
async function downloadAudio(url, outputPath, opts = {}) {
  return limiter.add(async () => {
    const format = opts.format || 'mp3';
    const bitrate = opts.bitrate || '192k';
    const outputTemplate = outputPath || path.join(tempDir, '%(title)s.%(ext)s');

    const buildAudioArgs = (fmt) => [
      '-x',
      '--audio-format', fmt,
      '--audio-quality', bitrate,
      '-o', outputTemplate,
      '--no-warnings',
      ...(opts.noPlaylist !== false ? ['--no-playlist'] : []),
      ...buildArgs(opts),
      url
    ];

    // Check if file already exists from a previous download
    let existingInfo = null;
    try { existingInfo = await getInfo(url); } catch {}
    if (existingInfo && existingInfo.title) {
      const safeTitle = fileTtl.sanitizeFilename(existingInfo.title);
      const audioExtensions = ['mp3', 'm4a', 'ogg', 'flac', 'opus', 'wav'];
      const existingFiles = fs.readdirSync(tempDir).filter(f => {
        if (!f.startsWith(safeTitle)) return false;
        const ext = path.extname(f).toLowerCase().replace('.', '');
        return audioExtensions.includes(ext);
      });
      if (existingFiles.length > 0) {
        const existingFile = path.join(tempDir, existingFiles[0]);
        if (fs.existsSync(existingFile)) {
          const stat = fs.statSync(existingFile);
          const registered = fileTtl.register(existingFile);
          return {
            success: true,
            path: registered.path,
            filename: registered.filename,
            downloadUrl: buildDownloadUrl(registered.filename),
            size: stat.size,
            format: path.extname(existingFile).replace('.', ''),
            info: { title: existingInfo.title, duration: existingInfo.duration, uploader: existingInfo.uploader }
          };
        }
      }
    }

    // Try preferred format, fallback to mp3, then to raw audio
    const formats = [format, 'mp3'];
    let lastErr = null;

    for (const fmt of formats) {
      try {
        const { stdout, stderr } = await execFileAsync(ytdlpPath, buildAudioArgs(fmt), { timeout: limiter._timeout || 600_000 });

        let finalPath = parseDestPath(stdout, stderr);

        if (outputPath && !finalPath) finalPath = outputPath;

        if (finalPath && !fs.existsSync(finalPath)) {
          const cleaned = finalPath.replace(/\.f\d+\./, '.');
          if (fs.existsSync(cleaned)) finalPath = cleaned;
        }

        if (!finalPath || !fs.existsSync(finalPath)) {
          const scanDir = outputPath ? path.dirname(path.resolve(outputPath)) : tempDir;
          const audioExtensions = ['mp3', 'm4a', 'ogg', 'flac', 'opus', 'wav'];
          const found = findMostRecentFile(scanDir, audioExtensions);
          if (found) finalPath = found;
        }

        if (!finalPath || !fs.existsSync(finalPath)) {
          throw new Error('Output file not found after audio download');
        }

        const stat = fs.statSync(finalPath);
        let info = {};
        try {
          info = await getInfo(url);
        } catch (infoErr) {
          try {
            const basic = await getBasicInfo(url);
            info = basic;
          } catch {}
        }

        const registered = fileTtl.register(finalPath);

        return {
          success: true,
          path: registered.path,
          filename: registered.filename,
          downloadUrl: buildDownloadUrl(registered.filename),
          size: stat.size,
          format: fmt,
          info: {
            title: info.title,
            duration: info.duration,
            uploader: info.uploader
          }
        };
      } catch (err) {
        lastErr = err;
        cleanupTempOnFailure();
        if (fmt === formats[formats.length - 1]) throw err;
      }
    }

    throw lastErr || new Error('Audio download failed');
  });
}

/**
 * Download subtitles
 * @param {string} url
 * @param {string} [outputDir]
 * @param {object} [opts]
 * @param {string} [opts.lang] - Language code (default: 'en')
 * @param {boolean} [opts.autoSubs] - Include auto-generated subs
 * @returns {Promise<{success: boolean, files: string[]}>}
 */
async function downloadSubtitles(url, outputDir, opts = {}) {
  return limiter.add(async () => {
    const args = [
      '--write-subs',
      '--sub-format', 'srt',
      '--skip-download',
      '-o', path.join(outputDir || tempDir, '%(title)s.%(ext)s'),
      '--no-warnings',
      ...buildArgs(opts),
      url
    ];

    if (opts.lang) args.splice(1, 0, '--sub-langs', opts.lang);
    if (opts.autoSubs) args.push('--write-auto-subs');

    await execFileAsync(ytdlpPath, args, { timeout: 60_000 });

    // Find generated subtitle files
    const files = fs.readdirSync(outputDir || tempDir)
      .filter(f => f.endsWith('.srt') || f.endsWith('.vtt') || f.endsWith('.ass'));

    return { success: true, files };
  });
}

/**
 * Get info for multiple URLs concurrently
 * @param {string[]} urls
 * @returns {Promise<object[]>}
 */
async function batchGetInfo(urls) {
  return limiter.addAll(urls.map(url => () => getBasicInfo(url))).then(results =>
    results.map(r => r.status === 'fulfilled' ? r.value : { error: r.reason.message })
  );
}

/**
 * Download multiple URLs concurrently
 * @param {Array<{url: string, output?: string, type?: 'video'|'audio', opts?: object}>} tasks
 * @returns {Promise<Array>}
 */
async function batchDownload(tasks) {
  return limiter.addAll(tasks.map(t => async () => {
    try {
      if (t.type === 'audio') {
        return await downloadAudio(t.url, t.output, t.opts);
      }
      return await download(t.url, t.output, t.opts);
    } catch (err) {
      return { success: false, url: t.url, error: err.message };
    }
  }));
}

/**
 * Search videos (using yt-dlp search)
 * @param {string} query
 * @param {number} [limit=5]
 * @returns {Promise<object[]>}
 */
async function search(query, limit = 5) {
  const result = await limiter.add(async () => {
    const args = [
      `ytsearch${limit}:${query}`,
      '--dump-json',
      '--no-download',
      '--no-warnings'
    ];
    const { stdout } = await execFileAsync(ytdlpPath, args, { timeout: 30_000 });
    const lines = stdout.trim().split('\n').filter(Boolean);
    return lines.map(line => {
      try {
        const info = JSON.parse(line);
        return {
          id: info.id,
          title: info.title,
          url: info.webpage_url,
          duration: info.duration_string,
          uploader: info.uploader,
          thumbnail: info.thumbnail,
          view_count: info.view_count
        };
      } catch { return null; }
    }).filter(Boolean);
  });
  return result;
}

/**
 * Build common yt-dlp args from options
 */
function buildArgs(opts) {
  const args = [];
  // Anti-403: real browser user-agent
  args.push('--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
  // Use default client (no player_client restriction) — gives widest format availability
  // Geo-bypass for region-locked content
  args.push('--geo-bypass');
  // Skip cert issues
  args.push('--no-check-certificates');
  if (opts.cookies) args.push('--cookies', opts.cookies);
  if (opts.extraArgs) args.push(...opts.extraArgs);
  return args;
}

/**
 * List of common temp file extensions to clean up on error
 */
const TEMP_CLEANUP_EXTS = ['mp4', 'mkv', 'webm', 'mp3', 'm4a', 'ogg', 'flac', 'opus', 'wav', 'part'];

/**
 * Scan temp dir and remove any leftover partial/failure files
 */
function cleanupTempOnFailure() {
  try {
    const files = fs.readdirSync(tempDir);
    const now = Date.now();
    for (const f of files) {
      const fp = path.join(tempDir, f);
      try {
        const stat = fs.statSync(fp);
        // Remove .part files and small leftover files (< 1MB, older than 2 min)
        if (f.endsWith('.part')) {
          fs.unlinkSync(fp);
        } else if (stat.size < 1024 * 1024 && (now - stat.mtimeMs) > 120_000) {
          fs.unlinkSync(fp);
        }
      } catch {}
    }
  } catch {}
}

/**
 * Get current concurrency stats
 */
function stats() {
  return {
    running: limiter.running,
    queued: limiter.queued,
    limit: limiter.limit,
    available: limiter.limit - limiter.running
  };
}

module.exports = {
  // Core
  getInfo,
  getBasicInfo,
  getFormats,
  isAvailable,
  getVersion,

  // Download
  download,
  downloadAudio,
  downloadSubtitles,

  // Search
  search,

  // Batch
  batchGetInfo,
  batchDownload,

  // Config
  setConcurrency,
  setTimeout,
  setPaths,
  stats,

  // Direct limiter access
  limiter
};

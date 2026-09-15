/**
 * Script Library - Unified Exports
 *
 * Provides concurrency-limited utilities for media processing and downloading.
 * All operations share the same concurrency model — tasks queue when the
 * limit is reached instead of spawning unlimited parallel processes.
 *
 * Modules:
 *   - concurrency: Semaphore-based concurrency limiter
 *   - ffmpeg: FFmpeg media processing wrapper
 *   - ytdl: yt-dlp video/audio downloader wrapper
 *
 * Usage in gateway handler_code:
 *   const { ffmpeg, ytdl } = require('../script');
 *   const audio = await ytdl.downloadAudio(url, '/tmp/output.mp3');
 *   const mp3 = await ffmpeg.convert('/tmp/video.mp4', '/tmp/audio.mp3');
 */

const concurrency = require('./concurrency');
const ffmpeg = require('./ffmpeg');
const ytdl = require('./ytdl');
const puppeteer = require('./puppeteer');

module.exports = {
  concurrency,
  ffmpeg,
  ytdl,
  puppeteer,

  /**
   * Global stats across all modules
   */
  stats() {
    return {
      concurrency: {
        ffmpeg: ffmpeg.stats(),
        ytdl: ytdl.stats(),
        puppeteer: puppeteer.stats()
      },
      ffmpegAvailable: null,
      ytdlAvailable: null,
      puppeteerAvailable: null
    };
  },

  /**
   * Check availability of external tools
   */
  async checkAvailability() {
    const [ffmpegOk, ytdlOk, puppeteerOk] = await Promise.all([
      ffmpeg.isAvailable(),
      ytdl.isAvailable(),
      puppeteer.isAvailable()
    ]);
    return { ffmpeg: ffmpegOk, ytdl: ytdlOk, puppeteer: puppeteerOk };
  }
};

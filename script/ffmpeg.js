/**
 * FFmpeg Wrapper with Concurrency Control
 *
 * Provides high-level functions for common media processing tasks.
 * All operations go through a concurrency limiter to prevent resource exhaustion.
 *
 * Requires: ffmpeg installed on the system and accessible in PATH.
 *
 * Usage:
 *   const ffmpeg = require('../script/ffmpeg');
 *
 *   // Set concurrency limit (default 3)
 *   ffmpeg.setConcurrency(3);
 *
 *   // Single task
 *   const result = await ffmpeg.convert('/tmp/input.mp4', '/tmp/output.mp3', {
 *     audioCodec: 'libmp3lame',
 *     audioBitrate: '192k'
 *   });
 *
 *   // Batch with concurrency control
 *   const results = await ffmpeg.batchConvert([
 *     { input: '/tmp/a.mp4', output: '/tmp/a.mp3' },
 *     { input: '/tmp/b.mp4', output: '/tmp/b.mp3' },
 *   ]);
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const { createLimiter } = require('./concurrency');

const execFileAsync = promisify(execFile);

// Default concurrency for FFmpeg operations (from env or 3)
let limiter = createLimiter(parseInt(process.env.SCRIPT_FFMPEG_CONCURRENCY) || 3, { timeout: parseInt(process.env.SCRIPT_FFMPEG_TIMEOUT) || 300_000 });

/**
 * FFmpeg binary path (auto-detected or overridden)
 */
let ffmpegPath = process.env.SCRIPT_FFMPEG_PATH || 'ffmpeg';
let ffprobePath = process.env.SCRIPT_FFPROBE_PATH || 'ffprobe';

/**
 * Check if FFmpeg is available
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
  try {
    await execFileAsync(ffmpegPath, ['-version'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Set concurrency limit for FFmpeg operations
 * @param {number} n - Max concurrent FFmpeg processes
 */
function setConcurrency(n) {
  limiter = createLimiter(n, { timeout: limiter._timeout });
}

/**
 * Set per-task timeout in ms
 * @param {number} ms - Timeout in milliseconds (0 = no timeout)
 */
function setTimeout(ms) {
  limiter = createLimiter(limiter.limit, { timeout: ms });
}

/**
 * Set custom ffmpeg/ffprobe paths
 * @param {{ ffmpeg?: string, ffprobe?: string }} paths
 */
function setPaths(paths) {
  if (paths.ffmpeg) ffmpegPath = paths.ffmpeg;
  if (paths.ffprobe) ffprobePath = paths.ffprobe;
}

/**
 * Get media info using ffprobe
 * @param {string} inputPath
 * @returns {Promise<object>}
 */
async function probe(inputPath) {
  const result = await limiter.add(async () => {
    const { stdout } = await execFileAsync(ffprobePath, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      inputPath
    ], { timeout: 30000 });
    const parsed = JSON.parse(stdout);
    // Strip internal file paths from output
    if (parsed.format) delete parsed.format.filename;
    if (parsed.streams) {
      for (const s of parsed.streams) {
        delete s.filename;
        delete s.codec_long_name;
      }
    }
    return parsed;
  });
  return result;
}

/**
 * Get duration in seconds
 * @param {string} inputPath
 * @returns {Promise<number>}
 */
async function getDuration(inputPath) {
  const info = await probe(inputPath);
  return parseFloat(info.format?.duration || '0');
}

/**
 * Convert media file
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {object} [opts]
 * @param {string} [opts.audioCodec] - Audio codec (e.g., 'libmp3lame', 'aac', 'copy')
 * @param {string} [opts.videoCodec] - Video codec (e.g., 'libx264', 'copy', 'libvpx')
 * @param {string} [opts.audioBitrate] - Audio bitrate (e.g., '192k', '320k')
 * @param {string} [opts.videoBitrate] - Video bitrate (e.g., '2M', '5M')
 * @param {string} [opts.format] - Output format (e.g., 'mp3', 'mp4', 'webm', 'ogg')
 * @param {string} [opts.resolution] - Video resolution (e.g., '1280x720', '640x360')
 * @param {number} [opts.start] - Start time in seconds
 * @param {number} [opts.duration] - Duration to process in seconds
 * @param {boolean} [opts.stripAudio] - Remove audio track
 * @param {boolean} [opts.stripVideo] - Remove video track
 * @param {string[]} [opts.extraArgs] - Additional ffmpeg arguments
 * @returns {Promise<{success: boolean, input: string, output: string, duration: number}>}
 */
async function convert(inputPath, outputPath, opts = {}) {
  const args = ['-i', inputPath, '-y'];

  if (opts.videoCodec) args.push('-c:v', opts.videoCodec);
  if (opts.audioCodec) args.push('-c:a', opts.audioCodec);
  if (opts.audioBitrate) args.push('-b:a', opts.audioBitrate);
  if (opts.videoBitrate) args.push('-b:v', opts.videoBitrate);
  if (opts.resolution) args.push('-s', opts.resolution);
  if (opts.format) args.push('-f', opts.format);
  if (opts.start !== undefined) args.push('-ss', String(opts.start));
  if (opts.duration !== undefined) args.push('-t', String(opts.duration));
  if (opts.stripAudio) args.push('-an');
  if (opts.stripVideo) args.push('-vn');
  if (opts.extraArgs) args.push(...opts.extraArgs);

  args.push(outputPath);

  const startTime = Date.now();
  await limiter.add(() => execFileAsync(ffmpegPath, args, { timeout: 300_000 }));

  return {
    success: true,
    input: inputPath,
    output: outputPath,
    duration: Date.now() - startTime
  };
}

/**
 * Extract audio from video
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {object} [opts]
 * @param {string} [opts.codec] - 'libmp3lame' | 'aac' | 'libopus' (default: libmp3lame)
 * @param {string} [opts.bitrate] - e.g. '192k' (default: '192k')
 * @param {string} [opts.sampleRate] - e.g. '44100'
 * @returns {Promise<object>}
 */
async function extractAudio(inputPath, outputPath, opts = {}) {
  return convert(inputPath, outputPath, {
    audioCodec: opts.codec || 'libmp3lame',
    audioBitrate: opts.bitrate || '192k',
    stripVideo: true,
    sampleRate: opts.sampleRate,
    extraArgs: opts.sampleRate ? ['-ar', opts.sampleRate] : []
  });
}

/**
 * Extract audio as MP3
 */
async function toMp3(inputPath, outputPath, bitrate = '192k') {
  return extractAudio(inputPath, outputPath, { codec: 'libmp3lame', bitrate });
}

/**
 * Extract audio as AAC
 */
async function toAac(inputPath, outputPath, bitrate = '192k') {
  return extractAudio(inputPath, outputPath, { codec: 'aac', bitrate });
}

/**
 * Extract audio as OGG Vorbis
 */
async function toOgg(inputPath, outputPath, bitrate = '192k') {
  return extractAudio(inputPath, outputPath, { codec: 'libvorbis', bitrate });
}

/**
 * Compress video
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {object} [opts]
 * @param {string} [opts.resolution] - Target resolution (default: '1280x720')
 * @param {string} [opts.videoBitrate] - Target video bitrate (default: '1M')
 * @param {string} [opts.audioBitrate] - Target audio bitrate (default: '128k')
 * @returns {Promise<object>}
 */
async function compressVideo(inputPath, outputPath, opts = {}) {
  return convert(inputPath, outputPath, {
    videoCodec: 'libx264',
    audioCodec: 'aac',
    resolution: opts.resolution || '1280x720',
    videoBitrate: opts.videoBitrate || '1M',
    audioBitrate: opts.audioBitrate || '128k',
    extraArgs: ['-preset', 'medium', '-crf', '23']
  });
}

/**
 * Resize video to target resolution
 */
async function resize(inputPath, outputPath, resolution) {
  return convert(inputPath, outputPath, {
    videoCodec: 'libx264',
    audioCodec: 'copy',
    resolution,
    extraArgs: ['-preset', 'fast']
  });
}

/**
 * Trim video/audio by time range
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {number} start - Start time in seconds
 * @param {number} end - End time in seconds (or use duration)
 * @returns {Promise<object>}
 */
async function trim(inputPath, outputPath, start, end) {
  const duration = end - start;
  return convert(inputPath, outputPath, {
    start,
    duration,
    videoCodec: 'copy',
    audioCodec: 'copy'
  });
}

/**
 * Generate thumbnail from video
 * @param {string} inputPath
 * @param {string} outputPath
 * @param {number} [time=1] - Time position in seconds
 * @returns {Promise<object>}
 */
async function thumbnail(inputPath, outputPath, time = 1) {
  return limiter.add(async () => {
    await execFileAsync(ffmpegPath, [
      '-i', inputPath,
      '-y',
      '-ss', String(time),
      '-vframes', '1',
      '-vf', 'scale=320:-1',
      outputPath
    ], { timeout: 30_000 });
    return { success: true, input: inputPath, output: outputPath };
  });
}

/**
 * Get media streams info
 */
async function getStreams(inputPath) {
  const info = await probe(inputPath);
  return info.streams || [];
}

/**
 * Convert input to a target format (auto-detect from extension)
 */
async function toFormat(inputPath, outputPath, format) {
  const formatMap = {
    mp3: { audioCodec: 'libmp3lame', format: 'mp3' },
    aac: { audioCodec: 'aac', format: 'aac' },
    ogg: { audioCodec: 'libvorbis', format: 'ogg' },
    wav: { audioCodec: 'pcm_s16le', format: 'wav' },
    flac: { audioCodec: 'flac', format: 'flac' },
    mp4: { videoCodec: 'libx264', audioCodec: 'aac', format: 'mp4' },
    webm: { videoCodec: 'libvpx', audioCodec: 'libopus', format: 'webm' },
    gif: { videoCodec: 'gif', format: 'gif', extraArgs: ['-vf', 'fps=10,scale=480:-1:flags=lanczos'] },
    mkv: { videoCodec: 'libx264', audioCodec: 'aac', format: 'matroska' },
  };

  const cfg = formatMap[format.toLowerCase()];
  if (!cfg) throw new Error(`Unsupported format: ${format}. Supported: ${Object.keys(formatMap).join(', ')}`);

  return convert(inputPath, outputPath, cfg);
}

/**
 * Batch convert multiple files with concurrency control
 * @param {Array<{input: string, output: string, opts?: object}>} tasks
 * @returns {Promise<Array<{success: boolean, error?: string, input: string, output: string}>>}
 */
async function batchConvert(tasks) {
  return limiter.addAll(tasks.map(t => async () => {
    try {
      await convert(t.input, t.output, t.opts || {});
      return { success: true, input: t.input, output: t.output };
    } catch (err) {
      return { success: false, input: t.input, output: t.output, error: err.message };
    }
  }));
}

/**
 * Batch extract audio
 */
async function batchExtractAudio(tasks) {
  return limiter.addAll(tasks.map(t => async () => {
    try {
      await extractAudio(t.input, t.output, t.opts || {});
      return { success: true, input: t.input, output: t.output };
    } catch (err) {
      return { success: false, input: t.input, output: t.output, error: err.message };
    }
  }));
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
  convert,
  probe,
  getDuration,
  getStreams,
  isAvailable,

  // Audio extraction
  extractAudio,
  toMp3,
  toAac,
  toOgg,

  // Video
  compressVideo,
  resize,
  trim,
  thumbnail,

  // Generic
  toFormat,

  // Batch
  batchConvert,
  batchExtractAudio,

  // Config
  setConcurrency,
  setTimeout,
  setPaths,
  stats,

  // Direct limiter access
  limiter
};

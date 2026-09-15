#!/usr/bin/env node
/**
 * Script Tools Setup — Auto-detect & install FFmpeg + yt-dlp
 *
 * Usage:
 *   node script/setup.js          # Check & install missing tools
 *   node script/setup.js check    # Only check availability
 *   node script/setup.js install  # Force install all
 *
 * Supported platforms:
 *   - Windows  : winget, choco, scoop, pip
 *   - macOS    : brew, pip
 *   - Linux    : apt (Debian/Ubuntu), dnf/yum (Fedora/RHEL),
 *                apk (Alpine), pacman (Arch), brew (Linuxbrew), pip
 */

const { execSync } = require('child_process');
const os = require('os');

// ── Colors ────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

const log = (color, icon, msg) => console.log(`${color}${icon}${c.reset} ${msg}`);
const ok = (m) => log(c.green, '✓', m);
const warn = (m) => log(c.yellow, '⚠', m);
const fail = (m) => log(c.red, '✗', m);
const info = (m) => log(c.cyan, '→', m);
const dim = (m) => console.log(`${c.dim}  ${m}${c.reset}`);

// ── Platform detection ────────────────────────────
const platform = os.platform(); // 'win32', 'darwin', 'linux'
const isWin = platform === 'win32';
const isMac = platform === 'darwin';
const isLinux = platform === 'linux';

// ── Detect package managers ───────────────────────
function detectManagers() {
  const candidates = isWin
    ? [
        { name: 'winget', cmd: 'winget --version' },
        { name: 'choco', cmd: 'choco --version' },
        { name: 'scoop', cmd: 'scoop --version' },
        { name: 'pip', cmd: 'pip --version' },
        { name: 'pip3', cmd: 'pip3 --version' },
      ]
    : isMac
    ? [
        { name: 'brew', cmd: 'brew --version' },
        { name: 'pip', cmd: 'pip --version' },
        { name: 'pip3', cmd: 'pip3 --version' },
      ]
    : [
        // Linux — detect distro family first for priority
        { name: 'apt', cmd: 'apt --version' },
        { name: 'dnf', cmd: 'dnf --version' },
        { name: 'yum', cmd: 'yum --version' },
        { name: 'apk', cmd: 'apk --version' },
        { name: 'pacman', cmd: 'pacman --version' },
        { name: 'brew', cmd: 'brew --version' },
        { name: 'pip', cmd: 'pip --version' },
        { name: 'pip3', cmd: 'pip3 --version' },
      ];

  const found = [];
  for (const m of candidates) {
    try {
      execSync(m.cmd, { stdio: 'pipe', timeout: 5000 });
      found.push(m.name);
    } catch { /* not available */ }
  }
  return found;
}

// ── Check if command exists ───────────────────────
function commandExists(cmd) {
  try {
    execSync(isWin ? `where ${cmd}` : `which ${cmd}`, { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ── Get version string ────────────────────────────
function getVersion(cmd, args = ['--version']) {
  try {
    const result = execSync(`${cmd} ${args.join(' ')}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10000,
    });

    const output = result?.trim();

    if (!output) return 'unknown';

    // Ambil hanya baris pertama
    const firstLine = output.split(/\r?\n/)[0].trim();

    return firstLine || 'unknown';
  } catch (err) {
    // Beberapa binary menulis versi ke stderr
    const output = [
      err?.stdout?.toString(),
      err?.stderr?.toString(),
    ]
      .filter(Boolean)
      .join('\n')
      .trim();

    if (!output) return 'unknown';

    return output.split(/\r?\n/)[0].trim() || 'unknown';
  }
}

// ── Get Linux distro info ─────────────────────────
function getLinuxDistro() {
  if (!isLinux) return null;
  try {
    const osRelease = require('fs').readFileSync('/etc/os-release', 'utf8');
    const id = osRelease.match(/^ID=(.+)$/m)?.[1]?.replace(/"/g, '') || '';
    const idLike = osRelease.match(/^ID_LIKE=(.+)$/m)?.[1]?.replace(/"/g, '') || '';
    return { id, idLike };
  } catch {
    return { id: '', idLike: '' };
  }
}

// ── Install FFmpeg ────────────────────────────────
function installFFmpeg(managers) {
  for (const mgr of managers) {
    try {
      info(`Installing FFmpeg via ${mgr}...`);

      if (mgr === 'winget') {
        // Gyan.FFmpeg is the most common maintained winget package
        execSync(`winget install --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements`, {
          stdio: 'inherit', timeout: 300_000,
        });
      } else if (mgr === 'choco') {
        execSync(`choco install ffmpeg -y`, { stdio: 'inherit', timeout: 300_000 });
      } else if (mgr === 'scoop') {
        execSync(`scoop install ffmpeg`, { stdio: 'inherit', timeout: 300_000 });
      } else if (mgr === 'brew') {
        execSync(`brew install ffmpeg`, { stdio: 'inherit', timeout: 300_000 });
      } else if (mgr === 'apt') {
        execSync(`sudo apt-get update && sudo apt-get install -y ffmpeg`, {
          stdio: 'inherit', timeout: 300_000,
        });
      } else if (mgr === 'dnf') {
        execSync(`sudo dnf install -y ffmpeg`, { stdio: 'inherit', timeout: 300_000 });
      } else if (mgr === 'yum') {
        execSync(`sudo yum install -y ffmpeg`, { stdio: 'inherit', timeout: 300_000 });
      } else if (mgr === 'apk') {
        execSync(`sudo apk add ffmpeg`, { stdio: 'inherit', timeout: 300_000 });
      } else if (mgr === 'pacman') {
        execSync(`sudo pacman -S --noconfirm ffmpeg`, { stdio: 'inherit', timeout: 300_000 });
      } else {
        continue; // pip can't install FFmpeg, skip
      }

      ok(`FFmpeg installed via ${mgr}`);
      return true;
    } catch (err) {
      warn(`${mgr} failed: ${err.message?.split('\n')[0]}`);
    }
  }
  fail('Could not install FFmpeg');
  return false;
}

// ── Install yt-dlp ────────────────────────────────
function installYtdlp(managers) {
  // yt-dlp has a winget ID on Windows
  for (const mgr of managers) {
    try {
      info(`Installing yt-dlp via ${mgr}...`);

      if (mgr === 'winget') {
        execSync(`winget install --id yt-dlp.yt-dlp --accept-source-agreements --accept-package-agreements`, {
          stdio: 'inherit', timeout: 300_000,
        });
      } else if (mgr === 'choco') {
        execSync(`choco install yt-dlp -y`, { stdio: 'inherit', timeout: 300_000 });
      } else if (mgr === 'scoop') {
        execSync(`scoop install yt-dlp`, { stdio: 'inherit', timeout: 300_000 });
      } else if (mgr === 'pip' || mgr === 'pip3') {
        execSync(`${mgr} install -U yt-dlp`, { stdio: 'inherit', timeout: 300_000 });
      } else if (mgr === 'brew') {
        execSync(`brew install yt-dlp`, { stdio: 'inherit', timeout: 300_000 });
      } else if (mgr === 'apt') {
        // Debian/Ubuntu apt repo is often outdated, try pip first
        execSync(`pip3 install -U yt-dlp || sudo apt-get update && sudo apt-get install -y yt-dlp`, {
          stdio: 'inherit', timeout: 300_000,
        });
      } else if (mgr === 'dnf') {
        execSync(`sudo dnf install -y yt-dlp`, { stdio: 'inherit', timeout: 300_000 });
      } else if (mgr === 'apk') {
        execSync(`pip3 install -U yt-dlp`, { stdio: 'inherit', timeout: 300_000 });
      } else if (mgr === 'pacman') {
        execSync(`sudo pacman -S --noconfirm yt-dlp`, { stdio: 'inherit', timeout: 300_000 });
      } else {
        continue;
      }

      ok(`yt-dlp installed via ${mgr}`);
      return true;
    } catch (err) {
      warn(`${mgr} failed: ${err.message?.split('\n')[0]}`);
    }
  }
  fail('Could not install yt-dlp');
  return false;
}

// ── Manual instructions ───────────────────────────
function printManual(tool) {
  console.log(`\n${c.bold}Manual install for ${tool}:${c.reset}`);

  if (tool === 'ffmpeg') {
    if (isWin) {
      dim('  winget install Gyan.FFmpeg');
      dim('  choco install ffmpeg');
      dim('  scoop install ffmpeg');
      dim('  # Or download: https://ffmpeg.org/download.html');
    } else if (isMac) {
      dim('  brew install ffmpeg');
    } else {
      dim('  sudo apt install ffmpeg     # Debian/Ubuntu');
      dim('  sudo dnf install ffmpeg     # Fedora');
      dim('  sudo apk add ffmpeg         # Alpine');
      dim('  sudo pacman -S ffmpeg       # Arch');
      dim('  brew install ffmpeg         # Linuxbrew');
    }
  } else if (tool === 'yt-dlp') {
    if (isWin) {
      dim('  winget install yt-dlp.yt-dlp');
      dim('  choco install yt-dlp');
      dim('  scoop install yt-dlp');
      dim('  pip install yt-dlp');
    } else if (isMac) {
      dim('  brew install yt-dlp');
      dim('  pip install yt-dlp');
    } else {
      dim('  pip install -U yt-dlp       # Recommended (always latest)');
      dim('  sudo apt install yt-dlp     # Debian/Ubuntu (may be outdated)');
      dim('  sudo dnf install yt-dlp     # Fedora');
      dim('  sudo pacman -S yt-dlp       # Arch');
      dim('  brew install yt-dlp         # Linuxbrew');
    }
  }
  console.log('');
}

// ── Check FFmpeg ──────────────────────────────────
function checkFFmpeg() {
  const ffmpegPath = process.env.SCRIPT_FFMPEG_PATH || 'ffmpeg';
  const ffprobePath = process.env.SCRIPT_FFPROBE_PATH || 'ffprobe';

  const ffmpegOk = commandExists(ffmpegPath);
  const ffprobeOk = commandExists(ffprobePath);

  if (ffmpegOk && ffprobeOk) {
    ok(`FFmpeg found: ${getVersion(ffmpegPath)}`);
    return true;
  }
  if (ffmpegOk && !ffprobeOk) {
    warn('FFmpeg found but ffprobe missing');
    return false;
  }
  fail('FFmpeg not found');
  return false;
}

// ── Check yt-dlp ──────────────────────────────────
function checkYtdlp() {
  const ytdlpPath = process.env.SCRIPT_YTDLP_PATH || 'yt-dlp';
  if (commandExists(ytdlpPath)) {
    ok(`yt-dlp found: ${getVersion(ytdlpPath)}`);
    return true;
  }
  fail('yt-dlp not found');
  return false;
}

// ── Summary ───────────────────────────────────────
function printSummary() {
  const ffmpegPath = process.env.SCRIPT_FFMPEG_PATH || 'ffmpeg';
  const ytdlpPath = process.env.SCRIPT_YTDLP_PATH || 'yt-dlp';

  console.log(`${c.bold}── Configuration ──${c.reset}`);
  dim(`Platform:      ${platform} (${isWin ? 'Windows' : isMac ? 'macOS' : 'Linux'})`);
  dim(`FFmpeg path:   ${ffmpegPath}`);
  dim(`yt-dlp path:   ${ytdlpPath}`);
  dim(`Concurrency:   FFmpeg=${process.env.SCRIPT_FFMPEG_CONCURRENCY || 3}, yt-dlp=${process.env.SCRIPT_YTDLP_CONCURRENCY || 3}`);
  dim(`Timeout:       FFmpeg=${process.env.SCRIPT_FFMPEG_TIMEOUT || 300_000}ms, yt-dlp=${process.env.SCRIPT_YTDLP_TIMEOUT || 600_000}ms`);
  console.log('');
}

// ── Main ──────────────────────────────────────────
async function main() {
  const action = process.argv[2] || 'check';

  console.log('');
  console.log(`${c.bold}${c.cyan}═══════════════════════════════════════${c.reset}`);
  console.log(`${c.bold}${c.cyan}  SaaS Gateway — Script Tools Setup${c.reset}`);
  console.log(`${c.bold}${c.cyan}═══════════════════════════════════════${c.reset}`);
  console.log('');

  // Step 1: Check current state
  const ffmpegOk = checkFFmpeg();
  const ytdlpOk = checkYtdlp();

  if (action === 'check') {
    console.log('');
    if (ffmpegOk && ytdlpOk) {
      ok('All script tools are ready!');
    } else {
      warn('Some tools missing. Run: npm run scripts:setup');
    }
    printSummary();
    return;
  }

  // Already installed
  if (ffmpegOk && ytdlpOk) {
    ok('All script tools already installed.');
    printSummary();
    return;
  }

  // Step 2: Detect package managers
  console.log('');
  info('Detecting package managers...');
  const managers = detectManagers();

  if (managers.length === 0) {
    fail('No package manager found on this system');
    console.log('');
    if (!ffmpegOk) printManual('ffmpeg');
    if (!ytdlpOk) printManual('yt-dlp');
    return;
  }

  dim(`Found: ${managers.join(', ')}`);

  // Show distro info on Linux
  if (isLinux) {
    const distro = getLinuxDistro();
    if (distro?.id) dim(`Distro: ${distro.id}${distro.idLike ? ` (${distro.idLike})` : ''}`);
  }
  console.log('');

  // Step 3: Install missing tools
  // For yt-dlp, prefer pip (always latest) over system package managers
  if (!ffmpegOk) {
    installFFmpeg(managers);
    console.log('');
  }

  if (!ytdlpOk) {
    // Reorder: pip first for yt-dlp (apt/dnf packages are often outdated)
    const pipFirst = ['pip', 'pip3', ...managers.filter(m => m !== 'pip' && m !== 'pip3')];
    installYtdlp(pipFirst);
    console.log('');
  }

  // Step 4: Final verification
  console.log(`${c.bold}── Final Check ──${c.reset}`);
  const finalFfmpeg = checkFFmpeg();
  const finalYtdlp = checkYtdlp();

  console.log('');
  if (finalFfmpeg && finalYtdlp) {
    ok('All script tools installed and ready!');
  } else {
    if (!finalFfmpeg) printManual('ffmpeg');
    if (!finalYtdlp) printManual('yt-dlp');
  }

  printSummary();
}

main().catch((err) => {
  fail(`Setup failed: ${err.message}`);
  process.exit(1);
});

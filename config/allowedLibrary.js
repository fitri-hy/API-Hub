/**
 * Centralized allowed libraries for sandboxed handler execution.
 * Used by gatewayController.js and playgroundController.js.
 */

const allowedInternal = {
  'script': require('../script'),
  'script/concurrency': require('../script/concurrency'),
  'script/ffmpeg': require('../script/ffmpeg'),
  'script/ytdl': require('../script/ytdl'),
  'script/puppeteer': require('../script/puppeteer'),
  'script/fileTtl': require('../script/fileTtl'),
  'qrcode': require('qrcode'),
  'canvas': require('canvas'),
  'jsqr': require('jsqr'),
  'sharp': require('sharp'),
};

const allowedCjs = {
  'uuid': 'uuid',
  'bcryptjs': 'bcryptjs',
  'crypto': 'crypto',
  'querystring': 'querystring',
  'url': 'url',
  'path': 'path',
  'axios': 'axios',
};

const allowedEsm = [
  'node-fetch', 'axios', 'cheerio', 'dayjs', 'moment',
  'lodash', 'ramda', 'mathjs', 'currency.js',
  'fast-xml-parser', 'xml2js', 'he', 'uuid', 'bcryptjs',
  'dotenv', 'form-data', 'querystring',
];

module.exports = { allowedInternal, allowedCjs, allowedEsm };

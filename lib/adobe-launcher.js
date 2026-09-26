'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { normalizeLanguage } = require('./i18n');

const ADOBE_APPS = Object.freeze({
  illustrator: Object.freeze({
    id: 'illustrator', name: 'Adobe Illustrator', executableName: 'Illustrator.exe',
    directoryPrefix: 'Adobe Illustrator',
    relativeExecutable: path.join('Support Files', 'Contents', 'Windows', 'Illustrator.exe'),
    alternateExecutables: [path.join('Support Files', 'Illustrator.exe'), 'Illustrator.exe'],
    environmentKeys: ['MESSS_ILLUSTRATOR_PATH', 'ILLUSTRATOR_PATH'],
    registryProductKeys: ['HKCU\\SOFTWARE\\Adobe\\Illustrator', 'HKLM\\SOFTWARE\\Adobe\\Illustrator', 'HKLM\\SOFTWARE\\WOW6432Node\\Adobe\\Illustrator']
  }),
  photoshop: Object.freeze({
    id: 'photoshop',
    name: 'Photoshop',
    executableName: 'Photoshop.exe',
    directoryPrefix: 'Adobe Photoshop',
    relativeExecutable: 'Photoshop.exe',
    environmentKeys: ['MESSS_PHOTOSHOP_PATH', 'PHOTOSHOP_PATH'],
    registryProductKeys: [
      'HKCU\\SOFTWARE\\Adobe\\Photoshop',
      'HKLM\\SOFTWARE\\Adobe\\Photoshop',
      'HKLM\\SOFTWARE\\WOW6432Node\\Adobe\\Photoshop'
    ]
  }),
  'after-effects': Object.freeze({
    id: 'after-effects',
    name: 'After Effects',
    executableName: 'AfterFX.exe',
    directoryPrefix: 'Adobe After Effects',
    relativeExecutable: path.join('Support Files', 'AfterFX.exe'),
    environmentKeys: ['MESSS_AFTER_EFFECTS_PATH', 'AFTERFX_PATH', 'AFTER_EFFECTS_PATH'],
    registryProductKeys: [
      'HKCU\\SOFTWARE\\Adobe\\After Effects',
      'HKLM\\SOFTWARE\\Adobe\\After Effects',
      'HKLM\\SOFTWARE\\WOW6432Node\\Adobe\\After Effects'
    ]
  })
});

function adobeApp(target) {
  return ADOBE_APPS[String(target || '').trim().toLowerCase()] || null;
}

function expandWindowsEnvironment(value, environment = process.env) {
  return String(value || '').replace(/%([^%]+)%/g, (match, key) => {
    const actualKey = Object.keys(environment).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
    return actualKey ? environment[actualKey] : match;
  });
}

function cleanWindowsPath(value, environment = process.env) {
  let candidate = expandWindowsEnvironment(value, environment)
    .replace(/\0/g, '')
    .trim();
  if (candidate.startsWith('"')) {
    const closingQuote = candidate.indexOf('"', 1);
    candidate = closingQuote > 1 ? candidate.slice(1, closingQuote) : candidate.slice(1);
  }
  return candidate.replace(/^'+|'+$/g, '').trim();
}

function registryValuePaths(output, definition, environment = process.env) {
  const candidates = [];
  for (const line of String(output || '').split(/\r?\n/)) {
    const valueMatch = line.match(/\bREG_(?:EXPAND_)?SZ\s+(.+)$/i);
    if (!valueMatch) continue;
    const value = cleanWindowsPath(valueMatch[1], environment);
    if (!value) continue;
    if (value.toLowerCase().endsWith(definition.executableName.toLowerCase())) {
      candidates.push(value);
    } else {
      for (const relative of [definition.relativeExecutable, ...(definition.alternateExecutables || [])]) candidates.push(path.join(value, relative));
    }
  }
  return candidates;
}

function queryRegistry(key, args = [], execFileSyncImpl = execFileSync) {
  try {
    return execFileSyncImpl('reg.exe', ['query', key, ...args], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2500
    });
  } catch (error) {
    return '';
  }
}

function appPathRegistryCandidates(definition, options = {}) {
  const query = options.queryRegistry || ((key, args) => queryRegistry(key, args, options.execFileSyncImpl));
  const roots = [
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths'
  ];
  return roots.flatMap((root) => registryValuePaths(
    query(`${root}\\${definition.executableName}`, ['/ve']),
    definition,
    options.env
  ));
}

function adobeProductRegistryCandidates(definition, options = {}) {
  const query = options.queryRegistry || ((key, args) => queryRegistry(key, args, options.execFileSyncImpl));
  return definition.registryProductKeys.flatMap((key) => registryValuePaths(
    query(key, ['/s']),
    definition,
    options.env
  ));
}

function standardAdobeRoots(environment = process.env) {
  const systemDrive = String(environment.SystemDrive || 'C:').replace(/[\\/]+$/, '');
  const parents = [
    environment.ProgramW6432,
    environment.ProgramFiles,
    environment['ProgramFiles(x86)'],
    path.join(systemDrive + '\\', 'Program Files'),
    path.join(systemDrive + '\\', 'Program Files (x86)'),
    environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, 'Programs')
  ].filter(Boolean);
  return [...new Set(parents.map((parent) => path.join(parent, 'Adobe')))];
}

function scannedInstallCandidates(definition, options = {}) {
  const environment = options.env || process.env;
  const readdirSyncImpl = options.readdirSync || fs.readdirSync;
  const roots = options.adobeRoots || standardAdobeRoots(environment);
  const matches = [];
  for (const root of roots) {
    let entries;
    try {
      entries = readdirSyncImpl(root, { withFileTypes: true });
    } catch (error) {
      continue;
    }
    const directories = entries
      .filter((entry) => entry && typeof entry.isDirectory === 'function' && entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name.toLowerCase().startsWith(definition.directoryPrefix.toLowerCase()))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
    for (const directory of directories) {
      for (const relative of [definition.relativeExecutable, ...(definition.alternateExecutables || [])]) matches.push(path.join(root, directory, relative));
    }
  }
  return matches;
}

function pathLookupCandidates(definition, options = {}) {
  const execFileSyncImpl = options.execFileSyncImpl || execFileSync;
  try {
    const output = execFileSyncImpl('where.exe', [definition.executableName], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2500
    });
    return String(output || '').split(/\r?\n/).map((line) => cleanWindowsPath(line, options.env)).filter(Boolean);
  } catch (error) {
    return [];
  }
}

function findAdobeExecutable(target, options = {}) {
  const definition = adobeApp(target);
  if (!definition || (options.platform || process.platform) !== 'win32') return '';
  const environment = options.env || process.env;
  const existsSyncImpl = options.existsSync || fs.existsSync;
  const statSyncImpl = options.statSync || fs.statSync;
  const explicit = definition.environmentKeys.map((key) => environment[key]).filter(Boolean);
  // Keep discovery lazy. Most Creative Cloud installs have an App Paths
  // entry, so there is no reason to synchronously enumerate every fallback
  // registry branch before launching the application.
  const groupFactories = [
    () => explicit,
    () => appPathRegistryCandidates(definition, options),
    () => scannedInstallCandidates(definition, options),
    () => adobeProductRegistryCandidates(definition, options),
    () => pathLookupCandidates(definition, options)
  ];
  const seen = new Set();
  for (const makeGroup of groupFactories) {
    const group = makeGroup();
    for (const rawCandidate of group) {
      const candidate = cleanWindowsPath(rawCandidate, environment);
      if (!candidate) continue;
      const normalized = path.normalize(candidate);
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        if (!existsSyncImpl(normalized)) continue;
        const stat = statSyncImpl(normalized);
        if (stat && typeof stat.isFile === 'function' && !stat.isFile()) continue;
        return normalized;
      } catch (error) {
        continue;
      }
    }
  }
  return '';
}

function responseMessage(reason, definition, language, detail = '') {
  const zh = language === 'zh';
  const ko = language === 'ko';
  const pick = (en, zhText, koText) => zh ? zhText : (ko ? koText : en);
  const appName = definition ? definition.name : 'Adobe application';
  const messages = {
    'invalid-target': pick('This Adobe application is not supported.', '不支持这个 Adobe 应用。', '이 Adobe 앱은 지원되지 않습니다.'),
    'unsupported-platform': pick(`Send to ${appName} is currently available on Windows only.`, `${appName} 发送功能目前仅支持 Windows。`, `${appName}(으)로 보내기는 현재 Windows에서만 사용할 수 있습니다.`),
    'invalid-source-path': pick('The source file path is invalid.', '源文件路径无效。', '원본 파일 경로가 올바르지 않습니다.'),
    'source-file-missing': pick('The original media file was moved or is missing.', '原始媒体文件已移动或不存在。', '원본 미디어 파일이 이동되었거나 없습니다.'),
    'not-installed': pick(`${appName} was not found. Make sure the Creative Cloud application is installed.`, `未找到 ${appName}，请确认已安装 Creative Cloud 版本。`, `${appName}을(를) 찾지 못했습니다. Creative Cloud 버전이 설치되어 있는지 확인하세요.`),
    'permission-denied': pick(`SCAAP. does not have permission to start ${appName}.`, `没有权限启动 ${appName}。`, `SCAAP.에 ${appName}을(를) 시작할 권한이 없습니다.`),
    'launch-timeout': pick(`${appName} took too long to start. Please try again.`, `${appName} 启动超时，请稍后重试。`, `${appName} 시작 시간이 초과되었습니다. 다시 시도하세요.`),
    'launch-failed': pick(`Could not start ${appName}${detail ? `: ${detail}` : '.'}`, `无法启动 ${appName}${detail ? `：${detail}` : '。'}`, `${appName}을(를) 시작하지 못했습니다${detail ? `: ${detail}` : '.'}`),
    launched: pick(`Sent to ${appName}.`, `已发送到 ${appName}。`, `${appName}(으)로 보냈습니다.`)
  };
  return messages[reason] || messages['launch-failed'];
}

async function launchAdobeMedia(target, mediaPath, options = {}) {
  const definition = adobeApp(target);
  const language = normalizeLanguage(options.language);
  if (!definition) {
    return { ok: false, reason: 'invalid-target', message: responseMessage('invalid-target', null, language) };
  }
  if ((options.platform || process.platform) !== 'win32') {
    return { ok: false, reason: 'unsupported-platform', message: responseMessage('unsupported-platform', definition, language) };
  }

  const sourcePath = cleanWindowsPath(mediaPath, options.env);
  if (!sourcePath || !path.isAbsolute(sourcePath) || /^[a-z][a-z0-9+.-]*:\/\//i.test(sourcePath)) {
    return { ok: false, reason: 'invalid-source-path', message: responseMessage('invalid-source-path', definition, language) };
  }
  try {
    const stat = (options.statSync || fs.statSync)(sourcePath);
    if (stat && typeof stat.isFile === 'function' && !stat.isFile()) throw new Error('Not a file');
  } catch (error) {
    return { ok: false, reason: 'source-file-missing', message: responseMessage('source-file-missing', definition, language) };
  }

  const executable = (options.findExecutable || findAdobeExecutable)(definition.id, options);
  if (!executable) {
    return { ok: false, reason: 'not-installed', message: responseMessage('not-installed', definition, language) };
  }

  const spawnImpl = options.spawn || spawn;
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 8000);
  return new Promise((resolve) => {
    let settled = false;
    let child;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({
      ok: false,
      reason: 'launch-timeout',
      message: responseMessage('launch-timeout', definition, language)
    }), timeoutMs);

    try {
      child = spawnImpl(executable, [sourcePath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
        shell: false
      });
    } catch (error) {
      const reason = error && error.code === 'EACCES' ? 'permission-denied' : 'launch-failed';
      finish({ ok: false, reason, message: responseMessage(reason, definition, language, error && error.message) });
      return;
    }

    child.once('error', (error) => {
      const reason = error && error.code === 'EACCES' ? 'permission-denied' : 'launch-failed';
      finish({ ok: false, reason, message: responseMessage(reason, definition, language, error && error.message) });
    });
    child.once('spawn', () => {
      try { child.unref(); } catch (error) {}
      finish({
        ok: true,
        reason: 'launched',
        message: responseMessage('launched', definition, language),
        app: definition.id
      });
    });
  });
}

module.exports = {
  ADOBE_APPS,
  adobeApp,
  cleanWindowsPath,
  registryValuePaths,
  standardAdobeRoots,
  findAdobeExecutable,
  launchAdobeMedia
};

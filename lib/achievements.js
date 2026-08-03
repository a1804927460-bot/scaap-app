'use strict';
/**
 * Achievement evaluation logic.
 *
 * All six achievements unlock from real, observable conditions — nothing is
 * faked or unlocked on a timer. See README.md "About the achievements" for
 * a plain-language explanation of exactly what each one watches for,
 * including the two (#5 and #6) that depend on the real OS Desktop folder
 * and are therefore best-effort / platform-dependent.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DUPLICATE_KEYWORDS = ['最终版', '最最终版', '打死不改版'];
const LOST_FOLDER_PATTERN = /^新建文件夹\s*\(7\)$|^new folder\s*\(7\)$/i;
const TEXT_DOC_PATTERN = /^新建文本文档(\s*\(\d+\))?\.txt$|^new text document(\s*\(\d+\))?\.txt$/i;

function todayStr(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

const KEYWORD_PATTERN = new RegExp(
  [...DUPLICATE_KEYWORDS].sort((a, b) => b.length - a.length).join('|'),
  'g'
);

function normalizeBaseName(filename) {
  let base = filename.replace(/\.[^./\\]+$/, ''); // strip extension
  let prev;
  do {
    prev = base;
    base = base.replace(KEYWORD_PATTERN, '');
  } while (base !== prev);
  return base.replace(/[\s_\-（）()]/g, '').toLowerCase();
}

function unlock(achievements, key) {
  if (!achievements[key] || achievements[key].unlocked) return false;
  achievements[key] = { unlocked: true, unlockedAt: new Date().toISOString() };
  return true;
}

/** Achievement 1 — 混乱有序: first file ever imported. */
function checkFirstImport(store) {
  if (store.data.files.length >= 1) {
    return unlock(store.data.achievements, 'first_import');
  }
  return false;
}

/**
 * Achievement 2 — 神级检索术: within 1000 seconds of this app session starting,
 * a search/locate action surfaces a file that was imported 7+ days ago.
 */
function checkDeepSearch(store, matchedFile) {
  if (!matchedFile) return false;
  const sessionStart = store.data.usage.sessionStartedAt
    ? new Date(store.data.usage.sessionStartedAt).getTime()
    : Date.now();
  const elapsedSec = (Date.now() - sessionStart) / 1000;
  const importedAt = new Date(matchedFile.importedAt).getTime();
  const ageMs = Date.now() - importedAt;
  if (elapsedSec <= 1000 && ageMs >= 7 * DAY_MS) {
    return unlock(store.data.achievements, 'deep_search');
  }
  return false;
}

/**
 * Achievement 3 — 你管这叫最新版？: permanently deleting a file imported within
 * the last 30 days whose name contains one of the "final version" keywords,
 * where another file (current or previously deleted) shares the same
 * normalized base name — i.e. it's a duplicate.
 */
function checkFinalVersion(store, deletedFile) {
  const hasKeyword = DUPLICATE_KEYWORDS.some((kw) => deletedFile.name.includes(kw));
  if (!hasKeyword) return false;

  const ageMs = Date.now() - new Date(deletedFile.importedAt).getTime();
  if (ageMs > 30 * DAY_MS) return false;

  const targetBase = normalizeBaseName(deletedFile.name);
  const others = [
    ...store.data.files.filter((f) => f.id !== deletedFile.id),
    ...store.data.deletions.filter((d) => d.id !== deletedFile.id)
  ];
  const hasDuplicate = others.some((f) => normalizeBaseName(f.name) === targetBase);
  if (hasDuplicate) {
    return unlock(store.data.achievements, 'final_version');
  }
  return false;
}

/**
 * Achievement 4 — 这也在你的计划之中吗?: importing a file whose real source
 * folder is literally named "新建文件夹 (7)" / "New Folder (7)".
 */
function checkLostFolder(store, importedFile) {
  if (importedFile.sourceFolder && LOST_FOLDER_PATTERN.test(importedFile.sourceFolder.trim())) {
    return unlock(store.data.achievements, 'lost_folder');
  }
  return false;
}

/**
 * Achievement 5 — 赛博赛博，到此为止: no file matching the OS-default
 * "new text document" naming pattern has appeared on the real Desktop
 * folder for 30 consecutive days. Best-effort: only as reliable as the
 * Desktop folder is observable (see README).
 */
function checkNoClutterMonth(store, desktopFilenames) {
  const now = Date.now();
  const sawTextDoc = desktopFilenames.some((name) => TEXT_DOC_PATTERN.test(name));
  if (sawTextDoc) {
    store.data.desktopWatch.lastTextDocSeenAt = new Date(now).toISOString();
    return false;
  }
  const last = store.data.desktopWatch.lastTextDocSeenAt
    ? new Date(store.data.desktopWatch.lastTextDocSeenAt).getTime()
    : store.data.usage.firstRunAt
      ? new Date(store.data.usage.firstRunAt).getTime()
      : now;
  if (now - last >= 30 * DAY_MS) {
    return unlock(store.data.achievements, 'no_clutter_month');
  }
  return false;
}

/**
 * Achievement 6 — 极简主义者: 7 consecutive days where (a) at least one file
 * was imported into Messs. that day, and (b) the real Desktop folder's file
 * count did not grow versus the previous day's snapshot.
 */
function checkMinimalist(store, desktopFileCount) {
  const today = todayStr();
  const dw = store.data.desktopWatch;

  if (dw.lastCheckedDay === today) {
    // Already evaluated today; just refresh the count.
    dw.lastDesktopFileCount = desktopFileCount;
    return false;
  }

  const importedToday = store.data.usage.importDays.includes(today);
  const noGrowth = dw.lastDesktopFileCount === null || desktopFileCount <= dw.lastDesktopFileCount;

  const yesterday = todayStr(new Date(Date.now() - DAY_MS));
  const continuesStreak = dw.lastCheckedDay === yesterday;

  if (importedToday && noGrowth) {
    dw.clutterStreakDays = continuesStreak ? dw.clutterStreakDays + 1 : 1;
  } else {
    dw.clutterStreakDays = 0;
  }

  dw.lastDesktopFileCount = desktopFileCount;
  dw.lastCheckedDay = today;

  if (dw.clutterStreakDays >= 7) {
    return unlock(store.data.achievements, 'minimalist');
  }
  return false;
}

const DEFINITIONS = [
  { key: 'first_import', title: '混乱有序', desc: '第一次导入文件进来，什么感觉？' },
  { key: 'deep_search', title: '神级检索术', desc: '在1000秒内，利用搜索或索引定位到一星期前的图片文件。' },
  { key: 'final_version', title: '你管这叫最新版？', desc: '彻底删除一个月内包含"最终版"、"最最终版"、"打死不改版"的重复文件。' },
  { key: 'lost_folder', title: '这也在你的计划之中吗?', desc: '在一个名为"新建文件夹 (7)"的角落里，意外找到了以为丢失的重要文件。' },
  { key: 'no_clutter_month', title: '赛博赛博，到此为止', desc: '连续一个月不往桌面上直接右键创建"新建文本文档"。' },
  { key: 'minimalist', title: '极简主义者', desc: '连续 7 天导入文件，保持桌面"零杂乱"。' }
];

module.exports = {
  DEFINITIONS,
  checkFirstImport,
  checkDeepSearch,
  checkFinalVersion,
  checkLostFolder,
  checkNoClutterMonth,
  checkMinimalist,
  normalizeBaseName,
  todayStr
};

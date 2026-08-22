'use strict';

const fs = require('fs');
const { execFile } = require('child_process');

const WECHAT_URI = 'weixin://dl/chat?username=filehelper';

function encodedPowerShell(script) {
  return Buffer.from(String(script || ''), 'utf16le').toString('base64');
}

function runPowerShell(script, options = {}) {
  const execFileImpl = options.execFile || execFile;
  return new Promise((resolve, reject) => {
    execFileImpl('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', encodedPowerShell(script)
    ], {
      encoding: 'utf8', windowsHide: true, timeout: Number(options.timeoutMs) || 5000,
      maxBuffer: 1024 * 1024
    }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout || '').trim());
    });
  });
}

async function probeWeChatWindows(options = {}) {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class MesssWeChatWindow {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder text, int count);
  public static string ClassName(IntPtr hWnd) { var b = new StringBuilder(512); GetClassName(hWnd, b, b.Capacity); return b.ToString(); }
}
'@
$items = @(Get-Process -Name Weixin,WeChat -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
  $class = [MesssWeChatWindow]::ClassName($_.MainWindowHandle)
  # Login state is determined from the stable native window class below.
  if ($class -notmatch 'LoginWnd|LoginWindow') {
    try {
      Add-Type -AssemblyName UIAutomationClient
      Add-Type -AssemblyName UIAutomationTypes
      $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $_.Id)
      $nodes = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
      $loginName = [string]::Concat([char]0x767b,[char]0x5f55)
      $scanLoginName = [string]::Concat([char]0x626b,[char]0x7801,[char]0x767b,[char]0x5f55)
      foreach ($node in $nodes) {
        if ($node.Current.Name -eq $loginName -or $node.Current.Name -eq $scanLoginName -or $node.Current.Name -match 'Log ?in') { $class = 'WeChatLoginWindow'; break }
        if ($node.Current.Name -match '登录|Log ?in|扫码登录|手机号') { $class = 'WeChatLoginWindow'; break }
      }
    } catch {}
  }
  [pscustomobject]@{ processId = $_.Id; processName = $_.ProcessName; title = $_.MainWindowTitle; className = $class }
})
$items | ConvertTo-Json -Compress
`;
  try {
    const output = await runPowerShell(script, options);
    if (!output) return [];
    const parsed = JSON.parse(output);
    return (Array.isArray(parsed) ? parsed : [parsed]).filter((item) => item && Number(item.processId));
  } catch (error) {
    return [];
  }
}

function isLoggedInWindow(windowInfo) {
  const className = String(windowInfo && windowInfo.className || '');
  const title = String(windowInfo && windowInfo.title || '');
  if (/LoginWnd|LoginWindow/i.test(className)) return false;
  if (/\u767b\u5f55|Log ?in/i.test(title)) return false;
  if (/\u5fae\u4fe1|\u6587\u4ef6\u4f20\u8f93\u52a9\u624b|WeChat|File Transfer/i.test(title)) return true;
  return /MainWnd|WeChatMain|Qt\d*QWindow/i.test(className)
    || /微信|WeChat|文件传输助手|File Transfer/i.test(title);
}

async function verifyFileHelperTarget(processId, options = {}) {
  const safeProcessId = Number(processId) || 0;
  if (!safeProcessId) return false;
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$pidCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, ${safeProcessId})
$nodes = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $pidCondition)
$fileHelperName = [string]::Concat([char]0x6587,[char]0x4ef6,[char]0x4f20,[char]0x8f93,[char]0x52a9,[char]0x624b)
$found = $false
foreach ($node in $nodes) {
  $name = $node.Current.Name
  if ($name -eq $fileHelperName) { $found = $true; break }
  if ($name -eq '文件传输助手' -or $name -eq 'File Transfer' -or $name -eq 'File Transfer Assistant') { $found = $true; break }
}
if (-not $found) {
  $process = Get-Process -Id ${safeProcessId} -ErrorAction SilentlyContinue
  if ($process -and $process.MainWindowTitle -eq $fileHelperName) { $found = $true }
  if ($process -and ($process.MainWindowTitle -match '文件传输助手|File Transfer')) { $found = $true }
  # Recent Qt WeChat builds expose only the top-level window to UI Automation.
  # The chat opened by the weixin:// URI is still the active target, so use a
  # non-login main window as the compatibility signal for the paste fallback.
  if (-not $found -and $process -and $process.MainWindowHandle -ne 0 -and $process.MainWindowTitle -notmatch '登录|Log ?in') {
    $found = $true
  }
}
if ($found) { 'true' } else { 'false' }
`;
  try {
    return (await runPowerShell(script, { ...options, timeoutMs: options.timeoutMs || 6000 })).trim().toLowerCase() === 'true';
  } catch (error) {
    return false;
  }
}

async function pasteAndSendToWeChat(processId, options = {}) {
  const safeProcessId = Number(processId) || 0;
  if (!safeProcessId) return false;
  const script = `
$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
if (-not $shell.AppActivate(${safeProcessId})) { throw 'Could not activate WeChat' }
Start-Sleep -Milliseconds 300
$shell.SendKeys('^v')
Start-Sleep -Milliseconds 1200
$shell.SendKeys('{ENTER}')
'sent'
`;
  try {
    return (await runPowerShell(script, { ...options, timeoutMs: options.timeoutMs || 5000 })).includes('sent');
  } catch (error) {
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendToWeChatFileHelper(filePath, options = {}) {
  const platform = options.platform || process.platform;
  const existsSync = options.existsSync || fs.existsSync;
  const openExternal = options.openExternal;
  const writeClipboardFiles = options.writeClipboardFiles;
  const probeWindows = options.probeWindows || probeWeChatWindows;
  const verifyTarget = options.verifyTarget || verifyFileHelperTarget;
  const pasteAndSend = options.pasteAndSend || pasteAndSendToWeChat;
  const waitImpl = options.wait || wait;

  if (platform !== 'win32') return { ok: false, reason: 'unsupported-platform' };
  if (!filePath || !existsSync(filePath)) return { ok: false, reason: 'file-not-found' };
  if (typeof openExternal !== 'function' || typeof writeClipboardFiles !== 'function') {
    return { ok: false, reason: 'integration-unavailable' };
  }

  const windows = await probeWindows(options);
  const loggedIn = windows.find(isLoggedInWindow);
  if (!loggedIn) {
    await openExternal('weixin://').catch(() => {});
    return { ok: false, reason: 'login-required' };
  }

  try {
    await openExternal(WECHAT_URI);
  } catch (error) {
    return { ok: false, reason: 'wechat-not-installed' };
  }

  let targetReady = false;
  for (let attempt = 0; attempt < 6 && !targetReady; attempt += 1) {
    await waitImpl(attempt === 0 ? 700 : 350);
    targetReady = await verifyTarget(loggedIn.processId, options);
  }
  if (!targetReady) return { ok: false, reason: 'file-helper-not-found' };

  writeClipboardFiles([filePath]);
  if (!await pasteAndSend(loggedIn.processId, options)) {
    return { ok: false, reason: 'send-failed' };
  }
  return { ok: true, reason: 'sent' };
}

module.exports = {
  WECHAT_URI,
  encodedPowerShell,
  runPowerShell,
  probeWeChatWindows,
  isLoggedInWindow,
  verifyFileHelperTarget,
  pasteAndSendToWeChat,
  sendToWeChatFileHelper
};

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src', 'js', 'store-client.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles', 'main.css'), 'utf8');
const toast = {
  innerHTML: '',
  hidden: true,
  children: [],
  attributes: {},
  style: {},
  classList: {
    values: new Set(),
    add(value) { this.values.add(value); },
    remove(value) { this.values.delete(value); },
    toggle(value, force) {
      if (force === undefined ? !this.values.has(value) : force) this.values.add(value);
      else this.values.delete(value);
      return this.values.has(value);
    },
    contains(value) { return this.values.has(value); }
  },
  appendChild(child) { this.children.push(child); return child; },
  setAttribute(name, value) { this.attributes[name] = String(value); }
};
const timers = [];
const sandbox = {
  document: {
    documentElement: { dataset: { language: 'zh' } },
    hidden: false,
    getElementById(id) { return id === 'toast' ? toast : null; },
    createElement(tagName) {
      return {
        tagName,
        className: '',
        type: '',
        textContent: '',
        attributes: {},
        addEventListener(name, handler) { this.listeners = this.listeners || {}; this.listeners[name] = handler; },
        setAttribute(name, value) { this.attributes[name] = String(value); }
      };
    },
    addEventListener() {}
    ,querySelectorAll() { return []; }
  },
  window: {addEventListener() {}, removeEventListener() {}},
  ResizeObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame(callback) { callback(); return 1; },
  cancelAnimationFrame() {},
  setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
  clearTimeout() {},
  console
};
vm.runInNewContext(`${source}\nthis.__showToast = showToast;`, sandbox);

sandbox.__showToast('本次生成请求未被接受，未扣积分。请检查设置后重试。', 'AI');
assert.strictEqual(toast.hidden, false);
assert.strictEqual(toast.classList.contains('is-persistent'), true);
assert.strictEqual(toast.attributes.role, 'alert');
assert.strictEqual(timers.length, 0, 'AI failure notifications must not auto-dismiss');
const dismiss = toast.children.find((child) => child.className === 'toast-dismiss');
assert.ok(dismiss, 'persistent notifications need a cancel button');
assert.strictEqual(dismiss.textContent, '关闭');
assert.ok(toast.children.some(child => child.className === 'toast-brand-logo' && child.src === 'assets/logo-mark.png'));
dismiss.listeners.click();
assert.strictEqual(timers.length, 1, 'dismiss should only schedule the transition after a click');
timers[0].callback();
assert.strictEqual(toast.hidden, true);

toast.children = [];
sandbox.__showToast('AI 图片已加入画布', 'AI');
assert.strictEqual(toast.classList.contains('is-persistent'), true);
assert.strictEqual(toast.children.some((child) => child.className === 'toast-dismiss'), true);
assert.strictEqual(timers.length, 1, 'success notifications also wait for dismissal');

assert.match(css, /\.toast\.is-persistent\s*\{/);
assert.match(css, /\.toast-dismiss\s*\{/);
console.log('Toast persistence tests passed.');

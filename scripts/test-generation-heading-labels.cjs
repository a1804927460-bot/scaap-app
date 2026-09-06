const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/js/board-canvas.js'), 'utf8');
const start = source.indexOf('    const headingLabels = {');
const end = source.indexOf("    pop.querySelector('.ai-ratio-value')", start);
assert.ok(start >= 0 && end > start);
assert.doesNotMatch(source, /headings\[\d\].*textContent/);
for (const language of ['zh', 'en']) {
  for (const qualityVisible of [false, true]) {
    const nodes = ['duration', 'quality', 'ratio', 'count', 'resolution'].map(key => ({
      dataset: { generationHeading: key }, hidden: key === 'quality' && !qualityVisible, textContent: ''
    }));
    vm.runInNewContext(source.slice(start, end), {
      t: (en, zh) => language === 'zh' ? zh : en,
      pop: { querySelectorAll: () => nodes }
    });
    const labels = Object.fromEntries(nodes.map(node => [node.dataset.generationHeading, node.textContent]));
    assert.equal(labels.count, language === 'zh' ? '数量' : 'Count');
    assert.equal(labels.duration, language === 'zh' ? '时长' : 'Duration');
    assert.equal(labels.quality, language === 'zh' ? '精细度' : 'Quality');
    for (const node of nodes) assert.ok(source.includes(`data-generation-heading="${node.dataset.generationHeading}"`));
  }
}
console.log('Generation headings: count/duration remain correct across languages, reordered fields and hidden quality.');

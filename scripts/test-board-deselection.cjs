const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/js/board-canvas.js'), 'utf8');
const start = source.indexOf('function syncBoardSelectionClasses(');
const end = source.indexOf('\nfunction ', start + 1);
const flags = new Set(['is-selected', 'is-single-selection']);
const element = { dataset: { boardId: 'old' }, classList: { toggle(name, on) { on ? flags.add(name) : flags.delete(name); } }, blur() { this.blurred = true; } };
const context = vm.createContext({
  Set, Board: { selectedIds: new Set(['old', 'other']), selectedCount: 2, mounted: new Map([['old', element]]) },
  BoardEngine: { hashSet: s => [...s].join(',') }, AppState: { boardItems: [] },
  document: { activeElement: element }, syncBoardSelectionGroup() {}, scheduleMountedImageQuality() {}
});
vm.runInContext(source.slice(start, end), context);
vm.runInContext('syncBoardSelectionClasses(new Set(), {changedIds:new Set(), deferGroup:true,deferTools:true,deferAgent:true,deferQuality:true})', context);
assert.equal(flags.has('is-selected'), false);
assert.equal(element.blurred, true);
console.log('Deselection removes stale classes and pointer focus.');

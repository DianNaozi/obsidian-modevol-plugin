// Minimal host API; rendering, Markdown parsing and navigation use production code.
function installDOMHelpers() {
	HTMLElement.prototype.empty = function () { this.replaceChildren(); };
	HTMLElement.prototype.addClass = function (name) { this.classList.add(name); };
	HTMLElement.prototype.removeClass = function (name) { this.classList.remove(name); };
	HTMLElement.prototype.setText = function (text) { this.textContent = text; };
	HTMLElement.prototype.createEl = function (tag, options = {}) {
		const el = this.ownerDocument.createElement(tag);
		if (options.cls) el.className = options.cls;
		if (options.text) el.textContent = options.text;
		this.appendChild(el);
		return el;
	};
	HTMLElement.prototype.createDiv = function (options) { return this.createEl('div', options); };
	HTMLElement.prototype.createSpan = function (options) { return this.createEl('span', options); };
}
installDOMHelpers();
export class ItemView {
	constructor(leaf) { this.app = leaf.app; this.contentEl = leaf.contentEl; this.cleanups = []; }
	register(callback) { this.cleanups.push(callback); }
	registerDomEvent(el, name, callback) {
		el.addEventListener(name, callback);
		this.register(() => el.removeEventListener(name, callback));
	}
	unload() { this.cleanups.forEach(callback => callback()); }
}
export class Notice { constructor(message) { window.notices.push(message); } }
export class TFile {
	constructor(path) { this.path = path; this.basename = path.replace(/\.md$/, ''); }
}
export class MarkdownView {
	constructor(file, editor) { this.file = file; this.editor = editor; }
	getMode() { return 'source'; }
}
export class WorkspaceLeaf {}
export function createHost(markdown) {
	window.notices = [];
	const file = new TFile('测试笔记.md');
	const editor = {
		value: markdown, selection: null, focused: false,
		getValue() { return this.value; },
		lineCount() { return this.value.split('\n').length; },
		getLine(line) { return this.value.split('\n')[line]; },
		setSelection(from, to) { this.selection = {from, to}; },
		scrollIntoView(range) { this.scrolled = range; },
		focus() { this.focused = true; },
	};
	const leaf = {view: new MarkdownView(file, editor)};
	const app = {
		vault: {getAbstractFileByPath(path) { return file.path === path ? file : null; }},
		workspace: {
			getLeavesOfType() { return [leaf]; },
			async revealLeaf() {},
		},
	};
	return {app, file, editor, contentEl: document.querySelector('#view')};
}

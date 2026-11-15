import { App, MarkdownView, TFile } from 'obsidian';

// Markmap 的行号从 0 开始，范围结束位置不包含在内。
export function getSourceLine(lines: unknown, markdown: string): number | null {
	if (typeof lines !== 'string' || !/^\d+,\d+$/.test(lines)) return null;
	const [start, end] = lines.split(',').map(Number);
	if (start === undefined || end === undefined || end <= start) return null;
	return start < markdown.split('\n').length ? start : null;
}

// 返回 false 表示原文已变化，需要刷新导图后重新选择节点。
export async function revealSourceLine(
	app: App, file: TFile, line: number, expectedMarkdown: string
): Promise<boolean> {
	if (app.vault.getAbstractFileByPath(file.path) !== file) {
		throw new Error('关联笔记已被删除，请重新打开笔记的导图。');
	}
	const workspace = app.workspace;
	let leaf = workspace.getLeavesOfType('markdown').find(
		(candidate) => candidate.view instanceof MarkdownView && candidate.view.file === file
	);
	if (!leaf) {
		leaf = workspace.getLeaf('split', 'vertical');
		await leaf.openFile(file, { state: { mode: 'source' }, active: true });
	} else if (leaf.view instanceof MarkdownView && leaf.view.getMode() !== 'source') {
		await leaf.setViewState({
			...leaf.getViewState(),
			state: { ...leaf.view.getState(), mode: 'source' },
		});
	}
	await workspace.revealLeaf(leaf);
	if (!(leaf.view instanceof MarkdownView)) throw new Error('无法打开笔记编辑器。');
	const editor = leaf.view.editor;
	if (editor.getValue() !== expectedMarkdown) return false;
	if (line < 0 || line >= editor.lineCount()) return false;
	const from = { line, ch: 0 };
	const to = { line, ch: editor.getLine(line).length };
	editor.setSelection(from, to);
	editor.scrollIntoView({ from, to }, true);
	editor.focus();
	return true;
}

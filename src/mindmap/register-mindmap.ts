import { Notice, Plugin, TFile } from 'obsidian';
import { MINDMAP_VIEW_TYPE, MindmapView } from './mindmap-view';
import type {ModevolSettings} from '../settings/settings';

export function registerMindmap(plugin: Plugin & {settings: ModevolSettings}): void {
	// 告诉 Obsidian 如何创建我们的面板
	plugin.registerView(
		MINDMAP_VIEW_TYPE,
		(leaf) => new MindmapView(leaf, () => plugin.settings.labels)
	);

	// 使用编辑器内容，不必等待笔记保存到磁盘。
	plugin.registerEvent(plugin.app.workspace.on('editor-change', (editor, info) => {
		if (!info.file) return;
		for (const leaf of plugin.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE)) {
			if (leaf.view instanceof MindmapView) {
				leaf.view.scheduleUpdate(info.file, editor.getValue());
			}
		}
	}));

	plugin.addCommand({
		id: 'open-mindmap',
		name: '打开思维导图',

		editorCallback: (editor, info) => {
			if (!info.file) return;
			// 先读取文字，再切换到导图面板
			const markdown = editor.getValue();

			void openMindmap(info.file, markdown).catch((error: unknown) => {
				console.error('[Jiangou Mindmap]', error);
				new Notice('打开思维导图失败，请查看控制台。');
			});
		},
	});
	plugin.register(() => plugin.app.workspace.detachLeavesOfType(MINDMAP_VIEW_TYPE));

	async function openMindmap(file: TFile, markdown: string): Promise<void> {
		const workspace = plugin.app.workspace;

		// 已经打开时复用，避免每执行一次就新增一个面板
		let leaf = workspace.getLeavesOfType(MINDMAP_VIEW_TYPE)[0];

		if (!leaf) {
			// 在当前笔记旁边创建左右分屏
			leaf = workspace.getLeaf('split', 'vertical');

			await leaf.setViewState({
				type: MINDMAP_VIEW_TYPE,
				active: true,
			});
		}

		await workspace.revealLeaf(leaf);

		if (leaf.view instanceof MindmapView) {
			await leaf.view.bindNote(file, markdown);
		}
	}
}

export function refreshMindmapLabels(plugin: Plugin): void {
	for (const leaf of plugin.app.workspace.getLeavesOfType(MINDMAP_VIEW_TYPE)) {
		if (leaf.view instanceof MindmapView) leaf.view.refreshLabels();
	}
}

import {ItemView, MarkdownView, Notice, TFile, WorkspaceLeaf} from 'obsidian';
import {Transformer} from 'markmap-lib';
import MindElixir, {type Topic} from 'mind-elixir';
import {addLabelNodes, toMindElixirNode, type SourceMetadata} from './mindmap-data';
import {DEFAULT_SETTINGS, type LabelConfig} from '../settings/settings';
import { getSourceLine, revealSourceLine } from './source-navigation';

export const MINDMAP_VIEW_TYPE = 'jiangou-mindmap-view';

export class MindmapView extends ItemView {
	private transformer = new Transformer();
	private mindmap: MindElixir | null = null;
	private renderedMarkdown = '';
	private initialized = false;
	private sourceFile: TFile | null = null;
	private updateTimer: number | null = null;
	private sourceLabel: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, private getLabels: () => LabelConfig[] = () => DEFAULT_SETTINGS.labels) {
		super(leaf);
		this.transformer.md.set({html: false});
	}

	getViewType(): string {
		return MINDMAP_VIEW_TYPE;
	}

	getDisplayText(): string {
		return '思维导图';
	}

	onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('jiangou-mindmap-view');
		const toolbar = this.contentEl.createDiv({cls: 'jiangou-mindmap-toolbar'});
		const fit = toolbar.createEl('button', {text: '适应窗口'});
		this.registerDomEvent(fit, 'click', () => {
			this.mindmap?.scaleFit();
		});
		toolbar.createSpan({text: '点击文字定位原文 · 点击加减号折叠 · 滚轮缩放'});
		this.sourceLabel = toolbar.createSpan({text: '等待选择笔记'});
		this.register(() => this.cancelUpdate());
		const canvas = this.contentEl.createDiv({cls: 'jiangou-mindmap-canvas'});
		canvas.setAttribute('aria-label', '思维导图');
		this.mindmap = new MindElixir({
			el: canvas,
			direction: MindElixir.RIGHT,
			editable: false,
			contextMenu: false,
			toolBar: false,
			keypress: false,
			allowUndo: false,
			// Only generated HTML from the html:false Markdown parser reaches this callback.
			markdown: (html) => html,
			theme: {...MindElixir.THEME,
			// Connect node edges at their vertical centers, rather than
			// drawing the default underline beneath child-node text.
			generateSubBranch: ({pT, pL, pW, pH, cT, cL, cW, cH, direction}) => {
				const left = direction === 'lhs';
				const startX = left ? pL : pL + pW;
				const endX = left ? cL + cW : cL;
				const startY = pT + pH / 2;
				const endY = cT + cH / 2;
				const middleX = (startX + endX) / 2;
				return `M ${startX} ${startY} C ${middleX} ${startY}, ${middleX} ${endY}, ${endX} ${endY}`;
			},
			cssVar: {
				...MindElixir.THEME.cssVar,
				'--bgcolor': 'var(--background-primary)',
				'--color': 'var(--text-normal)',
				'--main-color': 'var(--text-normal)',
				'--main-bgcolor': 'var(--background-secondary)',
				'--root-color': 'var(--text-on-accent)',
				'--root-bgcolor': 'var(--interactive-accent)',
				'--root-border-color': 'var(--interactive-accent)',
			}},
			handleWheel: (event) => {
				event.preventDefault();
				const map = this.mindmap;
				if (map) map.scale(Math.min(map.scaleMax, Math.max(map.scaleMin,
					map.scaleVal * Math.exp(-event.deltaY * 0.002))),
				{x: event.clientX, y: event.clientY});
			},
		});
		// Ignore a drag ending on a node, and keep expand/collapse clicks separate.
		this.mindmap.bus.addListener('expandNode', this.applyLabelStyles);
		let dragged = false;
		let start = {x: 0, y: 0};
		this.registerDomEvent(canvas, 'pointerdown', (event) => {
			dragged = false;
			start = {x: event.clientX, y: event.clientY};
		});
		this.registerDomEvent(canvas, 'pointermove', (event) => {
			if (event.buttons && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) dragged = true;
		});
		this.registerDomEvent(canvas, 'click', (event) => {
			const target = event.target as HTMLElement;
			const topic = target.closest<Topic>('me-tpc');
			if (dragged || !topic || !this.sourceFile || !this.renderedMarkdown.trim()) return;
			event.preventDefault();
			const metadata = topic.nodeObj.metadata as SourceMetadata | undefined;
			const line = getSourceLine(metadata?.lines, this.renderedMarkdown);
			if (line === null) return;
			void this.locateNode(this.sourceFile, line, this.renderedMarkdown).catch((error: unknown) => {
				console.error('[Jiangou Mindmap]', error);
				new Notice(error instanceof Error ? error.message : '定位原文失败。');
			});
		});
		return this.setMarkdown('# 请从笔记中执行“打开思维导图”');
	}

	async bindNote(file: TFile, markdown: string): Promise<void> {
		this.cancelUpdate();
		this.sourceFile = file;
		this.sourceLabel?.setText(`实时预览：${file.basename}`);
		await this.setMarkdown(markdown);
	}

	scheduleUpdate(file: TFile, markdown: string): void {
		// 绑定文件对象：重命名后仍跟随同一笔记，其他笔记不会覆盖此导图。
		if (file !== this.sourceFile || !this.mindmap) return;
		this.cancelUpdate();
		this.updateTimer = window.setTimeout(() => {
			this.updateTimer = null;
			if (file !== this.sourceFile) return;
			this.sourceLabel?.setText(`实时预览：${file.basename}`);
			void this.setMarkdown(markdown, false).catch((error: unknown) => {
				console.error('[Jiangou Mindmap]', error);
				new Notice('导图更新失败，请重新执行“打开思维导图”。');
			});
		}, 250);
	}

	private cancelUpdate(): void {
		if (this.updateTimer !== null) window.clearTimeout(this.updateTimer);
		this.updateTimer = null;
	}

	async setMarkdown(markdown: string, fit = true): Promise<void> {
		// Let the view attach its container before measuring the initial layout.
		await Promise.resolve();
		const mindmap = this.mindmap;
		if (!mindmap) return Promise.resolve();
		// 不裁剪原文，否则开头空行会使节点行号偏移。
		const {root} = this.transformer.transform(markdown.trim() ? markdown : '# 空白笔记');
		addLabelNodes(root, markdown, this.getLabels(), this.transformer.md);
		const data = {nodeData: toMindElixirNode(root)};
		if (this.initialized) mindmap.refresh(data);
		else {
			const error = mindmap.init(data);
			if (error) return Promise.reject(error);
			this.initialized = true;
		}
		this.renderedMarkdown = markdown;
		this.applyLabelStyles();
		// 输入时仅更新数据，保留用户的缩放和平移位置。
		if (fit) mindmap.scaleFit();
		return Promise.resolve();
	}

	private applyLabelStyles = (): void => {
		// Mind Elixir assigns branch colors to first-level node borders during
		// layout. Preserve label borders without changing the connector colors.
		this.contentEl.querySelectorAll<Topic>('me-tpc').forEach(topic => {
			const color = (topic.nodeObj.metadata as SourceMetadata | undefined)?.labelColor;
			topic.classList.toggle('jiangou-label-node', Boolean(color));
			if (color) {
				topic.style.setProperty('border', `1px solid ${color}`, 'important');
				topic.style.setProperty('--jiangou-label-color', color);
			} else {
				topic.style.removeProperty('--jiangou-label-color');
			}
		});
	};

	refreshLabels(): void {
		// A queued editor update already reads current settings; don't replace
		// its newer text with the last rendered version.
		if (this.sourceFile && this.updateTimer === null) this.scheduleUpdate(this.sourceFile, this.renderedMarkdown);
	}

	private async locateNode(file: TFile, line: number, markdown: string): Promise<void> {
		if (file !== this.sourceFile) return;
		const located = await revealSourceLine(this.app, file, line, markdown);
		if (located || file !== this.sourceFile || !this.mindmap) return;
		const view = this.app.workspace.getLeavesOfType('markdown')
			.map((leaf) => leaf.view)
			.find((candidate): candidate is MarkdownView =>
				candidate instanceof MarkdownView && candidate.file === file);
		if (view) {
			this.cancelUpdate();
			await this.setMarkdown(view.editor.getValue(), false);
		}
		new Notice('原文已变化，导图已刷新，请再次点击节点。');
	}

	onClose(): Promise<void> {
		this.cancelUpdate();
		this.sourceFile = null;
		this.sourceLabel = null;
		this.initialized = false;
		this.renderedMarkdown = '';
		this.mindmap?.bus.removeListener('expandNode', this.applyLabelStyles);
		this.mindmap?.destroy();
		this.mindmap = null;
		this.contentEl.empty();
		this.contentEl.removeClass('jiangou-mindmap-view');
		return Promise.resolve();
	}
}

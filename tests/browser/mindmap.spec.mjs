import {test, expect} from '@playwright/test';
import {build} from 'esbuild';
import {resolve} from 'node:path';

const fixture = await build({
	stdin: {
		contents: `export {MindmapView} from './src/mindmap/mindmap-view';
			export {createHost, TFile} from 'obsidian';`,
		resolveDir: process.cwd(),
	},
	bundle: true, write: false, format: 'iife', globalName: 'fixture',
	plugins: [{name: 'mock-host', setup(build) {
		build.onResolve({filter: /^obsidian$/}, () => ({path: resolve('tests/browser/obsidian-mock.js')}));
	}}],
});
const markdown = '\n\n# 项目计划\n\n## 设计\n### **配色**\n### 布局\n\n## 开发\n### 实时更新\n';

async function expectLabelFill(node, color) {
	const colors = await node.evaluate((el, labelColor) => {
		const probe = document.createElement('div');
		probe.style.backgroundColor = `color-mix(in srgb, ${labelColor} 22%, var(--background-primary) 78%)`;
		el.appendChild(probe);
		const expected = getComputedStyle(probe).backgroundColor;
		probe.remove();
		return {actual: getComputedStyle(el).backgroundColor, expected};
	}, color);
	expect(colors.actual).toBe(colors.expected);
	expect(colors.actual).not.toBe('rgba(0, 0, 0, 0)');
}

test('Modevol labels appear under their heading with configured colors and original navigation', async ({page}) => {
	await page.evaluate(async () => {
		const text = '# 验收\n\n## 渐构标签\n#d **描述测试**\n\n#e 示例测试\n\n#v 验证测试\n\n#t 迁移测试\n\n## 其他标题\n#d 后面的标签';
		host.editor.value = text;
		await view.bindNote(host.file, text);
	});
	await expect(page.locator('.jiangou-mindmap-label')).toHaveCount(0);
	for (const [text, color] of [['描述测试','rgb(75, 153, 211)'], ['示例测试','rgb(205, 82, 85)'], ['验证测试','rgb(85, 114, 241)'], ['迁移测试','rgb(235, 171, 55)']]) {
		const node = page.locator('me-tpc').filter({hasText: new RegExp('^' + text + '$')});
		await expect(node).toHaveCSS('border-top-color', color);
		await expect(node).toHaveCSS('border-bottom-width', '1px');
		await expect(node).toHaveCSS('border-left-style', 'solid');
		await expect(node).toHaveCSS('padding-left', '25px');
		await expect(node).toHaveCSS('padding-top', '8px');
		await expect(node).toHaveCSS('border-radius', '6px');
		await expectLabelFill(node, color);
	}
	for (const node of await page.locator('me-tpc').all()) await expect(node).toHaveCSS('border-radius', '6px');
	await page.screenshot({path: 'test-results/label-rectangles-light.png'});
	const labelBranch = page.locator('me-parent').filter({has: page.locator('me-tpc', {hasText: /^渐构标签$/})}).first();
	await labelBranch.locator('me-epd').click();
	await expect(page.locator('me-tpc').filter({hasText: /^描述测试$/})).toHaveCount(0);
	await labelBranch.locator('me-epd').click();
	await expectLabelFill(page.locator('me-tpc').filter({hasText: /^描述测试$/}), '#4b99d3');
	await page.evaluate(() => {
		document.body.style.setProperty('--background-primary', '#202020');
		document.body.style.setProperty('--text-normal', '#eeeeee');
	});
	await expectLabelFill(page.locator('me-tpc').filter({hasText: /^描述测试$/}), '#4b99d3');
	await expect(page.locator('me-tpc').filter({hasText: /^描述测试$/})).toHaveCSS('color', 'rgb(238, 238, 238)');

	expect(await page.evaluate(() => {
		const tree = view.mindmap.getData().nodeData;
		return tree.children.find(node => {
			const element = document.createElement('div');
			element.innerHTML = node.topic;
			return element.textContent === '渐构标签';
		}).children.length;
	})).toBe(4);
	await page.locator('me-tpc').filter({has: page.locator('strong', {hasText: '描述测试'})}).click();
	expect(await page.evaluate(() => host.editor.selection.from.line)).toBe(3);
});

test('label borders refresh and code/disabled tags stay excluded', async ({page}) => {
	await page.evaluate(async () => {
		view.getLabels = () => [
			{key: 'd', name: '<描述>', color: '#123456', enabled: true},
			{key: 'e', name: '例子', color: '#ff0000', enabled: false},
			{key: 'c', name: '自定义', color: '#abcdef', enabled: true, custom: true},
		];
		const text = '# 测试\n#d 内容\n\n#e 禁用\n\n#c 自定义名 正文\n\n```\n#d 代码\n```\n\n    #d 缩进代码\n';
		host.editor.value = text;
		await view.bindNote(host.file, text);
	});
	await expect(page.locator('me-tpc')).toHaveText(['测试', '内容', '自定义名 正文', '#d 代码', '#d 缩进代码']);
	await expect(page.locator('me-tpc').filter({hasText: /^内容$/})).toHaveCSS('border-top-color', 'rgb(18, 52, 86)');
	await page.evaluate(() => {
		view.getLabels = () => [{key: 'd', name: '改名', color: '#654321', enabled: true}];
		view.refreshLabels();
	});
	await expect(page.locator('me-tpc')).toHaveText(['测试', '内容', '#d 代码', '#d 缩进代码']);
	await expect(page.locator('me-tpc').filter({hasText: /^内容$/})).toHaveCSS('border-top-color', 'rgb(101, 67, 33)');
	await expectLabelFill(page.locator('me-tpc').filter({hasText: /^内容$/}), '#654321');
	await page.evaluate(() => {
		host.editor.value = host.editor.value.replace('#d 内容', '#d 更新内容');
		view.scheduleUpdate(host.file, host.editor.value);
	});
	const updated = page.locator('me-tpc').filter({hasText: /^更新内容$/});
	await expect(updated).toBeVisible();
	await expectLabelFill(updated, '#654321');
	await expect(updated).toHaveCSS('border-radius', '6px');
});

test('renders custom label names and rich text together in source order', async ({page}) => {
	await page.evaluate(async () => {
		const defaultLabels = view.getLabels();
		view.getLabels = () => [...defaultLabels, {key: 'x', name: '自定义类型', color: '#123456', enabled: true, custom: true}];
		const text = '# 验收\n## 渐构标签\n\n#c 测试\n\n#c   主题   **具体内容**\n\n#x 其他 正文\n\n#d 描述测试';
		host.editor.value = text;
		await view.bindNote(host.file, text);
	});
	await expect(page.locator('me-tpc')).toHaveText(['验收', '渐构标签', '测试', '主题 具体内容', '其他 正文', '描述测试']);
	const nameOnly = page.locator('me-tpc').filter({hasText: /^测试$/});
	await expect(nameOnly).toHaveCSS('border-top-color', 'rgb(201, 201, 201)');
	await expect(nameOnly).toHaveCSS('border-radius', '6px');
	await expectLabelFill(nameOnly, '#c9c9c9');
	await nameOnly.click();
	await expect.poll(() => page.evaluate(() => host.editor.selection?.from.line)).toBe(3);
	await expect(page.locator('me-tpc strong')).toHaveText('具体内容');
	await expect(page.locator('me-tpc').filter({hasText: /^其他 正文$/})).toHaveCSS('border-top-color', 'rgb(18, 52, 86)');
	await page.evaluate(() => {
		host.editor.value = host.editor.value.replace('#c 测试', '#c 测试 新正文');
		view.scheduleUpdate(host.file, host.editor.value);
	});
	await expect(page.locator('me-tpc').filter({hasText: /^测试 新正文$/})).toBeVisible();
});

test('hides all list subtrees, keeps headings and labels, and handles empty label bodies', async ({page}) => {
	await page.evaluate(async () => {
		const text = '# 验收\n## 学习计划\n- 无序\n  - 嵌套\n\n1. 有序\n2. 第二项\n\n- [ ] 任务\n- [x] 完成\n\n## 渐构标签\n#d \n\n#e 保留正文';
		host.editor.value = text;
		await view.bindNote(host.file, text);
	});
	await expect(page.locator('me-tpc')).toHaveText(['验收', '学习计划', '渐构标签', '空内容', '保留正文']);
	await page.locator('me-tpc').filter({hasText: /^保留正文$/}).click();
	expect(await page.evaluate(() => host.editor.selection.from.line)).toBe(14);
});

test.beforeEach(async ({page}) => {
	await page.setContent(`<style>
		body {margin:0; --background-primary:#fff; --background-secondary:#f4f4f6;
		--text-normal:#242428; --text-muted:#666; --interactive-accent:#6857d9;
		--text-on-accent:#fff; --font-text:Arial; --font-ui-small:12px;
		--background-modifier-border:#ddd; --background-modifier-border-hover:#888;}
		#view {width:1100px;height:720px;}
	</style><div id="view"></div>`);
	await page.addStyleTag({path: 'styles.css'});
	await page.addScriptTag({content: fixture.outputFiles[0].text});
	await page.evaluate(async text => {
		window.host = fixture.createHost(text);
		window.view = new fixture.MindmapView(host);
		await view.onOpen();
		await view.bindNote(host.file, text);
	}, markdown);
});

test('renders rich text and clicks the original zero-based line, including blank lines', async ({page}) => {
	await expect(page.locator('me-root me-tpc')).toHaveText('项目计划');
	await expect(page.locator('me-tpc strong')).toHaveText('配色');
	await page.locator('me-tpc').filter({hasText: /^配色$/}).click();
	await expect.poll(() => page.evaluate(() => host.editor.selection?.from.line)).toBe(5);
	expect(await page.evaluate(() => host.editor.focused)).toBe(true);
	await page.screenshot({path: 'test-results/mind-elixir-preview.png'});
});

test('debounces changes, preserves viewport, ignores other files and uses current line numbers', async ({page}) => {
	const before = await page.evaluate(() => {
		view.mindmap.scale(0.7);
		view.mindmap.move(35, 20);
		return view.mindmap.map.style.transform;
	});
	await page.evaluate(() => {
		view.scheduleUpdate(new fixture.TFile('其他.md'), '# 不应该出现');
		host.editor.value = '\n' + host.editor.value.replace('配色', '新配色');
		view.scheduleUpdate(host.file, '# 过时的更新');
		view.scheduleUpdate(host.file, host.editor.value);
	});
	await expect(page.locator('me-tpc strong')).toHaveText('新配色');
	expect(await page.evaluate(() => view.mindmap.map.style.transform)).toBe(before);
	await page.locator('me-tpc').filter({hasText: /^新配色$/}).click();
	await expect.poll(() => page.evaluate(() => host.editor.selection?.from.line)).toBe(6);
	await page.evaluate(() => view.scheduleUpdate(new fixture.TFile('其他.md'), '# 不应该出现'));
	await page.waitForTimeout(300);
	await expect(page.locator('me-root me-tpc')).toHaveText('项目计划');
});

test('collapse, wheel zoom and fit remain usable in read-only mode', async ({page}) => {
	const branch = page.locator('me-parent').filter({has: page.locator('me-tpc', {hasText: /^设计$/})}).first();
	await branch.locator('me-epd').click();
	await expect(page.locator('me-tpc').filter({hasText: /^配色$/})).toHaveCount(0);
	expect(await page.evaluate(() => host.editor.selection)).toBeNull();
	await branch.locator('me-epd').click();
	await expect(page.locator('me-tpc').filter({hasText: /^配色$/})).toBeVisible();
	for (const node of await page.locator('me-tpc').all()) await expect(node).toHaveCSS('border-radius', '6px');
	const scale = await page.evaluate(() => view.mindmap.scaleVal);
	await page.locator('.map-container').hover({position: {x: 30, y: 30}});
	await page.mouse.wheel(0, 150);
	await expect.poll(() => page.evaluate(() => view.mindmap.scaleVal)).toBeLessThan(scale);
	await page.getByRole('button', {name: '适应窗口'}).click();
	await expect(page.locator('me-root me-tpc')).toBeVisible();
	await page.locator('me-root me-tpc').dblclick();
	await expect(page.locator('#input-box')).toHaveCount(0);
});

test('stale source refreshes before navigation; close cancels pending updates', async ({page}) => {
	await page.evaluate(() => { host.editor.value = '\n' + host.editor.value; });
	await page.locator('me-tpc').filter({hasText: /^配色$/}).click();
	await expect.poll(() => page.evaluate(() => notices.length)).toBe(1);
	expect(await page.evaluate(() => host.editor.selection)).toBeNull();
	await page.locator('me-tpc').filter({hasText: /^配色$/}).click();
	await expect.poll(() => page.evaluate(() => host.editor.selection?.from.line)).toBe(6);
	await page.evaluate(async () => {
		view.scheduleUpdate(host.file, '# 待处理');
		await view.onClose();
		view.unload();
	});
	await page.waitForTimeout(300);
	await expect(page.locator('#view')).toBeEmpty();
});

test('empty notes and literal HTML are safe; theme colors follow the host', async ({page}) => {
	await page.evaluate(async () => {
		host.editor.value = '';
		await view.bindNote(host.file, '');
	});
	await expect(page.locator('me-root me-tpc')).toHaveText('空白笔记');
	await page.locator('me-root me-tpc').click();
	expect(await page.evaluate(() => host.editor.selection)).toBeNull();
	await page.evaluate(async () => {
		await view.bindNote(host.file, '# <img src=x onerror=alert(1)>');
		document.body.style.setProperty('--background-primary', '#202020');
		document.body.style.setProperty('--text-normal', '#eeeeee');
	});
	await expect(page.locator('me-tpc img')).toHaveCount(0);
	await expect(page.locator('.map-container')).toHaveCSS('background-color', 'rgb(32, 32, 32)');
});

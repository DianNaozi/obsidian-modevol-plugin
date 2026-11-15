import type {NodeObj} from 'mind-elixir';
import type {Transformer} from 'markmap-lib';
import type {LabelConfig} from '../settings/settings';
import ExpressionInterpreter from '../labels/ExpressionInterpreter';
import {isValidHexColor} from '../utils/colorUtils';

interface ParsedNode {
	content: string;
	payload?: {[key: string]: unknown};
	children?: ParsedNode[];
}

// Markmap omits ordinary paragraphs. Add enabled Modevol labels beneath the
// preceding heading, keeping original source lines for click navigation.
export function addLabelNodes(root: ParsedNode, markdown: string, configs: LabelConfig[], md: Transformer['md']): void {
	const headings: {line: number; node: ParsedNode}[] = [];
	const visit = (node: ParsedNode): void => {
		if (/^h[1-6]$/.test(String(node.payload?.tag))) {
			headings.push({line: Number(String(node.payload?.lines).split(',')[0]), node});
		}
		node.children?.forEach(visit);
	};
	visit(root);
	headings.sort((a, b) => a.line - b.line);
	const interpreter = new ExpressionInterpreter(configs.filter(config => config.enabled));
	const lines = markdown.split('\n');
	const touched = new Set<ParsedNode>();
	for (const token of md.parse(markdown, {})) {
		// Top-level paragraphs only: fenced/indented code and list items must
		// not become duplicate label nodes.
		if (token.type !== 'paragraph_open' || token.level !== 0 || !token.map) continue;
		for (let line = token.map[0]; line < token.map[1]; line++) {
			const match = interpreter.matchLine(lines[line]);
			const label = match && interpreter.getLabel(match);
			if (!label || !configs.some(config => config.enabled && config.key === label.type)) continue;
			const parent = [...headings].reverse().find(heading => heading.line < line)?.node ?? root;
			const color = isValidHexColor(label.color || '') ? label.color.trim() : '#808080';
			const content = interpreter.isCustomKey(label.type) ? label.text.slice(2) : label.content;
			(parent.children ??= []).push({
				content: md.renderInline(content.trim() || '空内容'),
				payload: {lines: `${line},${line + 1}`, labelColor: color},
			});
			touched.add(parent);
		}
	}
	for (const parent of touched) parent.children?.sort((a, b) =>
		Number(String(a.payload?.lines ?? '0').split(',')[0]) - Number(String(b.payload?.lines ?? '0').split(',')[0]));
}

export interface SourceMetadata {
	lines?: unknown;
	labelColor?: string;
}

// Keep the parser's original line ranges; never infer positions from rendered text.
export function toMindElixirNode(root: ParsedNode): NodeObj<SourceMetadata> {
	const convert = (node: ParsedNode, path: string): NodeObj<SourceMetadata> => ({
		id: path,
		topic: node.content || '笔记',
		metadata: {lines: node.payload?.lines, labelColor: typeof node.payload?.labelColor === 'string' ? node.payload.labelColor : undefined},
		...(typeof node.payload?.labelColor === 'string' ? {style: {border: `1px solid ${node.payload.labelColor}`}} : {}),
		children: node.children?.filter(child => !['li', 'ul', 'ol'].includes(String(child.payload?.tag))).map((child, index) => convert(child, `${path}-${index}`)),
	});
	return convert(root, 'root');
}

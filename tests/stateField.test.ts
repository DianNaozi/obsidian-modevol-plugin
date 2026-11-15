jest.mock("obsidian", () => ({
  Plugin: class {
    app: any;
    manifest: any;
    constructor(app: any, manifest: any) {
      this.app = app;
      this.manifest = manifest;
    }
    registerEvent() {}
    registerView() {}
    addStatusBarItem() {}
    addSettingTab() {}
    addCommand() {}
    registerEditorExtension() {}
    registerMarkdownPostProcessor() {}
    loadData() {
      return Promise.resolve(null);
    }
    saveData() {
      return Promise.resolve();
    }
  },
  debounce: (fn: any) => fn,
  MarkdownView: class {},
  MarkdownRenderChild: class {
    containerEl: HTMLElement;
    constructor(containerEl: HTMLElement) {
      this.containerEl = containerEl;
    }
    onload() {}
    onunload() {}
    load() {}
    unload() {}
  },
  ItemView: class {
    app: any;
    constructor(leaf: unknown) {}
    getViewType() {
      return "";
    }
    getDisplayText() {
      return "";
    }
    onOpen() {
      return Promise.resolve();
    }
    onClose() {
      return Promise.resolve();
    }
  },
  PluginSettingTab: class {
    app: any;
    plugin: any;
    constructor(app: any, plugin: any) {
      this.app = app;
      this.plugin = plugin;
    }
    display() {}
    hide() {}
  },
}), { virtual: true });

import ExpressionInterpreter from "../src/labels/ExpressionInterpreter";
import { setLabelConfigs, __getInterpreterForTest } from "../src/editor/StateField";
import { LabelConfig } from "../src/settings/settings";

describe("Bug 6: label configuration updates propagate to interpreter", () => {
  it("updates interpreter when setLabelConfigs is called again", () => {
    const configsD: LabelConfig[] = [
      { key: "d", name: "描述", color: "#4B99D3", svgIcon: "", enabled: true },
    ];
    const configsE: LabelConfig[] = [
      { key: "e", name: "例子", color: "#CD5255", svgIcon: "", enabled: true },
    ];

    setLabelConfigs(configsD);
    const first = __getInterpreterForTest();
    expect(first).toBeInstanceOf(ExpressionInterpreter);
    if (!first) return;

    expect(first.matchLine("#d 标题")).not.toBeNull();
    expect(first.matchLine("#e 标题")).toBeNull();

    setLabelConfigs(configsE);
    const second = __getInterpreterForTest();
    expect(second).toBeInstanceOf(ExpressionInterpreter);
    if (!second) return;
    expect(second).not.toBe(first);

    expect(second.matchLine("#e 标题")).not.toBeNull();
    expect(second.matchLine("#d 标题")).toBeNull();
  });
});

import { EditorSelection, EditorState } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import { labelField } from "../src/editor/StateField";
import { store } from "../src/state/store";

const editorConfigs: LabelConfig[] = [
  { key: "d", name: "描述", color: "blue", svgIcon: "", enabled: true },
  { key: "c", name: "自定义", color: "red", svgIcon: "", enabled: true, custom: true },
];

function decorationAt(state: EditorState, from: number) {
  const cursor = state.field(labelField).decorations.iter(from);
  expect(cursor.from).toBe(from);
  return cursor.value!;
}

describe("editor label parsing and selection updates", () => {
  beforeEach(() => setLabelConfigs(editorConfigs));
  afterEach(() => jest.restoreAllMocks());

  it("does not parse or publish labels during cursor movement and dragging in a long note", () => {
    const interpreter = __getInterpreterForTest()!;
    const match = jest.spyOn(interpreter, "matchLine");
    const parse = jest.spyOn(interpreter, "getLabel");
    let state = EditorState.create({
      doc: Array.from({ length: 10000 }, (_, i) => i % 5 === 0 ? `#c 标签 内容${i}` : `普通文字${i}`).join("\n"),
      extensions: [labelField],
    });
    const labels = store.labels;
    expect(match).toHaveBeenCalledTimes(10000);
    expect(parse).toHaveBeenCalledTimes(2000);
    match.mockClear();
    parse.mockClear();
    const serialize = jest.spyOn(state.doc, "toJSON");
    for (let i = 1; i <= 100; i++) {
      const line = state.doc.line(i * 97);
      state = state.update({ selection: { anchor: line.from, head: line.to } }).state;
      state = state.update({ selection: { anchor: line.from, head: state.doc.line(i * 97 + 1).to } }).state;
    }
    expect(match).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    expect(serialize).not.toHaveBeenCalled();
    expect(store.labels).toBe(labels);
  });

  it("updates only the old and new active tags and reuses unchanged decorations", () => {
    let state = EditorState.create({ doc: "plain\n#c 第一 内容\n#d 描述\n#c 第二 内容", extensions: [labelField] });
    const first = state.doc.line(2);
    const normal = state.doc.line(3);
    const second = state.doc.line(4);
    const normalDecoration = decorationAt(state, normal.from);
    expect(decorationAt(state, first.from).spec.widget).toBeDefined();
    state = state.update({ selection: { anchor: first.from } }).state;
    expect(decorationAt(state, first.from).spec.class).toBe(" mv-label-active");
    const activeState = state.field(labelField);
    state = state.update({ selection: { anchor: first.to, head: first.from } }).state;
    expect(state.field(labelField)).toBe(activeState);
    state = state.update({ selection: { anchor: second.to } }).state;
    expect(decorationAt(state, first.from).spec.widget).toBeDefined();
    expect(decorationAt(state, second.from).spec.class).toBe(" mv-label-active");
    expect(decorationAt(state, normal.from)).toBe(normalDecoration);
    state = state.update({ selection: { anchor: first.from, head: second.to } }).state;
    expect(state.field(labelField).active).toBeUndefined();
    expect(decorationAt(state, second.from).spec.widget).toBeDefined();
    const inactiveState = state.field(labelField);
    state = state.update({ selection: { anchor: normal.from } }).state;
    expect(state.field(labelField)).toBe(inactiveState);
    expect(state.update({}).state.field(labelField)).toBe(inactiveState);
  });

  it("uses the actual initial selection and preserves main-selection semantics", () => {
    const doc = "plain\n#c 标签 内容";
    const state = EditorState.create({
      doc,
      selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(8)], 1),
      extensions: [labelField, EditorState.allowMultipleSelections.of(true)],
    });
    expect(decorationAt(state, 6).spec.class).toBe(" mv-label-active");
    const next = state.update({ selection: EditorSelection.create(state.selection.ranges, 0) }).state;
    expect(decorationAt(next, 6).spec.widget).toBeDefined();
  });

  it("reparses edits and mapped selections, including newline insertion, undo and redo", () => {
    let state = EditorState.create({ doc: "plain\n#c 标签 内容", selection: { anchor: 10 }, extensions: [labelField, history()] });
    const original = state.doc.toString();
    const oldLabels = store.labels;
    const interpreter = __getInterpreterForTest()!;
    const match = jest.spyOn(interpreter, "matchLine");
    const transaction = state.update({ changes: { from: 0, insert: "new\n" } });
    expect(transaction.selection).toBeUndefined();
    state = transaction.state;
    expect(match).toHaveBeenCalledTimes(3);
    expect(store.labels).not.toBe(oldLabels);
    expect(store.labels[0]).toMatchObject({ pos: 10, line: 2, tagName: "标签" });
    expect(decorationAt(state, 10).spec.class).toBe(" mv-label-active");
    const target = () => ({ state, dispatch: (tr: import("@codemirror/state").Transaction) => { state = tr.state; } });
    expect(undo(target())).toBe(true);
    expect(state.doc.toString()).toBe(original);
    expect(store.labels[0]).toMatchObject({ pos: 6, line: 1 });
    expect(redo(target())).toBe(true);
    expect(store.labels[0]).toMatchObject({ pos: 10, line: 2 });
    state = state.update({ changes: { from: state.doc.length, insert: "追加" } }).state;
    expect(store.labels[0].text).toContain("内容追加");
    state = state.update({ changes: { from: 10, to: state.doc.length } }).state;
    expect(store.labels).toEqual([]);
    expect(state.field(labelField).decorations.size).toBe(0);
  });

  it("invalidates cached rules on the next transaction after configuration changes", () => {
    let state = EditorState.create({ doc: "#c 标签 内容\n#d 描述", extensions: [labelField] });
    const oldVersion = state.field(labelField).configVersion;
    setLabelConfigs([{ ...editorConfigs[0], name: "新名称", color: "green" }]);
    state = state.update({}).state;
    expect(state.field(labelField).configVersion).toBeGreaterThan(oldVersion);
    expect(state.field(labelField).active).toBeUndefined();
    expect(store.labels).toHaveLength(1);
    expect(store.labels[0]).toMatchObject({ type: "d", tagName: "新名称", color: "green" });
  });

  it("keeps each editor cache separate and handles empty notes", () => {
    const first = EditorState.create({ doc: "#c 第一 内容", extensions: [labelField] });
    const second = EditorState.create({ doc: "#c 第二 内容", extensions: [labelField] });
    expect(first.field(labelField).byLineStart).not.toBe(second.field(labelField).byLineStart);
    expect(first.update({ selection: { anchor: 5 } }).state.field(labelField).active?.label.tagName).toBe("第一");
    const empty = EditorState.create({ extensions: [labelField] });
    expect(empty.field(labelField).decorations.size).toBe(0);
    expect(store.labels).toEqual([]);
  });
});

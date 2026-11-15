import {
  RangeSetBuilder,
  StateField,
  Text,
  EditorSelection,
  EditorState,
} from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import ExpressionInterpreter from "../labels/ExpressionInterpreter";
import { Label } from "../labels/Label";
import { ModelvolLabelWidget } from "./ModevolWidget";
import { store } from "../state/store";
import { LabelConfig } from "../settings/settings";

let interpreter: ExpressionInterpreter | null = null;
let configVersion = 0;

export function setLabelConfigs(configs: LabelConfig[]) {
  interpreter = new ExpressionInterpreter(configs);
  configVersion++;
}

export function __getInterpreterForTest(): ExpressionInterpreter | null {
  return interpreter;
}

interface CachedLabel {
  label: Label;
  to: number;
  custom: boolean;
}

interface LabelFieldState {
  labels: Label[];
  byLineStart: Map<number, CachedLabel>;
  active: CachedLabel | undefined;
  decorations: DecorationSet;
  configVersion: number;
}

function parseDocument(doc: Text) {
  if (!interpreter) interpreter = new ExpressionInterpreter([]);
  const labels: Label[] = [];
  const byLineStart = new Map<number, CachedLabel>();
  let pos = 0;
  let lineNum = 0;
  for (const line of doc.iterLines()) {
    const match = interpreter.matchLine(line);
    const label = match ? interpreter.getLabel(match) : undefined;
    if (label) {
      label.pos = pos;
      label.line = lineNum;
      labels.push(label);
      const custom = interpreter.isCustomKey(label.type);
      byLineStart.set(pos, {
        label,
        custom,
        to: pos + (custom ? 3 + label.tagName.length : 2),
      });
    }
    pos += line.length + 1;
    lineNum++;
  }
  return { labels, byLineStart };
}

function activeLabel(doc: Text, selection: EditorSelection, byLineStart: Map<number, CachedLabel>) {
  const { from, to } = selection.main;
  const line = doc.lineAt(from);
  if (to > line.to) return undefined;
  const cached = byLineStart.get(line.from);
  return cached?.custom ? cached : undefined;
}

function decorationFor(cached: CachedLabel, active: boolean): Decoration {
  return active
    ? Decoration.mark({ class: " mv-label-active" })
    : Decoration.replace({ widget: new ModelvolLabelWidget(cached.label) });
}

function createFieldState(state: EditorState): LabelFieldState {
  const parsed = parseDocument(state.doc);
  const active = activeLabel(state.doc, state.selection, parsed.byLineStart);
  const builder = new RangeSetBuilder<Decoration>();
  for (const cached of parsed.byLineStart.values()) {
    builder.add(cached.label.pos, cached.to, decorationFor(cached, cached === active));
  }
  store.labels = parsed.labels;
  return { ...parsed, active, decorations: builder.finish(), configVersion };
}

export const labelField = StateField.define<LabelFieldState>({
  create: createFieldState,
  update(previous, transaction): LabelFieldState {
    if (transaction.docChanged || previous.configVersion !== configVersion) {
      return createFieldState(transaction.state);
    }
    if (!transaction.selection) return previous;
    const active = activeLabel(transaction.state.doc, transaction.state.selection, previous.byLineStart);
    if (active === previous.active) return previous;

    let decorations = previous.decorations;
    // Update two small ranges separately, even when the cursor jumps across a long note.
    for (const cached of [previous.active, active]) {
      if (!cached) continue;
      const from = cached.label.pos;
      decorations = decorations.update({
        filterFrom: from,
        filterTo: cached.to,
        filter: (rangeFrom) => rangeFrom !== from,
        add: [decorationFor(cached, cached === active).range(from, cached.to)],
      });
    }
    return { ...previous, active, decorations };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

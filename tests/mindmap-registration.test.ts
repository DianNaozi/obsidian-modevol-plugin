import { Plugin } from 'obsidian';
import { registerMindmap } from '../src/mindmap/register-mindmap';
import { MindmapView, MINDMAP_VIEW_TYPE } from '../src/mindmap/mindmap-view';

jest.mock('obsidian', () => ({ Notice: jest.fn() }), { virtual: true });
jest.mock('../src/mindmap/mindmap-view', () => ({
    MINDMAP_VIEW_TYPE: 'jiangou-mindmap-view',
    MindmapView: class {
        bindNote = jest.fn().mockResolvedValue(undefined);
        scheduleUpdate = jest.fn();
    },
}));

function setup() {
    const leaves: any[] = [];
    const workspace = {
        on: jest.fn((_event, callback) => callback),
        getLeavesOfType: jest.fn(() => leaves),
        getLeaf: jest.fn(() => {
            const leaf = {
                view: new (MindmapView as any)(),
                setViewState: jest.fn(async () => { leaves.push(leaf); }),
            };
            return leaf;
        }),
        revealLeaf: jest.fn().mockResolvedValue(undefined),
        detachLeavesOfType: jest.fn(),
    };
    const plugin = {
        app: { workspace }, registerView: jest.fn(), registerEvent: jest.fn(),
        addCommand: jest.fn(), register: jest.fn(),
    };
    registerMindmap(plugin as unknown as Parameters<typeof registerMindmap>[0]);
    return { plugin, workspace, leaves };
}

test('registers the view and command, opens unsaved text, and reuses the split', async () => {
    const { plugin, workspace, leaves } = setup();
    expect(plugin.registerView.mock.calls[0][0]).toBe(MINDMAP_VIEW_TYPE);
    const command = plugin.addCommand.mock.calls[0][0];
    expect(command.id).toBe('open-mindmap');
    const file = { path: 'test.md' };
    command.editorCallback({ getValue: () => '# Unsaved' }, { file });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(workspace.getLeaf).toHaveBeenCalledWith('split', 'vertical');
    expect(leaves[0].view.bindNote).toHaveBeenCalledWith(file, '# Unsaved');
    command.editorCallback({ getValue: () => '# Updated' }, { file });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(workspace.getLeaf).toHaveBeenCalledTimes(1);
    expect(leaves[0].view.bindNote).toHaveBeenLastCalledWith(file, '# Updated');
});

test('forwards editor events and registers cleanup without changing other views', () => {
    const { plugin, workspace, leaves } = setup();
    const view = new (MindmapView as any)();
    leaves.push({ view });
    const callback = workspace.on.mock.calls[0][1];
    expect(workspace.on.mock.calls[0][0]).toBe('editor-change');
    expect(plugin.registerEvent).toHaveBeenCalledWith(callback);
    const file = { path: 'test.md' };
    callback({ getValue: () => 'live' }, { file });
    expect(view.scheduleUpdate).toHaveBeenCalledWith(file, 'live');
    callback({ getValue: () => 'ignored' }, {});
    expect(view.scheduleUpdate).toHaveBeenCalledTimes(1);
    plugin.register.mock.calls[0][0]();
    expect(workspace.detachLeavesOfType).toHaveBeenCalledWith(MINDMAP_VIEW_TYPE);
});

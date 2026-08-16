export interface App {
	vault: Vault;
	workspace: Workspace;
}

export interface Vault {
	getAbstractFileByPath(path: string): TFile | TFolder | null;
	read(file: TFile): Promise<string>;
	create(path: string, content: string): Promise<TFile>;
	modify(file: TFile, content: string): Promise<void>;
	trash(file: TFile, force: boolean): Promise<void>;
}

export interface Workspace {
	getActiveFile(): TFile | null;
	getActiveViewOfType<T>(type: new (...args: any[]) => T): { leaf: WorkspaceLeaf; view: T } | null;
	getLeaf(split?: boolean | 'tab' | 'vertical' | 'horizontal'): WorkspaceLeaf;
	iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => void): void;
	on(event: string, callback: (...args: any[]) => any): EventRef;
}

export interface WorkspaceLeaf {
	view: View;
	setViewState(state: ViewState): Promise<void>;
	detach(): void;
}

export interface View {
	getViewType(): string;
	getState(): unknown;
}

export interface ViewState {
	type: string;
	state: Record<string, unknown>;
	active: boolean;
}

export interface EventRef {
	(): void;
}

export interface TFile {
	path: string;
	name: string;
	extension: string;
	parent: TFolder | null;
}

export interface TFolder {
	path: string;
	name: string;
	parent: TFolder | null;
	children: (TFile | TFolder)[];
}

export class Notice {
	constructor(_message: string) {}
}

export function setIcon(_element: HTMLElement, _icon: string): void {
	// no-op in tests; icons are decorative
}

export class Plugin {
	app: App;
	manifest: any;
	async loadData(): Promise<any> { return {}; }
	async saveData(_data: any): Promise<void> {}
	registerView(_type: string, _factory: (leaf: WorkspaceLeaf) => View): void {}
	addRibbonIcon(_icon: string, _title: string, _callback: () => void): void {}
	addCommand(_command: Command): void {}
	registerEvent(_eventRef: EventRef): void {}
	addSettingTab(_settingTab: any): void {}
	onunload(): void {}
}

export interface Command {
	id: string;
	name: string;
	callback: () => void | Promise<void>;
}

export class SettingTab {
	app: App;
	plugin: Plugin;
	constructor(app: App, plugin: Plugin) {
		this.app = app;
		this.plugin = plugin;
	}
	display(): void {}
	hide(): void {}
}

export class Modal {
	app: App;
	constructor(app: App) {
		this.app = app;
	}
	open(): void {}
	close(): void {}
}
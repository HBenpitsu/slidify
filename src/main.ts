import {
	MarkdownView,
	Plugin,
	TAbstractFile,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';
import {
	DEFAULT_SETTINGS,
	SlidesPreviewSettingTab,
	type SlidesPreviewSettings,
} from './settings';
import {
	SlidesPreviewView,
	VIEW_TYPE_SLIDES_PREVIEW,
} from './slidesPreviewView';

export default class SlidesLivePreviewPlugin extends Plugin {
	settings!: SlidesPreviewSettings;
	private lastSyncedCursorSignature: string | null = null;
	private pendingCursorSyncTimer: number | null = null;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_SLIDES_PREVIEW,
			(leaf) => new SlidesPreviewView(leaf, this),
		);

		this.addCommand({
			id: 'open-slides-live-preview-pane',
			name: 'Open preview pane',
			callback: () => {
				void this.activatePreviewPane();
			},
		});

		this.addCommand({
			id: 'refresh-slides-live-preview-pane',
			name: 'Refresh preview pane',
			callback: () => {
				void this.syncPreviewWithActiveContext();
			},
		});

		this.addCommand({
			id: 'toggle-slides-live-preview-presentation',
			name: 'Toggle presentation mode',
			callback: () => {
				void this.togglePresentationMode();
			},
		});

		this.registerEvent(
			this.app.workspace.on('file-open', () => {
				void this.syncPreviewWithActiveContext();
			}),
		);

		this.registerEvent(
			this.app.workspace.on('editor-change', (editor, info) => {
				const file = info.file;
				if (!this.isMarkdownFile(file)) {
					return;
				}

				const cursorLine = editor.getCursor().line;
				const signature = `${file.path}:${cursorLine}`;
				this.lastSyncedCursorSignature = signature;
				if (this.pendingCursorSyncTimer !== null) {
					window.clearTimeout(this.pendingCursorSyncTimer);
				}

				this.pendingCursorSyncTimer = window.setTimeout(() => {
					this.pendingCursorSyncTimer = null;
					void this.updatePreviewSource(file, editor.getValue(), cursorLine);
				}, 140);
			}),
		);

		this.registerInterval(
			window.setInterval(() => {
				void this.syncCursorWithActiveContext();
			}, 180),
		);

		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (!this.isMarkdownFile(file)) {
					return;
				}

				for (const view of this.getPreviewViews()) {
					void view.refreshFromDiskIfTarget(file);
				}
			}),
		);

		this.addSettingTab(new SlidesPreviewSettingTab(this.app, this));

		this.app.workspace.onLayoutReady(() => {
			void this.syncPreviewWithActiveContext();
		});
	}

	onunload() {
		if (this.pendingCursorSyncTimer !== null) {
			window.clearTimeout(this.pendingCursorSyncTimer);
			this.pendingCursorSyncTimer = null;
		}
		for (const leaf of this.app.workspace.getLeavesOfType(
			VIEW_TYPE_SLIDES_PREVIEW,
		)) {
			leaf.detach();
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<SlidesPreviewSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async refreshPreviewFromActiveContext() {
		await this.syncPreviewWithActiveContext();
	}

	private async activatePreviewPane() {
		const existingLeaf =
			this.app.workspace.getLeavesOfType(VIEW_TYPE_SLIDES_PREVIEW)[0];
		const leaf = existingLeaf ?? this.createPreviewLeaf();

		await leaf.setViewState({
			type: VIEW_TYPE_SLIDES_PREVIEW,
			active: true,
		});
		this.app.workspace.setActiveLeaf(leaf, { focus: true });
		await this.syncPreviewWithActiveContext();
	}

	private createPreviewLeaf(): WorkspaceLeaf {
		return this.app.workspace.getLeaf('split', 'vertical');
	}

	private async syncPreviewWithActiveContext() {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (this.isMarkdownFile(markdownView?.file)) {
			const cursorLine = markdownView.editor.getCursor().line;
			this.lastSyncedCursorSignature = `${markdownView.file.path}:${cursorLine}`;
			await this.updatePreviewSource(
				markdownView.file,
				markdownView.editor.getValue(),
				cursorLine,
			);
			return;
		}

		const activeFile = this.app.workspace.getActiveFile();
		this.lastSyncedCursorSignature = this.isMarkdownFile(activeFile)
			? `${activeFile.path}:no-editor`
			: null;
		await this.updatePreviewSource(
			this.isMarkdownFile(activeFile) ? activeFile : null,
			null,
			null,
		);
	}

	private async updatePreviewSource(
		file: TFile | null,
		markdown: string | null,
		cursorLine: number | null,
	) {
		await Promise.all(
			this.getPreviewViews().map((view) => view.setSource(file, markdown, cursorLine)),
		);
	}

	private async syncCursorWithActiveContext() {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!this.isMarkdownFile(markdownView?.file)) {
			return;
		}

		const cursorLine = markdownView.editor.getCursor().line;
		const signature = `${markdownView.file.path}:${cursorLine}`;
		if (signature === this.lastSyncedCursorSignature) {
			return;
		}

		this.lastSyncedCursorSignature = signature;
		await this.updatePreviewSource(
			markdownView.file,
			markdownView.editor.getValue(),
			cursorLine,
		);
	}

	private async togglePresentationMode() {
		let view = this.getPreviewViews()[0];
		if (!view) {
			await this.activatePreviewPane();
			view = this.getPreviewViews()[0];
		}

		if (!view) {
			return;
		}

		await view.togglePresentationMode();
	}

	private getPreviewViews(): SlidesPreviewView[] {
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE_SLIDES_PREVIEW)
			.map((leaf) => leaf.view)
			.filter((view): view is SlidesPreviewView => view instanceof SlidesPreviewView);
	}

	private isMarkdownFile(
		file: TAbstractFile | TFile | null | undefined,
	): file is TFile {
		return file instanceof TFile && file.extension === 'md';
	}
}

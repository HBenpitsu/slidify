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
import { normalizeSlideLayoutKnobs } from './layoutParams';
import {
	SlidesPreviewView,
	VIEW_TYPE_SLIDES_PREVIEW,
} from './slidesPreviewView';

interface ActiveMarkdownContext {
	file: TFile;
	markdown: string;
	cursorLine: number;
	sourceLeaf: WorkspaceLeaf;
}

export default class SlidesLivePreviewPlugin extends Plugin {
	settings!: SlidesPreviewSettings;
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
				void this.refreshAllPreviews();
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
			this.app.workspace.on('editor-change', (editor, info) => {
				const file = info.file;
				if (!this.isMarkdownFile(file)) {
					return;
				}

				this.queuePreviewSync(file, editor.getValue(), editor.getCursor().line);
			}),
		);

		this.registerDomEvent(document, 'selectionchange', () => {
			this.queueActiveCursorSync();
		});

		this.registerDomEvent(document, 'mouseup', () => {
			this.queueActiveCursorSync();
		});

		this.registerDomEvent(window, 'keyup', () => {
			this.queueActiveCursorSync();
		});

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
	}

	onunload() {
		if (this.pendingCursorSyncTimer !== null) {
			window.clearTimeout(this.pendingCursorSyncTimer);
			this.pendingCursorSyncTimer = null;
		}
	}

	async loadSettings() {
		const loaded = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<SlidesPreviewSettings>,
		);
		const normalizedLayoutKnobs = normalizeSlideLayoutKnobs({
			headerMarginEm: loaded.headerMarginEm,
			paragraphMarginEm: loaded.paragraphMarginEm,
			slidePaddingPx: loaded.slidePaddingPx,
		});
		this.settings = {
			...loaded,
			...normalizedLayoutKnobs,
			enablePeriodicRefresh: Boolean(loaded.enablePeriodicRefresh),
			periodicRefreshIntervalMs: normalizeIntegerInRange(
				loaded.periodicRefreshIntervalMs,
				DEFAULT_SETTINGS.periodicRefreshIntervalMs,
				250,
				5000,
			),
			resizeSettleRefreshCount: normalizeIntegerInRange(
				loaded.resizeSettleRefreshCount,
				DEFAULT_SETTINGS.resizeSettleRefreshCount,
				0,
				8,
			),
			resizeSettleRefreshIntervalMs: normalizeIntegerInRange(
				loaded.resizeSettleRefreshIntervalMs,
				DEFAULT_SETTINGS.resizeSettleRefreshIntervalMs,
				40,
				1200,
			),
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async refreshPreviewFromActiveContext() {
		await this.refreshAllPreviews();
	}

	private async activatePreviewPane() {
		const sourceContext = this.getActiveMarkdownContext();
		const existingLeaf =
			this.app.workspace.getLeavesOfType(VIEW_TYPE_SLIDES_PREVIEW)[0];
		const leaf = existingLeaf ?? this.createPreviewLeaf();

		await leaf.setViewState({
			type: VIEW_TYPE_SLIDES_PREVIEW,
			active: true,
		});
		this.app.workspace.setActiveLeaf(leaf, { focus: true });

		const view = leaf.view;
		if (!(view instanceof SlidesPreviewView)) {
			return;
		}

		if (sourceContext) {
			await view.setSource(
				sourceContext.file,
				sourceContext.markdown,
				sourceContext.cursorLine,
				sourceContext.sourceLeaf,
			);
			return;
		}

		const activeFile = this.app.workspace.getActiveFile();
		await view.setSource(this.isMarkdownFile(activeFile) ? activeFile : null, null, null, null);
	}

	private createPreviewLeaf(): WorkspaceLeaf {
		return this.app.workspace.getLeaf('split', 'vertical');
	}

	private getActiveMarkdownContext(): ActiveMarkdownContext | null {
		const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!this.isMarkdownFile(markdownView?.file) || !markdownView.leaf) {
			return null;
		}

		return {
			file: markdownView.file,
			markdown: markdownView.editor.getValue(),
			cursorLine: markdownView.editor.getCursor().line,
			sourceLeaf: markdownView.leaf,
		};
	}

	private async updatePreviewSourceForFile(
		file: TFile | null,
		markdown: string | null,
		cursorLine: number | null,
	) {
		if (!file) {
			return;
		}

		await Promise.all(this.getPreviewViews().map(async (view) => {
			if (!view.isTargetFile(file.path)) {
				return;
			}

			await view.setSource(file, markdown, cursorLine, null);
		}));
	}

	private queueActiveCursorSync() {
		const context = this.getActiveMarkdownContext();
		if (!context) {
			return;
		}

		this.queuePreviewSync(context.file, context.markdown, context.cursorLine);
	}

	private queuePreviewSync(
		file: TFile,
		markdown: string,
		cursorLine: number,
	) {
		if (this.pendingCursorSyncTimer !== null) {
			window.clearTimeout(this.pendingCursorSyncTimer);
		}

		this.pendingCursorSyncTimer = window.setTimeout(() => {
			this.pendingCursorSyncTimer = null;
			void this.updatePreviewSourceForFile(file, markdown, cursorLine);
		}, 140);
	}

	private async refreshAllPreviews(): Promise<void> {
		await Promise.all(this.getPreviewViews().map((view) => view.refreshPinnedSource()));
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

function normalizeIntegerInRange(
	value: number | undefined,
	fallback: number,
	min: number,
	max: number,
): number {
	if (!Number.isFinite(value)) {
		return fallback;
	}

	const safeValue = value as number;
	return Math.min(max, Math.max(min, Math.round(safeValue)));
}

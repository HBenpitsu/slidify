import {
	Component,
	ItemView,
	MarkdownRenderer,
	MarkdownView,
	TFile,
	type ViewStateResult,
	WorkspaceLeaf,
} from 'obsidian';
import SlidesLivePreviewPlugin from './main';
import { findSlideIndexForLine, parseSlides, type SlideSegment } from './slideModel';
import {
	createSlidesPreviewButtonIconSvg,
	type SlidesPreviewIconName,
} from './slidesPreview/icons';
import { registerSlidesPreviewInteractionHandlers } from './slidesPreview/interactionController';
import {
	computeSlideLayoutGeometry,
	measureSlideLayoutInputs,
	type SlideRenderMode,
} from './slidesPreview/layoutEngine';
import {
	renderPresentationMode,
	renderPreviewSlidesMode,
	type PreviewSlideElements,
	type SlideSurfaceElements,
} from './slidesPreview/modeRenderers';
import {
	resolveSlideLayoutTuningParams,
	type SlideLayoutTuningParams,
} from './layoutParams';

export const VIEW_TYPE_SLIDES_PREVIEW = 'slides-live-preview';

const CONTENT_SCALE_FACTOR = 1.1;
const CONTENT_SCALE_DEFAULT = 1;
const PREVIEW_OVERFLOW_SAFETY_PX = 12;
const NON_ACTIVE_BATCH_REFRESH_MS = 420;
const PREVIEW_RENDER_CHUNK_BUDGET_MS = 8;
const PERIODIC_REFRESH_INTERVAL_FALLBACK_MS = 900;
const PERIODIC_REFRESH_INTERVAL_MIN_MS = 250;
const PERIODIC_REFRESH_INTERVAL_MAX_MS = 5000;
const PERIODIC_ACTIVE_ONLY_FAILURE_THRESHOLD = 2;
const RESIZE_SETTLE_RETRY_COUNT_MIN = 0;
const RESIZE_SETTLE_RETRY_COUNT_MAX = 8;
const RESIZE_SETTLE_INTERVAL_MIN_MS = 40;
const RESIZE_SETTLE_INTERVAL_MAX_MS = 1200;
const DEFAULT_RESIZE_SETTLE_INTERVAL_MS = 140;
const PERSISTED_VIEW_STATE_SCHEMA_VERSION = 1;

interface SlidesPreviewViewState {
	schemaVersion: number;
	targetFilePath: string | null;
	currentSlideIndex: number;
	contentScale: number;
}

export class SlidesPreviewView extends ItemView {
	private plugin: SlidesLivePreviewPlugin;
	private targetFile: TFile | null = null;
	private targetLeaf: WorkspaceLeaf | null = null;
	private liveMarkdown: string | null = null;
	private currentCursorLine: number | null = null;
	private slidesRootEl: HTMLDivElement | null = null;
	private overlayEl: HTMLDivElement | null = null;
	private progressBarEl: HTMLDivElement | null = null;
	private prevButtonEl: HTMLButtonElement | null = null;
	private nextButtonEl: HTMLButtonElement | null = null;
	private presentButtonEl: HTMLButtonElement | null = null;
	private zoomOutButtonEl: HTMLButtonElement | null = null;
	private zoomResetButtonEl: HTMLButtonElement | null = null;
	private zoomInButtonEl: HTMLButtonElement | null = null;
	private zoomValueEl: HTMLSpanElement | null = null;
	private dockButtonEl: HTMLButtonElement | null = null;
	private controlDockSide: 'left' | 'right' = 'right';
	private renderComponent: Component | null = null;
	private renderVersion = 0;
	private currentSlideIndex = 0;
	private lastSlideCount = 0;
	private wheelNavigationLockUntil = 0;
	private revealActiveSlideOnRefresh = false;
	private contentScale = CONTENT_SCALE_DEFAULT;
	private paneResizeObserver: ResizeObserver | null = null;
	private lastObservedPaneWidth = 0;
	private lastRenderedFilePath: string | null = null;
	private lastRenderedMarkdown: string | null = null;
	private lastRenderedSlides: SlideSegment[] = [];
	private previewStackEl: HTMLDivElement | null = null;
	private presentationStageEl: HTMLDivElement | null = null;
	private pendingNonActiveBatchRefreshTimer: number | null = null;
	private periodicRefreshTimer: number | null = null;
	private pendingSettleRefreshTimers: number[] = [];
	private pendingPeriodicFullRefresh = false;
	private periodicViewportSnapshot = '';
	private periodicActiveOnlyFailureStreak = 0;
	private refreshInFlightCount = 0;
	private pendingPersistedViewState: SlidesPreviewViewState | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: SlidesLivePreviewPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.contentScale = this.getDefaultContentScale();
	}

	getViewType(): string {
		return VIEW_TYPE_SLIDES_PREVIEW;
	}

	getDisplayText(): string {
		return 'Slidify';
	}

	getState(): Record<string, unknown> {
		return {
			schemaVersion: PERSISTED_VIEW_STATE_SCHEMA_VERSION,
			targetFilePath: this.targetFile?.path ?? null,
			currentSlideIndex: Math.max(0, Math.floor(this.currentSlideIndex)),
			contentScale: this.normalizeContentScale(this.contentScale),
		};
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);
		result.history = false;

		const parsedState = this.parsePersistedViewState(state);
		if (!parsedState) {
			return;
		}

		if (!this.slidesRootEl) {
			this.pendingPersistedViewState = parsedState;
			return;
		}

		this.applyPersistedViewState(parsedState);
		await this.refresh();
	}

	async onRename(file: TFile): Promise<void> {
		if (this.targetFile !== file) {
			return;
		}

		this.lastRenderedFilePath = file.path;
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('slides-live-preview-view');
		this.contentEl.tabIndex = 0;
		this.applyAspectRatioCssVar();
		this.registerInteractionHandlers();

		this.slidesRootEl = this.contentEl.createDiv({ cls: 'slides-live-preview-root' });
		this.ensureOverlay();
		this.resetRenderComponent();
		if (this.pendingPersistedViewState) {
			this.applyPersistedViewState(this.pendingPersistedViewState);
			this.pendingPersistedViewState = null;
		}
		this.observePaneSize();
		this.periodicViewportSnapshot = this.getViewportSnapshot();
		this.reconcilePeriodicRefreshScheduler();
		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.cancelScheduledNonActiveBatchRefresh();
		this.stopPeriodicRefreshScheduler();
		this.cancelViewportSettleRefreshes();
		this.teardownRenderComponent();
		this.paneResizeObserver?.disconnect();
		this.paneResizeObserver = null;
		this.clearPagerState();
		this.overlayEl = null;
		this.slidesRootEl = null;
	}

	async setSource(
		file: TFile | null,
		markdown: string | null,
		cursorLine: number | null = null,
		sourceLeaf: WorkspaceLeaf | null = null,
	): Promise<void> {
		const nextPath = this.isMarkdownFile(file) ? file.path : null;
		this.targetFile = this.isMarkdownFile(file) ? file : null;
		if (!this.targetFile) {
			this.targetLeaf = null;
		}
		if (sourceLeaf) {
			this.targetLeaf = sourceLeaf;
		}
		this.liveMarkdown = markdown;
		this.currentCursorLine = cursorLine;

		if (
			nextPath &&
			nextPath === this.lastRenderedFilePath &&
			markdown !== null &&
			markdown !== this.lastRenderedMarkdown &&
			cursorLine !== null
		) {
			const updatedActiveOnly = await this.tryApplyActiveSlideLiveUpdate(
				markdown,
				cursorLine,
			);
			if (updatedActiveOnly) {
				this.scheduleNonActiveBatchRefresh();
				this.reconcilePeriodicRefreshScheduler();
				return;
			}
		}

		if (
			nextPath &&
			nextPath === this.lastRenderedFilePath &&
			markdown !== null &&
			markdown === this.lastRenderedMarkdown &&
			cursorLine !== null &&
			this.tryApplyCursorOnlyUpdate(cursorLine)
		) {
			this.reconcilePeriodicRefreshScheduler();
			return;
		}

		this.updateRevealState(cursorLine);
		await this.refresh();
		this.reconcilePeriodicRefreshScheduler();
		this.scheduleWorkspaceLayoutSave();
	}

	isTargetFile(path: string): boolean {
		return this.targetFile?.path === path;
	}

	async refreshPinnedSource(): Promise<void> {
		await this.refresh();
	}

	async refreshFromDiskIfTarget(file: TFile): Promise<void> {
		if (this.targetFile?.path !== file.path) {
			return;
		}

		this.liveMarkdown = null;
		await this.refresh();
	}

	async togglePresentationMode(): Promise<void> {
		this.revealActiveSlideOnRefresh = true;
		if (document.fullscreenElement === this.contentEl) {
			await document.exitFullscreen();
			return;
		}

		await this.contentEl.requestFullscreen();
		this.contentEl.focus();
	}

	private async refresh(): Promise<void> {
		this.refreshInFlightCount += 1;
		try {
			if (!this.slidesRootEl) {
				return;
			}

			this.applyAspectRatioCssVar();

			const currentVersion = ++this.renderVersion;
			const previousScrollTop = this.contentEl.scrollTop;
			const shouldRevealActiveSlide = !this.isPresenting() && this.revealActiveSlideOnRefresh;
			this.resetRenderComponent();

			if (!this.targetFile) {
				this.renderEmptyState('Open a Markdown note to preview slides.');
				if (!shouldRevealActiveSlide) {
					this.contentEl.scrollTop = previousScrollTop;
				}
				return;
			}

			const markdown =
				this.liveMarkdown ?? (await this.app.vault.cachedRead(this.targetFile));
			if (currentVersion !== this.renderVersion) {
				return;
			}

			const slides = parseSlides(markdown, this.plugin.settings.slideSeparator);
			if (slides.length === 0) {
				this.resetSlidesState();
				this.renderEmptyState('No slide content found.');
				if (!shouldRevealActiveSlide) {
					this.contentEl.scrollTop = previousScrollTop;
				}
				return;
			}

			this.syncActiveSlideIndex(slides);

			const activeSlide = slides[this.currentSlideIndex];
			if (!activeSlide) {
				this.renderEmptyState('No slide content found.');
				if (!shouldRevealActiveSlide) {
					this.contentEl.scrollTop = previousScrollTop;
				}
				return;
			}

			const sourcePath = this.targetFile.path;
			this.lastRenderedFilePath = sourcePath;
			this.lastRenderedMarkdown = markdown;
			this.lastRenderedSlides = slides;

			if (this.isPresenting()) {
				await this.renderPresentation(slides, activeSlide, sourcePath, currentVersion);
			} else {
				await this.renderPreviewSlides(
					slides,
					sourcePath,
					currentVersion,
					shouldRevealActiveSlide,
					previousScrollTop,
				);
			}

			if (currentVersion !== this.renderVersion) {
				return;
			}
		} finally {
			this.refreshInFlightCount = Math.max(0, this.refreshInFlightCount - 1);
			this.reconcilePeriodicRefreshScheduler();
		}
	}

	private parsePersistedViewState(state: unknown): SlidesPreviewViewState | null {
		const payload = this.unwrapPersistedViewStatePayload(state);
		if (!payload) {
			return null;
		}

		const schemaVersion =
			typeof payload.schemaVersion === 'number' ? Math.floor(payload.schemaVersion) : 0;
		if (schemaVersion > PERSISTED_VIEW_STATE_SCHEMA_VERSION) {
			return null;
		}

		const targetFilePath =
			typeof payload.targetFilePath === 'string' && payload.targetFilePath.length > 0
				? payload.targetFilePath
				: null;
		const currentSlideIndex =
			typeof payload.currentSlideIndex === 'number'
				? Math.max(0, Math.floor(payload.currentSlideIndex))
				: 0;
		const contentScale =
			typeof payload.contentScale === 'number'
				? this.normalizeContentScale(payload.contentScale)
				: this.getDefaultContentScale();

		return {
			schemaVersion,
			targetFilePath,
			currentSlideIndex,
			contentScale,
		};
	}

	private applyPersistedViewState(state: SlidesPreviewViewState): void {
		this.contentScale = this.normalizeContentScale(state.contentScale);
		this.currentSlideIndex = Math.max(0, Math.floor(state.currentSlideIndex));
		this.currentCursorLine = null;
		this.liveMarkdown = null;
		this.revealActiveSlideOnRefresh = true;
		this.lastRenderedMarkdown = null;
		this.lastRenderedSlides = [];
		this.lastSlideCount = 0;

		const nextFile = state.targetFilePath
			? this.resolveMarkdownFileByPath(state.targetFilePath)
			: null;
		this.targetFile = nextFile;
		this.targetLeaf = null;
		this.lastRenderedFilePath = nextFile?.path ?? null;
		this.updatePager(0);
		this.reconcilePeriodicRefreshScheduler();
		this.scheduleWorkspaceLayoutSave();
	}

	private unwrapPersistedViewStatePayload(
		state: unknown,
	): Record<string, unknown> | null {
		if (!isRecord(state)) {
			return null;
		}

		const nestedState = state.state;
		if (isRecord(nestedState)) {
			return nestedState;
		}

		return state;
	}

	private resolveMarkdownFileByPath(path: string): TFile | null {
		const abstractFile = this.app.vault.getAbstractFileByPath(path);
		if (!(abstractFile instanceof TFile)) {
			return null;
		}

		return this.isMarkdownFile(abstractFile) ? abstractFile : null;
	}

	private renderEmptyState(message: string): void {
		if (!this.slidesRootEl) {
			return;
		}

		this.slidesRootEl.empty();
		this.previewStackEl = null;
		this.presentationStageEl = null;
		this.updatePager(0);
		this.slidesRootEl.createDiv({
			cls: 'slides-live-preview-empty',
			text: message,
		});
	}

	private async renderPreviewSlides(
		slides: SlideSegment[],
		sourcePath: string,
		currentVersion: number,
		shouldRevealActiveSlide: boolean,
		previousScrollTop: number,
	): Promise<void> {
		if (!this.slidesRootEl) {
			return;
		}

		await renderPreviewSlidesMode({
			slides,
			sourcePath,
			currentVersion,
			currentSlideIndex: this.currentSlideIndex,
			shouldRevealActiveSlide,
			previousScrollTop,
			contentEl: this.contentEl,
			renderChunkBudgetMs: PREVIEW_RENDER_CHUNK_BUDGET_MS,
			getRenderVersion: () => this.renderVersion,
			ensurePreviewStack: () => this.ensurePreviewStack(),
			removePresentationStage: () => {
				if (!this.presentationStageEl) {
					return;
				}

				this.presentationStageEl.remove();
				this.presentationStageEl = null;
			},
			waitForLayoutFrame: (version) => this.waitForLayoutFrame(version),
			computeSlideRenderSignature: (slide) => this.computeSlideRenderSignature(slide),
			resolvePreviewSlideForRender: (args) => this.resolvePreviewSlideForRender(args),
			renderSlideMarkdown: (slide, slideContentEl, path) =>
				this.renderSlideMarkdown(slide, slideContentEl, path),
			resolveAndApplySlideLayout: (args) => this.resolveAndApplySlideLayout(args),
			updateSlideSourceMetadata: (slideEl, slide) =>
				this.updateSlideSourceMetadata(slideEl, slide),
			renderOverlay: (isPresenting, slideCount) => this.renderOverlay(isPresenting, slideCount),
			revealActiveSlideInPreview: (activeSlideEl, version) =>
				this.revealActiveSlideInPreview(activeSlideEl, version),
		});
	}

	private async renderPresentation(
		slides: SlideSegment[],
		activeSlide: SlideSegment,
		sourcePath: string,
		currentVersion: number,
	): Promise<void> {
		if (!this.slidesRootEl) {
			return;
		}

		await renderPresentationMode({
			slides,
			activeSlide,
			sourcePath,
			currentVersion,
			getRenderVersion: () => this.renderVersion,
			slidesRootEl: this.slidesRootEl,
			presentationStageEl: this.presentationStageEl,
			setPresentationStageEl: (stageEl) => {
				this.presentationStageEl = stageEl;
			},
			removePreviewStack: () => {
				if (!this.previewStackEl) {
					return;
				}

				this.previewStackEl.remove();
				this.previewStackEl = null;
			},
			createSlideSurface: (parentEl, cls) => this.createSlideSurface(parentEl, cls),
			renderSlideMarkdown: (slide, slideContentEl, path) =>
				this.renderSlideMarkdown(slide, slideContentEl, path),
			assignApproximateSourceLines: (slideContentEl, slide) =>
				this.assignApproximateSourceLines(slideContentEl, slide),
			resolveAndApplySlideLayout: (args) => this.resolveAndApplySlideLayout(args),
			resolveSourceLineFromPresentationClick: (target, slide) =>
				this.resolveSourceLineFromPresentationClick(target, slide),
			focusSourceEditorAtLine: (line) => this.focusSourceEditorAtLine(line),
			renderOverlay: (isPresenting, slideCount) => this.renderOverlay(isPresenting, slideCount),
		});
	}

	private ensurePreviewStack(): HTMLDivElement {
		if (!this.slidesRootEl) {
			throw new Error('Slides root is not ready.');
		}

		if (!this.previewStackEl) {
			this.previewStackEl = this.slidesRootEl.createDiv({ cls: 'slides-live-preview-stack' });
			return this.previewStackEl;
		}

		if (this.previewStackEl.parentElement !== this.slidesRootEl) {
			this.slidesRootEl.appendChild(this.previewStackEl);
		}

		for (const child of Array.from(this.slidesRootEl.children)) {
			if (child !== this.previewStackEl) {
				child.remove();
			}
		}

		return this.previewStackEl;
	}

	private createPreviewSlideElement(
		slideIndex: number,
	): PreviewSlideElements {
		const slideEl = createDiv({
			cls: 'slides-live-preview-slide slides-live-preview-slide-preview',
		});
		slideEl.toggleClass('is-active', slideIndex === this.currentSlideIndex);
		slideEl.setAttribute('data-slide-index', String(slideIndex));
		slideEl.addEventListener('mouseenter', () => {
			this.selectSlideInPreview(slideIndex);
		});
		slideEl.addEventListener('click', (event) => {
			void this.handlePreviewSlideClick(event, slideIndex, slideEl);
		});

		const overflowGuideEl = slideEl.createDiv({ cls: 'slides-live-preview-overflow-guide' });
		const { surfaceEl, zoomFrameEl, zoomContentEl, slideContentEl } =
			this.createSlideSurface(
				slideEl,
				'slides-live-preview-presentation-surface slides-live-preview-preview-surface',
			);
		return {
			slideEl,
			overflowGuideEl,
			surfaceEl,
			zoomFrameEl,
			zoomContentEl,
			slideContentEl,
		};
	}

	private resolvePreviewSlideForRender(args: {
		index: number;
		slide: SlideSegment;
		slideSignature: string;
		stackEl: HTMLDivElement;
		staleCard: Element | undefined;
	}): PreviewSlideElements & { needsMarkdownRender: boolean } {
		const existingSlide =
			args.staleCard instanceof HTMLDivElement
				? this.getPreviewSlideElementsFromExisting(args.staleCard)
				: null;

		if (
			existingSlide &&
			existingSlide.slideEl.getAttribute('data-slide-signature') === args.slideSignature
		) {
			existingSlide.slideEl.setAttribute('data-slide-index', String(args.index));
			return {
				...existingSlide,
				needsMarkdownRender: false,
			};
		}

		const nextSlide = this.createPreviewSlideElement(args.index);
		nextSlide.slideEl.setAttribute('data-slide-signature', args.slideSignature);
		if (args.staleCard instanceof HTMLDivElement) {
			args.stackEl.replaceChild(nextSlide.slideEl, args.staleCard);
		} else {
			args.stackEl.appendChild(nextSlide.slideEl);
		}

		return {
			...nextSlide,
			needsMarkdownRender: true,
		};
	}

	private getPreviewSlideElementsFromExisting(
		slideEl: HTMLDivElement,
	): PreviewSlideElements | null {
		const overflowGuideEl = slideEl.querySelector<HTMLDivElement>(
			'.slides-live-preview-overflow-guide',
		);
		const surfaceEl = slideEl.querySelector<HTMLDivElement>(
			'.slides-live-preview-preview-surface',
		);
		const zoomFrameEl = slideEl.querySelector<HTMLDivElement>(
			'.slides-live-preview-zoom-frame',
		);
		const zoomContentEl = slideEl.querySelector<HTMLDivElement>(
			'.slides-live-preview-zoom-content',
		);
		const slideContentEl = slideEl.querySelector<HTMLDivElement>(
			'.slides-live-preview-slide-content',
		);

		if (!overflowGuideEl || !surfaceEl || !zoomFrameEl || !zoomContentEl || !slideContentEl) {
			return null;
		}

		return {
			slideEl,
			overflowGuideEl,
			surfaceEl,
			zoomFrameEl,
			zoomContentEl,
			slideContentEl,
		};
	}

	private computeSlideRenderSignature(slide: SlideSegment): string {
		const contentHash = this.hashString(slide.content);
		const notesHash = this.hashString(slide.metadata.speakerNotes.join('\n'));
		const themeToken = slide.metadata.theme ?? '';
		return `${slide.layout}|${slide.scaleMultiplier}|${themeToken}|${notesHash}|${contentHash}`;
	}

	private hashString(content: string): string {
		let hash = 2166136261;
		for (let index = 0; index < content.length; index += 1) {
			hash ^= content.charCodeAt(index);
			hash +=
				(hash << 1) +
				(hash << 4) +
				(hash << 7) +
				(hash << 8) +
				(hash << 24);
		}

		return (hash >>> 0).toString(36);
	}

	private updateSlideSourceMetadata(slideEl: HTMLDivElement, slide: SlideSegment): void {
		slideEl.setAttribute('data-source-start-line', String(slide.startLine));
		slideEl.setAttribute('data-source-end-line', String(slide.endLine));
		slideEl.setAttribute('data-slide-notes-count', String(slide.metadata.speakerNotes.length));
		if (slide.metadata.theme) {
			slideEl.setAttribute('data-slide-theme', slide.metadata.theme);
		} else {
			slideEl.removeAttribute('data-slide-theme');
		}

		const slideContentEl = slideEl.querySelector<HTMLDivElement>(
			'.slides-live-preview-slide-content',
		);
		if (!slideContentEl) {
			return;
		}

		this.assignApproximateSourceLines(slideContentEl, slide);
	}

	private assignApproximateSourceLines(
		slideContentEl: HTMLDivElement,
		slide: SlideSegment,
	): void {
		const lines = slide.content.split(/\r?\n/);
		const blockElements = Array.from(slideContentEl.children);
		let lineOffset = 0;

		for (const blockEl of blockElements) {
			while (lineOffset < lines.length && !lines[lineOffset]?.trim()) {
				lineOffset += 1;
			}

			const boundedOffset = Math.min(Math.max(lineOffset, 0), Math.max(lines.length - 1, 0));
			blockEl.setAttribute('data-source-line', String(slide.startLine + boundedOffset));
			lineOffset += 1;
		}
	}

	private scheduleNonActiveBatchRefresh(): void {
		this.cancelScheduledNonActiveBatchRefresh();

		this.pendingNonActiveBatchRefreshTimer = window.setTimeout(() => {
			this.pendingNonActiveBatchRefreshTimer = null;
			window.requestAnimationFrame(() => {
				void this.refresh();
			});
		}, NON_ACTIVE_BATCH_REFRESH_MS);
	}

	private cancelScheduledNonActiveBatchRefresh(): void {
		if (this.pendingNonActiveBatchRefreshTimer !== null) {
			window.clearTimeout(this.pendingNonActiveBatchRefreshTimer);
			this.pendingNonActiveBatchRefreshTimer = null;
		}
	}

	private reconcilePeriodicRefreshScheduler(): void {
		const shouldRun =
			this.plugin.settings.enablePeriodicRefresh &&
			!this.isPresenting() &&
			Boolean(this.targetFile) &&
			Boolean(this.slidesRootEl);
		if (!shouldRun) {
			this.stopPeriodicRefreshScheduler();
			return;
		}

		if (this.periodicRefreshTimer !== null) {
			return;
		}

		this.scheduleNextPeriodicRefreshTick();
	}

	private scheduleNextPeriodicRefreshTick(): void {
		if (this.periodicRefreshTimer !== null) {
			return;
		}

		const intervalMs = this.getPeriodicRefreshIntervalMs();
		this.periodicRefreshTimer = window.setTimeout(() => {
			this.periodicRefreshTimer = null;
			void this.runPeriodicRefreshTick();
		}, intervalMs);
	}

	private stopPeriodicRefreshScheduler(): void {
		if (this.periodicRefreshTimer !== null) {
			window.clearTimeout(this.periodicRefreshTimer);
			this.periodicRefreshTimer = null;
		}
	}

	private async runPeriodicRefreshTick(): Promise<void> {
		if (
			!this.plugin.settings.enablePeriodicRefresh ||
			this.isPresenting() ||
			!this.targetFile ||
			!this.slidesRootEl
		) {
			this.stopPeriodicRefreshScheduler();
			return;
		}

		if (this.refreshInFlightCount > 0) {
			this.scheduleNextPeriodicRefreshTick();
			return;
		}

		const viewportChanged = this.consumeViewportChangeSignal();
		const shouldForceFullRefresh = this.pendingPeriodicFullRefresh || viewportChanged;
		let updatedActiveOnly = false;

		if (!shouldForceFullRefresh) {
			updatedActiveOnly = await this.tryApplyActiveSlideRelayoutOnly();
			if (updatedActiveOnly) {
				this.periodicActiveOnlyFailureStreak = 0;
			} else {
				this.periodicActiveOnlyFailureStreak += 1;
			}
		}

		const shouldEscalate =
			shouldForceFullRefresh ||
			(!updatedActiveOnly &&
				this.periodicActiveOnlyFailureStreak >= PERIODIC_ACTIVE_ONLY_FAILURE_THRESHOLD);

		if (shouldEscalate) {
			this.pendingPeriodicFullRefresh = false;
			this.periodicActiveOnlyFailureStreak = 0;
			await this.refresh();
			this.scheduleWorkspaceLayoutSave();
		} else {
			this.pendingPeriodicFullRefresh = false;
		}

		this.scheduleNextPeriodicRefreshTick();
	}

	private getPeriodicRefreshIntervalMs(): number {
		const value = this.plugin.settings.periodicRefreshIntervalMs;
		if (!Number.isFinite(value)) {
			return PERIODIC_REFRESH_INTERVAL_FALLBACK_MS;
		}

		return Math.min(
			PERIODIC_REFRESH_INTERVAL_MAX_MS,
			Math.max(PERIODIC_REFRESH_INTERVAL_MIN_MS, Math.round(value)),
		);
	}

	private getResizeSettleRefreshCount(): number {
		const value = this.plugin.settings.resizeSettleRefreshCount;
		if (!Number.isFinite(value)) {
			return 0;
		}

		return Math.min(
			RESIZE_SETTLE_RETRY_COUNT_MAX,
			Math.max(RESIZE_SETTLE_RETRY_COUNT_MIN, Math.round(value)),
		);
	}

	private getResizeSettleRefreshIntervalMs(): number {
		const value = this.plugin.settings.resizeSettleRefreshIntervalMs;
		if (!Number.isFinite(value)) {
			return DEFAULT_RESIZE_SETTLE_INTERVAL_MS;
		}

		return Math.min(
			RESIZE_SETTLE_INTERVAL_MAX_MS,
			Math.max(RESIZE_SETTLE_INTERVAL_MIN_MS, Math.round(value)),
		);
	}

	private markPeriodicFullRefreshNeeded(): void {
		this.pendingPeriodicFullRefresh = true;
	}

	private scheduleViewportSettleRefreshes(): void {
		this.cancelViewportSettleRefreshes();

		const retryCount = this.getResizeSettleRefreshCount();
		if (retryCount <= 0) {
			return;
		}

		const intervalMs = this.getResizeSettleRefreshIntervalMs();
		for (let retryIndex = 0; retryIndex < retryCount; retryIndex += 1) {
			const timer = window.setTimeout(() => {
				this.pendingSettleRefreshTimers = this.pendingSettleRefreshTimers.filter(
					(activeTimer) => activeTimer !== timer,
				);
				this.markPeriodicFullRefreshNeeded();
				void this.refresh();
			}, intervalMs * (retryIndex + 1));
			this.pendingSettleRefreshTimers.push(timer);
		}
	}

	private cancelViewportSettleRefreshes(): void {
		for (const timer of this.pendingSettleRefreshTimers) {
			window.clearTimeout(timer);
		}
		this.pendingSettleRefreshTimers = [];
	}

	private getViewportSnapshot(): string {
		return `${Math.round(window.innerWidth)}x${Math.round(window.innerHeight)}:${this.isPresenting() ? '1' : '0'}:${this.lastObservedPaneWidth}`;
	}

	private consumeViewportChangeSignal(): boolean {
		const nextSnapshot = this.getViewportSnapshot();
		if (!this.periodicViewportSnapshot) {
			this.periodicViewportSnapshot = nextSnapshot;
			return false;
		}

		const changed = this.periodicViewportSnapshot !== nextSnapshot;
		this.periodicViewportSnapshot = nextSnapshot;
		return changed;
	}

	private async tryApplyActiveSlideRelayoutOnly(): Promise<boolean> {
		if (this.isPresenting() || !this.previewStackEl || this.lastRenderedSlides.length === 0) {
			return false;
		}

		const activeSlide = this.lastRenderedSlides[this.currentSlideIndex];
		if (!activeSlide) {
			return false;
		}

		const activeSlideEl = this.previewStackEl.querySelector<HTMLDivElement>(
			`[data-slide-index="${this.currentSlideIndex}"]`,
		);
		if (!activeSlideEl) {
			return false;
		}

		const previewElements = this.getPreviewSlideElementsFromExisting(activeSlideEl);
		if (!previewElements) {
			return false;
		}

		const laidOut = await this.resolveAndApplySlideLayout({
			mode: 'preview',
			slide: activeSlide,
			surfaceEl: previewElements.surfaceEl,
			zoomFrameEl: previewElements.zoomFrameEl,
			zoomContentEl: previewElements.zoomContentEl,
			slideContentEl: previewElements.slideContentEl,
			slideEl: previewElements.slideEl,
			overflowGuideEl: previewElements.overflowGuideEl,
			currentVersion: this.renderVersion,
		});
		if (!laidOut) {
			return false;
		}

		this.updateSlideSourceMetadata(previewElements.slideEl, activeSlide);
		this.updatePager(this.lastSlideCount);
		return true;
	}

	private async tryApplyActiveSlideLiveUpdate(
		markdown: string,
		cursorLine: number,
	): Promise<boolean> {
		if (!this.targetFile || this.isPresenting() || !this.previewStackEl) {
			return false;
		}

		const slides = parseSlides(markdown, this.plugin.settings.slideSeparator);
		if (slides.length === 0) {
			return false;
		}

		this.currentCursorLine = cursorLine;
		this.syncActiveSlideIndex(slides);
		const activeSlide = slides[this.currentSlideIndex];
		if (!activeSlide) {
			return false;
		}

		const activeSlideEl = this.previewStackEl.querySelector<HTMLDivElement>(
			`[data-slide-index="${this.currentSlideIndex}"]`,
		);
		if (!activeSlideEl) {
			return false;
		}

		const previewElements = this.getPreviewSlideElementsFromExisting(activeSlideEl);
		if (!previewElements) {
			return false;
		}

		const nextSignature = this.computeSlideRenderSignature(activeSlide);
		if (activeSlideEl.getAttribute('data-slide-signature') !== nextSignature) {
			activeSlideEl.setAttribute('data-slide-signature', nextSignature);
			await this.renderSlideMarkdown(activeSlide, previewElements.slideContentEl, this.targetFile.path);
		}

		const laidOut = await this.resolveAndApplySlideLayout({
			mode: 'preview',
			slide: activeSlide,
			surfaceEl: previewElements.surfaceEl,
			zoomFrameEl: previewElements.zoomFrameEl,
			zoomContentEl: previewElements.zoomContentEl,
			slideContentEl: previewElements.slideContentEl,
			slideEl: previewElements.slideEl,
			overflowGuideEl: previewElements.overflowGuideEl,
			currentVersion: this.renderVersion,
		});
		if (!laidOut) {
			return false;
		}

		this.updateSlideSourceMetadata(previewElements.slideEl, activeSlide);
		this.lastRenderedSlides = slides;
		this.lastRenderedMarkdown = markdown;
		this.lastRenderedFilePath = this.targetFile.path;
		this.revealActiveSlideOnRefresh = true;
		this.revealActiveSlideInPreview(previewElements.slideEl, this.renderVersion);
		this.updatePager(slides.length);
		this.scheduleWorkspaceLayoutSave();
		return true;
	}

	private async handlePreviewSlideClick(
		event: MouseEvent,
		slideIndex: number,
		slideEl: HTMLDivElement,
	): Promise<void> {
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) {
			return;
		}

		event.preventDefault();
		this.selectSlideInPreview(slideIndex);
		const sourceLine = this.resolveSourceLineFromClickTarget(event.target, slideEl);
		await this.focusSourceEditorAtLine(sourceLine);
	}

	private resolveSourceLineFromClickTarget(
		target: EventTarget | null,
		slideEl: HTMLDivElement,
	): number {
		if (target instanceof HTMLElement) {
			const lineHintEl = target.closest<HTMLElement>('[data-source-line]');
			const hintedLine = lineHintEl?.getAttribute('data-source-line');
			const parsedHint = hintedLine ? Number.parseInt(hintedLine, 10) : Number.NaN;
			if (Number.isFinite(parsedHint) && parsedHint >= 0) {
				return parsedHint;
			}
		}

		const fallbackLineToken = slideEl.getAttribute('data-source-start-line');
		const fallbackLine = fallbackLineToken ? Number.parseInt(fallbackLineToken, 10) : Number.NaN;
		return Number.isFinite(fallbackLine) && fallbackLine >= 0 ? fallbackLine : 0;
	}

	private resolveTargetLeaf(): WorkspaceLeaf | null {
		if (this.targetLeaf && this.app.workspace.getLeavesOfType('markdown').includes(this.targetLeaf)) {
			return this.targetLeaf;
		}

		if (!this.targetFile) {
			return null;
		}

		const markdownLeaf = this.app.workspace
			.getLeavesOfType('markdown')
			.find((leaf) => {
				const markdownView = leaf.view;
				return markdownView instanceof MarkdownView && markdownView.file?.path === this.targetFile?.path;
			});
		if (markdownLeaf) {
			this.targetLeaf = markdownLeaf;
			return markdownLeaf;
		}

		return null;
	}

	private async focusSourceEditorAtLine(line: number): Promise<void> {
		const targetLeaf = this.resolveTargetLeaf();
		if (!targetLeaf || !this.targetFile) {
			return;
		}

		const currentView = targetLeaf.view;
		if (!(currentView instanceof MarkdownView) || currentView.file?.path !== this.targetFile.path) {
			await targetLeaf.openFile(this.targetFile, { active: false });
		}

		const markdownView = targetLeaf.view;
		if (!(markdownView instanceof MarkdownView)) {
			return;
		}

		const safeLine = Math.max(0, Math.floor(line));
		this.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
		markdownView.editor.setCursor({ line: safeLine, ch: 0 });
		markdownView.editor.scrollIntoView(
			{
				from: { line: safeLine, ch: 0 },
				to: { line: safeLine, ch: 0 },
			},
			true,
		);
	}

	private renderOverlay(isPresenting: boolean, slideCount = this.lastSlideCount): void {
		if (!this.ensureOverlay()) {
			return;
		}

		this.overlayEl?.toggleClass('is-presenting', isPresenting);
		this.overlayEl?.toggleClass('is-docked-left', this.controlDockSide === 'left');
		this.overlayEl?.toggleClass('is-docked-right', this.controlDockSide === 'right');
		this.updatePager(slideCount);

	}

	private ensureOverlay(): boolean {
		if (!this.slidesRootEl) {
			return false;
		}

		if (this.overlayEl) {
			return true;
		}

		this.overlayEl = this.contentEl.createDiv({
			cls: 'slides-live-preview-overlay',
		});
		const progressTrackEl = this.overlayEl.createDiv({
			cls: 'slides-live-preview-progress-track',
		});
		this.progressBarEl = progressTrackEl.createDiv({
			cls: 'slides-live-preview-progress-bar',
		});
		const controlsEl = this.overlayEl.createDiv({ cls: 'slides-live-preview-controls' });
		this.createZoomControls(controlsEl);
		this.prevButtonEl = this.createNavigationButton(controlsEl, 'previous', 'Previous slide', -1);
		this.presentButtonEl = this.createIconButton(
			controlsEl,
			'present',
			'Start presentation',
			'slides-live-preview-nav-button slides-live-preview-present-button',
		);
		this.presentButtonEl.addEventListener('click', () => {
			void this.togglePresentationMode();
		});
		this.nextButtonEl = this.createNavigationButton(controlsEl, 'next', 'Next slide', 1);
		this.dockButtonEl = this.createIconButton(
			controlsEl,
			this.controlDockSide === 'right' ? 'dockLeft' : 'dockRight',
			this.controlDockSide === 'right' ? 'Dock controls left' : 'Dock controls right',
		);
		this.dockButtonEl.addEventListener('click', () => {
			this.controlDockSide = this.controlDockSide === 'right' ? 'left' : 'right';
			this.overlayEl?.toggleClass('is-docked-left', this.controlDockSide === 'left');
			this.overlayEl?.toggleClass('is-docked-right', this.controlDockSide === 'right');
			this.setDockButtonIcon();
		});
		this.overlayEl.toggleClass('is-docked-left', this.controlDockSide === 'left');
		this.overlayEl.toggleClass('is-docked-right', this.controlDockSide === 'right');
		return true;
	}

	private updatePager(slideCount: number): void {
		const progressRatio = slideCount === 0 ? 0 : (this.currentSlideIndex + 1) / slideCount;

		if (this.progressBarEl) {
			this.progressBarEl.style.width = `${progressRatio * 100}%`;
		}

		if (this.prevButtonEl) {
			this.prevButtonEl.disabled = this.currentSlideIndex <= 0;
		}

		if (this.nextButtonEl) {
			this.nextButtonEl.disabled = this.currentSlideIndex >= slideCount - 1;
		}

		if (this.presentButtonEl) {
			this.setPresentationButtonIcon();
		}

		this.setDockButtonIcon();

		if (this.zoomValueEl) {
			this.zoomValueEl.textContent = `${Math.round(this.contentScale * 100)}%`;
		}

		if (this.zoomResetButtonEl) {
			const defaultScale = this.getDefaultContentScale();
			this.zoomResetButtonEl.disabled =
				Math.abs(this.contentScale - defaultScale) < 0.001;
		}
	}

	private async goToSlide(nextIndex: number): Promise<void> {
		if (!this.targetFile || nextIndex === this.currentSlideIndex || nextIndex < 0) {
			return;
		}

		if (this.lastSlideCount > 0 && nextIndex >= this.lastSlideCount) {
			return;
		}

		this.currentSlideIndex = nextIndex;
		this.currentCursorLine = null;
		this.revealActiveSlideOnRefresh = !this.isPresenting();
		await this.refresh();
		this.scheduleWorkspaceLayoutSave();
	}

	private clearPagerState(): void {
		this.progressBarEl = null;
		this.prevButtonEl = null;
		this.nextButtonEl = null;
		this.presentButtonEl = null;
		this.zoomOutButtonEl = null;
		this.zoomResetButtonEl = null;
		this.zoomInButtonEl = null;
		this.zoomValueEl = null;
		this.dockButtonEl = null;
	}

	private updateRevealState(cursorLine: number | null): void {
		this.revealActiveSlideOnRefresh = cursorLine !== null;
	}

	private resetSlidesState(): void {
		this.currentSlideIndex = 0;
		this.lastSlideCount = 0;
		this.lastRenderedSlides = [];
		this.lastRenderedMarkdown = null;
		this.lastRenderedFilePath = null;
	}

	private tryApplyCursorOnlyUpdate(cursorLine: number): boolean {
		if (this.isPresenting() || this.lastRenderedSlides.length === 0) {
			return false;
		}

		const nextIndex = findSlideIndexForLine(this.lastRenderedSlides, cursorLine);
		if (nextIndex === this.currentSlideIndex) {
			return true;
		}

		const stackEl = this.slidesRootEl?.querySelector('.slides-live-preview-stack');
		if (!(stackEl instanceof HTMLElement)) {
			return false;
		}

		const previousActiveEl = stackEl.querySelector(
			`[data-slide-index="${this.currentSlideIndex}"]`,
		);
		const nextActiveEl = stackEl.querySelector(`[data-slide-index="${nextIndex}"]`);
		if (!(nextActiveEl instanceof HTMLDivElement)) {
			return false;
		}

		if (previousActiveEl instanceof HTMLDivElement) {
			previousActiveEl.removeClass('is-active');
		}
		nextActiveEl.addClass('is-active');
		this.currentSlideIndex = nextIndex;
		this.revealActiveSlideOnRefresh = true;
		this.updatePager(this.lastSlideCount);
		this.revealActiveSlideInPreview(nextActiveEl, this.renderVersion);
		this.scheduleWorkspaceLayoutSave();
		return true;
	}

	private syncActiveSlideIndex(slides: SlideSegment[]): void {
		if (this.currentCursorLine !== null) {
			this.currentSlideIndex = findSlideIndexForLine(slides, this.currentCursorLine);
		}

		this.currentSlideIndex = Math.max(0, Math.min(this.currentSlideIndex, slides.length - 1));
		this.lastSlideCount = slides.length;
	}

	private registerInteractionHandlers(): void {
		registerSlidesPreviewInteractionHandlers({
			contentEl: this.contentEl,
			registerDomEvent: (target, type, handler) => {
				if (target instanceof Window) {
					this.registerDomEvent(target, type as keyof WindowEventMap, handler);
					return;
				}

				if (target instanceof Document) {
					this.registerDomEvent(target, type as keyof DocumentEventMap, handler);
					return;
				}

				this.registerDomEvent(target, type as keyof HTMLElementEventMap, handler);
			},
			getCurrentSlideIndex: () => this.currentSlideIndex,
			goToSlide: (nextIndex) => this.goToSlide(nextIndex),
			togglePresentationMode: () => this.togglePresentationMode(),
			multiplyContentScale: (multiplier) => this.multiplyContentScale(multiplier),
			isPresenting: () => this.isPresenting(),
			getWheelNavigationLockUntil: () => this.wheelNavigationLockUntil,
			setWheelNavigationLockUntil: (lockUntil) => {
				this.wheelNavigationLockUntil = lockUntil;
			},
			onFullscreenChanged: (isPresenting) => {
				this.contentEl.classList.toggle('is-presenting', isPresenting);
				this.revealActiveSlideOnRefresh = true;
				this.reconcilePeriodicRefreshScheduler();
			},
			onViewportChanged: () => {
				this.markPeriodicFullRefreshNeeded();
				this.scheduleViewportSettleRefreshes();
			},
			refresh: () => this.refresh(),
			contentScaleFactor: CONTENT_SCALE_FACTOR,
		});
	}

	private observePaneSize(): void {
		this.paneResizeObserver?.disconnect();
		this.paneResizeObserver = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) {
				return;
			}

			const nextWidth = Math.round(entry.contentRect.width);
			if (nextWidth <= 0 || nextWidth === this.lastObservedPaneWidth) {
				return;
			}

			this.lastObservedPaneWidth = nextWidth;
			this.markPeriodicFullRefreshNeeded();
			this.scheduleViewportSettleRefreshes();
			void this.refresh();
		});
		this.paneResizeObserver.observe(this.contentEl);
		this.lastObservedPaneWidth = Math.round(this.contentEl.getBoundingClientRect().width);
	}

	private applySlideLayout(slideContentEl: HTMLDivElement, slide: SlideSegment): void {
		slideContentEl.toggleClass('is-layout-hero', slide.layout === 'hero');
		slideContentEl.toggleClass('is-layout-section', slide.layout === 'section');
		slideContentEl.toggleClass('is-layout-content', slide.layout === 'content');

		if (slide.layout !== 'section') {
			return;
		}

		const children = Array.from(slideContentEl.children);
		const firstChild = children[0];
		if (!(firstChild instanceof HTMLElement)) {
			return;
		}

		const headingSlotEl = slideContentEl.createDiv({ cls: 'slides-live-preview-heading-slot' });
		const bodySlotEl = slideContentEl.createDiv({ cls: 'slides-live-preview-body-slot' });
		slideContentEl.prepend(bodySlotEl);
		slideContentEl.prepend(headingSlotEl);
		headingSlotEl.appendChild(firstChild);

		for (const child of children.slice(1)) {
			bodySlotEl.appendChild(child);
		}

		bodySlotEl.toggleClass('is-empty', bodySlotEl.childElementCount === 0);
	}

	private async renderSlideMarkdown(
		slide: SlideSegment,
		slideContentEl: HTMLDivElement,
		sourcePath: string,
	): Promise<void> {
		slideContentEl.empty();
		await MarkdownRenderer.render(
			this.app,
			slide.content,
			slideContentEl,
			sourcePath,
			this.getRenderComponent(),
		);
		this.applySlideLayout(slideContentEl, slide);
		this.applySlideMetadataAttributes(slideContentEl, slide);
	}

	private applySlideMetadataAttributes(targetEl: HTMLElement, slide: SlideSegment): void {
		targetEl.setAttribute('data-slide-layout', slide.layout);
		targetEl.setAttribute('data-slide-notes-count', String(slide.metadata.speakerNotes.length));
		if (slide.metadata.theme) {
			targetEl.setAttribute('data-slide-theme', slide.metadata.theme);
		} else {
			targetEl.removeAttribute('data-slide-theme');
		}
	}

	private resolveSourceLineFromPresentationClick(
		target: EventTarget | null,
		slide: SlideSegment,
	): number {
		if (target instanceof HTMLElement) {
			const lineHintEl = target.closest<HTMLElement>('[data-source-line]');
			const hintedLine = lineHintEl?.getAttribute('data-source-line');
			const parsedHint = hintedLine ? Number.parseInt(hintedLine, 10) : Number.NaN;
			if (Number.isFinite(parsedHint) && parsedHint >= 0) {
				return parsedHint;
			}
		}

		return Math.max(0, slide.startLine);
	}

	private createSlideSurface(parentEl: HTMLElement, cls: string): SlideSurfaceElements {
		const surfaceEl = parentEl.createDiv({ cls });
		const zoomFrameEl = surfaceEl.createDiv({ cls: 'slides-live-preview-zoom-frame' });
		const zoomContentEl = zoomFrameEl.createDiv({ cls: 'slides-live-preview-zoom-content' });
		zoomContentEl.addClass('is-layout-pending');
		const slideContentEl = zoomContentEl.createDiv({ cls: 'slides-live-preview-slide-content' });
		slideContentEl.addClass('markdown-preview-view');
		slideContentEl.addClass('markdown-rendered');
		return {
			surfaceEl,
			zoomFrameEl,
			zoomContentEl,
			slideContentEl,
		};
	}

	private async waitForLayoutFrame(currentVersion: number): Promise<boolean> {
		await new Promise<void>((resolve) => {
			window.requestAnimationFrame(() => resolve());
		});
		return currentVersion === this.renderVersion;
	}

	private async resolveAndApplySlideLayout(args: {
		mode: SlideRenderMode;
		slide: SlideSegment;
		surfaceEl: HTMLDivElement;
		zoomFrameEl: HTMLDivElement;
		zoomContentEl: HTMLDivElement;
		slideContentEl: HTMLDivElement;
		slideEl?: HTMLDivElement;
		overflowGuideEl?: HTMLDivElement;
		currentVersion: number;
	}): Promise<boolean> {
		const settled = await this.waitForLayoutFrame(args.currentVersion);
		if (!settled) {
			return false;
		}

		const { width: presentationReferenceWidth } = this.getPresentationReferenceSize();
		const measurements = measureSlideLayoutInputs({
			surfaceEl: args.surfaceEl,
			zoomFrameEl: args.zoomFrameEl,
			zoomContentEl: args.zoomContentEl,
			slideContentEl: args.slideContentEl,
			slide: args.slide,
			mode: args.mode,
			contentScale: this.contentScale,
			presentationReferenceWidth,
			viewportAspectRatio: this.getViewportAspectRatio(),
		});

		const geometry = computeSlideLayoutGeometry(
			args.slide,
			measurements,
		);

		args.zoomContentEl.style.transform =
			`translateY(${geometry.translateOffsetPx}px) scale(${geometry.effectiveScale})`;

		const bodySlotEl = args.slideContentEl.querySelector<HTMLElement>(
			'.slides-live-preview-body-slot',
		);
		if (bodySlotEl) {
			bodySlotEl.style.setProperty(
				'--slides-body-offset-unscaled',
				`${geometry.bodyOffsetPx / geometry.effectiveScale}px`,
			);
		}

		args.zoomFrameEl.style.height = `${geometry.baseHeight}px`;
		args.surfaceEl.style.height = `${geometry.surfaceHeight}px`;

		if (args.mode === 'preview' && args.slideEl && args.overflowGuideEl) {
			const idealHeight = Math.round(
				args.slideEl.clientWidth / this.getTargetAspectRatio(),
			);
			const actualHeight = Math.ceil(
				Math.max(idealHeight, geometry.scaledContentHeight + PREVIEW_OVERFLOW_SAFETY_PX),
			);
			const hasOverflow = actualHeight > idealHeight + 4;
			args.slideEl.toggleClass('has-overflow', hasOverflow);
			args.overflowGuideEl.style.top = `${idealHeight}px`;
			args.slideEl.style.minHeight = `${idealHeight}px`;
			args.slideEl.style.height = hasOverflow ? `${actualHeight}px` : `${idealHeight}px`;
		}

		args.zoomContentEl.removeClass('is-layout-pending');
		args.zoomContentEl.addClass('is-layout-ready');
		return true;
	}

	private revealActiveSlideInPreview(activeSlideEl: HTMLDivElement | null, currentVersion: number): void {
		if (!this.revealActiveSlideOnRefresh || !activeSlideEl) {
			return;
		}

		const containerEl = this.contentEl;
		if (!containerEl) {
			return;
		}

		window.requestAnimationFrame(() => {
			if (currentVersion !== this.renderVersion || !this.revealActiveSlideOnRefresh) {
				return;
			}

			const targetTop = this.calculatePreviewScrollTop(containerEl, activeSlideEl);
			containerEl.scrollTo({ top: targetTop, behavior: 'auto' });
			this.revealActiveSlideOnRefresh = false;
		});
	}

	private calculatePreviewScrollTop(
		containerEl: HTMLElement,
		activeSlideEl: HTMLDivElement,
	): number {
		const maxScrollTop = Math.max(0, containerEl.scrollHeight - containerEl.clientHeight);
		const containerRect = containerEl.getBoundingClientRect();
		const activeRect = activeSlideEl.getBoundingClientRect();
		const centeredTop =
			containerEl.scrollTop +
			(activeRect.top - containerRect.top) -
			(containerEl.clientHeight - activeRect.height) / 2;
		return Math.max(0, Math.min(centeredTop, maxScrollTop));
	}

	private async multiplyContentScale(multiplier: number): Promise<void> {
		const nextScale = this.normalizeContentScale(this.contentScale * multiplier);
		if (Math.abs(nextScale - this.contentScale) < 0.001) {
			return;
		}

		this.contentScale = nextScale;
		this.revealActiveSlideOnRefresh = true;
		await this.refresh();
		this.scheduleWorkspaceLayoutSave();
	}

	private async resetContentScale(): Promise<void> {
		const defaultScale = this.getDefaultContentScale();
		if (Math.abs(this.contentScale - defaultScale) < 0.001) {
			return;
		}

		this.contentScale = defaultScale;
		this.revealActiveSlideOnRefresh = true;
		await this.refresh();
		this.scheduleWorkspaceLayoutSave();
	}

	private selectSlideInPreview(nextIndex: number): void {
		if (this.isPresenting() || nextIndex === this.currentSlideIndex || nextIndex < 0) {
			return;
		}

		if (this.lastSlideCount > 0 && nextIndex >= this.lastSlideCount) {
			return;
		}

		const stackEl = this.previewStackEl;
		if (!stackEl) {
			return;
		}

		const previousActiveEl = stackEl.querySelector(
			`[data-slide-index="${this.currentSlideIndex}"]`,
		);
		const nextActiveEl = stackEl.querySelector(`[data-slide-index="${nextIndex}"]`);
		if (!(nextActiveEl instanceof HTMLDivElement)) {
			return;
		}

		if (previousActiveEl instanceof HTMLDivElement) {
			previousActiveEl.removeClass('is-active');
		}
		nextActiveEl.addClass('is-active');
		this.currentSlideIndex = nextIndex;
		this.currentCursorLine = null;
		this.updatePager(this.lastSlideCount);
		this.scheduleWorkspaceLayoutSave();
	}

	private scheduleWorkspaceLayoutSave(): void {
		void this.app.workspace.requestSaveLayout();
	}

	private normalizeContentScale(scale: number): number {
		return Number(Math.max(0.01, scale).toFixed(3));
	}

	private getDefaultContentScale(): number {
		const percent = this.plugin.settings.defaultContentScalePercent;
		if (!Number.isFinite(percent)) {
			return CONTENT_SCALE_DEFAULT;
		}

		const clampedPercent = Math.min(200, Math.max(50, percent));
		return this.normalizeContentScale(clampedPercent / 100);
	}

	private getLayoutTuningParams(): SlideLayoutTuningParams {
		return resolveSlideLayoutTuningParams({
			headerMarginEm: this.plugin.settings.headerMarginEm,
			paragraphMarginEm: this.plugin.settings.paragraphMarginEm,
			slidePaddingPx: this.plugin.settings.slidePaddingPx,
		});
	}

	private getPresentationReferenceSize(): { width: number; height: number } {
		const aspectRatio = this.getTargetAspectRatio();
		const viewportWidth = Math.max(1, window.innerWidth);
		const viewportHeight = Math.max(1, window.innerHeight - 80);
		const width = Math.min(viewportWidth, viewportHeight * aspectRatio);
		const height = width / aspectRatio;
		return { width, height };
	}

	private getTargetAspectRatio(): number {
		const monitorRatio = this.getMonitorAspectRatio();
		if (monitorRatio !== null) {
			return monitorRatio;
		}

		const viewportRatio = this.getViewportAspectRatio();
		if (Number.isFinite(viewportRatio) && viewportRatio > 0) {
			return viewportRatio;
		}

		return 16 / 9;
	}

	private getMonitorAspectRatio(): number | null {
		const screenWidth = window.screen?.width;
		const screenHeight = window.screen?.height;
		if (
			!Number.isFinite(screenWidth) ||
			!Number.isFinite(screenHeight) ||
			!screenWidth ||
			!screenHeight ||
			screenWidth <= 0 ||
			screenHeight <= 0
		) {
			return null;
		}

		return screenWidth / screenHeight;
	}

	private getViewportAspectRatio(): number {
		const width = Math.max(1, window.innerWidth);
		const height = Math.max(1, window.innerHeight);
		return width / height;
	}

	private applyAspectRatioCssVar(): void {
		const tuning = this.getLayoutTuningParams();
		this.contentEl.style.setProperty(
			'--slides-aspect-ratio',
			String(this.getTargetAspectRatio()),
		);
		this.contentEl.style.setProperty(
			'--slides-heading-margin-bottom-em',
			String(tuning.headerMarginBottomEm),
		);
		this.contentEl.style.setProperty(
			'--slides-paragraph-margin-top-em',
			String(tuning.paragraphMarginTopEm),
		);
		this.contentEl.style.setProperty(
			'--slides-paragraph-margin-bottom-em',
			String(tuning.paragraphMarginBottomEm),
		);
		this.contentEl.style.setProperty(
			'--slides-preview-surface-padding-px',
			`${tuning.previewSurfacePaddingPx}px`,
		);
		this.contentEl.style.setProperty(
			'--slides-presentation-surface-padding-px',
			`${tuning.presentationSurfacePaddingPx}px`,
		);
	}

	private setDockButtonIcon(): void {
		if (!this.dockButtonEl) {
			return;
		}

		const icon = this.controlDockSide === 'right' ? 'dockLeft' : 'dockRight';
		const label = this.controlDockSide === 'right' ? 'Dock controls left' : 'Dock controls right';
		this.setButtonIcon(this.dockButtonEl, icon, label);
	}

	private setPresentationButtonIcon(): void {
		if (!this.presentButtonEl) {
			return;
		}

		if (this.isPresenting()) {
			this.setButtonIcon(this.presentButtonEl, 'exit', 'Exit presentation');
			return;
		}

		this.setButtonIcon(this.presentButtonEl, 'present', 'Start presentation');
	}

	private createIconButton(
		parentEl: HTMLElement,
		icon: SlidesPreviewIconName,
		label: string,
		cls = 'slides-live-preview-nav-button',
	): HTMLButtonElement {
		const buttonEl = parentEl.createEl('button', { cls });
		this.setButtonIcon(buttonEl, icon, label);
		return buttonEl;
	}

	private createNavigationButton(
		parentEl: HTMLElement,
		icon: 'previous' | 'next',
		label: string,
		direction: -1 | 1,
	): HTMLButtonElement {
		const buttonEl = this.createIconButton(parentEl, icon, label);
		buttonEl.addEventListener('click', () => {
			void this.goToSlide(this.currentSlideIndex + direction);
		});
		return buttonEl;
	}

	private createZoomControls(parentEl: HTMLElement): void {
		const zoomControlsEl = parentEl.createDiv({ cls: 'slides-live-preview-zoom-controls' });

		this.zoomOutButtonEl = this.createIconButton(
			zoomControlsEl,
			'zoomOut',
			'Zoom out slide content',
		);
		this.zoomOutButtonEl.addEventListener('click', () => {
			void this.multiplyContentScale(1 / CONTENT_SCALE_FACTOR);
		});

		this.zoomValueEl = zoomControlsEl.createSpan({ cls: 'slides-live-preview-zoom-value' });

		this.zoomResetButtonEl = this.createIconButton(
			zoomControlsEl,
			'zoomReset',
			'Reset slide content zoom',
		);
		this.zoomResetButtonEl.addEventListener('click', () => {
			void this.resetContentScale();
		});

		this.zoomInButtonEl = this.createIconButton(
			zoomControlsEl,
			'zoomIn',
			'Zoom in slide content',
		);
		this.zoomInButtonEl.addEventListener('click', () => {
			void this.multiplyContentScale(CONTENT_SCALE_FACTOR);
		});
	}

	private setButtonIcon(
		buttonEl: HTMLButtonElement,
		icon: SlidesPreviewIconName,
		label: string,
	): void {
		buttonEl.empty();
		buttonEl.setAttribute('aria-label', label);
		buttonEl.setAttribute('title', label);
		buttonEl.appendChild(createSlidesPreviewButtonIconSvg(icon));
	}

	private isPresenting(): boolean {
		return document.fullscreenElement === this.contentEl;
	}

	private getRenderComponent(): Component {
		if (!this.renderComponent) {
			this.renderComponent = this.addChild(new Component());
		}
		return this.renderComponent;
	}

	private resetRenderComponent(): void {
		this.teardownRenderComponent();
		this.renderComponent = this.addChild(new Component());
	}

	private teardownRenderComponent(): void {
		if (!this.renderComponent) {
			return;
		}

		this.removeChild(this.renderComponent);
		this.renderComponent = null;
	}

	private isMarkdownFile(file: TFile | null): file is TFile {
		return Boolean(file && file.extension === 'md');
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

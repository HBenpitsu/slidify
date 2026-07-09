import { Component, ItemView, MarkdownRenderer, TFile, WorkspaceLeaf } from 'obsidian';
import SlidesLivePreviewPlugin from './main';
import { findSlideIndexForLine, parseSlides, type SlideSegment } from './slideModel';

export const VIEW_TYPE_SLIDES_PREVIEW = 'slides-live-preview';

const CONTENT_SCALE_FACTOR = 1.1;
const CONTENT_SCALE_DEFAULT = 1;
const PREVIEW_OVERFLOW_SAFETY_PX = 12;

type IconName =
	| 'previous'
	| 'next'
	| 'present'
	| 'exit'
	| 'dockLeft'
	| 'dockRight'
	| 'zoomOut'
	| 'zoomIn'
	| 'zoomReset';

interface SlideSurfaceElements {
	surfaceEl: HTMLDivElement;
	zoomFrameEl: HTMLDivElement;
	zoomContentEl: HTMLDivElement;
	slideContentEl: HTMLDivElement;
}

interface PreviewSlideElements extends SlideSurfaceElements {
	slideEl: HTMLDivElement;
	overflowGuideEl: HTMLDivElement;
}

type SlideRenderMode = 'preview' | 'presentation';

interface SlideLayoutGeometry {
	mode: SlideRenderMode;
	baseWidth: number;
	baseHeight: number;
	effectiveScale: number;
	scaledContentHeight: number;
	surfaceHeight: number;
	translateOffsetPx: number;
	bodyOffsetPx: number;
}

interface SlideLayoutMeasurements {
	mode: SlideRenderMode;
	baseWidth: number;
	baseHeight: number;
	effectiveScale: number;
	scaleNormalization: number;
	contentHeightUnscaled: number;
	headingHeightUnscaled: number;
	bodyHeightUnscaled: number;
	sectionGapUnscaled: number;
}

export class SlidesPreviewView extends ItemView {
	private plugin: SlidesLivePreviewPlugin;
	private targetFile: TFile | null = null;
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

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('slides-live-preview-view');
		this.contentEl.tabIndex = 0;
		this.applyAspectRatioCssVar();
		this.registerInteractionHandlers();

		this.slidesRootEl = this.contentEl.createDiv({ cls: 'slides-live-preview-root' });
		this.ensureOverlay();
		this.resetRenderComponent();
		this.observePaneSize();
		await this.refresh();
	}

	async onClose(): Promise<void> {
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
	): Promise<void> {
		const nextPath = this.isMarkdownFile(file) ? file.path : null;
		this.targetFile = this.isMarkdownFile(file) ? file : null;
		this.liveMarkdown = markdown;
		this.currentCursorLine = cursorLine;

		if (
			nextPath &&
			nextPath === this.lastRenderedFilePath &&
			markdown !== null &&
			markdown === this.lastRenderedMarkdown &&
			cursorLine !== null &&
			this.tryApplyCursorOnlyUpdate(cursorLine)
		) {
			return;
		}

		this.updateRevealState(cursorLine);
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
			await this.renderPreviewSlides(slides, sourcePath, currentVersion, shouldRevealActiveSlide, previousScrollTop);
		}

		if (currentVersion !== this.renderVersion) {
			return;
		}
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

		if (this.presentationStageEl) {
			this.presentationStageEl.remove();
			this.presentationStageEl = null;
		}

		const stackEl = this.ensurePreviewStack();
		const staleCards = Array.from(stackEl.children);
		let activeSlideEl: HTMLDivElement | null = null;

		for (const [index, slide] of slides.entries()) {
			if (currentVersion !== this.renderVersion) {
				return;
			}

			const previewSlide = this.createPreviewSlideElement(index);
			const { slideEl, overflowGuideEl, surfaceEl, zoomFrameEl, zoomContentEl, slideContentEl } =
				previewSlide;
			const staleCard = staleCards[index];
			if (staleCard instanceof HTMLDivElement) {
				stackEl.replaceChild(slideEl, staleCard);
			} else {
				stackEl.appendChild(slideEl);
			}

			await this.renderSlideMarkdown(slide, slideContentEl, sourcePath);
			const laidOut = await this.resolveAndApplySlideLayout({
				mode: 'preview',
				slide,
				surfaceEl,
				zoomFrameEl,
				zoomContentEl,
				slideContentEl,
				slideEl,
				overflowGuideEl,
				currentVersion,
			});
			if (!laidOut) {
				return;
			}

			if (index === this.currentSlideIndex) {
				activeSlideEl = slideEl;
			}
		}

		for (const staleCard of staleCards.slice(slides.length)) {
			staleCard.remove();
		}

		this.renderOverlay(false, slides.length);
		if (shouldRevealActiveSlide) {
			this.revealActiveSlideInPreview(activeSlideEl, currentVersion);
			return;
		}

		this.contentEl.scrollTop = previousScrollTop;
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

		if (this.previewStackEl) {
			this.previewStackEl.remove();
			this.previewStackEl = null;
		}

		for (const child of Array.from(this.slidesRootEl.children)) {
			if (child !== this.presentationStageEl) {
				child.remove();
			}
		}

		const stageEl = this.presentationStageEl ?? this.slidesRootEl.createDiv({ cls: 'slides-live-preview-stage' });
		this.presentationStageEl = stageEl;
		stageEl.empty();
		const { surfaceEl, zoomFrameEl, zoomContentEl, slideContentEl } =
			this.createSlideSurface(stageEl, 'slides-live-preview-presentation-surface');
		await this.renderSlideMarkdown(activeSlide, slideContentEl, sourcePath);
		const laidOut = await this.resolveAndApplySlideLayout({
			mode: 'presentation',
			slide: activeSlide,
			surfaceEl,
			zoomFrameEl,
			zoomContentEl,
			slideContentEl,
			currentVersion,
		});
		if (!laidOut) {
			return;
		}

		if (currentVersion !== this.renderVersion) {
			return;
		}

		this.renderOverlay(true, slides.length);
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
		this.registerDomEvent(this.contentEl, 'click', () => {
			this.contentEl.focus();
		});

		this.registerDomEvent(this.contentEl, 'keydown', (event: KeyboardEvent) => {
			if (event.key === 'ArrowRight' || event.key === 'PageDown') {
				event.preventDefault();
				void this.goToSlide(this.currentSlideIndex + 1);
				return;
			}

			if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
				event.preventDefault();
				void this.goToSlide(this.currentSlideIndex - 1);
				return;
			}

			if (event.key.toLowerCase() === 'f') {
				event.preventDefault();
				void this.togglePresentationMode();
			}
		});

		this.registerDomEvent(this.contentEl, 'wheel', (event: WheelEvent) => {
			if (event.ctrlKey) {
				event.preventDefault();
				event.stopPropagation();
				void this.multiplyContentScale(
					event.deltaY > 0 ? 1 / CONTENT_SCALE_FACTOR : CONTENT_SCALE_FACTOR,
				);
				return;
			}

			if (!this.isPresenting()) {
				return;
			}

			const now = Date.now();
			if (now < this.wheelNavigationLockUntil || Math.abs(event.deltaY) < 12) {
				return;
			}

			event.preventDefault();
			this.wheelNavigationLockUntil = now + 180;
			void this.goToSlide(this.currentSlideIndex + (event.deltaY > 0 ? 1 : -1));
		});

		this.registerDomEvent(document, 'fullscreenchange', () => {
			this.contentEl.classList.toggle(
				'is-presenting',
				document.fullscreenElement === this.contentEl,
			);
			this.revealActiveSlideOnRefresh = true;
			void this.refresh();
		});

		this.registerDomEvent(window, 'resize', () => {
			void this.refresh();
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
		await MarkdownRenderer.render(
			this.app,
			slide.content,
			slideContentEl,
			sourcePath,
			this.getRenderComponent(),
		);
		this.applySlideLayout(slideContentEl, slide);
	}

	private createSlideSurface(parentEl: HTMLElement, cls: string): SlideSurfaceElements {
		const surfaceEl = parentEl.createDiv({ cls });
		const zoomFrameEl = surfaceEl.createDiv({ cls: 'slides-live-preview-zoom-frame' });
		const zoomContentEl = zoomFrameEl.createDiv({ cls: 'slides-live-preview-zoom-content' });
		zoomContentEl.addClass('is-layout-pending');
		const slideContentEl = zoomContentEl.createDiv({ cls: 'slides-live-preview-slide-content' });
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

	private measureLayoutInputs(args: {
		surfaceEl: HTMLDivElement;
		zoomFrameEl: HTMLDivElement;
		zoomContentEl: HTMLDivElement;
		slideContentEl: HTMLDivElement;
		slide: SlideSegment;
		mode: SlideRenderMode;
	}): SlideLayoutMeasurements {
		const viewportAspectRatio = this.getViewportAspectRatio();
		const measuredWidth =
			args.zoomFrameEl.clientWidth ||
			args.zoomFrameEl.getBoundingClientRect().width ||
			args.surfaceEl.clientWidth;
		const measuredHeight =
			args.zoomFrameEl.clientHeight ||
			args.zoomFrameEl.getBoundingClientRect().height ||
			Math.round(measuredWidth / viewportAspectRatio);
		const baseWidth = Math.max(1, Math.round(measuredWidth));
		const baseHeight = Math.max(1, Math.round(measuredHeight));
		const scaleNormalization = this.computeScaleNormalization(args.surfaceEl, baseWidth);
		const effectiveScale =
			this.contentScale * args.slide.scaleMultiplier * scaleNormalization;

		args.zoomContentEl.style.width = `${baseWidth / effectiveScale}px`;
		args.zoomContentEl.style.transform = `translateY(0px) scale(${effectiveScale})`;

		const bodySlotEl = args.slideContentEl.querySelector<HTMLElement>(
			'.slides-live-preview-body-slot',
		);
		const headingSlotEl = args.slideContentEl.querySelector<HTMLElement>(
			'.slides-live-preview-heading-slot',
		);
		const slideContentStyle = window.getComputedStyle(args.slideContentEl);
		const sectionGapUnscaled = this.parsePixelValue(slideContentStyle.rowGap);

		return {
			mode: args.mode,
			baseWidth,
			baseHeight,
			effectiveScale,
			scaleNormalization,
			contentHeightUnscaled: args.zoomContentEl.scrollHeight,
			headingHeightUnscaled: headingSlotEl?.offsetHeight ?? 0,
			bodyHeightUnscaled: bodySlotEl?.scrollHeight ?? 0,
			sectionGapUnscaled,
		};
	}

	private computeScaleNormalization(surfaceEl: HTMLElement, baseWidth: number): number {
		const { width: referenceWidth } = this.getPresentationReferenceSize();
		if (referenceWidth <= 0) {
			return 1;
		}

		const computedStyle = window.getComputedStyle(surfaceEl);
		const horizontalPadding =
			this.parsePixelValue(computedStyle.paddingLeft) +
			this.parsePixelValue(computedStyle.paddingRight);
		const usableWidth = Math.max(1, baseWidth - horizontalPadding);
		const referenceUsableWidth = Math.max(1, referenceWidth - horizontalPadding);
		return usableWidth / referenceUsableWidth;
	}

	private parsePixelValue(value: string): number {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}

	private computeLayoutGeometry(
		slide: SlideSegment,
		measurements: SlideLayoutMeasurements,
	): SlideLayoutGeometry {
		const scaledContentHeight = measurements.contentHeightUnscaled * measurements.effectiveScale;
		let translateOffsetPx = 0;
		let bodyOffsetPx = 0;
		let finalScaledHeight = scaledContentHeight;

		if (slide.layout === 'section' && measurements.bodyHeightUnscaled > 0) {
			const headingHeight = measurements.headingHeightUnscaled * measurements.effectiveScale;
			const bodyHeight = measurements.bodyHeightUnscaled * measurements.effectiveScale;
			const sectionGap = measurements.sectionGapUnscaled * measurements.effectiveScale;

			// 1) Center body as if heading did not exist.
			const centeredBodyTop = (measurements.baseHeight - bodyHeight) / 2;

			// 2) If that overlaps heading(+gap), push body down just enough.
			const headingBottom = headingHeight + sectionGap;
			const targetBodyTop = Math.max(centeredBodyTop, headingBottom);
			bodyOffsetPx = Math.max(0, targetBodyTop - headingBottom);
			finalScaledHeight += bodyOffsetPx;
		} else {
			const remainingHeight = measurements.baseHeight - scaledContentHeight;
			translateOffsetPx = Math.max(0, remainingHeight / 2);
		}
		const surfaceHeight =
			measurements.mode === 'preview'
				? Math.max(measurements.baseHeight, finalScaledHeight)
				: measurements.baseHeight;
		void slide;

		return {
			mode: measurements.mode,
			baseWidth: measurements.baseWidth,
			baseHeight: measurements.baseHeight,
			effectiveScale: measurements.effectiveScale,
			scaledContentHeight: finalScaledHeight,
			surfaceHeight,
			translateOffsetPx,
			bodyOffsetPx,
		};
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

		const measurements = this.measureLayoutInputs({
			surfaceEl: args.surfaceEl,
			zoomFrameEl: args.zoomFrameEl,
			zoomContentEl: args.zoomContentEl,
			slideContentEl: args.slideContentEl,
			slide: args.slide,
			mode: args.mode,
		});

		const geometry = this.computeLayoutGeometry(
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
				args.slideEl.clientWidth / this.getViewportAspectRatio(),
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
	}

	private async resetContentScale(): Promise<void> {
		const defaultScale = this.getDefaultContentScale();
		if (Math.abs(this.contentScale - defaultScale) < 0.001) {
			return;
		}

		this.contentScale = defaultScale;
		this.revealActiveSlideOnRefresh = true;
		await this.refresh();
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

	private getPresentationReferenceSize(): { width: number; height: number } {
		const aspectRatio = this.getViewportAspectRatio();
		const viewportWidth = Math.max(1, window.innerWidth);
		const viewportHeight = Math.max(1, window.innerHeight - 80);
		const width = Math.min(viewportWidth, viewportHeight * aspectRatio);
		const height = width / aspectRatio;
		return { width, height };
	}

	private getViewportAspectRatio(): number {
		const width = Math.max(1, window.innerWidth);
		const height = Math.max(1, window.innerHeight);
		return width / height;
	}

	private applyAspectRatioCssVar(): void {
		this.contentEl.style.setProperty(
			'--slides-aspect-ratio',
			String(this.getViewportAspectRatio()),
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
		icon: IconName,
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
		icon: IconName,
		label: string,
	): void {
		buttonEl.empty();
		buttonEl.setAttribute('aria-label', label);
		buttonEl.setAttribute('title', label);
		buttonEl.appendChild(this.createButtonIconSvg(icon));
	}

	private createButtonIconSvg(
		icon: IconName,
	): SVGSVGElement {
		const iconPaths = {
			previous: 'M14.5 5.5 8 12l6.5 6.5',
			next: 'M9.5 5.5 16 12l-6.5 6.5',
			present: 'M8 4.5H4.5V8M16 4.5h3.5V8M8 19.5H4.5V16M16 19.5h3.5V16',
			exit: 'M8 8H4.5V4.5M16 8h3.5V4.5M8 16H4.5v3.5M16 16h3.5v3.5',
			dockLeft: 'M8 6.5v11M12 6.5v11M16 6.5v11M5.5 6.5h13',
			dockRight: 'M16 6.5v11M12 6.5v11M8 6.5v11M5.5 6.5h13',
			zoomOut: 'M7 12h10M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z',
			zoomIn: 'M7 12h10M12 7v10M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z',
			zoomReset: 'M7.5 9.5h9M7.5 14.5h9M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Z',
		};
		const namespace = 'http://www.w3.org/2000/svg';
		const svgEl = document.createElementNS(namespace, 'svg');
		svgEl.setAttribute('class', 'slides-live-preview-button-icon');
		svgEl.setAttribute('viewBox', '0 0 24 24');
		svgEl.setAttribute('aria-hidden', 'true');

		const pathEl = document.createElementNS(namespace, 'path');
		pathEl.setAttribute('d', iconPaths[icon]);
		pathEl.setAttribute('fill', 'none');
		pathEl.setAttribute('stroke', 'currentColor');
		pathEl.setAttribute('stroke-linecap', 'round');
		pathEl.setAttribute('stroke-linejoin', 'round');
		pathEl.setAttribute('stroke-width', '1.8');
		svgEl.appendChild(pathEl);

		return svgEl;
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

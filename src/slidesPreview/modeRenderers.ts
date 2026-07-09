import type { SlideSegment } from '../slideModel';
import type { SlideRenderMode } from './layoutEngine';

export interface SlideSurfaceElements {
	surfaceEl: HTMLDivElement;
	zoomFrameEl: HTMLDivElement;
	zoomContentEl: HTMLDivElement;
	slideContentEl: HTMLDivElement;
}

export interface PreviewSlideElements extends SlideSurfaceElements {
	slideEl: HTMLDivElement;
	overflowGuideEl: HTMLDivElement;
}

export async function renderPreviewSlidesMode(args: {
	slides: SlideSegment[];
	sourcePath: string;
	currentVersion: number;
	currentSlideIndex: number;
	shouldRevealActiveSlide: boolean;
	previousScrollTop: number;
	contentEl: HTMLElement;
	renderChunkBudgetMs: number;
	getRenderVersion: () => number;
	ensurePreviewStack: () => HTMLDivElement;
	removePresentationStage: () => void;
	waitForLayoutFrame: (currentVersion: number) => Promise<boolean>;
	computeSlideRenderSignature: (slide: SlideSegment) => string;
	resolvePreviewSlideForRender: (args: {
		index: number;
		slide: SlideSegment;
		slideSignature: string;
		stackEl: HTMLDivElement;
		staleCard: Element | undefined;
	}) => PreviewSlideElements & { needsMarkdownRender: boolean };
	renderSlideMarkdown: (
		slide: SlideSegment,
		slideContentEl: HTMLDivElement,
		sourcePath: string,
	) => Promise<void>;
	resolveAndApplySlideLayout: (args: {
		mode: SlideRenderMode;
		slide: SlideSegment;
		surfaceEl: HTMLDivElement;
		zoomFrameEl: HTMLDivElement;
		zoomContentEl: HTMLDivElement;
		slideContentEl: HTMLDivElement;
		slideEl?: HTMLDivElement;
		overflowGuideEl?: HTMLDivElement;
		currentVersion: number;
	}) => Promise<boolean>;
	updateSlideSourceMetadata: (slideEl: HTMLDivElement, slide: SlideSegment) => void;
	renderOverlay: (isPresenting: boolean, slideCount: number) => void;
	revealActiveSlideInPreview: (
		activeSlideEl: HTMLDivElement | null,
		currentVersion: number,
	) => void;
}): Promise<boolean> {
	args.removePresentationStage();

	const stackEl = args.ensurePreviewStack();
	const staleCards = Array.from(stackEl.children);
	let activeSlideEl: HTMLDivElement | null = null;
	let chunkStartTime = performance.now();

	for (const [index, slide] of args.slides.entries()) {
		if (args.currentVersion !== args.getRenderVersion()) {
			return false;
		}

		if (performance.now() - chunkStartTime > args.renderChunkBudgetMs) {
			const canContinue = await args.waitForLayoutFrame(args.currentVersion);
			if (!canContinue) {
				return false;
			}
			chunkStartTime = performance.now();
		}

		const slideSignature = args.computeSlideRenderSignature(slide);
		const staleCard = staleCards[index];
		const previewSlide = args.resolvePreviewSlideForRender({
			index,
			slide,
			slideSignature,
			stackEl,
			staleCard,
		});
		const {
			slideEl,
			overflowGuideEl,
			surfaceEl,
			zoomFrameEl,
			zoomContentEl,
			slideContentEl,
			needsMarkdownRender,
		} = previewSlide;

		if (needsMarkdownRender) {
			await args.renderSlideMarkdown(slide, slideContentEl, args.sourcePath);
		}

		const laidOut = await args.resolveAndApplySlideLayout({
			mode: 'preview',
			slide,
			surfaceEl,
			zoomFrameEl,
			zoomContentEl,
			slideContentEl,
			slideEl,
			overflowGuideEl,
			currentVersion: args.currentVersion,
		});
		if (!laidOut) {
			return false;
		}

		slideEl.toggleClass('is-active', index === args.currentSlideIndex);
		args.updateSlideSourceMetadata(slideEl, slide);
		if (index === args.currentSlideIndex) {
			activeSlideEl = slideEl;
		}
	}

	for (const staleCard of staleCards.slice(args.slides.length)) {
		staleCard.remove();
	}

	args.renderOverlay(false, args.slides.length);
	if (args.shouldRevealActiveSlide) {
		args.revealActiveSlideInPreview(activeSlideEl, args.currentVersion);
		return true;
	}

	args.contentEl.scrollTop = args.previousScrollTop;
	return true;
}

export async function renderPresentationMode(args: {
	slides: SlideSegment[];
	activeSlide: SlideSegment;
	sourcePath: string;
	currentVersion: number;
	getRenderVersion: () => number;
	slidesRootEl: HTMLDivElement;
	presentationStageEl: HTMLDivElement | null;
	setPresentationStageEl: (stageEl: HTMLDivElement) => void;
	removePreviewStack: () => void;
	createSlideSurface: (parentEl: HTMLElement, cls: string) => SlideSurfaceElements;
	renderSlideMarkdown: (
		slide: SlideSegment,
		slideContentEl: HTMLDivElement,
		sourcePath: string,
	) => Promise<void>;
	assignApproximateSourceLines: (
		slideContentEl: HTMLDivElement,
		slide: SlideSegment,
	) => void;
	resolveAndApplySlideLayout: (args: {
		mode: SlideRenderMode;
		slide: SlideSegment;
		surfaceEl: HTMLDivElement;
		zoomFrameEl: HTMLDivElement;
		zoomContentEl: HTMLDivElement;
		slideContentEl: HTMLDivElement;
		slideEl?: HTMLDivElement;
		overflowGuideEl?: HTMLDivElement;
		currentVersion: number;
	}) => Promise<boolean>;
	resolveSourceLineFromPresentationClick: (
		target: EventTarget | null,
		slide: SlideSegment,
	) => number;
	focusSourceEditorAtLine: (line: number) => Promise<void>;
	renderOverlay: (isPresenting: boolean, slideCount: number) => void;
}): Promise<boolean> {
	args.removePreviewStack();

	for (const child of Array.from(args.slidesRootEl.children)) {
		if (child !== args.presentationStageEl) {
			child.remove();
		}
	}

	const stageEl =
		args.presentationStageEl ??
		args.slidesRootEl.createDiv({ cls: 'slides-live-preview-stage' });
	args.setPresentationStageEl(stageEl);
	stageEl.empty();

	const { surfaceEl, zoomFrameEl, zoomContentEl, slideContentEl } =
		args.createSlideSurface(stageEl, 'slides-live-preview-presentation-surface');

	surfaceEl.addEventListener('click', (event: MouseEvent) => {
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) {
			return;
		}

		event.preventDefault();
		const sourceLine = args.resolveSourceLineFromPresentationClick(
			event.target,
			args.activeSlide,
		);
		void args.focusSourceEditorAtLine(sourceLine);
	});

	await args.renderSlideMarkdown(args.activeSlide, slideContentEl, args.sourcePath);
	args.assignApproximateSourceLines(slideContentEl, args.activeSlide);

	const laidOut = await args.resolveAndApplySlideLayout({
		mode: 'presentation',
		slide: args.activeSlide,
		surfaceEl,
		zoomFrameEl,
		zoomContentEl,
		slideContentEl,
		currentVersion: args.currentVersion,
	});
	if (!laidOut) {
		return false;
	}

	if (args.currentVersion !== args.getRenderVersion()) {
		return false;
	}

	args.renderOverlay(true, args.slides.length);
	return true;
}
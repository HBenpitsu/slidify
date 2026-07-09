import type { SlideSegment } from '../slideModel';

export type SlideRenderMode = 'preview' | 'presentation';

export interface SlideLayoutGeometry {
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
	contentHeightUnscaled: number;
	headingHeightUnscaled: number;
	bodyHeightUnscaled: number;
	sectionGapUnscaled: number;
}

export function measureSlideLayoutInputs(args: {
	surfaceEl: HTMLDivElement;
	zoomFrameEl: HTMLDivElement;
	zoomContentEl: HTMLDivElement;
	slideContentEl: HTMLDivElement;
	slide: SlideSegment;
	mode: SlideRenderMode;
	contentScale: number;
	presentationReferenceWidth: number;
	viewportAspectRatio: number;
}): SlideLayoutMeasurements {
	const measuredWidth =
		args.zoomFrameEl.clientWidth ||
		args.zoomFrameEl.getBoundingClientRect().width ||
		args.surfaceEl.clientWidth;
	const measuredHeight =
		args.zoomFrameEl.clientHeight ||
		args.zoomFrameEl.getBoundingClientRect().height ||
		Math.round(measuredWidth / args.viewportAspectRatio);
	const baseWidth = Math.max(1, Math.round(measuredWidth));
	const baseHeight = Math.max(1, Math.round(measuredHeight));
	const scaleNormalization = computeScaleNormalization(
		args.surfaceEl,
		baseWidth,
		args.presentationReferenceWidth,
	);
	const effectiveScale =
		args.contentScale * args.slide.scaleMultiplier * scaleNormalization;

	args.zoomContentEl.style.width = `${baseWidth / effectiveScale}px`;
	args.zoomContentEl.style.transform = `translateY(0px) scale(${effectiveScale})`;

	const bodySlotEl = args.slideContentEl.querySelector<HTMLElement>(
		'.slides-live-preview-body-slot',
	);
	const headingSlotEl = args.slideContentEl.querySelector<HTMLElement>(
		'.slides-live-preview-heading-slot',
	);
	const slideContentStyle = window.getComputedStyle(args.slideContentEl);
	const sectionGapUnscaled = parsePixelValue(slideContentStyle.rowGap);

	return {
		mode: args.mode,
		baseWidth,
		baseHeight,
		effectiveScale,
		contentHeightUnscaled: args.zoomContentEl.scrollHeight,
		headingHeightUnscaled: headingSlotEl?.offsetHeight ?? 0,
		bodyHeightUnscaled: bodySlotEl?.scrollHeight ?? 0,
		sectionGapUnscaled,
	};
}

export function computeSlideLayoutGeometry(
	slide: SlideSegment,
	measurements: ReturnType<typeof measureSlideLayoutInputs>,
): SlideLayoutGeometry {
	const scaledContentHeight =
		measurements.contentHeightUnscaled * measurements.effectiveScale;
	let translateOffsetPx = 0;
	let bodyOffsetPx = 0;
	let finalScaledHeight = scaledContentHeight;

	if (slide.layout === 'section' && measurements.bodyHeightUnscaled > 0) {
		const headingHeight =
			measurements.headingHeightUnscaled * measurements.effectiveScale;
		const bodyHeight =
			measurements.bodyHeightUnscaled * measurements.effectiveScale;
		const sectionGap =
			measurements.sectionGapUnscaled * measurements.effectiveScale;

		// Center body as if heading did not exist, then avoid overlap with heading block.
		const centeredBodyTop = (measurements.baseHeight - bodyHeight) / 2;
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

	return {
		baseWidth: measurements.baseWidth,
		baseHeight: measurements.baseHeight,
		effectiveScale: measurements.effectiveScale,
		scaledContentHeight: finalScaledHeight,
		surfaceHeight,
		translateOffsetPx,
		bodyOffsetPx,
	};
}

function computeScaleNormalization(
	surfaceEl: HTMLElement,
	baseWidth: number,
	presentationReferenceWidth: number,
): number {
	if (presentationReferenceWidth <= 0) {
		return 1;
	}

	const computedStyle = window.getComputedStyle(surfaceEl);
	const horizontalPadding =
		parsePixelValue(computedStyle.paddingLeft) +
		parsePixelValue(computedStyle.paddingRight);
	const usableWidth = Math.max(1, baseWidth - horizontalPadding);
	const referenceUsableWidth = Math.max(
		1,
		presentationReferenceWidth - horizontalPadding,
	);
	return usableWidth / referenceUsableWidth;
}

function parsePixelValue(value: string): number {
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : 0;
}
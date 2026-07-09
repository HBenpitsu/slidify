export interface SlideLayoutKnobs {
	headerMarginEm: number;
	paragraphMarginEm: number;
	slidePaddingPx: number;
}

export interface SlideLayoutTuningParams {
	headerMarginBottomEm: number;
	paragraphMarginTopEm: number;
	paragraphMarginBottomEm: number;
	previewSurfacePaddingPx: number;
	presentationSurfacePaddingPx: number;
}

export const DEFAULT_SLIDE_LAYOUT_KNOBS: SlideLayoutKnobs = {
	headerMarginEm: 0.42,
	paragraphMarginEm: 0.5,
	slidePaddingPx: 16,
};

const LIMITS = {
	headerMarginEm: { min: 0, max: 2 },
	paragraphMarginEm: { min: 0, max: 2 },
	slidePaddingPx: { min: 0, max: 64 },
} as const;

export function normalizeSlideLayoutKnobs(
	input: Partial<SlideLayoutKnobs> | null | undefined,
): SlideLayoutKnobs {
	const source = input ?? {};
	return {
		headerMarginEm: normalizeNumber(
			source.headerMarginEm,
			DEFAULT_SLIDE_LAYOUT_KNOBS.headerMarginEm,
			LIMITS.headerMarginEm.min,
			LIMITS.headerMarginEm.max,
		),
		paragraphMarginEm: normalizeNumber(
			source.paragraphMarginEm,
			DEFAULT_SLIDE_LAYOUT_KNOBS.paragraphMarginEm,
			LIMITS.paragraphMarginEm.min,
			LIMITS.paragraphMarginEm.max,
		),
		slidePaddingPx: normalizeNumber(
			source.slidePaddingPx,
			DEFAULT_SLIDE_LAYOUT_KNOBS.slidePaddingPx,
			LIMITS.slidePaddingPx.min,
			LIMITS.slidePaddingPx.max,
		),
	};
}

export function resolveSlideLayoutTuningParams(
	knobs: SlideLayoutKnobs,
): SlideLayoutTuningParams {
	const normalized = normalizeSlideLayoutKnobs(knobs);
	return {
		headerMarginBottomEm: normalized.headerMarginEm,
		paragraphMarginTopEm: Number((normalized.paragraphMarginEm * 0.76).toFixed(3)),
		paragraphMarginBottomEm: Number((normalized.paragraphMarginEm * 1.24).toFixed(3)),
		previewSurfacePaddingPx: Number((normalized.slidePaddingPx * 0.7).toFixed(2)),
		presentationSurfacePaddingPx: normalized.slidePaddingPx,
	};
}

function normalizeNumber(
	value: number | undefined,
	fallback: number,
	min: number,
	max: number,
): number {
	if (!Number.isFinite(value)) {
		return fallback;
	}

	const safeValue = value as number;

	return Number(Math.min(max, Math.max(min, safeValue)).toFixed(3));
}

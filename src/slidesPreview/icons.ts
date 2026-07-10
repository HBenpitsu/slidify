import { getIcon } from 'obsidian';

export type SlidesPreviewIconName =
	| 'previous'
	| 'next'
	| 'present'
	| 'exit'
	| 'dockLeft'
	| 'dockRight'
	| 'zoomOut'
	| 'zoomIn'
	| 'zoomReset';

const STANDARD_ICON_ID_CANDIDATES: Record<SlidesPreviewIconName, string[]> = {
	previous: ['chevron-left', 'arrow-left'],
	next: ['chevron-right', 'arrow-right'],
	present: ['maximize', 'expand', 'monitor-up'],
	exit: ['minimize', 'minimize-2', 'shrink'],
	dockLeft: ['panel-left', 'sidebar-left', 'columns-2'],
	dockRight: ['panel-right', 'sidebar-right', 'columns-2'],
	zoomOut: ['zoom-out', 'search-minus', 'minus-circle'],
	zoomIn: ['zoom-in', 'search-plus', 'plus-circle'],
	zoomReset: ['rotate-ccw', 'refresh-ccw', 'locate-fixed'],
};

const warnedFallbackIcons = new Set<SlidesPreviewIconName>();

const FALLBACK_ICON_PATHS: Record<SlidesPreviewIconName, string> = {
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

export function createSlidesPreviewButtonIconSvg(
	icon: SlidesPreviewIconName,
): SVGSVGElement {
	const standardIconEl = resolveStandardIcon(icon);
	if (standardIconEl) {
		standardIconEl.classList.add('slides-live-preview-button-icon');
		standardIconEl.setAttribute('aria-hidden', 'true');
		return standardIconEl;
	}

	if (!warnedFallbackIcons.has(icon)) {
		console.warn('[Slidify] Falling back to custom SVG icon.', {
			icon,
			candidates: STANDARD_ICON_ID_CANDIDATES[icon],
		});
		warnedFallbackIcons.add(icon);
	}

	const namespace = 'http://www.w3.org/2000/svg';
	const svgEl = document.createElementNS(namespace, 'svg');
	svgEl.setAttribute('class', 'slides-live-preview-button-icon');
	svgEl.setAttribute('viewBox', '0 0 24 24');
	svgEl.setAttribute('aria-hidden', 'true');

	const pathEl = document.createElementNS(namespace, 'path');
	pathEl.setAttribute('d', FALLBACK_ICON_PATHS[icon]);
	pathEl.setAttribute('fill', 'none');
	pathEl.setAttribute('stroke', 'currentColor');
	pathEl.setAttribute('stroke-linecap', 'round');
	pathEl.setAttribute('stroke-linejoin', 'round');
	pathEl.setAttribute('stroke-width', '1.8');
	svgEl.appendChild(pathEl);

	return svgEl;
}

function resolveStandardIcon(icon: SlidesPreviewIconName): SVGSVGElement | null {
	const candidates = STANDARD_ICON_ID_CANDIDATES[icon];
	for (const id of candidates) {
		const directIcon = getIcon(id);
		if (directIcon) {
			return directIcon;
		}

		const prefixedIcon = getIcon(`lucide-${id}`);
		if (prefixedIcon) {
			return prefixedIcon;
		}
	}

	return null;
}
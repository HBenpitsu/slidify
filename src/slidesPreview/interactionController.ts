interface SlidesPreviewInteractionHandlersArgs {
	contentEl: HTMLElement;
	registerDomEvent: (
		target: Window | Document | HTMLElement,
		type: string,
		handler: (event: Event) => void,
	) => void;
	getCurrentSlideIndex: () => number;
	goToSlide: (nextIndex: number) => Promise<void>;
	togglePresentationMode: () => Promise<void>;
	multiplyContentScale: (multiplier: number) => Promise<void>;
	isPresenting: () => boolean;
	getWheelNavigationLockUntil: () => number;
	setWheelNavigationLockUntil: (lockUntil: number) => void;
	onFullscreenChanged: (isPresenting: boolean) => void;
	onViewportChanged: () => void;
	refresh: () => Promise<void>;
	contentScaleFactor: number;
}

export function registerSlidesPreviewInteractionHandlers(
	args: SlidesPreviewInteractionHandlersArgs,
): void {
	args.registerDomEvent(args.contentEl, 'click', () => {
		args.contentEl.focus();
	});

	args.registerDomEvent(args.contentEl, 'keydown', (event) => {
		if (!(event instanceof KeyboardEvent)) {
			return;
		}

		if (event.key === 'ArrowRight' || event.key === 'PageDown') {
			event.preventDefault();
			void args.goToSlide(args.getCurrentSlideIndex() + 1);
			return;
		}

		if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
			event.preventDefault();
			void args.goToSlide(args.getCurrentSlideIndex() - 1);
			return;
		}

		if (event.key.toLowerCase() === 'f') {
			event.preventDefault();
			void args.togglePresentationMode();
		}
	});

	args.registerDomEvent(args.contentEl, 'wheel', (event) => {
		if (!(event instanceof WheelEvent)) {
			return;
		}

		if (event.ctrlKey) {
			event.preventDefault();
			event.stopPropagation();
			void args.multiplyContentScale(
				event.deltaY > 0 ? 1 / args.contentScaleFactor : args.contentScaleFactor,
			);
			return;
		}

		if (!args.isPresenting()) {
			return;
		}

		const now = Date.now();
		if (now < args.getWheelNavigationLockUntil() || Math.abs(event.deltaY) < 12) {
			return;
		}

		event.preventDefault();
		args.setWheelNavigationLockUntil(now + 180);
		void args.goToSlide(args.getCurrentSlideIndex() + (event.deltaY > 0 ? 1 : -1));
	});

	args.registerDomEvent(document, 'fullscreenchange', () => {
		args.onFullscreenChanged(document.fullscreenElement === args.contentEl);
		args.onViewportChanged();
		void args.refresh();
	});

	args.registerDomEvent(window, 'resize', () => {
		args.onViewportChanged();
		void args.refresh();
	});
}
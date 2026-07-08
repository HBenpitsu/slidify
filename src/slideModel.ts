export type SlideLayout = 'hero' | 'section' | 'content';

export interface SlideSegment {
	content: string;
	startLine: number;
	endLine: number;
	layout: SlideLayout;
	firstHeadingLevel: number | null;
}

export function parseSlides(markdown: string, separator: string): SlideSegment[] {
	const { body, startLineOffset } = stripFrontmatter(markdown);
	const lines = body.split(/\r?\n/);
	const trimmedSeparator = separator.trim();

	if (!trimmedSeparator) {
		const content = body.trim();
		return content
			? [createSlideSegment(content, startLineOffset, startLineOffset + Math.max(lines.length - 1, 0))]
			: [];
	}

	const escapedSeparator = trimmedSeparator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const separatorRegex = new RegExp(`^\\s*${escapedSeparator}\\s*$`);
	const slides: SlideSegment[] = [];
	let segmentStart = 0;

	const pushSegment = (segmentEnd: number) => {
		const rawContent = lines.slice(segmentStart, segmentEnd).join('\n');
		const content = rawContent.trim();
		if (content) {
			slides.push(
				createSlideSegment(
					content,
					startLineOffset + segmentStart,
					startLineOffset + Math.max(segmentEnd - 1, segmentStart),
				),
			);
		}

		segmentStart = segmentEnd + 1;
	};

	for (const [index, line] of lines.entries()) {
		if (separatorRegex.test(line)) {
			pushSegment(index);
		}
	}

	pushSegment(lines.length);
	return slides;
}

export function findSlideIndexForLine(slides: SlideSegment[], line: number): number {
	for (const [index, slide] of slides.entries()) {
		if (line < slide.startLine) {
			return Math.max(0, index - 1);
		}

		if (line <= slide.endLine) {
			return index;
		}
	}

	return slides.length - 1;
}

function createSlideSegment(
	content: string,
	startLine: number,
	endLine: number,
): SlideSegment {
	const firstHeadingLevel = detectFirstHeadingLevel(content);
	return {
		content,
		startLine,
		endLine,
		firstHeadingLevel,
		layout: classifySlideLayout(firstHeadingLevel),
	};
}

function detectFirstHeadingLevel(content: string): number | null {
	for (const line of content.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) {
			continue;
		}

		const match = /^(#{1,6})\s+/.exec(trimmed);
		const headingToken = match?.[1];
		return headingToken ? headingToken.length : null;
	}

	return null;
}

function classifySlideLayout(firstHeadingLevel: number | null): SlideLayout {
	if (firstHeadingLevel === 1) {
		return 'hero';
	}

	if (firstHeadingLevel !== null) {
		return 'section';
	}

	return 'content';
}

function stripFrontmatter(markdown: string): { body: string; startLineOffset: number } {
	const lines = markdown.split(/\r?\n/);
	if (lines[0]?.trim() !== '---') {
		return { body: markdown, startLineOffset: 0 };
	}

	for (let index = 1; index < lines.length; index += 1) {
		const line = lines[index]?.trim();
		if (line === '---' || line === '...') {
			return {
				body: lines.slice(index + 1).join('\n'),
				startLineOffset: index + 1,
			};
		}
	}

	return { body: markdown, startLineOffset: 0 };
}
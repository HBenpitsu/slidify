export type SlideLayout = 'hero' | 'section' | 'content';

export interface SlideSegment {
	content: string;
	startLine: number;
	endLine: number;
	layout: SlideLayout;
	firstHeadingLevel: number | null;
	scaleMultiplier: number;
}

interface SlideDirectives {
	scaleMultiplier: number;
}

interface ParsedLeadingDirectives {
	directives: SlideDirectives;
	contentWithoutDirectives: string;
}

interface SlideDirectiveRule {
	parse: (payload: string) => number | null;
	apply: (value: number, directives: SlideDirectives) => void;
}

const DEFAULT_SLIDE_DIRECTIVES: SlideDirectives = {
	scaleMultiplier: 1,
};

const SCALE_DIRECTIVE_PAYLOAD_REGEX = /^(\d+(?:\.\d+)?)\s*%$/;

const SLIDE_DIRECTIVE_RULES: SlideDirectiveRule[] = [
	{
		parse: (payload) => {
			const normalizedPayload = payload
				.trim()
				.replace(/\s+/g, ' ');
			if (!normalizedPayload) {
				return null;
			}

			const scaleMatch = SCALE_DIRECTIVE_PAYLOAD_REGEX.exec(normalizedPayload);
			if (!scaleMatch) {
				return null;
			}

			const percentToken = scaleMatch[1];
			if (!percentToken) {
				return null;
			}

			const parsedPercent = Number.parseFloat(percentToken);
			if (!Number.isFinite(parsedPercent) || parsedPercent <= 0) {
				return null;
			}

			return parsedPercent;
		},
		apply: (scalePercent, directives) => {
			directives.scaleMultiplier = clampScaleMultiplier(scalePercent / 100);
		},
	},
];

export function parseSlides(markdown: string, separator: string): SlideSegment[] {
	const { body, startLineOffset } = stripFrontmatter(markdown);
	const lines = body.split(/\r?\n/);
	const trimmedSeparator = separator.trim();

	if (!trimmedSeparator) {
		const content = body.trim();
		return content
			? [
					createSlideSegment(
						content,
						startLineOffset,
						startLineOffset + Math.max(lines.length - 1, 0),
						DEFAULT_SLIDE_DIRECTIVES,
					),
				]
			: [];
	}

	const escapedSeparator = trimmedSeparator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const separatorRegex = new RegExp(`^\\s*${escapedSeparator}\\s*$`);
	const slides: SlideSegment[] = [];
	let segmentStart = 0;

	const pushSegment = (segmentEnd: number) => {
		const rawContent = lines.slice(segmentStart, segmentEnd).join('\n');
		const parsedDirectives = parseLeadingDirectives(rawContent);
		const content = parsedDirectives.contentWithoutDirectives.trim();
		if (content) {
			slides.push(
				createSlideSegment(
					content,
					startLineOffset + segmentStart,
					startLineOffset + Math.max(segmentEnd - 1, segmentStart),
					parsedDirectives.directives,
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
	directives: SlideDirectives,
): SlideSegment {
	const firstHeadingLevel = detectFirstHeadingLevel(content);
	return {
		content,
		startLine,
		endLine,
		firstHeadingLevel,
		layout: classifySlideLayout(firstHeadingLevel),
		scaleMultiplier: directives.scaleMultiplier,
	};
}

function parseLeadingDirectives(content: string): ParsedLeadingDirectives {
	const lines = content.split(/\r?\n/);
	const directives: SlideDirectives = { ...DEFAULT_SLIDE_DIRECTIVES };

	let firstContentIndex = 0;
	while (firstContentIndex < lines.length && !lines[firstContentIndex]?.trim()) {
		firstContentIndex += 1;
	}

	let directiveStart = firstContentIndex;
	let directiveEnd = directiveStart;
	while (directiveEnd < lines.length) {
		const parsedBlock = parseLeadingCommentBlock(lines, directiveEnd);
		if (!parsedBlock) {
			break;
		}

		applyDirectivePayload(parsedBlock.payload, directives);
		directiveEnd = parsedBlock.endLine + 1;

		while (directiveEnd < lines.length && !lines[directiveEnd]?.trim()) {
			directiveEnd += 1;
		}
	}

	if (directiveEnd === directiveStart) {
		return {
			directives,
			contentWithoutDirectives: content,
		};
	}

	const contentWithoutDirectives = [
		...lines.slice(0, directiveStart),
		...lines.slice(directiveEnd),
	].join('\n');

	return {
		directives,
		contentWithoutDirectives,
	};
}

function applyDirectivePayload(payload: string, directives: SlideDirectives): void {

	for (const rule of SLIDE_DIRECTIVE_RULES) {
		const parsedValue = rule.parse(payload);
		if (parsedValue === null) {
			continue;
		}

		rule.apply(parsedValue, directives);
		break;
	}
}

function parseLeadingCommentBlock(
	lines: string[],
	startLine: number,
): { payload: string; endLine: number } | null {
	const startRawLine = lines[startLine];
	if (startRawLine === undefined) {
		return null;
	}

	const openIndex = startRawLine.indexOf('%%');
	if (openIndex < 0) {
		return null;
	}

	if (startRawLine.slice(0, openIndex).trim()) {
		return null;
	}

	const afterOpen = startRawLine.slice(openIndex + 2);
	const inlineCloseIndex = afterOpen.indexOf('%%');
	if (inlineCloseIndex >= 0) {
		const payload = afterOpen.slice(0, inlineCloseIndex);
		return {
			payload,
			endLine: startLine,
		};
	}

	const payloadLines: string[] = [afterOpen];
	for (let lineIndex = startLine + 1; lineIndex < lines.length; lineIndex += 1) {
		const line = lines[lineIndex] ?? '';
		const closeIndex = line.indexOf('%%');
		if (closeIndex >= 0) {
			payloadLines.push(line.slice(0, closeIndex));
			return {
				payload: payloadLines.join('\n'),
				endLine: lineIndex,
			};
		}

		payloadLines.push(line);
	}

	return null;
}

function clampScaleMultiplier(multiplier: number): number {
	if (!Number.isFinite(multiplier)) {
		return DEFAULT_SLIDE_DIRECTIVES.scaleMultiplier;
	}

	return Math.min(4, Math.max(0.1, multiplier));
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
import { App, PluginSettingTab, Setting } from 'obsidian';
import {
	DEFAULT_SLIDE_LAYOUT_KNOBS,
	normalizeSlideLayoutKnobs,
} from './layoutParams';
import SlidesLivePreviewPlugin from './main';

export interface SlidesPreviewSettings {
	slideSeparator: string;
	defaultContentScalePercent: number;
	headerMarginEm: number;
	paragraphMarginEm: number;
	slidePaddingPx: number;
}

export const DEFAULT_SETTINGS: SlidesPreviewSettings = {
	slideSeparator: '---',
	defaultContentScalePercent: 100,
	headerMarginEm: DEFAULT_SLIDE_LAYOUT_KNOBS.headerMarginEm,
	paragraphMarginEm: DEFAULT_SLIDE_LAYOUT_KNOBS.paragraphMarginEm,
	slidePaddingPx: DEFAULT_SLIDE_LAYOUT_KNOBS.slidePaddingPx,
};

export class SlidesPreviewSettingTab extends PluginSettingTab {
	plugin: SlidesLivePreviewPlugin;

	constructor(app: App, plugin: SlidesLivePreviewPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions() {
		return [
			{
				name: 'Slide separator',
				desc: 'A line containing this value splits slides.',
				control: {
					type: 'text',
					key: 'slideSeparator',
					placeholder: '---',
					validate: (value: string) =>
						value.trim().length === 0 ? 'Slide separator cannot be empty.' : undefined,
				},
			},
			{
				name: 'Default content zoom (%)',
				desc: 'Default slide content zoom used on open and reset.',
				control: {
					type: 'number',
					key: 'defaultContentScalePercent',
					min: 50,
					max: 200,
					step: 1,
					placeholder: '100',
				},
			},
			{
				name: 'Header margin (em)',
				desc: 'Bottom margin for headings in slide content.',
				control: {
					type: 'number',
					key: 'headerMarginEm',
					min: 0,
					max: 2,
					step: 0.01,
				},
			},
			{
				name: 'Paragraph margin (em)',
				desc: 'Base paragraph margin used in slide content.',
				control: {
					type: 'number',
					key: 'paragraphMarginEm',
					min: 0,
					max: 2,
					step: 0.01,
				},
			},
			{
				name: 'Slide padding (px)',
				desc: 'Padding for slide surfaces in preview and presentation.',
				control: {
					type: 'number',
					key: 'slidePaddingPx',
					min: 0,
					max: 64,
					step: 0.5,
				},
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof SlidesPreviewSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings;

		switch (key) {
			case 'slideSeparator': {
				const nextValue = typeof value === 'string' ? value.trim() : '';
				settings.slideSeparator = nextValue || DEFAULT_SETTINGS.slideSeparator;
				break;
			}

			case 'defaultContentScalePercent': {
				const nextValue = Number(value);
				const normalized = Number.isFinite(nextValue)
					? Math.round(Math.min(200, Math.max(50, nextValue)))
					: DEFAULT_SETTINGS.defaultContentScalePercent;
				settings.defaultContentScalePercent = normalized;
				break;
			}

			case 'headerMarginEm':
			case 'paragraphMarginEm':
			case 'slidePaddingPx': {
				const normalizedKnobs = normalizeSlideLayoutKnobs({
					headerMarginEm:
						key === 'headerMarginEm' ? Number(value) : settings.headerMarginEm,
					paragraphMarginEm:
						key === 'paragraphMarginEm' ? Number(value) : settings.paragraphMarginEm,
					slidePaddingPx:
						key === 'slidePaddingPx' ? Number(value) : settings.slidePaddingPx,
				});
				settings.headerMarginEm = normalizedKnobs.headerMarginEm;
				settings.paragraphMarginEm = normalizedKnobs.paragraphMarginEm;
				settings.slidePaddingPx = normalizedKnobs.slidePaddingPx;
				break;
			}

			default:
				return;
		}

		await this.plugin.saveSettings();
		await this.plugin.refreshPreviewFromActiveContext();
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Slide separator')
			.setDesc('A line containing this value splits slides (default: ---).')
			.addText((text) =>
				text
					.setPlaceholder('---')
					.setValue(this.plugin.settings.slideSeparator)
					.onChange(async (value) => {
						this.plugin.settings.slideSeparator = value.trim() || '---';
						await this.plugin.saveSettings();
						await this.plugin.refreshPreviewFromActiveContext();
					}),
			);

		new Setting(containerEl)
			.setName('Default content zoom (%)')
			.setDesc('Default slide content zoom used on open and reset.')
			.addText((text) => {
				text.setPlaceholder('100');
				text.setValue(String(this.plugin.settings.defaultContentScalePercent));
				text.onChange(async (value) => {
					const parsed = Number.parseInt(value.trim(), 10);
					const normalized = Number.isFinite(parsed)
						? Math.min(200, Math.max(50, parsed))
						: DEFAULT_SETTINGS.defaultContentScalePercent;
					this.plugin.settings.defaultContentScalePercent = normalized;
					text.setValue(String(normalized));
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Header margin (em)')
			.setDesc('Bottom margin for headings in slide content.')
			.addText((text) => {
				text.setPlaceholder(String(DEFAULT_SETTINGS.headerMarginEm));
				text.setValue(String(this.plugin.settings.headerMarginEm));
				text.onChange(async (value) => {
					const parsed = Number.parseFloat(value.trim());
					const normalized = normalizeSlideLayoutKnobs({
						headerMarginEm: parsed,
						paragraphMarginEm: this.plugin.settings.paragraphMarginEm,
						slidePaddingPx: this.plugin.settings.slidePaddingPx,
					});
					this.plugin.settings.headerMarginEm = normalized.headerMarginEm;
					text.setValue(String(normalized.headerMarginEm));
					await this.plugin.saveSettings();
					await this.plugin.refreshPreviewFromActiveContext();
				});
			});

		new Setting(containerEl)
			.setName('Paragraph margin (em)')
			.setDesc('Base paragraph margin used in slide content.')
			.addText((text) => {
				text.setPlaceholder(String(DEFAULT_SETTINGS.paragraphMarginEm));
				text.setValue(String(this.plugin.settings.paragraphMarginEm));
				text.onChange(async (value) => {
					const parsed = Number.parseFloat(value.trim());
					const normalized = normalizeSlideLayoutKnobs({
						headerMarginEm: this.plugin.settings.headerMarginEm,
						paragraphMarginEm: parsed,
						slidePaddingPx: this.plugin.settings.slidePaddingPx,
					});
					this.plugin.settings.paragraphMarginEm = normalized.paragraphMarginEm;
					text.setValue(String(normalized.paragraphMarginEm));
					await this.plugin.saveSettings();
					await this.plugin.refreshPreviewFromActiveContext();
				});
			});

		new Setting(containerEl)
			.setName('Slide padding (px)')
			.setDesc('Padding for slide surfaces in presentation and preview.')
			.addText((text) => {
				text.setPlaceholder(String(DEFAULT_SETTINGS.slidePaddingPx));
				text.setValue(String(this.plugin.settings.slidePaddingPx));
				text.onChange(async (value) => {
					const parsed = Number.parseFloat(value.trim());
					const normalized = normalizeSlideLayoutKnobs({
						headerMarginEm: this.plugin.settings.headerMarginEm,
						paragraphMarginEm: this.plugin.settings.paragraphMarginEm,
						slidePaddingPx: parsed,
					});
					this.plugin.settings.slidePaddingPx = normalized.slidePaddingPx;
					text.setValue(String(normalized.slidePaddingPx));
					await this.plugin.saveSettings();
					await this.plugin.refreshPreviewFromActiveContext();
				});
			});
	}
}

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

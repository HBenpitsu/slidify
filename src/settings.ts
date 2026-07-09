import { App, PluginSettingTab, Setting } from 'obsidian';
import SlidesLivePreviewPlugin from './main';

export interface SlidesPreviewSettings {
	slideSeparator: string;
	defaultContentScalePercent: number;
}

export const DEFAULT_SETTINGS: SlidesPreviewSettings = {
	slideSeparator: '---',
	defaultContentScalePercent: 100,
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
	}
}

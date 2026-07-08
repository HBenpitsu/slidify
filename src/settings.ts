import { App, PluginSettingTab, Setting } from 'obsidian';
import SlidesLivePreviewPlugin from './main';

export interface SlidesPreviewSettings {
	slideSeparator: string;
	syncWithActiveFile: boolean;
	openPreviewOnStartup: boolean;
	openInVerticalSplit: boolean;
}

export const DEFAULT_SETTINGS: SlidesPreviewSettings = {
	slideSeparator: '---',
	syncWithActiveFile: true,
	openPreviewOnStartup: false,
	openInVerticalSplit: true,
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
			.setName('Sync with active file')
			.setDesc('Keep preview focused on the file currently being edited.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.syncWithActiveFile)
					.onChange(async (value) => {
						this.plugin.settings.syncWithActiveFile = value;
						await this.plugin.saveSettings();
						if (value) {
							await this.plugin.refreshPreviewFromActiveContext();
						}
					}),
			);

		new Setting(containerEl)
			.setName('Open preview when Obsidian starts')
			.setDesc('Automatically open the slides live preview pane on launch.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.openPreviewOnStartup)
					.onChange(async (value) => {
						this.plugin.settings.openPreviewOnStartup = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Use vertical split')
			.setDesc('Open the preview pane to the right instead of below.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.openInVerticalSplit)
					.onChange(async (value) => {
						this.plugin.settings.openInVerticalSplit = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}

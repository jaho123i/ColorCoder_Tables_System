import { PluginSettings } from './types/plugin-settings';
import { ColorCoderSettingTab } from './components/SettingsTab';

// Export the types that main.ts expects
export type ColorCoderSettings = PluginSettings;
export { ColorCoderSettingTab };

export const DEFAULT_SETTINGS: PluginSettings = {
	databaseFileName: 'ColorCoder-board',
	defaultBoardConfig: {
		schema: [],
		views: [],
	},
	colorRules: [],
	autoUpdateCreatedAt: true,
	createdAtFieldName: 'Created At',
	pageSize: 50,
	colorGroupPanels: false,
	cardFontSize: 14,
};

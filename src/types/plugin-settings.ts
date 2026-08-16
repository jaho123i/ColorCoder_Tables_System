import type {
	BoardConfig,
	ColumnSchema,
	ColumnType,
	SelectOption,
	NumberFormat,
	FilterOperator,
	FilterConfig,
	SortConfig,
	RollupFunction,
	AggregationType,
	ViewConfig,
	SwimlaneConfig,
	SegmentConfig,
	ColorRule,
	FolderArrangementConfig,
} from './index';

// Re-export the shared type system so existing imports from
// './types/plugin-settings' keep working. The canonical definitions live in
// './index' — there is exactly one ColumnType / ColumnSchema / ViewConfig etc.
export type {
	BoardConfig,
	ColumnSchema,
	ColumnType,
	SelectOption,
	NumberFormat,
	FilterOperator,
	FilterConfig,
	SortConfig,
	RollupFunction,
	AggregationType,
	ViewConfig,
	SwimlaneConfig,
	SegmentConfig,
	ColorRule,
	FolderArrangementConfig,
};

export interface PluginSettings {
	databaseFileName: string;
	defaultBoardConfig: BoardConfig;
	colorRules: ColorRule[];
	/** Properties the user explicitly removed; auto-adopt must not re-add them. */
	excludedProperties?: string[];
	/** Frontmatter key used for the auto-maintained "last edit" timestamp. */
	updatedAtFieldName?: string;
	/** Frontmatter key used for the auto-maintained "created" timestamp. */
	createdAtFieldName?: string;
	/** Whether the plugin stamps `updatedAtFieldName` whenever a task changes. */
	autoUpdateUpdatedAt?: boolean;
	/** Whether the plugin stamps `createdAt` when a task is created. */
	autoUpdateCreatedAt?: boolean;
	/** Max cards rendered per board column before a "Show more" control appears (0 = no limit). */
	pageSize?: number;
	/** Tint board group panels with the matching color rule (less intense). */
	colorGroupPanels?: boolean;
	/** Font size (px) for the main text on board cards. */
	cardFontSize?: number;
	/** Compact toolbar: Customize and Add task become icon-only buttons. */
	compactMode?: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	databaseFileName: 'ColorCoder-board',
	defaultBoardConfig: {
		schema: [],
		views: [],
	},
	colorRules: [],
	excludedProperties: [],
	updatedAtFieldName: 'Updated At',
	createdAtFieldName: 'Created At',
	autoUpdateUpdatedAt: true,
	autoUpdateCreatedAt: true,
	pageSize: 50,
	colorGroupPanels: false,
	cardFontSize: 14,
	compactMode: false,
};
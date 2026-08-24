export type ColumnType =
	| 'title'
	| 'text'
	| 'number'
	| 'select'
	| 'multiselect'
	| 'date'
	| 'datetime'
	| 'checkbox'
	| 'url'
	| 'email'
	| 'phone'
	| 'status'
	| 'formula'
	| 'relation'
	| 'lookup'
	| 'rollup'
	| 'image'
	| 'audio'
	| 'video'
	| 'reference'
	| 'lastEdit';

export interface SelectOption {
	value: string;
	color?: string;
}

export interface NumberFormat {
	decimals: number;
	thousandsSeparator: boolean;
	prefix?: string;
	suffix?: string;
}

export interface ColumnSchema {
	id: string;
	name: string;
	type: ColumnType;
	visible: boolean;
	width?: number;
	options?: SelectOption[];
	formula?: string;
	refBoardPath?: string;
	refColumnId?: string;
	refMatchColumnId?: string;
	pairedColumnId?: string;
	numberFormat?: NumberFormat;
	dateFormat?: string;
	withTime?: boolean;
	imageSourceFolder?: string;
	audioSourceFolder?: string;
	videoSourceFolder?: string;
	rollupRelationColumnId?: string;
	rollupTargetColumnId?: string;
	rollupFunction?: RollupFunction;
	isHierarchical?: boolean;
	wrap?: boolean;
	clip?: boolean;
	/** True when the user removed this property for this board/schema — auto-adopt must not re-add it. */
	excluded?: boolean;
	/** Last-edit fields: auto-update on task change and the frontmatter key to write. */
	autoUpdate?: boolean;
	fieldName?: string;
}

export type FilterOperator =
	| 'contains'
	| 'not_contains'
	| 'starts_with'
	| 'ends_with'
	| 'is'
	| 'is_not'
	| 'gt'
	| 'lt'
	| 'gte'
	| 'lte'
	| 'is_checked'
	| 'is_unchecked'
	| 'is_empty'
	| 'is_not_empty';

export interface FilterConfig {
	id: string;
	columnId: string;
	operator: FilterOperator;
	value: string;
}

export interface SortConfig {
	columnId: string;
	direction: 'asc' | 'desc';
}

export type RollupFunction = 'sum' | 'count' | 'avg' | 'min' | 'max' | 'count_values' | 'list';

export type AggregationType = 'none' | 'count' | 'count_values' | 'sum' | 'avg' | 'min' | 'max';

export interface SwimlaneConfig {
	id: string;
	name: string;
	columnId: string;
	value: string;
	collapsed?: boolean;
	color?: string;
}

export interface SegmentConfig {
	id: string;
	name: string;
	columnId: string;
	values: string[];
	color?: string;
}

export type ColorRuleKind = 'condition' | 'gradient';

/** Per-value override for a gradient rule: when `auto` is on the value is
 *  colored by its position in the gradient; when off a custom color is used. */
export interface GradientValueConfig {
	value: string;
	/** Auto-color: interpolated midpoint of the gradient. */
	auto: boolean;
	color?: string;
	/** Auto text-color: interpolated midpoint of the text gradient. */
	autoText: boolean;
	textColor?: string;
}

export interface ColorRule {
	id: string;
	name: string;
	/** How the rule colors cards: a match condition or a gradient over a
	 *  property's values. Defaults to 'condition' for legacy rules. */
	kind?: ColorRuleKind;
	columnId: string;
	operator: FilterOperator;
	value: string;
	backgroundColor: string;
	textColor: string;
	priority: number;
	// Gradient rule fields (when kind === 'gradient'):
	/** Ordered value list the gradient interpolates across (first and last are
	 *  the gradient ends and never get an override). */
	gradientValues?: GradientValueConfig[];
	/** Start/end colors of the background gradient. */
	gradientStart?: string;
	gradientEnd?: string;
	/** Start/end colors of the text gradient. */
	gradientTextStart?: string;
	gradientTextEnd?: string;
}

export interface ViewConfig {
	id: string;
	name?: string;
	type: 'table' | 'list' | 'board' | 'gallery' | 'calendar' | 'timeline' | 'chart';
	filters: FilterConfig[];
	sorts: SortConfig[];
	hiddenColumns: string[];
	columnWidths: Record<string, number>;
	activePills?: { id: string; columnId: string; operator: FilterOperator; value: string; conjunction?: 'and' | 'or' }[];
	pinnedColumnId?: string | null;
	columnOrder?: string[];
	rowHeight?: 'compact' | 'medium' | 'tall';
	aggregations?: Record<string, AggregationType>;
	wrapText?: boolean;
	groupByColumnId?: string;
	swimlaneColumnId?: string;
	swimlanes?: SwimlaneConfig[];
	boardColumnOrder?: string[];
	boardSwimlaneOrder?: string[];
	groupSortDirection?: 'asc' | 'desc';
	swimlaneSortDirection?: 'asc' | 'desc';
	/** How columns are ordered: 'stable' follows the property's option order
	 *  dynamically; 'custom' uses boardColumnOrder; 'asc'/'desc' alphabetical. */
	groupSortMode?: 'stable' | 'asc' | 'desc' | 'custom';
	swimlaneSortMode?: 'stable' | 'asc' | 'desc' | 'custom';
	cardFields?: string[];
	hiddenGroups?: string[];
	boardColumnLimits?: Record<string, number>;
	boardTaskOrder?: Record<string, string[]>;
	boardHideEmpty?: boolean;
	boardHideNoValue?: boolean;
	galleryCoverField?: string;
	galleryCardSize?: 'small' | 'medium' | 'large';
	calendarDateField?: string;
	calendarViewMode?: 'month' | 'week';
	timelineStartField?: string;
	timelineEndField?: string;
	timelineZoom?: 'days' | 'weeks' | 'months';
	timelineGroupByField?: string;
	includeSubfolders?: boolean;
	chartType?: 'bar' | 'pie' | 'line';
	chartXAxis?: string;
	chartYAxis?: string;
	chartAggregation?: 'count' | 'sum' | 'avg' | 'min' | 'max';
	rowOrder?: string[];
	conditionalFormats?: ColorRule[];
	filtersCollapsed?: boolean;
	segments?: SegmentConfig[];
	activeSegmentId?: string;
}

export interface FolderArrangementConfig {
	enabled: boolean;
	propertyIds: string[];
}

export interface BoardConfig {
	schema: ColumnSchema[];
	views: ViewConfig[];
	templatePath?: string;
	templateFolder?: string;
	askTemplateOnCreate?: boolean;
	folderArrangement?: FolderArrangementConfig;
	/** Per-board General settings — snapshotted from the plugin defaults when
	 *  the board is created; the global settings never override these later. */
	pageSize?: number;
	colorGroupPanels?: boolean;
	cardFontSize?: number;
	/** Compact toolbar: Customize and Add task become icon-only buttons. */
	compactMode?: boolean;
	/** Per-board timestamp field names (fall back to the canonical defaults). */
	createdAtFieldName?: string;
	updatedAtFieldName?: string;
	/** Per-board color rules — snapshotted from the plugin defaults when the
	 *  board is created; the global rules never override these later. */
	colorRules?: ColorRule[];
}

export const DEFAULT_VIEW: ViewConfig = {
	id: 'default',
	type: 'board',
	filters: [],
	sorts: [],
	hiddenColumns: [],
	columnWidths: {},
	pinnedColumnId: null,
	// No hardcoded group-by/swimlane defaults — the board resolves them from
	// the first detected user properties (see resolveGroupField/resolveSwimlaneField).
	boardHideEmpty: false,
	boardHideNoValue: false,
};

export const DEFAULT_BOARD_CONFIG: BoardConfig = {
	schema: [],
	views: [DEFAULT_VIEW],
};

export interface TaskFileSchema {
	_file: string;
	_title: string;
	_inlineFields?: Record<string, InlineFieldMeta>;
	[key: string]: unknown;
}

export interface InlineFieldMeta {
	format: 'standalone' | 'bracketed' | 'parenthesized';
	rawKey: string;
	rawValue: string;
	lineNumber: number;
	fullMatch: string;
}

export interface NoteRow {
	_file: string;
	_title: string;
	_inlineFields?: Record<string, InlineFieldMeta>;
	[key: string]: unknown;
}

export * from './task-schema';
export * from './plugin-settings';
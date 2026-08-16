# ColorCoder Tables

A 2D Kanban/Swimlane task board plugin for Obsidian with Task-as-File architecture, virtual grouping, and dynamic color coding.

## Features

- **Task-as-File Architecture**: Every task is a Markdown file with YAML frontmatter
- **2D Kanban Board**: Columns + collapsible swimlanes for multi-dimensional visualization
- **Virtual Grouping**: Group tasks by shared ID values across folders (solves the directory problem)
- **Dynamic Color Coding**: Visual mapping of colors to priority, time-remaining, and custom properties
- **Segmented Views**: Split/bucket board segments by project type, duration, or custom criteria
- **Dark-mode Native Styling**: Matches Notion's aesthetic with Obsidian CSS variables
- **Notion Import Integration**: Seamless migration from Notion databases

## Installation

### For users (add to a vault)

Copy these 3 built files from the repo into your vault's plugin folder:

```
main.js            → <vault>/.obsidian/plugins/colorcoder-tables/main.js
manifest.json      → <vault>/.obsidian/plugins/colorcoder-tables/manifest.json
styles.css         → <vault>/.obsidian/plugins/colorcoder-tables/styles.css
```

Then enable **ColorCoder Tables** in Obsidian → Settings → Community plugins.

### For developers

1. Clone this repository into your Obsidian vault's `.obsidian/plugins/colorcoder-tables` folder
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the plugin
4. Enable "ColorCoder Tables" in Obsidian's Community Plugins settings

## Quick Start

1. **Create a board in the folder you want** — run the command *Create ColorCoder Board* (or right-click a folder → *Create ColorCoder board here*). Pick the folder, and a board file (`<name>-board.md`) is created there. Boards show tasks from that folder **and all subfolders**.
2. **Add tasks** — open the board, then run *Quick Add Task*: pick the board, give the task a title, status, and priority. Each task is a Markdown file with YAML frontmatter next to the board.
3. **Move cards** — drag a card between columns to change its status (the file's `status` field updates), or between swimlanes to change its priority.
4. **Color coding** — configure rules in Settings → ColorCoder Tables: name a property, operator, and value, and cards matching it get your background/text colors.
5. **Import from Notion** — export a Notion database as **Markdown & CSV**, then run the command *Import Notion Export*. Pick the export folder, then the destination vault folder. Every exported row note with frontmatter becomes a task (its `Status`, `Priority` (`!!!`/`!!`/`!`), and `Time` are mapped to the board's fields; other properties are preserved), database pages are skipped, and a board is created in the destination.

## Development

```bash
# Install dependencies
npm install

# Development mode (watch)
npm run dev

# Production build
npm run build

# Run tests
npm test

# Lint
npm run lint
```

## Project Structure

```
src/
├── main.ts                 # Plugin entry point
├── core/                   # Core business logic
│   ├── ColorCoderManager.ts
│   ├── VirtualGroupingEngine.ts
│   ├── ColorCodingEngine.ts
│   └── SegmentedViewEngine.ts
├── components/             # React components
│   ├── ColorCoderView.tsx
│   ├── BoardColumn.tsx
│   ├── BoardSwimlane.tsx
│   ├── BoardCard.tsx
│   ├── BoardToolbar.tsx
│   └── BoardSegmentTabs.tsx
├── hooks/                  # Custom React hooks
├── types/                  # TypeScript types
│   ├── task-schema.ts
│   ├── board-config.ts
│   └── index.ts
├── utils/                  # Utility functions
├── settings/               # Settings UI
├── core/notion-importer.ts # Notion export → task conversion
└── modals/                 # Modal dialogs (board picker, quick add, folder picker, Notion import)
```

## Configuration

Each board is a Markdown file (`<name>-board.md`) whose frontmatter stores the board schema and view settings:

```yaml
---
schema: []
views: [{"id":"default","type":"board","filters":[],"sorts":[],"groupByColumnId":"status","swimlaneColumnId":"priority","boardColumnOrder":["Todo","In Progress","Done"],"boardHideEmpty":false,"boardHideNoValue":false}]
---
```

Tasks are Markdown files with frontmatter in the same folder:

```yaml
---
id: task-123
title: Buy milk
status: todo          # todo | in-progress | done | blocked | cancelled
priority: high        # low | medium | high | critical
timeRemaining: < 15 min
projectId: ""
tags: []
dueDate: ""
assignee: ""
createdAt: 2026-01-01T00:00:00.000Z
updatedAt: 2026-01-01T00:00:00.000Z
---
```

## License

MIT
> **注記: この文書は実装前(着手時)の計画メモで、履歴として残している。** 計画の部品(`PreviewViewer.svelte` / `PreviewSettings.svelte` / `ManuscriptGrid.svelte`)は、エディタ内のプレビューとして実装済み。その後に、作品全体を通して読む「通読」(`src/routes/project/[id]/preview/+page.svelte`、`src/lib/components/preview/ManuscriptReader.svelte`、原稿の組み立ては `src/lib/utils/manuscript.ts`)が加わったが、この文書には書かれていない。計画と実装が食い違う場合は、コードと [UI_GUIDELINES.md](UI_GUIDELINES.md) を正とする。

Preview Viewer Implementation
Analyze existing project structure and data models
Design Preview Component
Implement Core Preview Layout
Vertical/Horizontal toggle
Basic text rendering
Integrate Preview into Editor Page
Split view / Toggle logic
Responsive layout
Implement Display Settings
Font size, line height, line length control
Font selection
Text orientation (upright/rotated)
Implement Manuscript Paper Mode
Grid overlay/background
Character alignment
Implement Advanced Text Formatting
Ruby (Furigana) support
Bouten (Emphasis dots) support
Implement Pagination and Line Numbers
Verify and Polish

Preview Viewer Implementation Plan
Goal Description
Implement a preview viewer for the writing application that supports vertical/horizontal text, manuscript paper layout, ruby characters, and emphasis dots. It should allow customization of display settings like font size and characters per line.

User Review Required
Integration: The preview will be integrated into the editor page for real-time feedback, responsive to screen size (split view or toggle).
Data Source: Need to ensure the editor state is shared with the preview component efficiently.
Proposed Changes
Components
[NEW]
src/lib/components/preview/PreviewViewer.svelte
Main component for rendering the preview.
Props: content, settings.
[NEW]
src/lib/components/preview/PreviewSettings.svelte
UI controls for toggling modes, adjusting sizes, etc.
New Setting: Text orientation for alphanumeric characters in vertical mode (upright vs rotated).
[NEW]
src/lib/components/preview/ManuscriptGrid.svelte
Component to render the manuscript paper background/grid.
Routes
[MODIFY]
src/routes/project/[id]/editor/+page.svelte
Integrate PreviewViewer alongside the editor.
Add logic to toggle preview visibility or adjust layout based on screen size.
Styling
Use Master CSS for styling (e.g., jc:center, ai:center, flex:col).
Use CSS writing-mode: vertical-rl for vertical text.
Use text-orientation and text-combine-upright for controlling character rotation.
Use CSS Grid or specific background patterns for manuscript paper.
Use HTML <ruby> tags for furigana.
Use text-emphasis style for bouten.
Verification Plan
Manual Verification
Open the editor.
Verify real-time updates in the preview pane.
Toggle Vertical/Horizontal.
Test Text Orientation: Check how numbers/English text behave with the new setting.
Change font size and verify layout updates.
Enable Manuscript Paper mode and check alignment.
Verify Ruby and Bouten rendering with sample text.

## 通読プレビュー（作品全体）

`/project/[id]/preview`。章の順・各章内のシーンの順（order）で全シーンを連続表示する読み取り専用の画面。

- 並べ替え・目次・文字数の累計・進捗は `src/lib/utils/manuscript.ts`（純粋関数、テストあり）。章に属さないシーンは末尾の擬似章にまとめる。
- 表示は `src/lib/components/preview/ManuscriptReader.svelte`。本文は IntersectionObserver で画面の近くに来たシーンだけ描画し、未描画のシーンは行数からの見積りの大きさで場所を確保する。ジャンプ・復元は、描画による大きさの変化を数フレーム追いかけて補正する。原稿用紙モードは対象外。
- 読んだ位置（シーン + シーン内の割合）は `storift:manuscript-pos:<projectId>`、縦横・文字サイズは `storift:manuscript-prefs` に端末内保存。
- 共有プロジェクトは Dexie の `content`（CRDT のミラー）を表示する。
- E2E: `bun run test:e2e:preview`（Firebase 不要）。

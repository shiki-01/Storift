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
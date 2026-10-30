<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import {
		SvelteFlow,
		Background,
		Controls,
		Panel,
		ConnectionMode,
		MarkerType,
		type Node,
		type Edge,
		type Viewport
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { v4 as uuidv4 } from 'uuid';
	import { charactersDB, relationMapsDB } from '$lib/db';
	import { queueChange } from '$lib/services/sync.service';
	import type { Character, RelationCurve, RelationMap } from '$lib/types';
	import {
		RELATION_COLORS,
		RELATION_CURVES,
		buildEdgeSpecs,
		circleLayout,
		curveToEdgeType,
		edgeStyleKey,
		insideRect
	} from '$lib/utils/relationGraph';
	import Sheet from '$lib/components/mobile/Sheet.svelte';
	import CharacterNode from './CharacterNode.svelte';
	import GroupNode from './GroupNode.svelte';

	interface Props {
		characters: Character[];
		projectId: string;
		/** 関係を変更したあとに呼ばれる(キャラクターの再読み込み用) */
		onChanged?: () => void | Promise<void>;
		onOpenCharacter?: (character: Character) => void;
	}

	let { characters, projectId, onChanged, onOpenCharacter }: Props = $props();

	const nodeTypes = { character: CharacterNode, region: GroupNode };
	const NODE_W = 96;
	const NODE_H = 88;

	let map = $state<RelationMap | null>(null);
	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let fullscreen = $state(false);
	let viewport = $state<Viewport>({ x: 0, y: 0, zoom: 1 });
	let canvasEl = $state<HTMLDivElement | null>(null);

	// --- 編集シート ---
	type Editor =
		| { kind: 'new'; from: string; to: string }
		| { kind: 'edge'; from: string; to: string; index: number; label: string }
		| { kind: 'group'; id: string };
	let editor = $state<Editor | null>(null);
	let sheetOpen = $state(false);
	let draftLabel = $state('');
	let draftColor = $state<string>(RELATION_COLORS[0]);
	let draftCurve = $state<RelationCurve>('bezier');
	let busy = $state(false);

	let nameOf = $derived((id: string) => characters.find((c) => c.id === id)?.name ?? '?');

	onMount(async () => {
		map = await relationMapsDB.get(projectId);
		rebuild();
	});

	// キャラクターが増減・更新されたらノードと線を作り直す(位置などの map は参照のみ)
	$effect(() => {
		void characters;
		if (!untrack(() => map)) return;
		untrack(rebuild);
	});

	function handleSides(a: { x: number; y: number }, b: { x: number; y: number }) {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		if (Math.abs(dx) > Math.abs(dy)) {
			return dx > 0 ? { source: 'right', target: 'left' } : { source: 'left', target: 'right' };
		}
		return dy > 0 ? { source: 'bottom', target: 'top' } : { source: 'top', target: 'bottom' };
	}

	function rebuild() {
		if (!map) return;
		const positions = circleLayout(
			characters.map((c) => c.id),
			map.positions
		);
		const placedNew = Object.keys(positions).length !== Object.keys(map.positions).length;
		map = { ...map, positions };

		const groupNodes: Node[] = map.groups.map((g) => ({
			id: `g:${g.id}`,
			type: 'region',
			position: { x: g.x, y: g.y },
			width: g.width,
			height: g.height,
			zIndex: 0,
			data: { label: g.label, color: g.color, onResizeEnd: persist }
		}));
		const characterNodes: Node[] = characters.map((c) => ({
			id: c.id,
			type: 'character',
			position: positions[c.id],
			zIndex: 1,
			data: { name: c.name, role: c.role, imageUrl: c.imageUrl }
		}));
		nodes = [...groupNodes, ...characterNodes];
		rebuildEdges();
		if (placedNew) void relationMapsDB.save(map);
	}

	function rebuildEdges() {
		if (!map) return;
		const pos = (id: string) => nodes.find((n) => n.id === id)?.position ?? map!.positions[id];
		edges = buildEdgeSpecs(characters, map.edgeStyles).map((s) => {
			const sides = handleSides(pos(s.source) ?? { x: 0, y: 0 }, pos(s.target) ?? { x: 0, y: 0 });
			return {
				id: s.id,
				source: s.source,
				target: s.target,
				sourceHandle: sides.source,
				targetHandle: sides.target,
				type: curveToEdgeType(s.curve),
				label: s.label,
				style: `stroke:${s.color};stroke-width:2;`,
				labelStyle: `fill:${s.color};font-weight:600;`,
				markerEnd: { type: MarkerType.ArrowClosed, color: s.color },
				data: { from: s.source, to: s.target, index: s.index, label: s.label }
			} satisfies Edge;
		});
	}

	// --- 配置の保存 ---
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	function persist() {
		if (!map) return;
		const positions = { ...map.positions };
		const groups = [...map.groups];
		for (const n of nodes) {
			if (n.type === 'character') {
				positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) };
			} else if (n.type === 'region') {
				const i = groups.findIndex((g) => `g:${g.id}` === n.id);
				if (i === -1) continue;
				groups[i] = {
					...groups[i],
					x: Math.round(n.position.x),
					y: Math.round(n.position.y),
					width: Math.round(n.width ?? n.measured?.width ?? groups[i].width),
					height: Math.round(n.height ?? n.measured?.height ?? groups[i].height)
				};
			}
		}
		map = { ...map, positions, groups };
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			if (map) void relationMapsDB.save(map);
		}, 300);
	}

	// --- グループを動かすと、中のキャラクターも一緒に動かす ---
	let dragCtx: {
		groupId: string;
		start: { x: number; y: number };
		contained: Map<string, { x: number; y: number }>;
	} | null = null;

	function onNodeDragStart({ targetNode }: { targetNode: Node | null }) {
		if (!targetNode || targetNode.type !== 'region') {
			dragCtx = null;
			return;
		}
		const rect = {
			x: targetNode.position.x,
			y: targetNode.position.y,
			width: targetNode.width ?? targetNode.measured?.width ?? 320,
			height: targetNode.height ?? targetNode.measured?.height ?? 220
		};
		const contained = new Map<string, { x: number; y: number }>();
		for (const n of nodes) {
			if (
				n.type === 'character' &&
				insideRect(n.position.x + NODE_W / 2, n.position.y + NODE_H / 2, rect)
			) {
				contained.set(n.id, { ...n.position });
			}
		}
		dragCtx = { groupId: targetNode.id, start: { ...targetNode.position }, contained };
	}

	function onNodeDrag({ targetNode }: { targetNode: Node | null }) {
		if (!dragCtx || !targetNode || targetNode.id !== dragCtx.groupId) return;
		const dx = targetNode.position.x - dragCtx.start.x;
		const dy = targetNode.position.y - dragCtx.start.y;
		const ctx = dragCtx;
		nodes = nodes.map((n) => {
			const base = ctx.contained.get(n.id);
			return base ? { ...n, position: { x: base.x + dx, y: base.y + dy } } : n;
		});
	}

	function onNodeDragStop() {
		dragCtx = null;
		persist();
		rebuildEdges();
	}

	// --- 操作 ---
	function openSheet(next: Editor, label: string, color: string, curve: RelationCurve) {
		editor = next;
		draftLabel = label;
		draftColor = color;
		draftCurve = curve;
		sheetOpen = true;
	}

	function onBeforeConnect(connection: { source: string; target: string }) {
		if (connection.source !== connection.target) {
			openSheet(
				{ kind: 'new', from: connection.source, to: connection.target },
				'',
				RELATION_COLORS[0],
				'bezier'
			);
		}
		return false as const; // 線は保存後に characters から描く
	}

	// 線そのものでもラベルでも、選択された時点で編集シートを開く
	function onSelectionChange({
		nodes: selNodes,
		edges: selEdges
	}: {
		nodes: Node[];
		edges: Edge[];
	}) {
		if (sheetOpen || selNodes.length > 0 || selEdges.length !== 1) return;
		openEdgeEditor(selEdges[0]);
	}

	function openEdgeEditor(edge: Edge) {
		const data = edge.data as { from: string; to: string; index: number; label: string };
		const style = map?.edgeStyles[edgeStyleKey(data.from, data.to, data.label)];
		openSheet(
			{ kind: 'edge', from: data.from, to: data.to, index: data.index, label: data.label },
			data.label,
			style?.color ?? RELATION_COLORS[0],
			style?.curve ?? 'bezier'
		);
	}

	function onNodeClick({ node }: { node: Node }) {
		if (node.type === 'region') {
			const group = map?.groups.find((g) => `g:${g.id}` === node.id);
			if (group) openSheet({ kind: 'group', id: group.id }, group.label, group.color, 'bezier');
		} else {
			const character = characters.find((c) => c.id === node.id);
			if (character) onOpenCharacter?.(character);
		}
	}

	function addGroup() {
		if (!map) return;
		const w = canvasEl?.clientWidth ?? 600;
		const h = canvasEl?.clientHeight ?? 400;
		const width = 320;
		const height = 220;
		const cx = (w / 2 - viewport.x) / viewport.zoom;
		const cy = (h / 2 - viewport.y) / viewport.zoom;
		const group = {
			id: uuidv4(),
			label: 'グループ',
			color: RELATION_COLORS[1],
			x: Math.round(cx - width / 2),
			y: Math.round(cy - height / 2),
			width,
			height
		};
		map = { ...map, groups: [...map.groups, group] };
		void relationMapsDB.save(map);
		rebuild();
		openSheet({ kind: 'group', id: group.id }, group.label, group.color, 'bezier');
	}

	function autoLayout() {
		if (!map) return;
		map = {
			...map,
			positions: circleLayout(
				characters.map((c) => c.id),
				{}
			)
		};
		void relationMapsDB.save(map);
		rebuild();
	}

	function plainRelationships(c: Character) {
		return c.relationships.map((r) => ({ characterId: r.characterId, relation: r.relation }));
	}

	async function writeRelationships(
		characterId: string,
		relationships: Character['relationships']
	) {
		await charactersDB.update(characterId, { relationships });
		await queueChange('characters', characterId, 'update');
	}

	async function save() {
		if (!editor || !map || busy) return;
		busy = true;
		try {
			const label = draftLabel.trim();
			if (editor.kind === 'group') {
				const id = editor.id;
				map = {
					...map,
					groups: map.groups.map((g) =>
						g.id === id ? { ...g, label: label || 'グループ', color: draftColor } : g
					)
				};
				await relationMapsDB.save(map);
				rebuild();
			} else {
				if (!label) return;
				const current = editor;
				const from = characters.find((c) => c.id === current.from);
				if (!from) return;
				const styles = { ...map.edgeStyles };
				const rels = plainRelationships(from);
				if (editor.kind === 'new') {
					rels.push({ characterId: editor.to, relation: label });
				} else {
					delete styles[edgeStyleKey(editor.from, editor.to, editor.label)];
					rels[editor.index] = { characterId: editor.to, relation: label };
				}
				styles[edgeStyleKey(editor.from, editor.to, label)] = {
					color: draftColor,
					curve: draftCurve
				};
				map = { ...map, edgeStyles: styles };
				await relationMapsDB.save(map);
				await writeRelationships(from.id, rels);
				await onChanged?.();
			}
			sheetOpen = false;
		} catch (error) {
			console.error('Failed to save relation:', error);
		} finally {
			busy = false;
		}
	}

	async function remove() {
		if (!editor || !map || busy) return;
		busy = true;
		try {
			if (editor.kind === 'group') {
				const id = editor.id;
				map = { ...map, groups: map.groups.filter((g) => g.id !== id) };
				await relationMapsDB.save(map);
				rebuild();
			} else if (editor.kind === 'edge') {
				const current = editor;
				const from = characters.find((c) => c.id === current.from);
				if (!from) return;
				const styles = { ...map.edgeStyles };
				delete styles[edgeStyleKey(editor.from, editor.to, editor.label)];
				map = { ...map, edgeStyles: styles };
				await relationMapsDB.save(map);
				const idx = editor.index;
				await writeRelationships(
					from.id,
					plainRelationships(from).filter((_, i) => i !== idx)
				);
				await onChanged?.();
			}
			sheetOpen = false;
		} catch (error) {
			console.error('Failed to remove:', error);
		} finally {
			busy = false;
		}
	}

	$effect(() => {
		if (!fullscreen) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape' && !sheetOpen) fullscreen = false;
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	let sheetTitle = $derived(
		editor?.kind === 'group'
			? 'グループ'
			: editor?.kind === 'new'
				? `${nameOf(editor.from)} → ${nameOf(editor.to)}`
				: editor?.kind === 'edge'
					? `${nameOf(editor.from)} → ${nameOf(editor.to)}`
					: ''
	);
</script>

<div class="canvas" class:full={fullscreen} bind:this={canvasEl}>
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		fitView
		fitViewOptions={{ padding: 0.25 }}
		minZoom={0.3}
		maxZoom={2}
		connectionMode={ConnectionMode.Loose}
		connectionRadius={70}
		deleteKey={null}
		proOptions={{ hideAttribution: true }}
		onbeforeconnect={onBeforeConnect}
		onselectionchange={onSelectionChange}
		onnodeclick={onNodeClick}
		onnodedragstart={onNodeDragStart}
		onnodedrag={onNodeDrag}
		onnodedragstop={onNodeDragStop}
		onmoveend={(_, vp) => (viewport = vp)}
	>
		<Background gap={22} />
		<Controls showLock={false} />
		<Panel position="top-left">
			<div class="tools">
				<button onclick={addGroup}>＋ グループ</button>
				<button onclick={autoLayout}>自動配置</button>
				<button onclick={() => (fullscreen = !fullscreen)}>
					{fullscreen ? '閉じる' : '全画面'}
				</button>
			</div>
		</Panel>
		<Panel position="bottom-center">
			<p class="hint">
				{#if characters.length < 2}
					キャラクターを2人以上作ると関係を結べます
				{:else}
					丸い点から別のキャラクターへドラッグして関係を作成 / 線をタップして編集
				{/if}
			</p>
		</Panel>
	</SvelteFlow>
</div>

<Sheet
	bind:open={sheetOpen}
	title={sheetTitle}
	size="auto"
	onClose={() => {
		editor = null;
		// 選択を解除して、同じ線をもう一度タップしても開けるようにする
		edges = edges.map((e) => (e.selected ? { ...e, selected: false } : e));
	}}
>
	{#if editor}
		<form
			class="form"
			onsubmit={(e) => {
				e.preventDefault();
				void save();
			}}
		>
			<label class="field">
				<span>{editor.kind === 'group' ? 'グループ名' : '関係(例: 幼なじみ)'}</span>
				<input
					type="text"
					bind:value={draftLabel}
					placeholder={editor.kind === 'group' ? 'グループ' : '関係'}
				/>
			</label>

			<div class="field">
				<span>色</span>
				<div class="swatches">
					{#each RELATION_COLORS as color (color)}
						<button
							type="button"
							class="swatch"
							class:on={draftColor === color}
							style:background={color}
							aria-label={`色 ${color}`}
							aria-pressed={draftColor === color}
							onclick={() => (draftColor = color)}
						></button>
					{/each}
				</div>
			</div>

			{#if editor.kind !== 'group'}
				<div class="field">
					<span>線の形</span>
					<div class="seg" role="group" aria-label="線の形">
						{#each RELATION_CURVES as curve (curve.id)}
							<button
								type="button"
								class:on={draftCurve === curve.id}
								onclick={() => (draftCurve = curve.id)}
							>
								{curve.label}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<div class="actions">
				{#if editor.kind !== 'new'}
					<button type="button" class="danger" onclick={remove} disabled={busy}>削除</button>
				{/if}
				<button
					type="submit"
					class="primary"
					disabled={busy || (editor.kind !== 'group' && !draftLabel.trim())}
				>
					{editor.kind === 'new' ? '追加' : '保存'}
				</button>
			</div>
		</form>
	{/if}
</Sheet>

<style>
	.canvas {
		position: relative;
		width: 100%;
		height: 70dvh;
		min-height: 420px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		overflow: hidden;
		background: var(--color-background);
		--xy-background-color: var(--color-background);
		--xy-background-pattern-dots-color-default: var(--color-border);
		--xy-edge-label-background-color-default: var(--color-background);
		--xy-edge-label-color-default: var(--color-text);
		--xy-controls-button-background-color-default: var(--color-background);
		--xy-controls-button-color-default: var(--color-text);
		--xy-controls-button-border-color-default: var(--color-border);
		--xy-minimap-background-color-default: var(--color-surface);
	}

	@media (max-width: 768px) {
		.canvas {
			height: calc(100dvh - 200px);
		}
	}

	.canvas.full {
		position: fixed;
		inset: 0;
		z-index: 800;
		height: auto;
		min-height: 0;
		border: none;
		border-radius: 0;
		padding-top: var(--safe-top);
		padding-bottom: var(--safe-bottom);
	}

	.canvas :global(.svelte-flow) {
		background: var(--color-background);
	}

	/* normal.css の svg { max-width: 100% } だと、幅 0 の親の中でエッジの svg が描画されなくなる */
	.canvas :global(svg) {
		max-width: none;
	}

	.tools {
		display: flex;
		gap: 6px;
	}

	.tools button {
		height: 34px;
		padding: 0 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: var(--color-text);
		font-size: 13px;
		cursor: pointer;
	}

	.hint {
		margin: 0 0 8px;
		padding: 4px 10px;
		border-radius: 999px;
		background: color-mix(in srgb, var(--color-background) 88%, transparent);
		font-size: 11px;
		color: var(--color-text-secondary);
		text-align: center;
	}

	.form {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 0 16px 16px;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.field input[type='text'] {
		padding: 10px 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: var(--color-text);
		font-size: 16px;
		font-family: inherit;
	}

	.swatches {
		display: flex;
		gap: 10px;
	}

	.swatch {
		width: 32px;
		height: 32px;
		border-radius: 50%;
		border: 2px solid var(--color-background);
		box-shadow: 0 0 0 1px var(--color-border);
		cursor: pointer;
	}

	.swatch.on {
		box-shadow: 0 0 0 2px var(--color-text);
	}

	.seg {
		display: flex;
		gap: 4px;
		padding: 3px;
		border-radius: 10px;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
	}

	.seg button {
		flex: 1;
		height: 34px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: var(--color-text-secondary);
		font-size: 13px;
		cursor: pointer;
	}

	.seg button.on {
		background: var(--color-background);
		color: var(--color-text);
		font-weight: 600;
	}

	.actions {
		display: flex;
		gap: 8px;
	}

	.actions button {
		height: 44px;
		padding: 0 18px;
		border-radius: 12px;
		font-size: 14px;
		cursor: pointer;
	}

	.actions .primary {
		flex: 1;
		border: none;
		background: var(--color-primary);
		color: var(--color-background);
		font-weight: 600;
	}

	.actions .primary:disabled {
		opacity: 0.4;
	}

	.actions .danger {
		border: 1px solid var(--color-border);
		background: var(--color-background);
		color: var(--color-error);
	}
</style>

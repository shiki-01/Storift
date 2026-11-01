<script lang="ts" module>
	import type { RelationCurve } from '$lib/types';

	export interface RelationEdgeData {
		curve: RelationCurve;
		color: string;
		/** 中点からの制御点のずれ(既定値を解決済み) */
		offset: { x: number; y: number };
		/** null は既定値へ戻す */
		onOffsetChange: (offset: { x: number; y: number } | null) => void;
	}
</script>

<script lang="ts">
	import {
		BaseEdge,
		EdgeLabel,
		getBezierPath,
		getSmoothStepPath,
		getStraightPath,
		useSvelteFlow,
		type EdgeProps
	} from '@xyflow/svelte';

	type Point = { x: number; y: number };

	/** ラベルは制御点の少し上に置き、アンカーと重ならないようにする */
	const LABEL_GAP = 16;

	let {
		sourceX,
		sourceY,
		sourcePosition,
		targetX,
		targetY,
		targetPosition,
		label,
		style,
		markerEnd,
		selected = false,
		data: rawData
	}: EdgeProps = $props();

	// EdgeTypes の型に合わせて Record で受け、RelationCanvas が作る形として扱う
	const data = $derived(rawData as unknown as RelationEdgeData);

	const { screenToFlowPosition } = useSvelteFlow();

	let dragOffset = $state<Point | null>(null);
	let hovered = $state(false);
	let drag: { start: Point; origin: Point; moved: boolean } | null = null;

	const mid = $derived({ x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 });
	const offset = $derived(dragOffset ?? data.offset);
	/** 制御点 C = 中点 + ずれ */
	const control = $derived({ x: mid.x + offset.x, y: mid.y + offset.y });

	const path = $derived.by(() => {
		if (offset.x !== 0 || offset.y !== 0) {
			// 中点が C を通る二次ベジェ。制御点は Q = 2C - M
			const qx = 2 * control.x - mid.x;
			const qy = 2 * control.y - mid.y;
			return `M ${sourceX} ${sourceY} Q ${qx} ${qy} ${targetX} ${targetY}`;
		}
		// ずれが 0 のときは従来の組み込みパスと同じ形にする
		const params = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
		switch (data.curve) {
			case 'straight':
				return getStraightPath(params)[0];
			case 'step':
				return getSmoothStepPath({ ...params, borderRadius: 0 })[0];
			case 'smoothstep':
				return getSmoothStepPath(params)[0];
			default:
				return getBezierPath(params)[0];
		}
	});

	function flowPoint(e: PointerEvent): Point {
		return screenToFlowPosition({ x: e.clientX, y: e.clientY });
	}

	function onAnchorDown(e: PointerEvent) {
		if (e.button !== 0) return;
		e.stopPropagation();
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		drag = { start: flowPoint(e), origin: { ...offset }, moved: false };
	}

	function onAnchorMove(e: PointerEvent) {
		if (!drag) return;
		e.stopPropagation();
		const p = flowPoint(e);
		const next = {
			x: Math.round(drag.origin.x + p.x - drag.start.x),
			y: Math.round(drag.origin.y + p.y - drag.start.y)
		};
		if (next.x !== drag.origin.x || next.y !== drag.origin.y) drag.moved = true;
		dragOffset = next;
	}

	/** 確定時だけ親へ伝える。ドラッグ中は親の edges を作り直さない */
	function endDrag(e: PointerEvent, commit: boolean) {
		if (!drag) return;
		e.stopPropagation();
		const el = e.currentTarget as HTMLElement;
		if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
		const { moved } = drag;
		const next = dragOffset;
		drag = null;
		dragOffset = null;
		if (commit && moved && next) data.onOffsetChange(next);
	}

	function onAnchorDblClick(e: MouseEvent) {
		e.stopPropagation();
		data.onOffsetChange(null);
	}
</script>

<BaseEdge {path} {markerEnd} {style} interactionWidth={20} />

{#if label}
	<EdgeLabel x={control.x} y={control.y - LABEL_GAP} selectEdgeOnClick>
		<span class="relation-edge-label" style:color={data.color}>{label}</span>
	</EdgeLabel>
{/if}

<EdgeLabel x={control.x} y={control.y}>
	<button
		type="button"
		class="relation-edge-anchor nodrag nopan"
		class:active={selected || hovered}
		style:border-color={data.color}
		aria-label="線の位置を調整"
		tabindex="-1"
		onpointerdown={onAnchorDown}
		onpointermove={onAnchorMove}
		onpointerup={(e) => endDrag(e, true)}
		onpointercancel={(e) => endDrag(e, false)}
		onpointerenter={() => (hovered = true)}
		onpointerleave={() => (hovered = false)}
		ondblclick={onAnchorDblClick}
		onclick={(e) => e.stopPropagation()}
	></button>
</EdgeLabel>

<style>
	.relation-edge-label {
		display: inline-block;
		padding: 1px 6px;
		border-radius: 999px;
		background: var(--color-background);
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
	}

	.relation-edge-anchor {
		box-sizing: border-box;
		width: 10px;
		height: 10px;
		padding: 0;
		border: 2px solid;
		border-radius: 50%;
		background: var(--color-background);
		cursor: grab;
		touch-action: none;
		user-select: none;
		transition: transform 0.12s ease;
	}

	.relation-edge-anchor.active {
		transform: scale(1.4);
	}

	.relation-edge-anchor:active {
		cursor: grabbing;
	}
</style>

<script lang="ts" module>
	import type { RelationArrow, RelationCurve } from '$lib/types';

	export interface RelationEdgeData {
		curve: RelationCurve;
		arrow: RelationArrow;
		color: string;
		/** 中点からの制御点のずれ(既定値を解決済み) */
		offset: { x: number; y: number };
		/** null は既定値へ戻す */
		onOffsetChange: (offset: { x: number; y: number } | null) => void;
		/** お互い別の矢印を並べるとき 1。始点・終点を進行方向の左側へずらす */
		lane?: number;
	}
</script>

<script lang="ts">
	import { PARALLEL_LANE_GAP } from '$lib/utils/relationGraph';
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
	/** 双方向の直線(⇄)で 2 本の線を離す幅(px) */
	const BOTH_LANE_GAP = 20;

	let {
		sourceX: rawSourceX,
		sourceY: rawSourceY,
		sourcePosition,
		targetX: rawTargetX,
		targetY: rawTargetY,
		targetPosition,
		label,
		style,
		markerStart,
		markerEnd,
		selected = false,
		data: rawData
	}: EdgeProps = $props();

	// EdgeTypes の型に合わせて Record で受け、RelationCanvas が作る形として扱う
	const data = $derived(rawData as unknown as RelationEdgeData);

	const { screenToFlowPosition } = useSvelteFlow();

	// お互い別の 2 本は、同じ点から出ないよう始点・終点を進行方向と垂直にずらす。
	// 向きが逆だと「左」も逆になるので、2 本は自然に反対側へ分かれる
	const shift = $derived.by(() => {
		const lane = data.lane ?? 0;
		const dx = rawTargetX - rawSourceX;
		const dy = rawTargetY - rawSourceY;
		const len = Math.hypot(dx, dy);
		if (!lane || len === 0) return { x: 0, y: 0 };
		return { x: (-dy / len) * lane * PARALLEL_LANE_GAP, y: (dx / len) * lane * PARALLEL_LANE_GAP };
	});
	const sourceX = $derived(rawSourceX + shift.x);
	const sourceY = $derived(rawSourceY + shift.y);
	const targetX = $derived(rawTargetX + shift.x);
	const targetY = $derived(rawTargetY + shift.y);

	/** 双方向の直線は ⇄ のように平行な 2 本にし、途中で曲げない */
	const exchange = $derived(data.arrow === 'both' && data.curve === 'straight');
	const half = BOTH_LANE_GAP / 2;
	const exchangeShift = $derived.by(() => {
		const dx = rawTargetX - rawSourceX;
		const dy = rawTargetY - rawSourceY;
		const len = Math.hypot(dx, dy);
		if (len === 0) return { x: 0, y: 0 };
		return { x: (-dy / len) * half, y: (dx / len) * half };
	});
	const forwardPath = $derived(
		`M ${rawSourceX + exchangeShift.x} ${rawSourceY + exchangeShift.y} L ${rawTargetX + exchangeShift.x} ${rawTargetY + exchangeShift.y}`
	);
	const backwardPath = $derived(
		`M ${rawTargetX - exchangeShift.x} ${rawTargetY - exchangeShift.y} L ${rawSourceX - exchangeShift.x} ${rawSourceY - exchangeShift.y}`
	);

	let dragOffset = $state<Point | null>(null);
	let hovered = $state(false);
	let drag: { start: Point; origin: Point; moved: boolean } | null = null;

	const mid = $derived({ x: (sourceX + targetX) / 2, y: (sourceY + targetY) / 2 });
	const offset = $derived(exchange ? { x: 0, y: 0 } : (dragOffset ?? data.offset));
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

{#if exchange}
	<BaseEdge path={forwardPath} {markerEnd} {style} interactionWidth={20} />
	<BaseEdge path={backwardPath} {markerEnd} {style} interactionWidth={20} />
{:else}
	<BaseEdge {path} {markerStart} {markerEnd} {style} interactionWidth={20} />
{/if}

{#if label}
	<EdgeLabel x={control.x} y={control.y - LABEL_GAP - (exchange ? half : 0)} selectEdgeOnClick>
		<span class="relation-edge-label" style:--edge-color={data.color}>
			<i class="dot"></i>{label}
		</span>
	</EdgeLabel>
{/if}

{#if !exchange}
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
{/if}

<style>
	/* ライブラリ既定の白い箱(.svelte-flow__edge-label)は RelationCanvas 側で消している */
	.relation-edge-label {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 9px 2px 7px;
		border: 1px solid color-mix(in srgb, var(--edge-color) 55%, var(--color-border));
		border-radius: 999px;
		background: var(--color-background);
		color: var(--color-text);
		font-size: 12px;
		font-weight: 600;
		line-height: 1.4;
		white-space: nowrap;
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
	}

	.dot {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--edge-color);
	}

	/* 線の中点のつまみ。見た目は 12px、つかめる範囲は 28px */
	.relation-edge-anchor {
		position: relative;
		box-sizing: border-box;
		width: 12px;
		height: 12px;
		padding: 0;
		border: 2px solid;
		border-radius: 50%;
		background: var(--color-background);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
		cursor: grab;
		touch-action: none;
		user-select: none;
		transition: transform 0.12s ease;
	}

	.relation-edge-anchor::after {
		content: '';
		position: absolute;
		inset: -10px;
		border-radius: 50%;
	}

	.relation-edge-anchor.active {
		transform: scale(1.4);
	}

	.relation-edge-anchor:active {
		cursor: grabbing;
	}
</style>

<script lang="ts">
	import { onMount } from 'svelte';
	import Shot from '$lib/Shot.svelte';

	const shots = [
		{
			name: 'split',
			label: '執筆',
			alt: '執筆画面。左に章とシーンの一覧、中央に本文、右に縦書きのプレビューが並ぶ',
			note: '本文の隣に縦書きのプレビューを開いたまま書けます。'
		},
		{
			name: 'relation',
			label: '相関図',
			alt: '人物の相関図。四人の登場人物が線で結ばれ、線に関係の名前が付いている',
			note: '人物を動かしながら、関係を線でつなぎます。'
		},
		{
			name: 'world',
			label: '設定資料',
			alt: '設定資料の一覧と詳細。左に分類ごとの項目が並び、右に選んだ項目の全文が出る',
			note: '地名や用語、年表を分類して控えておけます。'
		},
		{
			name: 'progress',
			label: '進捗',
			alt: '進捗画面。累計文字数などの数字と、日ごとの記録のカレンダーが並ぶ',
			note: '日ごとに書いた分量と、目標までの距離が見えます。'
		},
		{
			name: 'home',
			label: '作品一覧',
			alt: '作品一覧。縦書きの題が入った表紙が本棚のように並ぶ',
			note: '作品は表紙の形で並びます。'
		}
	];

	let current = $state(0);

	// 切り替えた瞬間に画像が空で出ないよう、全タブの画像(明暗とも)を裏で先読みして復号しておく
	onMount(() => {
		const keep: HTMLImageElement[] = [];
		const load = () => {
			for (const s of shots) {
				for (const mode of ['light', 'dark']) {
					const img = new Image();
					img.src = `/shots/${s.name}-${mode}.webp`;
					img.decode().catch(() => {});
					keep.push(img);
				}
			}
		};
		const w = window as Window & {
			requestIdleCallback?: (cb: () => void) => number;
		};
		if (w.requestIdleCallback) w.requestIdleCallback(load);
		else setTimeout(load, 200);
		return () => (keep.length = 0);
	});
</script>

<div class="gallery">
	<div class="head">
		<div class="segmented" role="tablist" aria-label="アプリの画面">
			{#each shots as s, i (s.name)}
				<button
					type="button"
					role="tab"
					id="shot-tab-{s.name}"
					aria-selected={current === i}
					aria-controls="shot-panel"
					onclick={() => (current = i)}>{s.label}</button
				>
			{/each}
		</div>
		<p class="note">{shots[current].note}</p>
	</div>
	<div id="shot-panel" role="tabpanel" aria-labelledby="shot-tab-{shots[current].name}">
		{#key current}
			<div class="frame">
				<Shot name={shots[current].name} alt={shots[current].alt} />
			</div>
		{/key}
	</div>
</div>

<style>
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 16px;
		margin-bottom: 16px;
	}

	.note {
		font-size: 13.5px;
		color: var(--color-text-secondary);
	}

	.frame {
		animation: appear 0.24s ease-out;
	}

	@keyframes appear {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}
</style>

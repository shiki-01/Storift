<script lang="ts">
	import { onMount } from 'svelte';
	import Shot from '$lib/Shot.svelte';

	const shots = [
		{
			name: 'split',
			label: '執筆',
			alt: '執筆画面。左に章とシーンの一覧、中央に本文、右に縦書きのプレビューが並び、上部に保存状態と表示モードの切り替えがある',
			note: '本文の隣に縦書きのプレビューを開いたまま書けます。'
		},
		{
			name: 'plot',
			label: 'プロット',
			alt: 'プロットのボード。アイデア、計画中、執筆済み、推敲済みの四つの列にカードが並ぶ',
			note: 'カードをドラッグして、状態の列へ移したり、並べ替えたりします。'
		},
		{
			name: 'characters',
			label: '人物',
			alt: '人物の一覧と詳細。左に円形のアバターが付いた人物の一覧、右に選んだ人物の外見・性格・背景・関係が全文で出る',
			note: '選ぶだけで全文が読めます。一覧は並べ替えられます。'
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
			alt: '設定資料の一覧と詳細。上に分類のチップ、左に分類ごとの項目、右に選んだ項目の全文とタグが出る',
			note: '地名や用語、年表を分類とタグで絞り込めます。'
		},
		{
			name: 'preview',
			label: '通読',
			alt: '通読の画面。作品全体が章をまたいで一続きに並び、上部に目次、横書き・縦書きの切り替え、表示設定がある',
			note: '作品全体を、章をまたいで通して読めます。'
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
			alt: '作品一覧。上に「続きから書く」の欄があり、その下に縦書きの題が入った表紙が本棚のように並ぶ',
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

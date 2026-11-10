<script lang="ts">
	import { loadReviewBundle } from '$lib/services/reviewExport.service';
	import { toast } from '$lib/stores/toast.svelte';
	import { LARGE_PASTE_CHARS, type ReviewBundle, type ReviewScope } from '$lib/utils/reviewBundle';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		projectId: string;
		projectTitle: string;
		chapters: { id: string; title: string; order: number }[];
		/** 開いたときに選んでおく章(いま編集している章) */
		currentChapterId?: string;
		onClose: () => void;
	}

	let { projectId, projectTitle, chapters, currentChapterId, onClose }: Props = $props();

	const sortedChapters = $derived([...chapters].sort((a, b) => a.order - b.order));

	let scope = $state<ReviewScope>('chapter');
	let chapterId = $state('');
	let plainText = $state(true);
	let includeSettings = $state(false);
	let includePrompt = $state(true);
	let bundle = $state<ReviewBundle | null>(null);
	let loading = $state(false);
	let failed = $state(false);

	// 章の初期値。いまの章が無ければ先頭の章
	$effect(() => {
		if (chapterId && sortedChapters.some((c) => c.id === chapterId)) return;
		chapterId =
			currentChapterId && sortedChapters.some((c) => c.id === currentChapterId)
				? currentChapterId
				: (sortedChapters[0]?.id ?? '');
	});

	// 条件が変わるたびに組み直す(古い読み込みの結果は捨てる)
	let token = 0;
	$effect(() => {
		const options = { scope, chapterId, plainText, includeSettings, includePrompt };
		const mine = ++token;
		loading = true;
		failed = false;
		loadReviewBundle(projectId, {
			scope: options.scope,
			chapterId: options.chapterId,
			plainText: options.plainText,
			includeSettings: options.includeSettings,
			includePrompt: options.includePrompt
		})
			.then((result) => {
				if (mine === token) bundle = result;
			})
			.catch((error) => {
				console.error('Failed to build review bundle:', error);
				if (mine === token) {
					bundle = null;
					failed = true;
				}
			})
			.finally(() => {
				if (mine === token) loading = false;
			});
	});

	const canExport = $derived(!loading && !!bundle && bundle.sceneCount > 0);
	const isLarge = $derived((bundle?.totalChars ?? 0) > LARGE_PASTE_CHARS);

	async function handleCopy() {
		if (!bundle) return;
		try {
			await navigator.clipboard.writeText(bundle.text);
			toast.success('クリップボードにコピーしました');
			onClose();
		} catch (error) {
			console.error('Failed to copy:', error);
			toast.error('クリップボードへのコピーに失敗しました');
		}
	}

	function handleDownload() {
		if (!bundle) return;
		const label =
			scope === 'chapter'
				? (sortedChapters.find((c) => c.id === chapterId)?.title ?? '章')
				: '全体';
		const name = `${projectTitle}_${label}_添削用`.replace(/[/\\?%*:|"<>]/g, '-');
		const blob = new Blob([bundle.text], { type: 'text/markdown;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${name}.md`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		onClose();
	}

	const choiceClass = (active: boolean) =>
		`flex:1 p:12 r:8 cursor:pointer transition:all|0.2s border:1|solid|theme-border ${
			active
				? 'bg:theme-primary fg:theme-background border-color:theme-primary'
				: 'bg:theme-background fg:theme-text hover:bg:theme-surface'
		}`;
</script>

<div class="flex flex:column gap:20" data-testid="review-export">
	<p class="m:0 font:14 fg:theme-text-secondary">
		外部の
		AI(ブラウザのチャットなど)に添削を頼むための文章を作ります。コピーまたはファイルにして、AI
		に貼り付け・添付してください。
	</p>

	<div>
		<span class="display:block font-weight:500 m:0|0|12|0 fg:theme-text">範囲</span>
		<div class="flex gap:8">
			<button
				class={choiceClass(scope === 'chapter')}
				data-testid="review-scope-chapter"
				onclick={() => (scope = 'chapter')}>章ごと</button
			>
			<button
				class={choiceClass(scope === 'work')}
				data-testid="review-scope-work"
				onclick={() => (scope = 'work')}>作品全体</button
			>
		</div>
		{#if scope === 'chapter'}
			<select
				class="w:100% m:12|0|0|0 p:10 r:8 border:1|solid|theme-border bg:theme-background fg:theme-text"
				aria-label="対象の章"
				data-testid="review-chapter"
				bind:value={chapterId}
			>
				{#each sortedChapters as c, i (c.id)}
					<option value={c.id}>第{i + 1}章 {c.title}</option>
				{/each}
			</select>
		{/if}
	</div>

	<div class="flex flex:column gap:10">
		<span class="font-weight:500 fg:theme-text">内容</span>
		<label class="flex ai:flex-start gap:8 cursor:pointer">
			<input type="checkbox" bind:checked={includePrompt} class="m:4|0|0|0" />
			<span>
				<span class="display:block fg:theme-text">添削の依頼文を先頭に付ける</span>
				<span class="display:block font:12 fg:theme-text-secondary"
					>誤字・表記ゆれ・読みにくさ・設定との矛盾を、引用つきで指摘してもらう文です</span
				>
			</span>
		</label>
		<label class="flex ai:flex-start gap:8 cursor:pointer">
			<input type="checkbox" bind:checked={includeSettings} class="m:4|0|0|0" />
			<span>
				<span class="display:block fg:theme-text">作品の設定を含める</span>
				<span class="display:block font:12 fg:theme-text-secondary"
					>概要・章のあらすじ・人物・設定資料・プロットを添えます。設定との整合も見てもらえます</span
				>
			</span>
		</label>
		<label class="flex ai:flex-start gap:8 cursor:pointer">
			<input type="checkbox" bind:checked={plainText} class="m:4|0|0|0" />
			<span>
				<span class="display:block fg:theme-text">ルビ・傍点の記法を取り除く</span>
				<span class="display:block font:12 fg:theme-text-secondary"
					>《》などの記号が読みの邪魔にならないようにします</span
				>
			</span>
		</label>
	</div>

	<div class="p:12 r:8 bg:theme-surface font:13" aria-live="polite" data-testid="review-summary">
		{#if loading && !bundle}
			<span class="fg:theme-text-secondary">読み込み中…</span>
		{:else if failed}
			<span class="fg:theme-error">読み込みに失敗しました</span>
		{:else if bundle}
			<div class="fg:theme-text">
				{bundle.chapterCount} 章 / {bundle.sceneCount} シーン / 本文
				{bundle.bodyChars.toLocaleString('ja-JP')} 文字(全体
				{bundle.totalChars.toLocaleString('ja-JP')} 文字)
			</div>
			{#if bundle.sceneCount === 0}
				<div class="fg:theme-text-secondary m:4|0|0|0">対象のシーンがありません</div>
			{/if}
			{#if isLarge}
				<div class="fg:theme-warning m:4|0|0|0">
					文字数が多く、チャットに貼り付けきれない恐れがあります。章ごとに分けるか、ファイルで添付してください。
				</div>
			{/if}
		{/if}
	</div>

	<div class="flex jc:flex-end gap:12">
		<Button variant="secondary" onclick={onClose}>キャンセル</Button>
		<Button variant="secondary" onclick={handleDownload} disabled={!canExport}>
			<span class="flex ai:center gap:6">
				<Icon name="download" class="w:16px" />
				.md で保存
			</span>
		</Button>
		<Button onclick={handleCopy} disabled={!canExport}>
			<span class="flex ai:center gap:6">
				<Icon name="copy" class="w:16px" />
				コピー
			</span>
		</Button>
	</div>
</div>

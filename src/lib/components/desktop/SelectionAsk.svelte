<script lang="ts">
	/**
	 * エディタで文章を選択したときに出る小さなポップアップ(AI に聞く・ルビ・メモ)。
	 * 「AI に聞く」は選んだ部分を引用として AI パネルへ渡す。
	 * 「ルビ」は設定の「ルビの振り方」に従う(Storift: 記法を入れて読みを手入力 / AI: 読みを提案してもらう)。
	 */
	import { onMount } from 'svelte';
	import { aiStore } from '$lib/stores/ai.svelte';
	import { editorStore } from '$lib/stores/editor.svelte';
	import { makeAnchor, rangeTextOffsets } from '$lib/utils/memos';
	import { applyInsertion } from '$lib/utils/editorInput';

	const MAX_QUOTE = 20000;
	/** ルビの記法は Storift 形式(｜親文字《よみ》)に合わせる */
	const RUBY_PROMPT =
		'引用した部分のうち、読みにくい漢字や固有名詞に、Storift のルビ記法「｜親文字《よみ》」でふりがなを付けてください。' +
		'本文の文字そのものは変えず、ルビの記法だけを加えてください。すでにルビがある箇所はそのままにしてください。';

	let visible = $state(false);
	let top = $state(0);
	let left = $state(0);
	let text = '';
	let timer: ReturnType<typeof setTimeout> | undefined;

	/** 選択がエディタ(本文の contenteditable)の中にあるか */
	function editorRange(): Range | null {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
		const range = sel.getRangeAt(0);
		const node = range.commonAncestorContainer;
		const el = node instanceof Element ? node : node.parentElement;
		const editor = el?.closest('[contenteditable="true"]');
		if (!editor || editor.closest('[data-ai-panel]') || !editor.closest('.app-main')) return null;
		return range;
	}

	function update() {
		const range = editorRange();
		const selected = range ? (window.getSelection()?.toString() ?? '') : '';
		if (!range || !selected.trim() || !editorStore.currentScene) {
			visible = false;
			return;
		}
		text = selected.slice(0, MAX_QUOTE);
		const rect = range.getBoundingClientRect();
		const width = 260;
		left = Math.min(
			Math.max(8, rect.left + rect.width / 2 - width / 2),
			window.innerWidth - width - 8
		);
		top = rect.top > 56 ? rect.top - 44 : rect.bottom + 8;
		visible = true;
	}

	function schedule() {
		clearTimeout(timer);
		timer = setTimeout(update, 120);
	}

	function quote() {
		const scene = editorStore.currentScene;
		if (!scene) return false;
		aiStore.setQuote({ text, sceneId: scene.id, sceneTitle: scene.title });
		visible = false;
		return true;
	}

	function ask() {
		quote();
	}

	/** 選んだ範囲に新規メモを付け、メモパネルを開く(入力欄にフォーカス) */
	function memo() {
		const range = editorRange();
		const scene = editorStore.currentScene;
		const root = range?.commonAncestorContainer;
		const el = root instanceof Element ? root : root?.parentElement;
		const editor = el?.closest<HTMLElement>('[contenteditable="true"]');
		const offsets = range && editor ? rangeTextOffsets(editor, range) : null;
		visible = false;
		if (!scene || !offsets || offsets.end <= offsets.start) return;
		aiStore.open = false;
		editorStore.requestMemo({
			sceneId: scene.id,
			anchor: makeAnchor(editorStore.content, offsets.start, offsets.end)
		});
	}

	/** 選んだ範囲にルビを振る */
	function ruby() {
		if (editorStore.rubyProvider === 'ai') {
			if (aiStore.isRunning) return;
			aiStore.open = true;
			if (quote()) void aiStore.send(RUBY_PROMPT);
			return;
		}
		// Storift: ｜親文字《》を入れて、読みの入力位置へカーソルを置く
		const range = editorRange();
		visible = false;
		if (!range) return;
		applyInsertion('ruby');
	}

	onMount(() => {
		const hide = () => (visible = false);
		document.addEventListener('selectionchange', schedule);
		// スクロールすると位置がずれるので隠す(選択し直せばまた出る)
		document.addEventListener('scroll', hide, true);
		return () => {
			clearTimeout(timer);
			document.removeEventListener('selectionchange', schedule);
			document.removeEventListener('scroll', hide, true);
		};
	});
</script>

{#if visible}
	<!-- 押したときに選択が外れないよう、mousedown の既定動作を止める -->
	<div
		class="popup"
		style="top:{top}px;left:{left}px"
		role="toolbar"
		aria-label="選択した文章の操作"
		tabindex="-1"
		onmousedown={(e) => e.preventDefault()}
	>
		<button class="main" onclick={ask}>AI に聞く</button>
		<button
			onclick={ruby}
			disabled={editorStore.rubyProvider === 'ai' && aiStore.isRunning}
			title={editorStore.rubyProvider === 'ai'
				? 'AI に読みを付けてもらう(設定で切り替えられます)'
				: '｜親文字《よみ》の形でルビを振る(設定で切り替えられます)'}>ルビ</button
		>
		<button onclick={memo} title="選んだ範囲にメモを付ける">メモ</button>
	</div>
{/if}

<style>
	.popup {
		position: fixed;
		z-index: 1000;
		display: flex;
		gap: 2px;
		padding: 3px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		box-shadow: var(--shadow-float);
		font-size: 13px;
	}

	button {
		padding: 4px 10px;
		border-radius: 6px;
		color: var(--color-text);
		cursor: pointer;
		white-space: nowrap;
	}

	button:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-text) 8%, transparent);
	}

	button.main {
		color: var(--color-primary);
		font-weight: 600;
	}

	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
</style>

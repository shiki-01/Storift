<script lang="ts">
	/**
	 * エディタで文章を選択したときに出る「AI に聞く」の小さなポップアップ。
	 * 選んだ部分を引用として Claude パネルへ渡す。
	 */
	import { onMount } from 'svelte';
	import { claudeStore, QUICK_ACTIONS } from '$lib/stores/claude.svelte';
	import { editorStore } from '$lib/stores/editor.svelte';

	const MAX_QUOTE = 20000;
	const REWRITE_PROMPT =
		'引用した部分を、意味と文体を保ったまま、より読みやすく自然な文章に書き換えてください。';

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
		if (!editor || editor.closest('[data-claude-panel]') || !editor.closest('.app-main'))
			return null;
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
		claudeStore.setQuote({ text, sceneId: scene.id, sceneTitle: scene.title });
		visible = false;
		return true;
	}

	function ask() {
		quote();
	}

	/** 引用してからプロンプトを作る(「引用した部分」を対象にするため) */
	function run(prompt: () => string) {
		if (quote()) void claudeStore.send(prompt());
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
		aria-label="選択した文章を AI に聞く"
		tabindex="-1"
		onmousedown={(e) => e.preventDefault()}
	>
		<button class="main" onclick={ask}>AI に聞く</button>
		<button
			onclick={() => run(() => claudeStore.actionPrompt(QUICK_ACTIONS[0]))}
			disabled={claudeStore.isRunning}>校正</button
		>
		<button onclick={() => run(() => REWRITE_PROMPT)} disabled={claudeStore.isRunning}
			>書き換え</button
		>
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
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.15);
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

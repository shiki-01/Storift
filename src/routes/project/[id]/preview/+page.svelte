<script lang="ts">
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { settingsStore } from '$lib/stores/settings.svelte';
	import { editorStore } from '$lib/stores/editor.svelte';
	import { viewport } from '$lib/stores/viewport.svelte';
	import { dataChange } from '$lib/stores/dataChange.svelte';
	import { chaptersDB, scenesDB } from '$lib/db';
	import { editorFontToCss } from '$lib/utils/fonts';
	import { buildManuscript, isSameSource, progressAt } from '$lib/utils/manuscript';
	import ProgressBar from '$lib/components/ui/ProgressBar.svelte';
	import ManuscriptReader from '$lib/components/preview/ManuscriptReader.svelte';
	import type { Chapter, Scene, WritingMode } from '$lib/types';

	const projectId = page.params.id ?? '';

	// --- データ(章・シーンをまとめて取得) ---
	let chapters = $state.raw<Chapter[]>([]);
	let scenes = $state.raw<Scene[]>([]);
	let loaded = $state(false);
	let loadFailed = $state(false);

	// 共有プロジェクトでは、Dexie の content(CRDT のミラー)をそのまま表示する。
	// 開いていないシーンのミラーは、最後に同期した時点の内容
	async function load() {
		try {
			const [nextChapters, nextScenes] = await Promise.all([
				chaptersDB.getByProjectId(projectId),
				scenesDB.getByProjectId(projectId)
			]);
			// 変わっていなければ再構築・再描画しない
			if (
				!isSameSource(
					{ chapters: untrack(() => chapters), scenes: untrack(() => scenes) },
					{ chapters: nextChapters, scenes: nextScenes }
				) ||
				!untrack(() => loaded)
			) {
				chapters = nextChapters;
				scenes = nextScenes;
			}
			loadFailed = false;
		} catch (error) {
			console.error('Failed to load manuscript:', error);
			if (!untrack(() => loaded)) loadFailed = true;
		}
	}

	let manuscript = $derived(buildManuscript(chapters, scenes));

	// --- 表示設定(端末内に保存) ---
	const PREFS_KEY = 'storift:manuscript-prefs';
	const MIN_SIZE = 12;
	const MAX_SIZE = 32;

	function loadPrefs(): { writingMode: WritingMode; fontSize: number | null; focus: boolean } {
		try {
			const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null');
			return {
				writingMode: raw?.writingMode === 'vertical' ? 'vertical' : 'horizontal',
				fontSize: typeof raw?.fontSize === 'number' ? raw.fontSize : null,
				focus: raw?.focus === true
			};
		} catch {
			return { writingMode: 'horizontal', fontSize: null, focus: false };
		}
	}

	const savedPrefs = loadPrefs();
	let writingMode = $state<WritingMode>(savedPrefs.writingMode);
	// 保存が無ければ、執筆画面の文字サイズに従う
	let fontSize = $state(
		Math.min(
			Math.max(savedPrefs.fontSize ?? settingsStore.editorFormatting?.fontSize ?? 16, MIN_SIZE),
			MAX_SIZE
		)
	);

	// 集中モード: 周辺の UI(アプリのレール・上部バー・この画面の操作バー)を隠して本文だけにする
	let focusReading = $state(savedPrefs.focus);
	// 集中中、マウス移動・タップで終了ボタンをはっきり見せる時間
	let focusAwake = $state(false);
	let awakeTimer: ReturnType<typeof setTimeout> | null = null;

	function wake() {
		if (!focusReading) return;
		focusAwake = true;
		if (awakeTimer) clearTimeout(awakeTimer);
		awakeTimer = setTimeout(() => (focusAwake = false), 2500);
	}

	function setFocusReading(on: boolean) {
		focusReading = on;
		tocOpen = false;
		settingsOpen = false;
		focusAwake = false;
		savePrefs();
		if (on) wake();
	}

	// アプリ全体のレール・ヘッダー・下部ナビは、執筆画面の集中モードと同じ editorStore.focusMode で隠れる
	$effect(() => {
		editorStore.focusMode = focusReading;
	});
	onDestroy(() => {
		editorStore.focusMode = false;
		if (awakeTimer) clearTimeout(awakeTimer);
	});

	function savePrefs() {
		try {
			localStorage.setItem(
				PREFS_KEY,
				JSON.stringify({ writingMode, fontSize, focus: focusReading })
			);
		} catch {
			// 保存できなくても、その場の表示には反映される
		}
	}

	function setMode(mode: WritingMode) {
		writingMode = mode;
		savePrefs();
	}

	function changeSize(delta: number) {
		fontSize = Math.min(Math.max(fontSize + delta, MIN_SIZE), MAX_SIZE);
		savePrefs();
	}

	let fontFamily = $derived(editorFontToCss(settingsStore.editorFont));
	let lineHeight = $derived(settingsStore.editorFormatting?.lineHeight ?? 2);
	let letterSpacing = $derived(settingsStore.editorFormatting?.letterSpacing ?? 0);

	// --- 読んでいる位置(プロジェクトごとに保存・復元) ---
	const POSITION_KEY = `storift:manuscript-pos:${projectId}`;

	function loadPosition(): { sceneId: string; ratio: number } | null {
		try {
			const raw = JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null');
			if (typeof raw?.sceneId === 'string' && typeof raw?.ratio === 'number') {
				return { sceneId: raw.sceneId, ratio: Math.min(Math.max(raw.ratio, 0), 1) };
			}
		} catch {
			// 読めなければ先頭から
		}
		return null;
	}

	let initialPosition = $state.raw<{ sceneId: string; ratio: number } | null>(null);
	let pos = $state({ sceneIndex: 0, ratio: 0 });
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingSave: { sceneId: string; ratio: number } | null = null;

	function flushPosition() {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = null;
		if (!pendingSave) return;
		try {
			localStorage.setItem(POSITION_KEY, JSON.stringify(pendingSave));
		} catch {
			// 保存できなくても動作には影響しない
		}
		pendingSave = null;
	}

	function onPosition(next: { sceneIndex: number; ratio: number }) {
		pos = next;
		const scene = manuscript.scenes[next.sceneIndex];
		if (!scene) return;
		pendingSave = { sceneId: scene.id, ratio: Math.round(next.ratio * 1000) / 1000 };
		if (!saveTimer) saveTimer = setTimeout(flushPosition, 400);
	}

	let currentScene = $derived(manuscript.scenes[pos.sceneIndex] ?? null);
	let currentChapter = $derived(
		currentScene ? manuscript.chapters.find((c) => c.id === currentScene.chapterId) : null
	);
	let progress = $derived(progressAt(manuscript, pos.sceneIndex, pos.ratio));
	let percent = $derived(Math.floor(progress.fraction * 100));

	// --- 目次・表示設定の開閉 ---
	let tocOpen = $state(false);
	let settingsOpen = $state(false);
	let tocButton = $state<HTMLButtonElement | null>(null);
	let settingsButton = $state<HTMLButtonElement | null>(null);
	let tocPanel = $state<HTMLElement | null>(null);
	let reader = $state<ReturnType<typeof ManuscriptReader> | null>(null);

	async function openToc() {
		settingsOpen = false;
		tocOpen = true;
		await tick();
		const current = tocPanel?.querySelector<HTMLElement>('[aria-current="location"]');
		(current ?? tocPanel?.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
		current?.scrollIntoView({ block: 'center' });
	}

	function closeToc() {
		tocOpen = false;
		tocButton?.focus();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (focusReading && !tocOpen && !settingsOpen) {
			e.preventDefault();
			setFocusReading(false);
			return;
		}
		if (tocOpen) {
			e.preventDefault();
			closeToc();
		} else if (settingsOpen) {
			e.preventDefault();
			settingsOpen = false;
			settingsButton?.focus();
		}
	}

	function jumpToScene(sceneId: string) {
		void reader?.jumpTo(sceneId, 0);
		if (viewport.isMobile) {
			tocOpen = false;
		}
	}

	function jumpToChapter(chapterId: string) {
		void reader?.jumpToChapter(chapterId);
		if (viewport.isMobile) {
			tocOpen = false;
		}
	}

	// --- エディタで開く ---
	function openInEditor(sceneId: string) {
		flushPosition();
		try {
			localStorage.setItem(`storift:last-scene:${projectId}`, sceneId);
		} catch {
			// 保存できなくても動作には影響しない
		}
		// 執筆画面が前回のシーンを覚えていても、このシーンを開く(未保存の変更がある時は触らない)
		const scene = scenes.find((s) => s.id === sceneId);
		if (scene && !editorStore.isDirty) editorStore.currentScene = scene;
		void goto(resolve('/project/[id]/editor', { id: projectId }));
	}

	// --- データの更新(同期・他タブでの編集) ---
	let reloadTimer: ReturnType<typeof setTimeout> | null = null;
	function scheduleReload() {
		if (reloadTimer) clearTimeout(reloadTimer);
		reloadTimer = setTimeout(() => {
			reloadTimer = null;
			void load();
		}, 300);
	}

	let firstRun = true;
	$effect(() => {
		// 同期の取り込みや AI の編集で、ストアが差し替わった時に読み直す
		void dataChange.revision('chapters');
		void currentProjectStore.scenes;
		void currentProjectStore.chapters;
		if (firstRun) {
			firstRun = false;
			return;
		}
		scheduleReload();
	});

	function onVisibility() {
		if (document.visibilityState === 'visible') {
			scheduleReload();
		} else {
			flushPosition();
		}
	}

	onMount(async () => {
		await load();
		initialPosition = loadPosition();
		loaded = true;
	});

	onDestroy(() => {
		flushPosition();
		if (reloadTimer) clearTimeout(reloadTimer);
	});

	const numberFormat = new Intl.NumberFormat('ja-JP');
</script>

<svelte:window
	onkeydown={onKeydown}
	onpagehide={flushPosition}
	onpointermove={wake}
	onpointerdown={wake}
/>
<svelte:document onvisibilitychange={onVisibility} />

<div class="preview-page">
	{#if !loaded}
		<p class="state-msg">{loadFailed ? '作品を読み込めませんでした' : '読み込み中...'}</p>
	{:else if manuscript.scenes.length === 0}
		<p class="state-msg">
			まだ読むシーンがありません。
			<a href={resolve('/project/[id]/editor', { id: projectId })}>執筆画面で書き始める</a>
		</p>
	{:else}
		{#if focusReading}
			<button
				type="button"
				class="focus-exit"
				class:awake={focusAwake}
				aria-label="集中モードを終了(Esc)"
				title="集中モードを終了(Esc)"
				data-testid="focus-exit"
				onclick={() => setFocusReading(false)}
			>
				<svg
					viewBox="0 0 24 24"
					width="18"
					height="18"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg
				>
			</button>
		{/if}
		<header class="bar" class:hidden={focusReading} aria-label="通読プレビューの操作">
			<div class="bar-row">
				<button
					bind:this={tocButton}
					type="button"
					class="icon-btn"
					aria-label="目次"
					aria-expanded={tocOpen}
					aria-controls="manuscript-toc"
					title="目次"
					data-testid="toc-toggle"
					onclick={() => (tocOpen ? closeToc() : openToc())}
				>
					<svg
						viewBox="0 0 24 24"
						width="20"
						height="20"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" /></svg
					>
				</button>

				<div class="where" data-testid="where">
					<span class="where-chapter">{currentChapter?.title ?? ''}</span>
					<span class="where-scene">{currentScene?.title ?? ''}</span>
				</div>

				<div class="seg" role="group" aria-label="表示モード">
					<button
						type="button"
						class:on={writingMode === 'horizontal'}
						aria-pressed={writingMode === 'horizontal'}
						title="横書き"
						data-testid="mode-horizontal"
						onclick={() => setMode('horizontal')}>横</button
					>
					<button
						type="button"
						class:on={writingMode === 'vertical'}
						aria-pressed={writingMode === 'vertical'}
						title="縦書き"
						data-testid="mode-vertical"
						onclick={() => setMode('vertical')}>縦</button
					>
				</div>

				<button
					type="button"
					class="icon-btn"
					aria-label="集中モード"
					title="集中モード(周辺の表示を隠して本文だけにする)"
					data-testid="focus-toggle"
					onclick={() => setFocusReading(true)}
				>
					<svg
						viewBox="0 0 24 24"
						width="20"
						height="20"
						fill="none"
						stroke="currentColor"
						stroke-width="1.8"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg
					>
				</button>

				<button
					bind:this={settingsButton}
					type="button"
					class="icon-btn"
					aria-label="表示設定"
					aria-expanded={settingsOpen}
					title="表示設定"
					data-testid="settings-toggle"
					onclick={() => {
						settingsOpen = !settingsOpen;
						if (settingsOpen) tocOpen = false;
					}}>Aa</button
				>
			</div>

			<div class="bar-row meter">
				<ProgressBar
					class="meter-bar"
					value={progress.fraction}
					label="読んだ割合"
					size="sm"
					showText={false}
				/>
				<span class="meter-text" data-testid="progress-text">
					{percent}% ・ {numberFormat.format(progress.readChars)} / {numberFormat.format(
						progress.totalChars
					)}字
				</span>
			</div>

			{#if settingsOpen}
				<div class="popover" role="group" aria-label="表示設定">
					<div class="pop-row">
						<span class="pop-label">文字サイズ</span>
						<div class="stepper">
							<button
								type="button"
								aria-label="文字を小さく"
								disabled={fontSize <= MIN_SIZE}
								data-testid="size-down"
								onclick={() => changeSize(-1)}>−</button
							>
							<output aria-live="polite" data-testid="size-value">{fontSize}</output>
							<button
								type="button"
								aria-label="文字を大きく"
								disabled={fontSize >= MAX_SIZE}
								data-testid="size-up"
								onclick={() => changeSize(1)}>＋</button
							>
						</div>
					</div>
					<div class="pop-row">
						<button
							type="button"
							class="text-btn"
							data-testid="refresh"
							onclick={() => void load()}
						>
							最新の内容に更新
						</button>
						<button
							type="button"
							class="text-btn"
							data-testid="open-current"
							disabled={!currentScene}
							onclick={() => currentScene && openInEditor(currentScene.id)}
						>
							このシーンをエディタで開く
						</button>
					</div>
					{#if currentProjectStore.project?.sharing?.status === 'active'}
						<p class="pop-note" data-testid="shared-note">
							開いていないシーンは、この端末が最後に同期した内容です。
						</p>
					{/if}
				</div>
			{/if}
		</header>

		<div class="reader-wrap">
			<ManuscriptReader
				bind:this={reader}
				{manuscript}
				projectTitle={currentProjectStore.project?.title ?? ''}
				{writingMode}
				{fontSize}
				{lineHeight}
				{letterSpacing}
				{fontFamily}
				initial={initialPosition}
				onposition={onPosition}
				onopen={openInEditor}
			/>

			{#if tocOpen}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<div class="backdrop" onclick={closeToc}></div>
				<aside class="toc" bind:this={tocPanel} id="manuscript-toc" data-testid="toc">
					<nav aria-label="目次">
						<ol class="toc-chapters">
							{#each manuscript.toc as chapter (chapter.id)}
								<li>
									<button
										type="button"
										class="toc-chapter"
										aria-current={currentChapter?.id === chapter.id ? 'location' : undefined}
										onclick={() => jumpToChapter(chapter.id)}
									>
										<span class="toc-title">{chapter.title}</span>
										<span class="toc-count">{numberFormat.format(chapter.charCount)}字</span>
									</button>
									{#if chapter.scenes.length > 0}
										<ol class="toc-scenes">
											{#each chapter.scenes as scene (scene.id)}
												<li>
													<button
														type="button"
														class="toc-scene"
														aria-current={currentScene?.id === scene.id ? 'location' : undefined}
														onclick={() => jumpToScene(scene.id)}
													>
														<span class="toc-title">{scene.title}</span>
														<span class="toc-count">{numberFormat.format(scene.charCount)}字</span>
													</button>
												</li>
											{/each}
										</ol>
									{/if}
								</li>
							{/each}
						</ol>
					</nav>
				</aside>
			{/if}
		</div>
	{/if}
</div>

<style>
	.preview-page {
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-height: 0;
		background: var(--editor-background, #fff);
	}

	.state-msg {
		margin: auto;
		padding: 2rem;
		color: var(--color-text-secondary);
		text-align: center;
	}

	.bar {
		position: relative;
		z-index: 3;
		flex: none;
		padding: 6px max(10px, var(--safe-right, 0px)) 4px max(10px, var(--safe-left, 0px));
		border-bottom: 1px solid var(--color-border);
		background: var(--color-background);
		color: var(--color-text);
	}

	.bar.hidden {
		display: none;
	}

	.focus-exit {
		position: absolute;
		top: calc(var(--safe-top, 0px) + 8px);
		right: max(8px, var(--safe-right, 0px));
		z-index: 5;
		width: 36px;
		height: 36px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		background: var(--color-background);
		color: var(--color-text-secondary);
		opacity: 0.25;
		transition: opacity 0.2s;
		cursor: pointer;
	}

	.focus-exit.awake,
	.focus-exit:hover,
	.focus-exit:focus-visible {
		opacity: 1;
	}

	.bar-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.icon-btn {
		flex: none;
		min-width: 44px;
		height: 44px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.icon-btn:hover,
	.icon-btn[aria-expanded='true'] {
		background: var(--hover, color-mix(in srgb, currentColor 8%, transparent));
	}

	.where {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		line-height: 1.3;
	}

	.where-chapter,
	.where-scene {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.where-chapter {
		font-size: 0.7rem;
		color: var(--color-text-secondary);
	}

	.where-scene {
		font-size: 0.85rem;
		font-weight: 600;
	}

	.seg {
		flex: none;
		display: inline-flex;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		overflow: hidden;
	}

	.seg button {
		min-width: 40px;
		height: 36px;
		border: none;
		background: transparent;
		color: inherit;
		font-size: 0.9rem;
		cursor: pointer;
	}

	.seg button.on {
		background: var(--color-primary);
		color: #fff;
	}

	.meter {
		gap: 10px;
		padding: 0 4px 2px;
	}

	.meter :global(.meter-bar) {
		flex: 1;
	}

	.meter-text {
		flex: none;
		font-size: 0.7rem;
		color: var(--color-text-secondary);
		font-variant-numeric: tabular-nums;
	}

	.popover {
		position: absolute;
		top: 100%;
		right: max(10px, var(--safe-right, 0px));
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: min(280px, calc(100vw - 20px));
		padding: 8px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.15);
	}

	.pop-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		flex-wrap: wrap;
	}

	.pop-label {
		font-size: 0.85rem;
	}

	.pop-note {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
	}

	.stepper {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.stepper button,
	.text-btn {
		min-width: 44px;
		height: 44px;
		padding: 0 12px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-surface);
		color: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.stepper button:disabled,
	.text-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.stepper output {
		min-width: 2.5em;
		text-align: center;
		font-variant-numeric: tabular-nums;
	}

	.reader-wrap {
		position: relative;
		flex: 1;
		min-height: 0;
	}

	.backdrop {
		position: absolute;
		inset: 0;
		z-index: 4;
		background: rgb(0 0 0 / 0.3);
	}

	.toc {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		z-index: 5;
		width: min(340px, 88vw);
		overflow-y: auto;
		padding: 8px 0 16px;
		padding-left: var(--safe-left, 0px);
		border-right: 1px solid var(--color-border);
		background: var(--color-background);
		color: var(--color-text);
		box-shadow: 4px 0 24px rgb(0 0 0 / 0.12);
		overscroll-behavior: contain;
	}

	@media (prefers-reduced-motion: no-preference) {
		.toc {
			animation: toc-in 0.18s ease-out;
		}
		.backdrop {
			animation: fade-in 0.18s ease-out;
		}
	}

	@keyframes toc-in {
		from {
			transform: translateX(-24px);
			opacity: 0;
		}
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}

	.toc ol {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.toc-chapter,
	.toc-scene {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		min-height: 44px;
		border: none;
		background: transparent;
		color: inherit;
		text-align: left;
		cursor: pointer;
	}

	.toc-chapter {
		padding: 6px 14px;
		font-weight: 600;
		font-size: 0.9rem;
	}

	.toc-scene {
		padding: 6px 14px 6px 28px;
		font-size: 0.85rem;
	}

	.toc-chapter:hover,
	.toc-scene:hover {
		background: var(--hover, color-mix(in srgb, currentColor 8%, transparent));
	}

	.toc-chapter[aria-current='location'],
	.toc-scene[aria-current='location'] {
		background: var(--selected, color-mix(in srgb, var(--color-primary) 13%, transparent));
	}

	.toc-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.toc-count {
		flex: none;
		font-size: 0.7rem;
		color: var(--color-text-secondary);
		font-variant-numeric: tabular-nums;
	}
</style>

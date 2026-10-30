<script lang="ts">
	import { onMount } from 'svelte';
	import { getCurrentWindow } from '@tauri-apps/api/window';

	// デスクトップ版(Tauri)専用の、ウィンドウ上端のバー。
	// Windows / Linux は OS の枠を外しているので、最小化・最大化・閉じるを自前で描く。
	// macOS は OS の信号機ボタンを残し(titleBarStyle: Overlay)、その分だけ左を空ける。
	let { title = '' }: { title?: string } = $props();

	const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
	const appWindow = getCurrentWindow();

	let maximized = $state(false);
	let focused = $state(true);

	onMount(() => {
		const sync = async () => {
			maximized = await appWindow.isMaximized();
		};
		void sync();
		const unlisteners = [
			appWindow.onResized(sync),
			appWindow.onFocusChanged(({ payload }) => (focused = payload))
		];
		return () => {
			for (const u of unlisteners) void u.then((fn) => fn());
		};
	});
</script>

<header class="titlebar" class:mac={isMac} class:blurred={!focused} data-tauri-drag-region>
	<span class="titlebar-title" data-tauri-drag-region>{title}</span>

	{#if !isMac}
		<div class="controls">
			<button
				type="button"
				class="control"
				aria-label="最小化"
				title="最小化"
				onclick={() => appWindow.minimize()}
			>
				<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"
					><path d="M0 5.5h10" stroke="currentColor" stroke-width="1" /></svg
				>
			</button>
			<button
				type="button"
				class="control"
				aria-label={maximized ? '元のサイズに戻す' : '最大化'}
				title={maximized ? '元のサイズに戻す' : '最大化'}
				onclick={() => appWindow.toggleMaximize()}
			>
				{#if maximized}
					<svg viewBox="0 0 10 10" width="10" height="10" fill="none" aria-hidden="true"
						><path d="M2.5 2.5V.5h7v7h-2" stroke="currentColor" stroke-width="1" /><rect
							x=".5"
							y="2.5"
							width="7"
							height="7"
							stroke="currentColor"
							stroke-width="1"
						/></svg
					>
				{:else}
					<svg viewBox="0 0 10 10" width="10" height="10" fill="none" aria-hidden="true"
						><rect x=".5" y=".5" width="9" height="9" stroke="currentColor" stroke-width="1" /></svg
					>
				{/if}
			</button>
			<button
				type="button"
				class="control control--close"
				aria-label="閉じる"
				title="閉じる"
				onclick={() => appWindow.close()}
			>
				<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"
					><path d="M.5.5l9 9M9.5.5l-9 9" stroke="currentColor" stroke-width="1" /></svg
				>
			</button>
		</div>
	{/if}
</header>

<style>
	.titlebar {
		flex: none;
		position: relative;
		display: flex;
		align-items: center;
		height: 32px;
		padding-left: 14px;
		background: var(--color-surface);
		border-bottom: 1px solid var(--color-border);
		color: var(--color-text-secondary);
		user-select: none;
		-webkit-user-select: none;
	}

	/* 信号機ボタンの分だけ空ける */
	.titlebar.mac {
		padding-left: 78px;
		height: 30px;
	}

	.titlebar-title {
		flex: 1;
		min-width: 0;
		font-size: 12px;
		letter-spacing: 0.04em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transition: opacity 0.2s;
	}

	.blurred .titlebar-title,
	.blurred .control {
		opacity: 0.55;
	}

	.controls {
		display: flex;
		align-self: stretch;
	}

	.control {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 46px;
		padding: 0;
		border: none;
		background: transparent;
		color: var(--color-text);
		cursor: default;
		transition:
			background-color 0.12s,
			color 0.12s,
			opacity 0.2s;
	}

	.control:hover {
		background: var(--hover);
	}

	.control:active {
		background: color-mix(in srgb, var(--color-text) 12%, transparent);
	}

	/* 閉じるは OS と同じく赤に白抜き */
	.control--close:hover {
		background: #c42b1c;
		color: #fff;
	}

	.control--close:active {
		background: #b22a1b;
		color: #fff;
	}
</style>

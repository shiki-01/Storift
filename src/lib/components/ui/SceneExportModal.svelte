<script lang="ts">
	import { settingsStore } from '$lib/stores/settings.svelte';
	import type { ExportFormatPattern } from '$lib/types';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		content: string;
		title?: string;
		onClose: () => void;
	}

	let { content, title = 'シーン', onClose }: Props = $props();

	// デフォルトのエクスポートパターン
	const defaultPatterns: ExportFormatPattern[] = [
		{
			id: 'plain',
			name: 'プレーンテキスト',
			description: 'ルビ・傍点記法を削除',
			rubyPattern: '$1',
			boutenPattern: '$1',
			rubyWithBarPattern: '$1'
		},
		{
			id: 'storift',
			name: 'Storift形式（そのまま）',
			description: 'ルビ・傍点記法を維持',
			rubyPattern: '$1《$2》',
			boutenPattern: '《《$1》》',
			rubyWithBarPattern: '｜$1《$2》'
		},
		{
			id: 'aozora',
			name: '青空文庫形式',
			description: '青空文庫のルビ記法',
			rubyPattern: '｜$1《$2》',
			boutenPattern: '$1［＃「$1」に傍点］',
			rubyWithBarPattern: '｜$1《$2》'
		},
		{
			id: 'kakuyomu',
			name: 'カクヨム形式',
			description: 'カクヨムのルビ記法',
			rubyPattern: '｜$1《$2》',
			boutenPattern: '《《$1》》',
			rubyWithBarPattern: '｜$1《$2》'
		},
		{
			id: 'narou',
			name: '小説家になろう形式',
			description: 'なろうのルビ記法',
			rubyPattern: '|$1《$2》',
			boutenPattern: '$1',
			rubyWithBarPattern: '|$1《$2》'
		},
		{
			id: 'pixiv',
			name: 'pixiv形式',
			description: 'pixiv小説のルビ記法',
			rubyPattern: '[[rb:$1 > $2]]',
			boutenPattern: '$1',
			rubyWithBarPattern: '[[rb:$1 > $2]]'
		},
		{
			id: 'html',
			name: 'HTML形式',
			description: 'HTMLのrubyタグ',
			rubyPattern: '<ruby>$1<rt>$2</rt></ruby>',
			boutenPattern: '<span class="bouten">$1</span>',
			rubyWithBarPattern: '<ruby>$1<rt>$2</rt></ruby>'
		}
	];

	// ユーザー定義パターンとデフォルトを結合
	let allPatterns = $derived([
		...defaultPatterns,
		...(settingsStore.settings?.exportPatterns || [])
	]);

	let selectedPatternId = $state('storift');
	let exportMode = $state<'download' | 'clipboard'>('clipboard');

	// 選択されたパターンを取得
	let selectedPattern = $derived(
		allPatterns.find((p) => p.id === selectedPatternId) || defaultPatterns[1]
	);

	// コンテンツを変換
	function convertContent(text: string, pattern: ExportFormatPattern): string {
		let result = text;

		// 傍点を先に変換（ルビより前に処理）
		// 《《テキスト》》 → パターンに変換
		result = result.replace(/《《([^》]+)》》/g, (_, boutenText) => {
			return pattern.boutenPattern.replace(/\$1/g, boutenText);
		});

		// 縦棒付きルビを変換
		// ｜親文字《ルビ》 または |親文字《ルビ》
		result = result.replace(/[｜|]([^《》\n]+)《([^》]+)》/g, (_, base, ruby) => {
			return pattern.rubyWithBarPattern.replace('$1', base).replace('$2', ruby);
		});

		// 漢字のみルビを変換
		// 漢字《かんじ》
		result = result.replace(/([一-龯々]+)《([^》]+)》/g, (_, base, ruby) => {
			return pattern.rubyPattern.replace('$1', base).replace('$2', ruby);
		});

		return result;
	}

	// プレビュー用の変換済みコンテンツ
	let convertedContent = $derived(convertContent(content, selectedPattern));

	// ダウンロード
	async function handleDownload() {
		const blob = new Blob([convertedContent], { type: 'text/plain;charset=utf-8' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${title.replace(/[/\\?%*:|"<>]/g, '-')}.txt`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		onClose();
	}

	// クリップボードにコピー
	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(convertedContent);
			onClose();
		} catch (error) {
			console.error('Failed to copy:', error);
			alert('クリップボードへのコピーに失敗しました');
		}
	}

	// エクスポート実行
	function handleExport() {
		if (exportMode === 'download') {
			handleDownload();
		} else {
			handleCopy();
		}
	}
</script>

<div class="flex flex-direction:column gap:24">
	<!-- エクスポート方法 -->
	<div>
		<span class="display:block font-weight:500 m:0|0|12|0 fg:theme-text">エクスポート方法</span>
		<div class="flex gap:8">
			<button
				class="flex:1 flex align-items:center justify-content:center gap:8 p:12 r:8 cursor:pointer transition:all|0.2s border:1|solid|theme-border {exportMode === 'download' ? 'bg:$(theme.primary) fg:white border-color:$(theme.primary)' : 'bg:theme-background fg:theme-text hover:bg:theme-background-secondary'}"
				onclick={() => (exportMode = 'download')}
			>
				<Icon name="download" class="w:20px" />
				ファイルダウンロード
			</button>
			<button
				class="flex:1 flex align-items:center justify-content:center gap:8 p:12 r:8 cursor:pointer transition:all|0.2s border:1|solid|theme-border {exportMode === 'clipboard' ? 'bg:$(theme.primary) fg:white border-color:$(theme.primary)' : 'bg:theme-background fg:theme-text hover:bg:theme-background-secondary'}"
				onclick={() => (exportMode = 'clipboard')}
			>
				<Icon name="copy" class="w:20px" />
				クリップボードにコピー
			</button>
		</div>
	</div>

	<!-- 変換形式 -->
	<div>
		<span class="display:block font-weight:500 m:0|0|12|0 fg:theme-text">ルビ・傍点の変換形式</span>
		<div class="flex flex-direction:column gap:8 max-h:200 overflow-y:auto">
			{#each allPatterns as pattern}
				<button
					class="flex align-items:center gap:12 p:12 r:8 cursor:pointer transition:all|0.2s border:1|solid|theme-border text-align:left {selectedPatternId === pattern.id ? 'bg:$(theme.primary)/.1 border-color:$(theme.primary)' : 'bg:theme-background hover:bg:theme-background-secondary'}"
					onclick={() => (selectedPatternId = pattern.id)}
				>
					<div class="w:20 h:20 r:full border:2|solid|{selectedPatternId === pattern.id ? '$(theme.primary)' : 'theme-border'} flex align-items:center justify-content:center">
						{#if selectedPatternId === pattern.id}
							<div class="w:10 h:10 r:full bg:$(theme.primary)"></div>
						{/if}
					</div>
					<div class="flex-grow:1">
						<div class="font:14 font-weight:500 fg:theme-text">{pattern.name}</div>
						{#if pattern.description}
							<div class="font:12 fg:theme-text-secondary">{pattern.description}</div>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	</div>

	<!-- プレビュー -->
	<div>
		<span class="display:block font-weight:500 m:0|0|12|0 fg:theme-text">変換プレビュー</span>
		<div class="b:1|solid|theme-border r:8 p:16 bg:theme-background-secondary max-h:200 overflow-y:auto">
			<pre class="font:13 fg:theme-text m:0 white-space:pre-wrap word-break:break-all">{convertedContent.slice(0, 500)}{convertedContent.length > 500 ? '...' : ''}</pre>
		</div>
	</div>

	<!-- ボタン -->
	<div class="flex justify-content:flex-end gap:12">
		<Button variant="secondary" onclick={onClose}>キャンセル</Button>
		<Button onclick={handleExport}>
			<span class="flex align-items:center gap:6">
				<Icon name={exportMode === 'download' ? 'download' : 'copy'} class="w:16px" />
				{exportMode === 'download' ? 'ダウンロード' : 'コピー'}
			</span>
		</Button>
	</div>
</div>

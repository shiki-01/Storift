<script lang="ts">
	import { onMount } from 'svelte';
	import Card from './Card.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { settingsDB } from '$lib/db';
	import { settingsStore } from '$lib/stores/settings.svelte';

	// 共同編集中に他の人のカーソル/選択範囲を表示するか(この端末だけの設定。未設定は表示)
	let enabled = $state(settingsStore.settings.showRemoteCursors !== false);

	// ストアは読み込み前かもしれないので、保存されている値を読み直す
	onMount(async () => {
		try {
			enabled = (await settingsDB.get()).showRemoteCursors !== false;
		} catch (error) {
			console.error('Failed to load remote cursor setting:', error);
		}
	});

	async function toggle() {
		const next = !enabled;
		enabled = next;
		try {
			await settingsDB.update({ showRemoteCursors: next });
			settingsStore.settings = { ...settingsStore.settings, showRemoteCursors: next };
		} catch (error) {
			console.error('Failed to save remote cursor setting:', error);
			enabled = !next;
			toast.error('設定を保存できませんでした');
		}
	}
</script>

<Card class="b:1px|solid|theme-border flex flex:column gap:1rem">
	<h2 class="font:bold">共同編集のカーソル表示</h2>
	<label class="flex ai:center gap:.5rem cursor:pointer">
		<input type="checkbox" checked={enabled} onchange={toggle} />
		<span>他の人のカーソルを表示</span>
	</label>
	<p class="fg:theme-text-secondary font:.875rem">
		共有プロジェクトで同じシーンを開いている人のカーソルと選択範囲を、本文に色付きで表示します。オフにすると、通信量を抑えるため自分のカーソルも他の人に送りません(誰がどのシーンを開いているかの表示は変わりません)。この設定はこの端末だけに保存されます。
	</p>
</Card>

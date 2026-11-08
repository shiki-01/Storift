/**
 * 資料リンクの遷移の中身(SvelteKit に依存しない部分。テストしやすいよう分けてある)。
 */
import { itemNav } from '$lib/stores/itemNav.svelte';

/**
 * path のページで項目 id を選ぶよう依頼し、別のページにいるときだけ移動する。
 * すでにそのページにいるときに goto すると、MasterDetail が履歴に持つ選択(page.state)が空に戻り、
 * 依頼した選択が打ち消される(同じページ内で別の項目へ連続して移れなくなる)。
 */
export async function selectAndGo(
	path: string,
	id: string,
	currentPath: string,
	go: (path: string) => Promise<void>
): Promise<void> {
	itemNav.select(path, id);
	if (path !== currentPath) await go(path);
}

/**
 * 「このページの、この項目を選択して」という依頼。
 * AI の回答中の資料リンクから、プロット・人物・設定資料・執筆(シーン)のページへ項目を選ばせるのに使う。
 * 依頼を出してからページを移動してもよい(移動先のページが開いたときに受け取る)。
 */
let request = $state<{ path: string; id: string } | null>(null);

export const itemNav = {
	get request() {
		return request;
	},
	select(path: string, id: string) {
		request = { path, id };
	},
	/** path 宛ての依頼があれば、取り出して消す */
	take(path: string): string | null {
		if (!request || request.path !== path) return null;
		const id = request.id;
		request = null;
		return id;
	}
};

/**
 * 画面の見出し(タイトルバー・スマホの上部バー)に出す「選択中の対象名」。
 * プロット・人物・設定資料の各ページが、選んでいる項目の名前をここへ入れる。
 * 画面のパス付きで持つので、画面が切り替わった直後に前のページの名前が残って見えることはない。
 */
let path = $state('');
let label = $state('');

export const pageContext = {
	/** 現在のパスに対する選択中の名前(別の画面のものなら空) */
	detailFor(pathname: string): string {
		return path === pathname ? label : '';
	},
	setDetail(pathname: string, value: string) {
		path = pathname;
		label = value;
	}
};

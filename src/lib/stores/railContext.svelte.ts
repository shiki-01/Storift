/**
 * 左端のレールが「作品の中」のタブを出し続けるための記憶。
 * 作品の画面から設定へ移動しても、レールは作品のタブのままにして、作品へ戻れるようにする。
 * ホーム(作品一覧)へ戻ったら忘れる。
 */
let projectId = $state('');

export const railContext = {
	get projectId() {
		return projectId;
	},
	set projectId(value: string) {
		projectId = value;
	}
};

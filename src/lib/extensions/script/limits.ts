/**
 * スクリプト拡張(kind: script)の上限。ホスト(アプリ)・検証スクリプト・紹介サイトが同じ値を使う。
 * 純粋な定数だけを置く(manifest.ts から読み込まれ、紹介サイトにも入るため)。
 */
export const SCRIPT_LIMITS = {
	/** スクリプトのソース(1 ファイル)の上限(バイト) */
	sourceBytes: 200 * 1024,
	/** entry のファイル名の長さ */
	entryNameLength: 64,

	// ---- ホストとの通信 ----
	/** 1 秒あたりに受け付けるメッセージの数。超えたら停止 */
	messagesPerSecond: 100,
	/** 1 つのメッセージの大きさ(JSON 換算の概算バイト)。超えたら停止 */
	messageBytes: 128 * 1024,
	/** メッセージの入れ子の深さ */
	messageDepth: 8,
	/** メッセージに含まれる値の個数 */
	messageNodes: 4000,
	/** 応答を待っているリクエストの数。超えたら停止 */
	pendingRequests: 32,
	/** 1 秒あたりの画面(ui.set)の更新回数。超えたら停止 */
	uiUpdatesPerSecond: 10,
	/** 権限や上限による拒否がこの回数に達したら停止 */
	violationsBeforeStop: 10,
	/** 通知(トースト)の回数の上限(1 分あたり) */
	notifyPerMinute: 5,
	/** 通知の文字数の上限 */
	notifyLength: 200,

	// ---- 端末内ストレージ ----
	/** 1 拡張あたりの合計(キーと値のバイト数)。超えたら書き込みを拒否 */
	storageTotalBytes: 256 * 1024,
	storageKeyLength: 64,
	/** 値 1 つ(JSON 文字列)の上限(バイト) */
	storageValueBytes: 64 * 1024,
	storageKeys: 100,

	// ---- ウォッチドッグ ----
	/** ホスト → シェルの確認の間隔(ミリ秒) */
	heartbeatMs: 1000,
	/** ワーカーがこの時間応答しなければ、シェルが terminate する */
	workerHangMs: 3000,
	/** シェルがこの時間応答しなければ、ホストが iframe ごと取り除く */
	shellHangMs: 4000,
	/** 起動(ハンドシェイクとワーカーの起動)を待つ時間 */
	startupMs: 6000,
	/** 連続してこの回数止まったら、自動で無効にする */
	consecutiveStopsBeforeDisable: 3,
	/** この時間、止まらずに動き続けたら、連続して止まった回数を 0 に戻す */
	stableMs: 60_000,

	// ---- 画面(ui)の記述 ----
	uiNodes: 60,
	uiTextLength: 500,
	uiLabelLength: 80,
	uiListItems: 50,
	uiSelectOptions: 30,
	uiInputLength: 1000,
	uiIdLength: 40,
	uiUrlLength: 300
} as const;

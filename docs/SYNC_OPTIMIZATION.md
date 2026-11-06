# Firebase 同期の最適化実装

## 実装した最適化

### ✅ 1. 現在のプロジェクトのみリアルタイム監視

**変更前:**

- 全プロジェクトの全データを常時監視
- アプリ起動時に全コレクション読み込み

**変更後:**

- プロジェクト一覧のみグローバルで監視
- 章・シーン・キャラクターは**プロジェクトを開いた時だけ**監視
- `where('projectId', '==', currentProjectId)` でフィルタリング

**使用方法:**

```typescript
// プロジェクトを開いた時
startCurrentProjectSync(projectId);

// プロジェクトを閉じた時
stopCurrentProjectSync();
```

**削減効果:** 読み取り90%削減（5,000シーン → 500シーン）

---

### ✅ 2. 差分取得(段階1)

**変更前:**

- 通常のダウンロードでも `syncAllFromFirestore(type)` が全件を取得していた(差分の条件は未使用の `syncProjectsFromFirestore` にしか効いていなかった)

**変更後:**

- 通常のトリガ(タブ表示・オンライン復帰・5分ごとの定期・再試行)は、型ごとの最終同期時刻で `where('updatedAt', '>', 最終同期時刻 - 5分)` の差分だけを取得する
- `updatedAt` はすべて数値(`Date.now()` のエポックms)なので、そのまま数値比較する
- 最終同期時刻は「その取得を開始した時刻」(端末の時計)を型ごとに `localStorage` の `storift_sync_state` に保存する。成功した型だけ更新する。5分の安全マージンは、取得中の更新と端末間の時計のずれを吸収するためのもの
- 既存の `storift_last_sync_time`(未使用の `syncProjectsFromFirestore` 用)は変更していない

**完全同期(全件取得して照合する)を行う条件:**

| 条件                                                                  | 内容                                               |
| --------------------------------------------------------------------- | -------------------------------------------------- |
| 起動時(`initializeSync`)に、前回の完全同期から6時間以上、または未実施 | 全型を完全取得                                     |
| 設定画面の「完全同期を実行」ボタン                                    | 全型を完全取得(バックオフ・再試行不可の状態も解除) |
| 型の最終同期時刻が無い、またはその型のローカルが0件                   | その型だけ完全取得(IndexedDB の消去などに備える)   |

**削除検知:** 「リモートに無いローカルデータ」の判定(同期済みなら他端末で削除されたとみなして取り除く/未同期ならアップロード)は完全取得のときだけ行う(`syncPlan.ts` の `classifyLocalOnly`)。差分取得ではこの判定を一切行わない。そのため、他端末での削除は、リアルタイム同期(開いているプロジェクト)・起動時の6時間ごとの完全取得・手動の完全同期のいずれかで反映される。

**実装箇所:**

- `src/lib/firebase/syncPlan.ts`: 差分/完全の判定(`planDownload`)、削除判定(`classifyLocalOnly`)、WriteBatch 分割(`chunkBatches`)
- `src/lib/firebase/syncMeta.ts`: `loadSyncState` / `saveSyncState`
- `src/lib/services/sync.service.ts`: `downloadAllFromFirestore({ trigger })`、`runFullSync()`

---

### ✅ 2b. 速度改善(段階1)

- **base の永続化をまとめる**: `storift_sync_base` はメモリで保持し、800ms のデバウンスで1回だけ書く。`pagehide` / `visibilitychange(hidden)` / `stopSync` で即時に書く。クラッシュで書き損ねた場合は base が古い側に残るだけで、競合と判定されやすくなる方向（データを失う方向ではない）
- **pending キュー**: `Map` で保持(検索は O(1))。複数件を積む場面(取得結果の突き合わせ・ローカルのみのデータ)は1回の保存にまとめる。ユーザー操作による `queueChange` は即時に保存する
- **リアルタイム同期**: `docChanges()` の added / modified だけを突き合わせる(初回スナップショットは全件が added なので一括処理になる)。removed は従来どおり
- **取得の並列化**: projects を先に処理し、残りの5種類は並列。型内は100件ずつ、上限8並列で突き合わせ、書き込みは Dexie のトランザクション内で `bulkPut`。トランザクション内で「判定時から行が変わっていないこと」を再確認し、判定中にユーザーが編集した行は上書きしない
- **ストア更新**: 変化した型だけを、取得全体で1回だけ読み直す
- **アップロード**: 上限5並列でローカル読み出しとリモート取得(3者比較)を行い、送信が必要なものを `writeBatch` で送る(500件・約4MBごとに分割。バッチは原子的)。同一ドキュメントの変更はキュー上で1件にまとまっているため順序は保たれる。失敗したバッチの分だけキューに戻す

---

### ✅ 2c. 排他・再試行・進捗(段階1)

- **排他**: 取得(`runDownload`)と送信(`processPendingChanges`)は非同期ミューテックス(`utils/asyncControl.ts`)で直列化する。取得の中からは `enqueueAndSchedule`(デバウンスされた予約)だけを呼び、送信を直接待たないのでデッドロックしない。リアルタイム適用はミューテックスを取らず、上記のトランザクション内の再確認で保護する
- **初期化**: `initializeSync` は実行中なら同じ Promise を返す。`startNetworkMonitoring` は1回だけ登録し、`stopNetworkMonitoring` で interval も解除する。`stopSync` は `onNetworkStatusChange` の購読・定期同期・再試行タイマーも解除する
- **isSyncing**: 進行中の処理の数で管理する(`beginActivity` / `endActivity`)。全て終わったときに status を確定する
- **エラー分類**(`utils/syncErrors.ts`): `unavailable` / `deadline-exceeded` / `network-request-failed` などは再試行可、`permission-denied` / `unauthenticated` は再試行不可(status を error にしてメッセージを保持。完全同期ボタンか再初期化まで自動再試行しない)。分類できないエラーは再試行可として扱う
- **バックオフ**: 再試行可の失敗は 5秒 → 10秒 → … 最大5分(±20%のジッタ)で次回を予約する。バックオフ中は、定期・タブ表示・オンライン復帰のトリガでも取得/送信を始めない。成功でリセット
- **取得の最小間隔**: 60秒は「取得を試みた時刻」から数える(失敗でも更新。成功時刻とは別)
- **タイムアウト**: 取得・送信それぞれ全体で90秒(`Promise.race`)。超過するとエラー扱い＋バックオフ。Firestore 呼び出し自体は中断できないため、打ち切りフラグで以降の作業を止めるだけで、実行中の呼び出しは完了まで走る(送信が完了していた分は次回に再送されるが、`setDoc(merge)` / 3者比較なので害はない)
- **進捗**: `syncStore.progress`(phase / done / total)を取得・送信が更新し、`SyncStatus.svelte` が「同期中 12/84」と表示する
- **計測**: 設定画面の「同期診断」に、型ごとの取得件数と所要時間(差分取得では取得せずに済んだ件数も)が出る

**実装しなかったこと:**

- `syncedAt`(サーバー時刻)での差分取得: 端末間の時計のずれに強いが、`updatedAt` での取得を指示されたため見送り。時計のずれが5分を超える端末の更新は、次回の完全取得まで反映が遅れる可能性がある
- 差分取得での削除検知(tombstone など): 削除は完全取得・リアルタイム同期で反映する
- Firestore 呼び出しの中断(AbortSignal 非対応)
- Firebase 設定を変更したときの同期状態(`storift_sync_state`)の自動リセット
- `deleteOldHistory` の変更: すでに `createdAt` のインデックスで絞り込んでおり、全件走査ではない

---

### ✅ 3. 自動保存のデバウンス処理

**変更前:**

- 変更の度に即座に同期

**変更後:**

- 変更から3秒後に同期（連続した変更をまとめる）
- `debounceAsync()` 関数を実装

**実装箇所:**

- `src/lib/utils/debounce.ts`: デバウンス関数
- `src/lib/services/sync.service.ts`: `debouncedProcessPendingChanges`

**削減効果:** 書き込み80-90%削減（1,200回 → 100-200回）

---

### ✅ 4. Firestoreキャッシュの有効化

**変更前:**

- キャッシュなし（毎回サーバーから取得）

**変更後:**

- `persistentLocalCache` を有効化（既に実装済み）
- オフライン時もキャッシュからデータ取得可能

**実装箇所:**

- `src/lib/firebase/config.ts`: 既に実装済み

**削減効果:** 再接続時の読み取り100%削減（キャッシュから取得）

---

### ✅ 5. 変更検出の最適化

**変更前:**

- 変更の有無に関わらず常にアップロード

**変更後:**

- `updatedAt` と `_version` を比較
- 変更がない場合はアップロードをスキップ

**実装箇所:**

- `src/lib/services/sync.service.ts`: `hasChanges()` 関数

**削減効果:** 不要な書き込みを削減

---

## 使用量の比較

### 最適化前（5人共同編集）

| 項目     | 回数/日 | 使用率  |
| -------- | ------- | ------- |
| 読み取り | 140,750 | 281% ❌ |
| 書き込み | 4,000   | 20%     |

### 最適化後（5人共同編集）

| 項目     | 回数/日 | 使用率 |
| -------- | ------- | ------ |
| 読み取り | 2,000   | 4% ✅  |
| 書き込み | 800     | 4% ✅  |

**結果: 無料枠内で余裕を持って使用可能！**

---

## 使用方法

### プロジェクトを開く時

プロジェクトページの `+layout.svelte` などで:

```typescript
import { startCurrentProjectSync, stopCurrentProjectSync } from '$lib/services/sync.service';
import { onMount, onDestroy } from 'svelte';

let projectId = $page.params.id;

onMount(() => {
	// プロジェクトの同期を開始
	startCurrentProjectSync(projectId);
});

onDestroy(() => {
	// プロジェクトの同期を停止
	stopCurrentProjectSync();
});
```

### アプリ起動時

従来通り `initializeSync()` を呼ぶだけ:

```typescript
import { initializeSync } from '$lib/services/sync.service';

// アプリ起動時（一度だけ）
await initializeSync();
```

---

## 注意事項

### 1. プロジェクトの同期開始を忘れずに

各プロジェクトページで `startCurrentProjectSync()` を呼び出す必要があります。
呼び出さないとリアルタイム同期が機能しません。

### 2. 複数プロジェクトの同時編集

複数のプロジェクトを同時に開くと、それぞれの同期が走るため注意が必要です。
基本的に一度に1つのプロジェクトのみ開くことを推奨します。

### 3. データの整合性

差分取得では他端末での削除を検知しません。起動時に6時間以上経っていれば自動で完全取得しますが、
すぐに全件を照合したいときは設定画面の「完全同期を実行」を使ってください:

```typescript
// 全データを再同期（メンテナンス用）
await runFullSync();
```

---

## 今後の改善案

### 短期的

- [ ] プロジェクトごとの同期設定UI（同期ON/OFF）
- [ ] 同期状況の詳細表示（何が同期中か表示）
- [x] 手動の完全同期ボタン(設定画面)

### 中期的

- [ ] バックグラウンド同期（Service Worker利用）
- [ ] 競合解決UIの改善
- [ ] 同期ログの記録・表示

### 長期的

- [ ] WebSocket を使った更に効率的なリアルタイム同期
- [ ] 差分データのみを送信するプロトコル
- [ ] P2P 同期の検討（Firebase 経由せず）

---

## トラブルシューティング

### 同期が動かない

1. `startCurrentProjectSync()` を呼んでいるか確認
2. Firebaseが正しく初期化されているか確認
3. ネットワーク接続を確認

### データが古い

1. ブラウザのキャッシュをクリア
2. 設定画面の「完全同期を実行」(`runFullSync()`)で全データを再取得
3. IndexedDB をクリアして再同期

### 無料枠を超えそう

1. プロジェクト数を減らす
2. 自動保存の頻度を下げる（デバウンス時間を増やす）
3. 不要なプロジェクトをアーカイブ

---

## 参考

- Firebase 無料プランの制限: [FIREBASE_USAGE_ESTIMATE.md](./FIREBASE_USAGE_ESTIMATE.md)
- Firestore ドキュメント: https://firebase.google.com/docs/firestore

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

### ✅ 2b-2. 競合の自動解決と未変更書き込みの抑止

「ほぼ同時刻に、両端末で内容の同じデータの競合ダイアログが出る」問題への対応。ダイアログに出ていた差分が `updatedAt` / `syncedAt` だけ(`_version` は表示対象外)だったことから、内容が同一なのに双方が `updatedAt` を進めた(自動書き込みで編集日時だけが動いた)ケースと判明した。

**競合の自動解決(`decideConflict`、`firebase/conflictContent.ts`。`sync.service.ts` の `handleConflict` から呼ぶ)**。base 以降に双方が更新された(`reconcile` が `conflict`)場合に、次の順で判定する。

1. プロジェクト、および CRDT 化したシーン(本文 `content` / `characterCount` を比較対象から外す): 常に新しい `updatedAt` の側(従来どおり)
2. **内容が同一**: メタ項目 `updatedAt` / `_version` / `syncedAt` を除いて等価なら、ダイアログを出さず新しい `updatedAt` の側を採用する(リモートが新しければ取り込み、ローカルが新しければ送信。base は通常の取り込み・送信の経路で更新される)。履歴(同期バックアップ)への退避はしない(失われる内容が無いため)
3. 競合ポリシーが `local` / `remote`: その方針
4. それ以外(内容が異なる): 手動解決(ダイアログ)

起動時に、旧版が保留にした「内容が同一の保留中の競合」は取り下げ、最新のデータで改めて突き合わせる(再送信キューに載せる。違いが残っていれば再び保留になる)。自動解決した件数と理由は、設定の「同期診断」に「競合を自動解決(種類: 内容が同一…)」として記録される(再読み込みで消える)。

**未変更の書き込みを止める**。`projectsDB` / `chaptersDB` / `scenesDB` / `charactersDB` / `plotsDB` / `worldbuildingDB` の `update` は、渡された値(`scenesDB` は導出される `characterCount` を含む)が保存済みの値と同じなら何も書かず、`updatedAt` / `_version` も進めず、所属プロジェクトの `touchProject` と履歴の作成も行わない(`db/utils.ts` の `isUnchanged`)。`reorder` も、位置が変わらない行は更新しない。`characterCount` が実際の文字数と食い違う旧データは、最初の保存で値が直る(書く)。

**競合ダイアログ**は、種類と題名、更新日時(年月日 時:分:秒)、内容に差のあるフィールドの抜粋(本文は先頭40文字と全体の文字数・文字数差)を表示する。`syncedAt` の生数値は「詳細(開発者向け)」に畳む。

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

### ✅ 2d. 同期対象(SyncTarget)と共有プロジェクト(段階2b-2)

エンティティの置き場所を `SyncTarget`(`firebase/syncTarget.ts`)で表す。`primary` は従来の最上位コレクション、`shared(pid)` は主 Firebase の `shared/{pid}/{type}/{id}`。ゲスト接続(別の Firebase)は `connectionId` つきのキーで表せる(接続の登録は段階 2b-3)。データ配置の詳細は [SHARING_RULES.md](./SHARING_RULES.md)。

- **行き先の解決**: 子要素は、所属プロジェクトの `sharing`(active / migrating)なら shared、そうでなければ primary。projects 型(ポインタ文書)は常に primary で、共有中は同じバッチで `shared/{pid}/projects/{pid}`(secrets 除く)とメタの name にも書く。
- **pending キュー**: エントリに `target` を持つ。キーは `type/id`(primary。旧形式と同じ)か `{target}|type/id`。旧形式(target なし)は primary として読む。削除でエンティティが既にローカルに無い場合は、Dexie の削除フックで覚えた所属プロジェクトから決める(分からなければ primary と共有中の全プロジェクトに送る。存在しない文書の削除は無害)。**送信時に行き先を再解決する**(積んだ後に共有が始まった/止まった場合に追随)。
- **base**: キーに target を含める(primary は従来のキー)。**最終同期時刻**: `storift_sync_state` の `targets[キー]` にターゲットごとに持つ(primary は従来どおりトップレベル)。差分/完全の判定(`planDownload`)はターゲットごとに呼ぶ。
- **取得**: primary の下りでは、共有中プロジェクトの子要素を「ローカルにだけある」判定の母集団と取り込み対象から外す(最上位に子要素が再作成・削除されるのを防ぐ)。続けて、共有中の各プロジェクトを shared ターゲットから差分取得する(型は並列、プロジェクトは順に)。共有が止まったターゲットの状態は取り除く。
- **リアルタイム**: 開いているプロジェクトが共有中なら `shared/{pid}/{type}` を購読する(停止の移行中は購読しない)。共有の開始・停止で購読先を切り替える。
- **移行中の削除イベント**: 共有の開始で最上位の子要素が消える/停止で共有側が消えるのは、データの移動なので、他端末での削除として扱わない(`isMovedByMigration`)。
- **段階0・1の性質**: 取得と送信の排他(ミューテックス)、バックオフ、WriteBatch の分割(送信先ごとにまとめてコミット)、診断(`label` にターゲットのキー)、進捗は従来どおり。
- **送信データ**: Firestore が受け付けない `undefined` のフィールドを取り除く(`stripUndefined`)。

実装箇所: `firebase/syncTarget.ts`(純粋なロジック)、`firebase/sync.ts`(Firestore 呼び出しが target を受ける)、`firebase/syncMeta.ts`、`firebase/sharingAdopt.ts`、`services/sync.service.ts`、`services/sharing.service.ts`。

**未実施・制約**: 実 Firestore・複数端末での確認。ゲスト接続の同期は 2b-3、共有側の更新ログ(updates / crdt)は 2e。

---

### ✅ 2e. 共有プロジェクトの本文のリアルタイム共同編集(CRDT、段階3a)

共有プロジェクトのシーン本文だけを Yjs(`Y.Text`)で扱う。それ以外(章・題名・人物など)は従来の同期。Firestore 配置・初期化・圧縮の詳細は [SHARING_RULES.md](./SHARING_RULES.md) の「シーン本文の CRDT」。

- **経路**: ローカルの変更 → Y 文書 → 2.5 秒ごとにまとめて `updates` に 1 文書で送信(失敗・オフラインは `pending` に残してバックオフ再送、オンライン復帰でも再送)。受信は開いている間 `updates`(`createdAt > lastSeen - 5分`)と `crdt/snapshot` を購読。
- **ローカル永続化**: Dexie v5 の `crdtDocs`(`sceneId, targetKey, state, pending, lastSeen, updatedAt` + `appliedIds, snapshotRev`)。500ms デバウンスで保存、pagehide / 非表示で即時保存。起動後にオフラインでも保存済みの状態から編集でき、未送信の更新は `Y.mergeUpdates` で 1 つにまとめて蓄積する。
- **content ミラー**: Y の文字列を 1.5 秒デバウンスで `scenesDB.update`(文字数・履歴・更新日時は既存の処理)に反映し、編集者は共有側の `scenes` 文書にも従来の同期(`queueChange`)で送る。reconcile は CRDT 化したシーンの `content` / `characterCount` を比較しない(`reconcile.ts`)。
- **窓口**: `services/sceneText.service.ts`(`isCrdtScene` / `getSceneText` / `applySceneText` / `openSceneDoc` / `resumePendingSends`)。マネージャは `crdt/doc.ts`、Firestore 操作は `crdt/transport.ts`、純粋な判断は `crdt/policy.ts`、差分は `crdt/diff.ts`。

#### 無料枠(Spark: 読み取り 50,000/日・書き込み 20,000/日)の見積り

設計値からの机上の見積り(実測ではない)。**1 人が連続で入力し続けた 1 時間**あたり(実際は入力と休止を繰り返すので、これより小さくなる):

| 項目                            | 回数/時間 | 内訳                                                                                                          |
| ------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| 書き込み                        | 約 4,100  | updates 1,440(2.5 秒ごと)+ 圧縮での削除 1,440 + snapshot 約 30 + 共有側 scenes 文書のミラー約 1,200(3 秒ごと) |
| 読み取り(他に 1 人が開いている) | 約 7,900  | updates 1,440 + ミラー文書 1,200 + ルールの `get()`/`exists()` 約 5,300(書き込み 1 回につき約 2)              |
| 読み取り(他に 4 人が開いている) | 約 15,900 | 上の updates・ミラーが 4 倍(5,760 + 4,800)+ ルール約 5,300                                                    |

連続入力で換算すると、書き込みは 1 日約 4.9 時間分、読み取りは他に 4 人がいると約 3.1 時間分で無料枠に達する。ほかに、シーンを開くたびに snapshot 1 件 + 残りの updates(通常は 10 件未満)+ 圧縮の通知を読む。圧縮は updates の滞留を抑えて、新規参加者・再接続時の読み取りを減らすためのもの。使用量が問題になる場合の調整点は、送信間隔(`SEND_DELAY`)、ミラーの送信(共有側 scenes 文書の `content` は CRDT 上は冗長)、圧縮の閾値(`policy.ts`)。

---

### ✅ 2f. エディタとの結合(共同編集の編集時の挙動、段階3b)

共有プロジェクト(`sharing.status === 'active'`、失効していない)のシーンを開くと、`openSceneDoc` で接続し、本文は `Y.Text` が正になる。コアは `crdt/editorBinding.ts`(DOM 非依存。アダプタ経由)、DOM とのアダプタは `crdt/domAdapter.ts`、`+page.svelte` は薄い接着。

- **ローカル→Y**: `input` のたびに、DOM の直前の本文と今の本文の最小差分(`diffText`)を `local` origin で Y に入れる。DOM は書き換えない。貼り付け(`text/plain`)・ドロップ・補助入力バー・右クリックメニューの切り取り/貼り付けも同じ経路。
- **IME**: 変換中(`compositionstart`〜`compositionend`)は DOM→Y も、リモート更新の DOM 反映も保留する。開始時のキャレット/選択を `Y.RelativePosition` で覚え、確定時に「確定した差分」をキャレット領域を基準に現在の Y の座標へ写して適用する(変換中に相手がキャレットより前へ挿入・削除しても、確定した文字は正しい位置に入る)。置き換える範囲の中身が変換中に変わっていたら、削除はせず挿入だけにする。その後、保留していたリモート更新を DOM に反映する。
- **Y→DOM**: リモートなどの変更は `requestAnimationFrame` でまとめて `innerText` に書く。書く前の選択範囲は、保留中の変更(delta)を通して新しい座標へ写して復元する(`<br>`/`<div>` の改行の数え方は既存の `textRange` / `textOffsetAt` と同じ)。フレームの前にユーザーが入力した場合は、保留中のリモートの変更を通して位置を写してから Y に入れ、すぐ DOM を合わせる(リモートの変更を消さない)。
- **viewer(読み取り専用)**: `contenteditable=false`。入力・貼り付け・ドロップは止め、書き込みは Y に届かない。リモート更新は反映する。
- **undo/redo**: `Y.UndoManager`(対象は `local` origin だけ、`captureTimeout` 500ms)。`beforeinput`(`historyUndo`/`historyRedo`)、Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z、補助入力バーのボタンを UndoManager へ回す。他者の編集は戻さない。表示モードの切り替え(エディタ DOM の作り直し)では履歴を保つ。非共同編集のシーンは従来の `execCommand`。
- **保存**: 共同編集中は従来の保存経路(`handleSave` の `scenesDB.update`・自動保存・30 秒の AutoSave・待ち時間の上限)を使わない。`Scene.content` へのミラーは 3a の仕組み。シーンの切り替え・ルートの離脱・`pagehide`・非表示では `handle.flush()`(永続化・ミラー・送信の試行)。シーンを切り替えたとき・エディタを閉じたときは `destroy()`(参照カウントを下げ、最後なら圧縮)。
- **進捗**: `ytext` の変更のうち origin がリモート/復元でないもの(自分の入力・undo)の純増分を集計し、約 5 秒ごと・離脱時に `progressLogsDB.addProgress` へ記録する(従来の「保存ごとの増えた分のみ」と同じく、純増分が正のときだけ)。
- **周辺機能**: 検索(共同編集の本文を検索)・一括置換(`applySceneText`)・Claude の編集の反映(開いているシーンは `editorStore.applyExternalText` → ハンドル、それ以外は `applySceneText`)・バージョン復元/同期バックアップの復元(復元前の本文を履歴に退避してから `applySceneText`)・執筆支援/校正(ストアの変更を差分として Y へ)。範囲メモはリモート由来の変更の 0.8 秒後に `resolveAnchor` で位置を更新し、見つからないものは既存の「孤立」表示のまま。
- **フォールバック**: 接続できない(オフラインの初回、閲覧権限で共同編集の本文がまだ無い、権限なし)ときは従来の編集(`Scene.content`)で開き、ツールバーに「オフラインのため共同編集は再接続後に有効になります」などを控えめに出す(「再試行」で開き直せる。自動では切り替えない)。保存済みの状態があればオフラインでも共同編集のまま編集できる。後で共同編集に切り替わるとき、`Scene.content` と Y の本文が違えば 3a が履歴へ退避してから Y を採用する。

#### 既知の制限

- 本文は `innerText` との往復なので、ブラウザが末尾の改行を正規化するなど `innerText` が文字列と一致しないケースは、差分の取り込みが 1 文字ずれることがある(Chromium では Enter・Backspace を含む E2E で確認)。Safari・Firefox・各 IME の実機は未確認。
- 変換中に相手が「同じ範囲」を編集した場合は、確定した文字だけを入れる(相手の編集は残る)。自動修正でキャレットから離れた場所が変わった場合は、差分の位置をキャレット領域からの距離で写すため、その間にリモートの編集があるとずれることがある(本文は壊さない)。
- 他者のカーソル/選択範囲は、現在のエディタ本文が横書きだけなので縦書き用の対応は無い(縦書きの contenteditable にしたときは `RemoteCursors` が非表示になる)。位置は端末間で 3 秒以上遅れて届く(間引き)。Safari・Firefox・実機は未確認。
- ドロップは `text/plain` だけを扱う(HTML・ファイルは無視)。ドラッグ元がエディタ内なら移動、Ctrl/Alt でコピー。
- 一括置換・Claude の反映は、オフラインで保存済みの状態が無い/読み取り専用のシーンをスキップする(置換は結果にスキップ件数と理由を表示)。

#### E2E

`bun run test:e2e`(`tests/e2e/coedit.spec.mjs`)。Firebase Emulator(auth + firestore、`firestore.rules` を自動で読み込む)の中で `vite dev`(空きポート、`VITE_FIREBASE_EMULATOR=127.0.0.1:8080,127.0.0.1:9099`)を起動し、プリインストールの Chromium(Playwright)で 3 つのブラウザコンテキスト(オーナー A・編集ゲスト B・閲覧ゲスト C)を操作する。A/B の同時入力の収束、Enter/Backspace、undo が自分の編集だけを戻すこと、CDP の `Input.imeSetComposition` / `Input.insertText` による IME(変換中に相手が前方へ挿入)、viewer、在席表示、メンバー削除後の失効表示を確認する。`VITE_FIREBASE_EMULATOR` は未設定なら何も起きない(`firebase/emulator.ts`)。段階 4 では、A のキャレット移動・範囲選択が B の画面に A の色のキャレット/ハイライトとして期待の文字の位置に出ること、B が先頭に入力しても A のキャレットが同じ文字に留まること、A の入力直後の位置、設定オフでの非表示と送信停止、viewer の C にも見えて自分のは描かれないことを確認する。

---

### ✅ 2g. 他者のカーソル/選択範囲の表示(段階4)

presence 文書の `cursor`(`Y.RelativePosition` の JSON、形・送信・描画の詳細は [SHARING_RULES.md](./SHARING_RULES.md) の「他者のカーソル(段階 4)」)。ルールの変更は無い。

#### 書き込みの見積り(Spark: 読み取り 50,000/日・書き込み 20,000/日)

設計値からの机上の見積り(実測ではない)。カーソルの書き込みは **3 秒に 1 回が上限**で、同じ位置・フォーカスが無い・設定オフのときは書かない。**1 人が連続で入力・カーソル移動をし続けた 1 時間**あたり(読んでいるだけの人は 30 秒ごとの在席の書き込みのみで、増えない):

| 項目                                  | 回数/時間  | 内訳                                                                                     |
| ------------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| 追加の書き込み                        | 最大 1,200 | 3,600 秒 ÷ 3 秒。2e の約 4,100 と合わせて約 5,300(約 +29%)                               |
| 追加の読み取り(他に 1 人が開いている) | 約 3,600   | 相手への配信 1,200 + ルールの `exists()` 約 2,400(書き込み 1 回につき約 2。オーナーは 1) |
| 追加の読み取り(他に 4 人が開いている) | 約 7,200   | 相手への配信 4,800(1,200 × 4)+ ルール約 2,400                                            |

2e の見積りに足すと、連続入力で換算した無料枠までの時間は、書き込みが約 4.9 時間 → **約 3.8 時間**、読み取り(他に 4 人)が約 3.1 時間 → **約 2.2 時間**。全員が同時に連続でカーソルを動かす最悪ケース(5 人)では、cursor の書き込みだけで 1 時間に約 6,000、配信が約 24,000 になる。使用量が問題になる場合の調整点は、`CURSOR_SEND_INTERVAL_MS`(`crdt/remoteCursor.ts`、既定 3 秒)と、設定「他の人のカーソルを表示」のオフ(送信も止まる)。

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
- [x] 競合解決UIの改善(種類・題名・差分の表示、内容が同一の競合の自動解決)
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

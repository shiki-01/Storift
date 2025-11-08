# Firestore セットアップガイド

## 重要な変更

このアプリは**共有コレクション方式**を使用しています。
同じFirebase設定を使用するすべてのブラウザ・端末で、データがリアルタイムに同期されます。

## データ構造

```
projects/
  {projectId}/
    - id
    - title
    - description
    - createdAt
    - updatedAt
    - syncedAt
    - _lastModifiedBy

chapters/
  {chapterId}/
    - id
    - projectId
    - title
    - ...

scenes/
  {sceneId}/
    - id
    - chapterId
    - projectId
    - content
    - ...
```

ユーザー別の分離はなく、認証済みであれば全データにアクセスできます。

## セキュリティルールの設定

Firebase Consoleで以下の手順を実行してください:

1. **Firebase Console** (https://console.firebase.google.com/) を開く
2. プロジェクトを選択
3. 左メニューから **Firestore Database** を選択
4. **ルール** タブをクリック
5. 以下のルールをコピー＆ペースト:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    // 認証済みユーザー（匿名含む）のみアクセス可能
    match /{collection}/{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

6. **公開** をクリック

## 動作確認

1. ChromeとEdgeで同じFirebase設定を入力
2. 両方とも「保存して開始」をクリック
3. 片方のブラウザでプロジェクトを作成
4. もう片方のブラウザに即座に表示されることを確認

## トラブルシューティング

### データが同期されない場合

1. **ブラウザのDevToolsを開く** (F12)
2. **Console** タブを確認してエラーメッセージを探す
3. よくあるエラー:
   - `Missing or insufficient permissions` → Firestoreルールが正しく設定されていない
   - `Auth not initialized` → ページをリロードしてみる

### 既存データの移行

以前のユーザー別コレクション (`users/{uid}/projects`) にデータがある場合:

1. Firebase Consoleで **Firestore Database** を開く
2. 古いデータを手動で新しいコレクション構造にコピー
3. または、アプリ側で一度全データをダウンロードして再アップロード

## セキュリティについて

現在の実装では、同じFirebase設定を持つすべてのユーザーがデータを共有します。
これは個人用途や信頼できるメンバー間での使用を想定しています。

より強固なアクセス制御が必要な場合は、以下のいずれかを実装してください:

1. **メール/パスワード認証**: ユーザーごとにデータを分離
2. **招待制システム**: プロジェクトごとにアクセス権限を管理
3. **共有キー**: プロジェクトごとに共有キーを設定し、キーを持つユーザーのみアクセス可能

## 開発者向け情報

### データパスの変更点

**変更前:**

```typescript
doc(db, `users/${user.uid}/projects/${projectId}`);
```

**変更後:**

```typescript
doc(db, `projects/${projectId}`);
```

### リアルタイム同期の仕組み

1. `setupRealtimeSync()` が `onSnapshot()` でコレクション全体を監視
2. Firestoreで変更があると即座にコールバックが呼ばれる
3. ローカルのIndexedDBとStoreを更新
4. UIが自動的に再レンダリング

### オフライン対応

Firestoreの `persistentLocalCache` により、オフライン時も以下が可能:

- ローカルキャッシュからの読み取り
- 変更の一時保存（オンライン復帰時に自動同期）
- 競合の自動解決

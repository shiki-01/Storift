# データ移行ガイド

## 🔄 変更内容

データ構造を変更しました:

**旧形式:**
```
users/{userId}/projects/{projectId}
users/{userId}/chapters/{chapterId}
...
```

**新形式:**
```
projects/{projectId}
chapters/{chapterId}
...
```

## 📋 移行手順

### 方法1: クリーンスタート（推奨・簡単）

既存データを削除して、新しい構造で始める方法です。

#### ステップ1: ローカルデータをクリア

**Chrome:**
1. F12でDevToolsを開く
2. Application タブ
3. Storage → IndexedDB → `storift` を右クリック → Delete

**Edge:**
1. F12でDevToolsを開く
2. Application タブ
3. Storage → IndexedDB → `storift` を右クリック → Delete

#### ステップ2: Firestoreデータをクリア

**Firebase Console:**
1. https://console.firebase.google.com/ を開く
2. プロジェクトを選択
3. Firestore Database を開く
4. `users` コレクション全体を削除

#### ステップ3: セキュリティルールを更新

Firestore → ルール タブで以下をコピー＆ペースト:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    // 完全オープン（認証不要）
    match /{collection}/{document=**} {
      allow read, write: if true;
    }
  }
}
```

「公開」をクリック。

#### ステップ4: アプリをリロード

両方のブラウザでページをリロードして、新しい構造で使い始めます。

---

### 方法2: データ移行（既存データを保持）

既存データを新しい構造に移行する方法です。

#### ステップ1: Firebase Consoleでデータを確認

1. Firestore Database を開く
2. `users/{userId}/projects` のデータを確認

#### ステップ2: 手動でデータをコピー

各ドキュメントを新しい場所にコピー:

**旧:** `users/abc123/projects/project1`  
↓  
**新:** `projects/project1`

Firebase Consoleで:
1. 旧ドキュメントを開く
2. データをコピー
3. 新しいコレクション `projects` にドキュメントを作成
4. データをペースト

すべてのコレクション（projects, chapters, scenes, characters）で繰り返します。

#### ステップ3: セキュリティルールを更新

上記と同じルールを設定。

#### ステップ4: ローカルIndexedDBをクリア

DevTools → Application → IndexedDB → `storift` を削除

#### ステップ5: アプリをリロード

新しい構造のデータが自動的にダウンロードされます。

---

## ⚠️ 注意事項

- **バックアップ**: 移行前に重要なデータはバックアップしてください
- **テスト環境**: 可能であれば別のFirebaseプロジェクトでテストしてください
- **同時作業**: 移行中は複数ブラウザでの作業を避けてください

---

## ✅ 動作確認

移行後、以下を確認してください:

1. Chrome/Edgeでプロジェクト一覧が表示される
2. プロジェクトを作成 → 両方のブラウザに即座に表示
3. 片方で編集 → もう片方に即座に反映
4. オフラインで編集 → オンライン復帰時に同期

---

## 🆘 トラブルシューティング

### エラー: "Missing or insufficient permissions"

→ Firestoreルールが正しく設定されていません。上記のルールを再度設定してください。

### データが同期されない

1. F12でConsoleを確認
2. エラーメッセージを確認
3. ページをリロード
4. Firebase設定を確認

### 古いデータが表示される

→ IndexedDBをクリアしてページをリロードしてください。

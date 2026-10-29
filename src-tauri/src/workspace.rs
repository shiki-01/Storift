//! Claude Code が読むワークスペース。
//!
//! 原稿の正本はアプリ内の IndexedDB にあり、Claude Code からは読めない。
//! そこでアプリ側で全プロジェクトを Markdown に書き出し、このディレクトリに
//! 置く。Claude Code はここを作業ディレクトリとして起動し、Read / Grep で
//! プロジェクトを横断して参照する。書き出しは一方向(アプリ → ファイル)。

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

/// 前回書き出したファイルの一覧。消えたシーンなどのファイルを削除するのに使う
const MANIFEST: &str = ".storift-manifest.json";

#[derive(Deserialize)]
pub struct WorkspaceFile {
    /// ワークスペースからの相対パス("/" 区切り)
    path: String,
    content: String,
}

#[derive(Serialize)]
pub struct SyncResult {
    written: usize,
    removed: usize,
    unchanged: usize,
}

#[derive(Serialize)]
pub struct WorkspaceInfo {
    path: String,
}

pub fn workspace_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(crate::app_data_dir(app)?.join("workspace"))
}

/// 相対パスを検証して、ワークスペースの外を指さないものだけ通す
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel.is_empty()
        || rel_path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(format!("不正なパスです: {rel}"));
    }
    Ok(root.join(rel_path))
}

fn read_manifest(root: &Path) -> BTreeSet<String> {
    fs::read_to_string(root.join(MANIFEST))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// 中身が空になったディレクトリを、ワークスペースの直下まで遡って消す
fn remove_empty_parents(root: &Path, file: &Path) {
    let mut dir = file.parent();
    while let Some(d) = dir {
        if d == root || fs::remove_dir(d).is_err() {
            break;
        }
        dir = d.parent();
    }
}

#[tauri::command]
pub async fn workspace_sync(
    app: tauri::AppHandle,
    files: Vec<WorkspaceFile>,
) -> Result<SyncResult, String> {
    let root = workspace_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || sync_files(&root, files))
        .await
        .map_err(|e| e.to_string())?
}

fn sync_files(root: &Path, files: Vec<WorkspaceFile>) -> Result<SyncResult, String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let previous = read_manifest(root);
    let mut current = BTreeSet::new();
    let mut result = SyncResult { written: 0, removed: 0, unchanged: 0 };

    for file in files {
        let path = resolve(root, &file.path)?;
        current.insert(file.path);
        // 変わっていないファイルは書き換えない(更新日時を保ち、無駄な書き込みを避ける)
        if fs::read_to_string(&path).is_ok_and(|old| old == file.content) {
            result.unchanged += 1;
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&path, file.content).map_err(|e| e.to_string())?;
        result.written += 1;
    }

    // 前回は書き出したが今回は無いもの(削除・改名されたもの)だけを消す。
    // それ以外のファイルには触れない
    for stale in previous.difference(&current) {
        if let Ok(path) = resolve(root, stale) {
            if fs::remove_file(&path).is_ok() {
                result.removed += 1;
                remove_empty_parents(root, &path);
            }
        }
    }

    let manifest = serde_json::to_string(&current).map_err(|e| e.to_string())?;
    fs::write(root.join(MANIFEST), manifest).map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn workspace_info(app: tauri::AppHandle) -> Result<WorkspaceInfo, String> {
    Ok(WorkspaceInfo {
        path: workspace_dir(&app)?.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub fn workspace_open(app: tauri::AppHandle) -> Result<(), String> {
    let dir = workspace_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(dir, None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, content: &str) -> WorkspaceFile {
        WorkspaceFile { path: path.into(), content: content.into() }
    }

    #[test]
    fn rejects_paths_outside_workspace() {
        let root = Path::new("/tmp/ws");
        assert!(resolve(root, "../x.md").is_err());
        assert!(resolve(root, "/etc/passwd").is_err());
        assert!(resolve(root, "a/./b.md").is_ok());
        assert!(resolve(root, "").is_err());
    }

    #[test]
    fn writes_and_removes_stale_files() {
        let root = std::env::temp_dir().join(format!("storift-ws-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);

        let r = sync_files(&root, vec![file("p/a.md", "A"), file("p/sub/b.md", "B")]).unwrap();
        assert_eq!((r.written, r.removed), (2, 0));

        // 自分で置いたファイルは消さない
        fs::write(root.join("p/note.txt"), "keep").unwrap();

        let r = sync_files(&root, vec![file("p/a.md", "A")]).unwrap();
        assert_eq!((r.written, r.unchanged, r.removed), (0, 1, 1));
        assert!(!root.join("p/sub").exists());
        assert!(root.join("p/note.txt").exists());

        fs::remove_dir_all(&root).unwrap();
    }
}

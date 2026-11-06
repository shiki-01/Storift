//! AI プロバイダの API キーを OS のキーチェーンに保管する。
//!
//! macOS(Keychain)と Windows(資格情報マネージャー)だけで `keyring` を使う。
//! Linux などでは、キーチェーン(libdbus 等)への依存を避けるため未対応とし、`"unsupported"` を返す。
//! フロントエンド(`src/lib/ai/secrets.ts`)はそのとき localStorage へ保存する方式に切り替える。
//! キーの値はログやエラー文に含めない。

/// 未対応の環境で返す値(フロントエンドの `UNSUPPORTED` と一致させる)
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const UNSUPPORTED: &str = "unsupported";

/// キーチェーンでの項目名の組(サービス名, アカウント名)。アカウント名は「プロバイダ ID:識別子」
fn entry_names(provider: &str, name: &str) -> Result<(String, String), String> {
    let valid =
        |s: &str| !s.is_empty() && s.len() <= 128 && !s.chars().any(|c| c.is_control() || c == ':');
    if !valid(provider) || !valid(name) {
        return Err("キーの名前が正しくありません".into());
    }
    Ok((
        "app.storift.desktop.ai".to_string(),
        format!("{provider}:{name}"),
    ))
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn entry(provider: &str, name: &str) -> Result<keyring::Entry, String> {
    let (service, account) = entry_names(provider, name)?;
    keyring::Entry::new(&service, &account).map_err(|e| e.to_string())
}

/// 保存する(同じ名前があれば上書き)
#[tauri::command]
pub fn secret_set(provider: String, name: String, value: String) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        entry(&provider, &name)?
            .set_password(&value)
            .map_err(|e| e.to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (provider, name, value);
        Err(UNSUPPORTED.into())
    }
}

/// 読み出す。保存されていなければ `None`
#[tauri::command]
pub fn secret_get(provider: String, name: String) -> Result<Option<String>, String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        match entry(&provider, &name)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (provider, name);
        Err(UNSUPPORTED.into())
    }
}

/// 削除する。保存されていなくてもエラーにしない
#[tauri::command]
pub fn secret_delete(provider: String, name: String) -> Result<(), String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        match entry(&provider, &name)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (provider, name);
        Err(UNSUPPORTED.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_names_are_validated() {
        let (service, account) = entry_names("openai-compatible", "openrouter").unwrap();
        assert_eq!(service, "app.storift.desktop.ai");
        assert_eq!(account, "openai-compatible:openrouter");
        assert!(entry_names("", "x").is_err());
        assert!(entry_names("a", "").is_err());
        assert!(entry_names("a:b", "x").is_err());
        assert!(entry_names("a", "x\ny").is_err());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    #[test]
    fn unsupported_on_other_platforms() {
        assert_eq!(
            secret_get("a".into(), "b".into()),
            Err("unsupported".to_string())
        );
        assert_eq!(
            secret_set("a".into(), "b".into(), "v".into()),
            Err("unsupported".to_string())
        );
        assert_eq!(
            secret_delete("a".into(), "b".into()),
            Err("unsupported".to_string())
        );
    }
}

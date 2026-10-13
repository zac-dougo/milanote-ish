use super::*;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};

const MAGIC: &[u8] = b"MILANOTEISH-BACKUP\n";
#[derive(Serialize, Deserialize)]
struct Asset {
    name: String,
    size: u64,
    sha256: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    archive_version: u32,
    schema_version: u32,
    completed_at: u64,
    library: Library,
    assets: Vec<Asset>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    boards: usize,
    cards: usize,
    connectors: usize,
    assets: usize,
    completed_at: u64,
    fingerprint: String,
}
struct Staged {
    path: PathBuf,
    info: BackupInfo,
}
impl Drop for Staged {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn hash_reader(input: &mut impl Read) -> Result<(u64, String)> {
    let mut hash = Sha256::new();
    let mut size = 0;
    let mut buffer = [0u8; 65536];
    loop {
        let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
        size += count as u64;
    }
    Ok((size, format!("{:x}", hash.finalize())))
}
fn info(manifest: &Manifest, fingerprint: String) -> BackupInfo {
    BackupInfo {
        boards: manifest.library.boards.len(),
        cards: manifest.library.cards.len(),
        connectors: manifest.library.connectors.len(),
        assets: manifest.assets.len(),
        completed_at: manifest.completed_at,
        fingerprint,
    }
}
fn originals(library: &Library) -> std::collections::BTreeSet<String> {
    library
        .cards
        .iter()
        .flat_map(|card| &card.blocks)
        .filter_map(|block| match block {
            Block::Image { asset, .. } | Block::File { asset, .. } => Some(asset.clone()),
            _ => None,
        })
        .collect()
}

pub(super) fn export(root: &Path, destination: &Path) -> Result<()> {
    let parent = destination
        .parent()
        .ok_or("Choose a backup destination.")?
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if parent.starts_with(root.canonicalize().map_err(|e| e.to_string())?) {
        return Err("Save the backup outside the active library.".into());
    }
    let library = read_library(root)?;
    let mut assets = Vec::new();
    for name in originals(&library) {
        let path = existing_asset(root, &name)?;
        let (size, sha256) = hash_reader(&mut fs::File::open(path).map_err(|e| e.to_string())?)?;
        assets.push(Asset { name, size, sha256 });
    }
    let manifest = Manifest {
        archive_version: 1,
        schema_version: 4,
        completed_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_secs(),
        library,
        assets,
    };
    let bytes = serde_json::to_vec(&manifest).map_err(|e| e.to_string())?;
    let staging = parent.join(format!(".milanote-backup-{}.partial", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut output = fs::File::create(&staging).map_err(|e| e.to_string())?;
        output
            .write_all(MAGIC)
            .and_then(|_| output.write_all(&(bytes.len() as u64).to_le_bytes()))
            .and_then(|_| output.write_all(&bytes))
            .map_err(|e| e.to_string())?;
        for asset in &manifest.assets {
            let mut input =
                fs::File::open(existing_asset(root, &asset.name)?).map_err(|e| e.to_string())?;
            let mut hash = Sha256::new();
            let mut copied = 0u64;
            let mut buffer = [0u8; 65536];
            loop {
                let count = input.read(&mut buffer).map_err(|e| e.to_string())?;
                if count == 0 {
                    break;
                }
                output
                    .write_all(&buffer[..count])
                    .map_err(|e| e.to_string())?;
                hash.update(&buffer[..count]);
                copied += count as u64;
            }
            if copied != asset.size || format!("{:x}", hash.finalize()) != asset.sha256 {
                return Err("An asset changed during backup. Try again.".into());
            }
        }
        output.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&staging, destination).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(staging);
    }
    result
}

struct HashReader<R> {
    inner: R,
    hash: Sha256,
    count: u64,
}
impl<R: Read> Read for HashReader<R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let count = self.inner.read(buffer)?;
        self.hash.update(&buffer[..count]);
        self.count += count as u64;
        Ok(count)
    }
}

fn stage(source: &Path, parent: &Path) -> Result<Staged> {
    let mut input = fs::File::open(source).map_err(|e| e.to_string())?;
    let mut magic = vec![0u8; MAGIC.len()];
    input
        .read_exact(&mut magic)
        .map_err(|_| "Incomplete backup.".to_string())?;
    if magic != MAGIC {
        return Err("This is not a Milanote-ish backup.".into());
    }
    let mut length = [0u8; 8];
    input
        .read_exact(&mut length)
        .map_err(|_| "Incomplete backup.".to_string())?;
    let length = u64::from_le_bytes(length);
    let total = input.metadata().map_err(|e| e.to_string())?.len();
    if length > total.saturating_sub(MAGIC.len() as u64 + 8) {
        return Err("Incomplete backup metadata.".into());
    }
    let (manifest, fingerprint): (Manifest, String) = {
        let mut reader = HashReader {
            inner: (&mut input).take(length),
            hash: Sha256::new(),
            count: 0,
        };
        let manifest = serde_json::from_reader(&mut reader)
            .map_err(|e| format!("Invalid backup manifest: {e}"))?;
        if reader.count != length {
            return Err("Incomplete backup metadata.".into());
        }
        (manifest, format!("{:x}", reader.hash.finalize()))
    };
    if manifest.archive_version != 1 || manifest.schema_version != 4 {
        return Err("This backup format is not supported by this app version.".into());
    }
    let staged = Staged {
        path: parent.join(format!(".milanote-restore-{}", uuid::Uuid::new_v4())),
        info: info(&manifest, fingerprint),
    };
    fs::create_dir_all(staged.path.join("assets")).map_err(|e| e.to_string())?;
    let mut names = std::collections::BTreeSet::new();
    for asset in &manifest.assets {
        if !names.insert(asset.name.clone()) {
            return Err("Duplicate backup asset.".into());
        }
        let path = asset_path(&staged.path, &asset.name)?;
        let mut output = fs::File::create(path).map_err(|e| e.to_string())?;
        let mut limited = (&mut input).take(asset.size);
        let mut hash = Sha256::new();
        let mut count = 0u64;
        let mut buffer = [0u8; 65536];
        loop {
            let n = limited.read(&mut buffer).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            output.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
            hash.update(&buffer[..n]);
            count += n as u64;
        }
        if count != asset.size || format!("{:x}", hash.finalize()) != asset.sha256 {
            return Err(format!("Missing or corrupt backup asset: {}", asset.name));
        }
        output.sync_all().map_err(|e| e.to_string())?;
    }
    if names != originals(&manifest.library) {
        return Err("Backup assets do not match the saved content.".into());
    }
    let mut extra = [0u8; 1];
    if input.read(&mut extra).map_err(|e| e.to_string())? != 0 {
        return Err("Unexpected data after the backup.".into());
    }
    let mut thumbnails = std::collections::HashSet::new();
    for block in manifest.library.cards.iter().flat_map(|card| &card.blocks) {
        if let Block::Image {
            asset, thumbnail, ..
        } = block
        {
            if names.contains(thumbnail) {
                return Err("A thumbnail may not overwrite an original.".into());
            }
            if thumbnails.insert(thumbnail) {
                let bytes =
                    fs::read(asset_path(&staged.path, asset)?).map_err(|e| e.to_string())?;
                let image = image::load_from_memory(&bytes)
                    .map_err(|e| format!("Corrupt original image: {e}"))?;
                let mut output = std::io::Cursor::new(Vec::new());
                image
                    .thumbnail(1000, 1000)
                    .write_to(&mut output, image::ImageFormat::Png)
                    .map_err(|e| e.to_string())?;
                durable_write(&asset_path(&staged.path, thumbnail)?, output.get_ref())?;
            }
        }
    }
    // Duplicate IDs would otherwise silently upsert and hide archive corruption.
    for ids in [
        manifest
            .library
            .boards
            .iter()
            .map(|item| &item.id)
            .collect::<Vec<_>>(),
        manifest.library.cards.iter().map(|item| &item.id).collect(),
        manifest
            .library
            .connectors
            .iter()
            .map(|item| &item.id)
            .collect(),
    ] {
        if ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len() {
            return Err("Duplicate backup item identifier.".into());
        }
    }
    store_patch(
        &staged.path,
        &Patch {
            boards: manifest.library.boards,
            cards: manifest.library.cards,
            connectors: manifest.library.connectors,
            ..Default::default()
        },
    )?;
    let conn = db(&staged.path)?;
    for (id, camera) in manifest.library.cameras {
        if id != "home" {
            uuid(&id)?;
            read_board(&conn, &id)?;
        }
        if !camera.x.is_finite() || !camera.y.is_finite() || !(0.1..=4.0).contains(&camera.zoom) {
            return Err("Invalid backup viewport.".into());
        }
        conn.execute(
            "INSERT INTO cameras VALUES (?1, ?2)",
            params![
                id,
                serde_json::to_string(&camera).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    if let Some(last) = manifest.library.last_canvas {
        if last != "home" {
            read_board(&conn, &last)?;
        }
        conn.execute("INSERT INTO settings VALUES ('last_canvas', ?1)", [last])
            .map_err(|e| e.to_string())?;
    }
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| e.to_string())?;
    drop(conn);
    Ok(staged)
}

#[derive(Serialize, Deserialize)]
struct RestoreJournal {
    staged: String,
    old: String,
}
fn journal_path(root: &Path) -> Result<PathBuf> {
    Ok(root
        .parent()
        .ok_or("Invalid library directory.")?
        .join(format!(
            ".{}-restore.json",
            root.file_name()
                .and_then(|name| name.to_str())
                .ok_or("Invalid library name.")?
        )))
}
pub(super) fn recover(root: &Path) -> Result<()> {
    let path = journal_path(root)?;
    if !path.exists() {
        return Ok(());
    }
    let journal: RestoreJournal =
        serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Invalid restore recovery record: {e}"))?;
    if !journal.staged.starts_with(".milanote-restore-")
        || !journal.old.starts_with(".milanote-replaced-")
        || Path::new(&journal.staged)
            .file_name()
            .and_then(|name| name.to_str())
            != Some(&journal.staged)
        || Path::new(&journal.old)
            .file_name()
            .and_then(|name| name.to_str())
            != Some(&journal.old)
    {
        return Err("Invalid restore recovery paths.".into());
    }
    let parent = root.parent().ok_or("Invalid library directory.")?;
    let old = parent.join(journal.old);
    if !root.exists() {
        if !old.is_dir() {
            return Err(
                "Interrupted restore requires recovery. The old library directory is unavailable."
                    .into(),
            );
        }
        fs::rename(old, root).map_err(|e| format!("Could not recover interrupted restore: {e}"))?;
    }
    // Once the active directory exists it is either the unchanged old library or
    // the fully validated replacement. Never create an empty library in the gap.
    let _ = fs::remove_dir_all(parent.join(journal.staged));
    fs::remove_file(path).map_err(|e| e.to_string())?;
    Ok(())
}

pub(super) fn restore(root: &Path, source: &Path, fingerprint: &str) -> Result<()> {
    let parent = root.parent().ok_or("Invalid library directory.")?;
    let staged = stage(source, parent)?;
    if staged.info.fingerprint != fingerprint {
        return Err(
            "The backup changed after inspection. Choose it again before restoring.".into(),
        );
    }
    let recovery = parent.join(format!(
        "milanote-recovery-{}.milanote",
        uuid::Uuid::new_v4()
    ));
    export(root, &recovery)?;
    let conn = db(root)?;
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|e| e.to_string())?;
    drop(conn);
    let old = parent.join(format!(".milanote-replaced-{}", uuid::Uuid::new_v4()));
    let journal = journal_path(root)?;
    durable_write(
        &journal,
        &serde_json::to_vec(&RestoreJournal {
            staged: staged
                .path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned(),
            old: old.file_name().unwrap().to_string_lossy().into_owned(),
        })
        .map_err(|e| e.to_string())?,
    )?;
    fs::rename(root, &old).map_err(|e| e.to_string())?;
    if let Err(error) = fs::rename(&staged.path, root) {
        fs::rename(&old, root).map_err(|restore| {
            format!(
                "Could not activate backup: {error}; old library is at {}: {restore}",
                old.display()
            )
        })?;
        return Err(error.to_string());
    }
    let _ = fs::remove_file(journal);
    // Retain the replaced directory as an additional recovery copy. The exported
    // archive lives beside it and contains originals, metadata and Trash.
    Ok(())
}

#[tauri::command]
pub async fn export_backup(root: State<'_, LibraryPath>, path: String) -> Result<()> {
    let lock = root.1.clone();
    let root = root.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock
            .lock()
            .map_err(|_| "Library operation failed. Restart the app.".to_string())?;
        export(&root, Path::new(&path))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn inspect_backup(root: State<'_, LibraryPath>, path: String) -> Result<BackupInfo> {
    let lock = root.1.clone();
    let parent = root
        .0
        .parent()
        .ok_or("Invalid library directory.")?
        .to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock
            .lock()
            .map_err(|_| "Library operation failed. Restart the app.".to_string())?;
        let staged = stage(Path::new(&path), &parent)?;
        let Staged { info, .. } = &staged;
        Ok(BackupInfo {
            boards: info.boards,
            cards: info.cards,
            connectors: info.connectors,
            assets: info.assets,
            completed_at: info.completed_at,
            fingerprint: info.fingerprint.clone(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn restore_backup(
    root: State<'_, LibraryPath>,
    path: String,
    fingerprint: String,
) -> Result<()> {
    let lock = root.1.clone();
    let root = root.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock
            .lock()
            .map_err(|_| "Library operation failed. Restart the app.".to_string())?;
        restore(&root, Path::new(&path), &fingerprint)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interrupted_replacement_recovers_the_previous_library_without_creating_empty_data() {
        let parent =
            std::env::temp_dir().join(format!("milanote-journal-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&parent).unwrap();
        let root = parent.join("library");
        let board = crate::tests::board(uuid::Uuid::new_v4().to_string(), None);
        store_board(&root, &board).unwrap();
        let old = parent.join(".milanote-replaced-test");
        let staged = parent.join(".milanote-restore-test");
        fs::create_dir_all(&staged).unwrap();
        durable_write(
            &journal_path(&root).unwrap(),
            &serde_json::to_vec(&RestoreJournal {
                old: ".milanote-replaced-test".into(),
                staged: ".milanote-restore-test".into(),
            })
            .unwrap(),
        )
        .unwrap();
        fs::rename(&root, &old).unwrap();
        let library = read_library(&root).unwrap();
        assert_eq!(library.boards[0].id, board.id);
        assert!(!staged.exists());
        assert!(!journal_path(&root).unwrap().exists());
        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn archives_rebuild_disposable_thumbnails_and_reject_unsafe_paths_and_versions() {
        let parent =
            std::env::temp_dir().join(format!("milanote-archive-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&parent).unwrap();
        let root = parent.join("library");
        let board = crate::tests::board(uuid::Uuid::new_v4().to_string(), None);
        store_board(&root, &board).unwrap();
        let mut encoded = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1200, 600)
            .write_to(&mut encoded, image::ImageFormat::Png)
            .unwrap();
        let imported = copy_image(&root, encoded.get_ref(), "frame.png".into()).unwrap();
        let mut card = crate::tests::card(board.id);
        card.blocks = vec![Block::Image {
            id: uuid::Uuid::new_v4().to_string(),
            alt: Some("Frame".into()),
            asset: imported.asset.clone(),
            thumbnail: imported.thumbnail.clone(),
            name: imported.name,
        }];
        store_card(&root, &card).unwrap();
        fs::remove_file(asset_path(&root, &imported.thumbnail).unwrap()).unwrap();
        let path = parent.join("image.milanote");
        export(&root, &path).unwrap();
        let staged = stage(&path, &parent).unwrap();
        assert!(asset_path(&staged.path, &imported.thumbnail)
            .unwrap()
            .exists());
        assert_eq!(
            serde_json::to_value(read_library(&staged.path).unwrap()).unwrap(),
            serde_json::to_value(read_library(&root).unwrap()).unwrap()
        );
        drop(staged);
        let original = fs::read(&path).unwrap();
        let length =
            u64::from_le_bytes(original[MAGIC.len()..MAGIC.len() + 8].try_into().unwrap()) as usize;
        let payload = &original[MAGIC.len() + 8 + length..];
        let original_manifest: serde_json::Value =
            serde_json::from_slice(&original[MAGIC.len() + 8..MAGIC.len() + 8 + length]).unwrap();
        for unsafe_version in [false, true] {
            let mut manifest = original_manifest.clone();
            if unsafe_version {
                manifest["schemaVersion"] = serde_json::json!(5);
            } else {
                manifest["assets"][0]["name"] = serde_json::json!("../escape.png");
            }
            let bytes = serde_json::to_vec(&manifest).unwrap();
            let mut output = Vec::from(MAGIC);
            output.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
            output.extend_from_slice(&bytes);
            output.extend_from_slice(payload);
            let unsafe_path = parent.join("invalid.milanote");
            fs::write(&unsafe_path, output).unwrap();
            assert!(stage(&unsafe_path, &parent).is_err());
            assert!(!parent.join("escape.png").exists());
        }
        fs::remove_dir_all(parent).unwrap();
    }

    #[test]
    fn archive_preserves_trash_assets_and_rejects_corruption_before_replacement() {
        let parent =
            std::env::temp_dir().join(format!("milanote-backup-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&parent).unwrap();
        let root = parent.join("library");
        let board = crate::tests::board(uuid::Uuid::new_v4().to_string(), None);
        store_board(&root, &board).unwrap();
        let source = parent.join("script.txt");
        fs::write(&source, b"the original bytes").unwrap();
        let imported = copy_file(&root, &source).unwrap();
        let mut card = crate::tests::card(board.id.clone());
        card.trashed = true;
        card.blocks = vec![Block::File {
            id: uuid::Uuid::new_v4().to_string(),
            asset: imported.asset,
            name: imported.name,
            size: imported.size,
            media_type: imported.media_type,
        }];
        store_card(&root, &card).unwrap();
        let path = parent.join("export.milanote");
        export(&root, &path).unwrap();
        let staged = stage(&path, &parent).unwrap();
        let fingerprint = staged.info.fingerprint.clone();
        drop(staged);
        let extra = crate::tests::board(uuid::Uuid::new_v4().to_string(), None);
        store_board(&root, &extra).unwrap();
        let corrupt = parent.join("corrupt.milanote");
        let mut bytes = fs::read(&path).unwrap();
        *bytes.last_mut().unwrap() ^= 1;
        fs::write(&corrupt, bytes).unwrap();
        assert!(restore(&root, &corrupt, &fingerprint).is_err());
        assert_eq!(read_library(&root).unwrap().boards.len(), 2);
        assert!(restore(&root, &path, "wrong manifest").is_err());
        assert_eq!(read_library(&root).unwrap().boards.len(), 2);
        restore(&root, &path, &fingerprint).unwrap();
        let library = read_library(&root).unwrap();
        assert_eq!(library.boards.len(), 1);
        assert!(library.cards[0].trashed);
        assert_eq!(originals(&library).len(), 1);
        assert_eq!(
            fs::read(existing_asset(&root, originals(&library).first().unwrap()).unwrap()).unwrap(),
            b"the original bytes"
        );
        assert!(fs::read_dir(&parent).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("milanote-recovery")));
        fs::remove_dir_all(parent).unwrap();
    }
}

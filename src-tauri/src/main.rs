#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{Emitter, Manager, State};

type Result<T> = std::result::Result<T, String>;
struct LibraryPath(PathBuf);

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Board {
    id: String,
    title: String,
    color: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Block {
    Heading {
        id: String,
        text: String,
    },
    Text {
        id: String,
        text: String,
    },
    Image {
        id: String,
        asset: String,
        thumbnail: String,
        name: String,
    },
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Card {
    id: String,
    board_id: String,
    x: f64,
    y: f64,
    width: f64,
    color: String,
    blocks: Vec<Block>,
    #[serde(default)]
    trashed: bool,
}

#[derive(Serialize, Deserialize)]
struct Camera {
    x: f64,
    y: f64,
    zoom: f64,
}

#[derive(Serialize)]
struct Library {
    boards: Vec<Board>,
    cards: Vec<Card>,
    cameras: std::collections::HashMap<String, Camera>,
}

#[derive(Serialize)]
struct Imported {
    asset: String,
    thumbnail: String,
    name: String,
}

fn db(root: &Path) -> Result<Connection> {
    fs::create_dir_all(root.join("assets")).map_err(|e| e.to_string())?;
    let conn = Connection::open(root.join("library.sqlite3")).map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if version > 1 {
        return Err("This library was created by a newer version of the app.".into());
    }
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cameras (board_id TEXT PRIMARY KEY REFERENCES boards(id), data TEXT NOT NULL);
      PRAGMA user_version=1;").map_err(|e| e.to_string())?;
    Ok(conn)
}

fn uuid(value: &str) -> Result<()> {
    uuid::Uuid::parse_str(value)
        .map(|_| ())
        .map_err(|_| "Invalid item identifier.".into())
}

fn asset_path(root: &Path, name: &str) -> Result<PathBuf> {
    if name.is_empty() || Path::new(name).file_name().and_then(|s| s.to_str()) != Some(name) {
        return Err("Invalid asset filename.".into());
    }
    Ok(root.join("assets").join(name))
}

fn store_card(root: &Path, card: &Card) -> Result<()> {
    uuid(&card.id)?;
    uuid(&card.board_id)?;
    if !card.x.is_finite()
        || !card.y.is_finite()
        || !(180.0..=1200.0).contains(&card.width)
        || card.blocks.is_empty()
    {
        return Err("Invalid card dimensions or content.".into());
    }
    let mut seen = std::collections::HashSet::new();
    for block in &card.blocks {
        let id = match block {
            Block::Heading { id, .. } | Block::Text { id, .. } => id,
            Block::Image {
                id,
                asset,
                thumbnail,
                ..
            } => {
                for name in [asset, thumbnail] {
                    if !asset_path(root, name)?.is_file() {
                        return Err("An imported image is missing. The card was not saved.".into());
                    }
                }
                id
            }
        };
        uuid(id)?;
        if !seen.insert(id) {
            return Err("Duplicate content block identifier.".into());
        }
    }
    let conn = db(root)?;
    let json = serde_json::to_string(card).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO cards (id, board_id, data) VALUES (?1, ?2, ?3)
      ON CONFLICT(id) DO UPDATE SET board_id=excluded.board_id, data=excluded.data",
        params![card.id, card.board_id, json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn load_library(root: State<LibraryPath>) -> Result<Library> {
    let conn = db(&root.0)?;
    let read = |table: &str| -> Result<Vec<String>> {
        let mut stmt = conn
            .prepare(&format!("SELECT data FROM {table} ORDER BY rowid"))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    };
    let boards = read("boards")?
        .iter()
        .map(|s| serde_json::from_str(s).map_err(|e| e.to_string()))
        .collect::<Result<Vec<Board>>>()?;
    let cards = read("cards")?
        .iter()
        .map(|s| serde_json::from_str(s).map_err(|e| e.to_string()))
        .collect::<Result<Vec<Card>>>()?;
    let mut stmt = conn
        .prepare("SELECT board_id, data FROM cameras")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    let mut cameras = std::collections::HashMap::new();
    for row in rows {
        let (id, data) = row.map_err(|e| e.to_string())?;
        cameras.insert(id, serde_json::from_str(&data).map_err(|e| e.to_string())?);
    }
    Ok(Library {
        boards,
        cards,
        cameras,
    })
}

#[tauri::command]
fn save_card(root: State<LibraryPath>, card: Card) -> Result<()> {
    store_card(&root.0, &card)
}

#[tauri::command]
fn save_board(root: State<LibraryPath>, board: Board) -> Result<()> {
    uuid(&board.id)?;
    let conn = db(&root.0)?;
    conn.execute("INSERT INTO boards (id, data) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      params![board.id, serde_json::to_string(&board).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_camera(root: State<LibraryPath>, board_id: String, camera: Camera) -> Result<()> {
    uuid(&board_id)?;
    if !camera.x.is_finite() || !camera.y.is_finite() || !(0.1..=4.0).contains(&camera.zoom) {
        return Err("Invalid canvas viewport.".into());
    }
    db(&root.0)?
        .execute(
            "INSERT INTO cameras (board_id, data) VALUES (?1, ?2)
      ON CONFLICT(board_id) DO UPDATE SET data=excluded.data",
            params![
                board_id,
                serde_json::to_string(&camera).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn durable_write(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let staging = path.with_extension("staging");
    let mut file = fs::File::create(&staging).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    fs::rename(&staging, path).map_err(|e| e.to_string())?;
    Ok(())
}

fn copy_image(root: &Path, bytes: &[u8], name: String) -> Result<Imported> {
    let format = image::guess_format(bytes)
        .map_err(|_| "This file is not a supported image.".to_string())?;
    let extension = match format {
        image::ImageFormat::Png => "png",
        image::ImageFormat::Jpeg => "jpg",
        image::ImageFormat::WebP => "webp",
        image::ImageFormat::Gif => "gif",
        _ => return Err("Use a PNG, JPEG, WebP, or GIF image in this first build.".into()),
    };
    let reader = image::ImageReader::with_format(std::io::Cursor::new(bytes), format);
    let decoded = reader
        .decode()
        .map_err(|e| format!("Could not decode this image: {e}"))?;
    let key = uuid::Uuid::new_v4();
    let asset = format!("{key}.{extension}");
    let thumbnail = format!("{key}-thumb.png");
    fs::create_dir_all(root.join("assets")).map_err(|e| e.to_string())?;
    let thumb = decoded.thumbnail(1000, 1000);
    let mut output = std::io::Cursor::new(Vec::new());
    thumb
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    durable_write(&asset_path(root, &asset)?, bytes)?;
    durable_write(&asset_path(root, &thumbnail)?, output.get_ref())?;
    Ok(Imported {
        asset,
        thumbnail,
        name,
    })
}

#[tauri::command]
async fn import_image(root: State<'_, LibraryPath>, path: String) -> Result<Imported> {
    let root = root.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let source = Path::new(&path);
        let name = source
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Image")
            .to_string();
        let bytes = fs::read(source).map_err(|e| format!("Could not read image: {e}"))?;
        copy_image(&root, &bytes, name)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_clipboard(root: State<'_, LibraryPath>, bytes: Vec<u8>) -> Result<Imported> {
    let root = root.0.clone();
    tauri::async_runtime::spawn_blocking(move || copy_image(&root, &bytes, "Pasted image".into()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn finish_quit(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            app.manage(LibraryPath(root));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_library,
            save_card,
            save_board,
            save_camera,
            import_image,
            import_clipboard,
            finish_quit
        ])
        .build(tauri::generate_context!())
        .expect("Could not start Milanote-ish")
        .run(|app, event| {
            // Native Cmd-Q must flush the same queue as closing the window.
            // An explicit exit code is sent only after the frontend has flushed.
            if let tauri::RunEvent::ExitRequested {
                api, code: None, ..
            } = event
            {
                api.prevent_exit();
                let _ = app.emit("app:quit-requested", ());
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        std::env::temp_dir().join(format!("milanote-test-{}", uuid::Uuid::new_v4()))
    }
    fn card(board_id: String) -> Card {
        Card {
            id: uuid::Uuid::new_v4().to_string(),
            board_id,
            x: -25.0,
            y: 43.0,
            width: 320.0,
            color: "paper".into(),
            blocks: vec![Block::Text {
                id: uuid::Uuid::new_v4().to_string(),
                text: "A scene".into(),
            }],
            trashed: false,
        }
    }
    #[test]
    fn card_survives_reopen_and_foreign_boards_are_rejected() {
        let root = root();
        let conn = db(&root).unwrap();
        let board_id = uuid::Uuid::new_v4().to_string();
        conn.execute("INSERT INTO boards VALUES (?1, '{}')", [&board_id])
            .unwrap();
        drop(conn);
        let mut saved = card(board_id);
        store_card(&root, &saved).unwrap();
        let conn = db(&root).unwrap();
        let data: String = conn
            .query_row("SELECT data FROM cards WHERE id=?1", [&saved.id], |r| {
                r.get(0)
            })
            .unwrap();
        let loaded: Card = serde_json::from_str(&data).unwrap();
        assert_eq!(loaded.x, -25.0);
        assert!(matches!(&loaded.blocks[0], Block::Text { text, .. } if text == "A scene"));
        assert!(store_card(&root, &card(uuid::Uuid::new_v4().to_string())).is_err());
        saved.trashed = true;
        store_card(&root, &saved).unwrap();
        let data: String = conn
            .query_row("SELECT data FROM cards WHERE id=?1", [&saved.id], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(serde_json::from_str::<Card>(&data).unwrap().trashed);
        drop(conn);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn asset_paths_and_missing_images_cannot_be_committed() {
        let root = root();
        assert!(asset_path(&root, "../outside.png").is_err());
        let mut c = card(uuid::Uuid::new_v4().to_string());
        c.blocks = vec![Block::Image {
            id: uuid::Uuid::new_v4().to_string(),
            asset: "absent.png".into(),
            thumbnail: "absent-thumb.png".into(),
            name: "Missing".into(),
        }];
        assert!(store_card(&root, &c).unwrap_err().contains("missing"));
    }
    #[test]
    fn newer_library_is_left_untouched() {
        let root = root();
        let conn = db(&root).unwrap();
        conn.pragma_update(None, "user_version", 2).unwrap();
        drop(conn);
        assert!(db(&root).unwrap_err().contains("newer"));
        let conn = Connection::open(root.join("library.sqlite3")).unwrap();
        assert_eq!(
            conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
                .unwrap(),
            2
        );
        drop(conn);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn imported_original_and_thumbnail_are_independent_files() {
        let root = root();
        let mut output = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1600, 800)
            .write_to(&mut output, image::ImageFormat::Png)
            .unwrap();
        let original = output.into_inner();
        let imported = copy_image(&root, &original, "Scene.png".into()).unwrap();
        assert_eq!(
            fs::read(asset_path(&root, &imported.asset).unwrap()).unwrap(),
            original
        );
        let thumb = image::open(asset_path(&root, &imported.thumbnail).unwrap()).unwrap();
        assert_eq!((thumb.width(), thumb.height()), (1000, 500));
        fs::remove_dir_all(root).unwrap();
    }
}

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backup;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{Emitter, Manager, State};

type Result<T> = std::result::Result<T, String>;
struct LibraryPath(PathBuf, std::sync::Arc<std::sync::Mutex<()>>);

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Board {
    id: String,
    title: String,
    color: String,
    parent_id: Option<String>,
    x: f64,
    y: f64,
    trashed: bool,
    #[serde(default)]
    order: f64,
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
        #[serde(default, skip_serializing_if = "Option::is_none")]
        document: Option<Vec<TextLine>>,
    },
    Quote {
        id: String,
        text: String,
        attribution: String,
    },
    Link {
        id: String,
        url: String,
        title: String,
    },
    Checklist {
        id: String,
        items: Vec<ChecklistItem>,
    },
    File {
        id: String,
        asset: String,
        name: String,
        size: u64,
        #[serde(rename = "mediaType")]
        media_type: String,
    },
    Image {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        alt: Option<String>,
        asset: String,
        thumbnail: String,
        name: String,
    },
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
enum TextLineKind {
    Paragraph,
    Bullet,
    Number,
}
#[derive(Serialize, Deserialize, Clone)]
struct TextSpan {
    text: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    bold: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    italic: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    underline: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    strike: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    href: Option<String>,
}
#[derive(Serialize, Deserialize, Clone)]
struct TextLine {
    kind: TextLineKind,
    spans: Vec<TextSpan>,
}

#[derive(Serialize, Deserialize, Clone)]
struct ChecklistItem {
    id: String,
    text: String,
    done: bool,
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
    #[serde(default)]
    order: f64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Connector {
    id: String,
    board_id: String,
    from_id: String,
    to_id: String,
    arrow: String,
    color: String,
    trashed: bool,
}

#[derive(Serialize, Deserialize)]
struct Camera {
    x: f64,
    y: f64,
    zoom: f64,
}

#[derive(Serialize, Deserialize)]
struct Library {
    boards: Vec<Board>,
    cards: Vec<Card>,
    connectors: Vec<Connector>,
    cameras: std::collections::HashMap<String, Camera>,
    #[serde(rename = "lastCanvas")]
    last_canvas: Option<String>,
}

#[derive(Serialize)]
struct Imported {
    asset: String,
    thumbnail: String,
    name: String,
}

fn db(root: &Path) -> Result<Connection> {
    backup::recover(root)?;
    fs::create_dir_all(root.join("assets")).map_err(|e| e.to_string())?;
    let mut conn = Connection::open(root.join("library.sqlite3")).map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    let version: i64 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if version > 4 {
        return Err("This library was created by a newer version of the app.".into());
    }
    if version > 0 && version < 4 {
        let recovery = root.join(format!(
            "library-v{version}-recovery-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        let staging = recovery.with_extension("staging");
        conn.execute(
            "VACUUM INTO ?1",
            [staging.to_str().ok_or("Invalid recovery path.")?],
        )
        .map_err(|e| format!("Could not back up the library before updating: {e}"))?;
        fs::File::open(&staging)
            .and_then(|file| file.sync_all())
            .map_err(|e| e.to_string())?;
        fs::rename(&staging, &recovery).map_err(|e| e.to_string())?;
    }
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS boards (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cameras (board_id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);").map_err(|e| e.to_string())?;
    if version < 4 {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        if version < 2 {
            let rows = {
                let mut stmt = tx
                    .prepare("SELECT id, data FROM boards ORDER BY rowid")
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                    .map_err(|e| e.to_string())?;
                rows.collect::<std::result::Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?
            };
            for (index, (id, json)) in rows.into_iter().enumerate() {
                let mut data: serde_json::Value =
                    serde_json::from_str(&json).map_err(|e| e.to_string())?;
                let fields = data.as_object_mut().ok_or("Invalid saved board.")?;
                fields.entry("parentId").or_insert(serde_json::Value::Null);
                fields
                    .entry("x")
                    .or_insert(serde_json::json!((index % 3) as f64 * 280.0));
                fields
                    .entry("y")
                    .or_insert(serde_json::json!((index / 3) as f64 * 220.0));
                fields.entry("trashed").or_insert(serde_json::json!(false));
                serde_json::from_value::<Board>(data.clone())
                    .map_err(|e| format!("Invalid saved board: {e}"))?;
                tx.execute(
                    "UPDATE boards SET data=?2 WHERE id=?1",
                    params![id, data.to_string()],
                )
                .map_err(|e| e.to_string())?;
            }
            // Home has a viewport but is not a content board. Preserve the old cameras
            // while removing the board-only foreign key, then validate owners on writes.
            tx.execute_batch(
                "ALTER TABLE cameras RENAME TO old_cameras;
          CREATE TABLE cameras (board_id TEXT PRIMARY KEY, data TEXT NOT NULL);
          INSERT INTO cameras SELECT * FROM old_cameras;
          DROP TABLE old_cameras;
",
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS connectors (
          id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id),
          from_id TEXT NOT NULL, to_id TEXT NOT NULL, data TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS connectors_board ON connectors(board_id);
          PRAGMA user_version=4;",
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
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

fn read_board(conn: &Connection, id: &str) -> Result<Board> {
    let data: String = conn
        .query_row("SELECT data FROM boards WHERE id=?1", [id], |r| r.get(0))
        .map_err(|_| "The parent board is unavailable.".to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

fn validate_parent(conn: &Connection, id: &str, parent: Option<&str>) -> Result<()> {
    let mut next = parent.map(String::from);
    let mut seen = std::collections::HashSet::from([id.to_string()]);
    while let Some(parent_id) = next {
        if !seen.insert(parent_id.clone()) {
            return Err("A board cannot be placed inside itself or a descendant.".into());
        }
        let board = read_board(conn, &parent_id)?;
        if board.trashed {
            return Err("The parent board is in Trash.".into());
        }
        next = board.parent_id;
    }
    Ok(())
}

fn store_board(root: &Path, board: &Board) -> Result<()> {
    uuid(&board.id)?;
    if !board.x.is_finite() || !board.y.is_finite() || !board.order.is_finite() {
        return Err("Invalid board tile position.".into());
    }
    if let Some(parent) = &board.parent_id {
        uuid(parent)?;
    }
    let mut conn = db(root)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    validate_parent(&tx, &board.id, board.parent_id.as_deref())?;
    tx.execute("INSERT INTO boards (id, data) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      params![board.id, serde_json::to_string(board).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn validate_card_content(root: &Path, card: &Card) -> Result<()> {
    validate_card_with_refs(root, card, &std::collections::HashSet::new())
}

fn retained_refs(card: &Card) -> std::collections::HashSet<(String, String)> {
    card.blocks
        .iter()
        .flat_map(|block| match block {
            Block::Image {
                id,
                asset,
                thumbnail,
                ..
            } => vec![(id.clone(), asset.clone()), (id.clone(), thumbnail.clone())],
            Block::File { id, asset, .. } => vec![(id.clone(), asset.clone())],
            _ => vec![],
        })
        .collect()
}
fn validate_card_with_refs(
    root: &Path,
    card: &Card,
    retained: &std::collections::HashSet<(String, String)>,
) -> Result<()> {
    uuid(&card.id)?;
    uuid(&card.board_id)?;
    if !card.order.is_finite()
        || !card.x.is_finite()
        || !card.y.is_finite()
        || !(180.0..=1200.0).contains(&card.width)
        || card.blocks.is_empty()
    {
        return Err("Invalid card dimensions or content.".into());
    }
    let mut seen = std::collections::HashSet::new();
    for block in &card.blocks {
        let id = match block {
            Block::Heading { id, .. } | Block::Quote { id, .. } | Block::Link { id, .. } => id,
            Block::Text { id, text, document } => {
                if let Some(lines) = document {
                    let plain = lines
                        .iter()
                        .map(|line| {
                            line.spans
                                .iter()
                                .map(|span| span.text.as_str())
                                .collect::<String>()
                        })
                        .collect::<Vec<_>>()
                        .join("\n");
                    if &plain != text {
                        return Err("Formatted text does not match its readable text.".into());
                    }
                    for span in lines.iter().flat_map(|line| &line.spans) {
                        if let Some(href) = &span.href {
                            validated_web_url(href)?;
                        }
                    }
                }
                id
            }
            Block::Checklist { id, items } => {
                let mut item_ids = std::collections::HashSet::new();
                for item in items {
                    uuid(&item.id)?;
                    if !item_ids.insert(&item.id) {
                        return Err("Duplicate checklist item identifier.".into());
                    }
                }
                id
            }
            Block::File {
                id, asset, size, ..
            } => {
                asset_path(root, asset)?;
                match existing_asset(root, asset)
                    .and_then(|path| fs::metadata(path).map_err(|e| e.to_string()))
                {
                    Ok(metadata) => {
                        if !metadata.is_file() || metadata.len() != *size {
                            return Err("The imported file size has changed.".into());
                        }
                    }
                    Err(error) if !retained.contains(&(id.clone(), asset.clone())) => {
                        return Err(error)
                    }
                    Err(_) => {}
                }
                id
            }
            Block::Image {
                id,
                asset,
                thumbnail,
                ..
            } => {
                for name in [asset, thumbnail] {
                    if !asset_path(root, name)?.is_file()
                        && !retained.contains(&(id.clone(), name.clone()))
                    {
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
    Ok(())
}

fn store_card(root: &Path, card: &Card) -> Result<()> {
    validate_card_content(root, card)?;
    let mut conn = db(root)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    if !card.trashed {
        validate_parent(&tx, "", Some(&card.board_id))?;
    }
    let json = serde_json::to_string(card).map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO cards (id, board_id, data) VALUES (?1, ?2, ?3)
      ON CONFLICT(id) DO UPDATE SET board_id=excluded.board_id, data=excluded.data",
        params![card.id, card.board_id, json],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn endpoint_available(conn: &Connection, owner: &str, id: &str) -> Result<bool> {
    let card = conn
        .query_row("SELECT data FROM cards WHERE id=?1", [id], |r| {
            r.get::<_, String>(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(json) = card {
        let card: Card = serde_json::from_str(&json).map_err(|e| e.to_string())?;
        return Ok(card.board_id == owner && !card.trashed);
    }
    let tile = conn
        .query_row("SELECT data FROM boards WHERE id=?1", [id], |r| {
            r.get::<_, String>(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    match tile {
        Some(json) => {
            let board: Board = serde_json::from_str(&json).map_err(|e| e.to_string())?;
            Ok(board.parent_id.as_deref() == Some(owner) && !board.trashed)
        }
        None => Ok(false),
    }
}

fn connector_available(conn: &Connection, line: &Connector) -> Result<bool> {
    Ok(line.from_id != line.to_id
        && validate_parent(conn, "", Some(&line.board_id)).is_ok()
        && endpoint_available(conn, &line.board_id, &line.from_id)?
        && endpoint_available(conn, &line.board_id, &line.to_id)?)
}

fn store_connector(root: &Path, connector: &Connector) -> Result<()> {
    for id in [
        &connector.id,
        &connector.board_id,
        &connector.from_id,
        &connector.to_id,
    ] {
        uuid(id)?;
    }
    if connector.from_id == connector.to_id {
        return Err("Choose two different items to connect.".into());
    }
    if !["none", "target"].contains(&connector.arrow.as_str())
        || !["#243b35", "#a04732", "#295c7b", "#466333"].contains(&connector.color.as_str())
    {
        return Err("Invalid connector style.".into());
    }
    let mut conn = db(root)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let existing = tx
        .query_row(
            "SELECT data FROM connectors WHERE id=?1",
            [&connector.id],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let existing = existing
        .map(|json| serde_json::from_str::<Connector>(&json).map_err(|e| e.to_string()))
        .transpose()?;
    if existing
        .as_ref()
        .is_some_and(|line| line.board_id != connector.board_id)
    {
        return Err("A connector cannot change boards.".into());
    }
    // Explicitly trashed lines retain their endpoint references. Endpoint deletion
    // also makes a line effectively trashed, atomically via the endpoint's state.
    let changed_endpoints = existing
        .as_ref()
        .is_some_and(|line| line.from_id != connector.from_id || line.to_id != connector.to_id);
    if (!connector.trashed || existing.is_none() || changed_endpoints)
        && !connector_available(&tx, connector)?
    {
        return Err("Connectors must join live items on the same board.".into());
    }
    tx.execute("INSERT INTO connectors (id, board_id, from_id, to_id, data) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(id) DO UPDATE SET from_id=excluded.from_id, to_id=excluded.to_id, data=excluded.data",
      params![connector.id, connector.board_id, connector.from_id, connector.to_id, serde_json::to_string(connector).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Deserialize, Default)]
struct Removed {
    #[serde(default)]
    boards: Vec<String>,
    #[serde(default)]
    cards: Vec<String>,
    #[serde(default)]
    connectors: Vec<String>,
}
#[derive(Deserialize, Default)]
struct Patch {
    #[serde(default)]
    boards: Vec<Board>,
    #[serde(default)]
    cards: Vec<Card>,
    #[serde(default)]
    connectors: Vec<Connector>,
    #[serde(default)]
    removed: Removed,
}

fn store_patch(root: &Path, patch: &Patch) -> Result<()> {
    let mut conn = db(root)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    tx.execute_batch("PRAGMA defer_foreign_keys=ON;")
        .map_err(|e| e.to_string())?;
    for (table, ids) in [
        ("connectors", &patch.removed.connectors),
        ("cards", &patch.removed.cards),
        ("boards", &patch.removed.boards),
    ] {
        for id in ids {
            uuid(id)?;
            tx.execute(&format!("DELETE FROM {table} WHERE id=?1"), [id])
                .map_err(|e| e.to_string())?;
        }
    }
    for id in &patch.removed.boards {
        tx.execute("DELETE FROM cameras WHERE board_id=?1", [id])
            .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE settings SET value='home' WHERE key='last_canvas' AND value=?1",
            [id],
        )
        .map_err(|e| e.to_string())?;
    }
    for board in &patch.boards {
        uuid(&board.id)?;
        if !board.x.is_finite() || !board.y.is_finite() || !board.order.is_finite() {
            return Err("Invalid board position.".into());
        }
        tx.execute(
            "INSERT INTO boards VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
            params![
                board.id,
                serde_json::to_string(board).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    for card in &patch.cards {
        let old: Option<String> = tx
            .query_row("SELECT data FROM cards WHERE id=?1", [&card.id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?;
        let retained = old
            .map(|json| {
                serde_json::from_str::<Card>(&json)
                    .map(|card| retained_refs(&card))
                    .map_err(|e| e.to_string())
            })
            .transpose()?
            .unwrap_or_default();
        validate_card_with_refs(root, card, &retained)?;
        tx.execute("INSERT INTO cards VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET board_id=excluded.board_id, data=excluded.data", params![card.id, card.board_id, serde_json::to_string(card).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
    }
    for line in &patch.connectors {
        for id in [&line.id, &line.board_id, &line.from_id, &line.to_id] {
            uuid(id)?;
        }
        if line.from_id == line.to_id
            || !["none", "target"].contains(&line.arrow.as_str())
            || !["#243b35", "#a04732", "#295c7b", "#466333"].contains(&line.color.as_str())
        {
            return Err("Invalid connector.".into());
        }
        tx.execute("INSERT INTO connectors VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(id) DO UPDATE SET board_id=excluded.board_id, from_id=excluded.from_id, to_id=excluded.to_id, data=excluded.data", params![line.id, line.board_id, line.from_id, line.to_id, serde_json::to_string(line).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
    }
    // Validate the final graph, including hidden descendants and retained Trash lines.
    // This permits undo and moves to restore multiple dependent entities together.
    let read = |table: &str| -> Result<Vec<String>> {
        let mut stmt = tx
            .prepare(&format!("SELECT data FROM {table}"))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    };
    let boards = read("boards")?
        .into_iter()
        .map(|json| serde_json::from_str::<Board>(&json).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>>>()?;
    let cards = read("cards")?
        .into_iter()
        .map(|json| serde_json::from_str::<Card>(&json).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>>>()?;
    let lines = read("connectors")?
        .into_iter()
        .map(|json| serde_json::from_str::<Connector>(&json).map_err(|e| e.to_string()))
        .collect::<Result<Vec<_>>>()?;
    let board_map: std::collections::HashMap<_, _> = boards
        .iter()
        .map(|board| (board.id.as_str(), board))
        .collect();
    let card_map: std::collections::HashMap<_, _> =
        cards.iter().map(|card| (card.id.as_str(), card)).collect();
    for board in &boards {
        if card_map.contains_key(board.id.as_str()) {
            return Err("Duplicate canvas item identifier.".into());
        }
        let mut visited = std::collections::HashSet::from([board.id.as_str()]);
        let mut next = board.parent_id.as_deref();
        while let Some(parent) = next {
            if !visited.insert(parent) {
                return Err("A board cannot be placed inside itself or a descendant.".into());
            }
            next = board_map
                .get(parent)
                .ok_or("Missing parent board.")?
                .parent_id
                .as_deref();
        }
    }
    let mut block_ids = std::collections::HashSet::new();
    for card in &cards {
        for block in &card.blocks {
            let id = match block {
                Block::Heading { id, .. }
                | Block::Text { id, .. }
                | Block::Quote { id, .. }
                | Block::Link { id, .. }
                | Block::Checklist { id, .. }
                | Block::File { id, .. }
                | Block::Image { id, .. } => id,
            };
            if !block_ids.insert(id) {
                return Err("A content block cannot belong to two cards.".into());
            }
        }
        if !board_map.contains_key(card.board_id.as_str()) {
            return Err("Missing card owner.".into());
        }
    }
    for line in &lines {
        if !board_map.contains_key(line.board_id.as_str()) {
            return Err("Missing connector owner.".into());
        }
        for endpoint in [&line.from_id, &line.to_id] {
            let owner = card_map
                .get(endpoint.as_str())
                .map(|card| Some(card.board_id.as_str()))
                .or_else(|| {
                    board_map
                        .get(endpoint.as_str())
                        .map(|board| board.parent_id.as_deref())
                })
                .ok_or("Missing connector endpoint.")?;
            if !line.trashed && owner != Some(line.board_id.as_str()) {
                return Err("Connectors must remain on their endpoints' board.".into());
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Deserialize)]
struct Geometry {
    id: String,
    x: f64,
    y: f64,
    width: Option<f64>,
}
fn store_geometry(root: &Path, items: &[Geometry]) -> Result<()> {
    let mut conn = db(root)?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    for item in items {
        uuid(&item.id)?;
        if !item.x.is_finite()
            || !item.y.is_finite()
            || item
                .width
                .is_some_and(|width| !(180.0..=1200.0).contains(&width))
        {
            return Err("Invalid geometry checkpoint.".into());
        }
        let saved: Option<String> = tx
            .query_row("SELECT data FROM cards WHERE id=?1", [&item.id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(json) = saved {
            let mut card: Card = serde_json::from_str(&json).map_err(|e| e.to_string())?;
            card.x = item.x;
            card.y = item.y;
            if let Some(width) = item.width {
                card.width = width;
            }
            tx.execute(
                "UPDATE cards SET data=?2 WHERE id=?1",
                params![
                    card.id,
                    serde_json::to_string(&card).map_err(|e| e.to_string())?
                ],
            )
            .map_err(|e| e.to_string())?;
        } else {
            let mut board = read_board(&tx, &item.id)?;
            board.x = item.x;
            board.y = item.y;
            tx.execute(
                "UPDATE boards SET data=?2 WHERE id=?1",
                params![
                    board.id,
                    serde_json::to_string(&board).map_err(|e| e.to_string())?
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
fn save_geometry(root: State<LibraryPath>, items: Vec<Geometry>) -> Result<()> {
    let _guard = root
        .1
        .lock()
        .map_err(|_| "Library operation failed. Restart the app.".to_string())?;
    store_geometry(&root.0, &items)
}

fn purge(root: &Path, patch: &Patch) -> Result<Vec<String>> {
    if !patch.boards.is_empty() || !patch.cards.is_empty() || !patch.connectors.is_empty() {
        return Err("Permanent deletion accepts only removals.".into());
    }
    store_patch(root, patch)?;
    let library = match read_library(root) {
        Ok(library) => library,
        Err(error) => return Ok(vec![error]),
    };
    let retained: std::collections::HashSet<_> = library
        .cards
        .iter()
        .flat_map(|card| &card.blocks)
        .flat_map(|block| match block {
            Block::Image {
                asset, thumbnail, ..
            } => vec![asset.as_str(), thumbnail.as_str()],
            Block::File { asset, .. } => vec![asset.as_str()],
            _ => vec![],
        })
        .collect();
    let mut failures = Vec::new();
    let entries = match fs::read_dir(root.join("assets")) {
        Ok(entries) => entries,
        Err(error) => return Ok(vec![error.to_string()]),
    };
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                failures.push(error.to_string());
                continue;
            }
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_owned = name
            .get(..36)
            .is_some_and(|key| uuid::Uuid::parse_str(key).is_ok());
        if is_owned && !retained.contains(name.as_str()) {
            if let Err(error) = fs::remove_file(entry.path()) {
                failures.push(error.to_string());
            }
        }
    }
    Ok(failures)
}
#[tauri::command]
fn purge_items(root: State<LibraryPath>, patch: Patch) -> Result<Vec<String>> {
    let _guard = root
        .1
        .lock()
        .map_err(|_| "Library operation failed. Restart the app.".to_string())?;
    purge(&root.0, &patch)
}

#[tauri::command]
fn save_patch(root: State<LibraryPath>, patch: Patch) -> Result<()> {
    let _guard = root
        .1
        .lock()
        .map_err(|_| "Library operation failed. Restart the app.".to_string())?;
    store_patch(&root.0, &patch)
}

#[tauri::command]
fn save_connector(root: State<LibraryPath>, connector: Connector) -> Result<()> {
    let _guard = root
        .1
        .lock()
        .map_err(|_| "Library operation failed. Restart the app.".to_string())?;
    store_connector(&root.0, &connector)
}

#[tauri::command]
async fn load_library(root: State<'_, LibraryPath>) -> Result<Library> {
    let lock = root.1.clone();
    let root = root.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock
            .lock()
            .map_err(|_| "Library operation failed. Restart the app.".to_string())?;
        let library = read_library(&root)?;
        for block in library.cards.iter().flat_map(|card| &card.blocks) {
            if let Block::Image {
                asset, thumbnail, ..
            } = block
            {
                let destination = asset_path(&root, thumbnail)?;
                if !destination.exists() {
                    let rebuild = || -> Result<()> {
                        let bytes =
                            fs::read(existing_asset(&root, asset)?).map_err(|e| e.to_string())?;
                        let image = image::load_from_memory(&bytes).map_err(|e| e.to_string())?;
                        let mut output = std::io::Cursor::new(Vec::new());
                        image
                            .thumbnail(1000, 1000)
                            .write_to(&mut output, image::ImageFormat::Png)
                            .map_err(|e| e.to_string())?;
                        durable_write(&destination, output.get_ref())
                    };
                    let _ = rebuild();
                }
            }
        }
        Ok(library)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn read_library(root: &Path) -> Result<Library> {
    let mut connection = db(root)?;
    let conn = connection.transaction().map_err(|e| e.to_string())?;
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
    let connectors = read("connectors")?
        .iter()
        .map(|s| serde_json::from_str(s).map_err(|e| e.to_string()))
        .collect::<Result<Vec<Connector>>>()?;
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
        connectors,
        cameras,
        last_canvas: conn
            .query_row(
                "SELECT value FROM settings WHERE key='last_canvas'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?,
    })
}

#[tauri::command]
fn save_card(root: State<LibraryPath>, card: Card) -> Result<()> {
    let _guard = root
        .1
        .lock()
        .map_err(|_| "Library operation failed. Restart the app.".to_string())?;
    store_card(&root.0, &card)
}

#[tauri::command]
fn save_board(root: State<LibraryPath>, board: Board) -> Result<()> {
    let _guard = root
        .1
        .lock()
        .map_err(|_| "Library operation failed. Restart the app.".to_string())?;
    store_board(&root.0, &board)
}

#[tauri::command]
fn save_session(root: State<LibraryPath>, canvas_id: String) -> Result<()> {
    let _guard = root
        .1
        .lock()
        .map_err(|_| "Library operation failed. Restart the app.".to_string())?;
    let conn = db(&root.0)?;
    if canvas_id != "home" {
        uuid(&canvas_id)?;
        validate_parent(&conn, "", Some(&canvas_id))?;
    }
    conn.execute("INSERT INTO settings VALUES ('last_canvas', ?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [canvas_id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_camera(root: State<LibraryPath>, board_id: String, camera: Camera) -> Result<()> {
    let _guard = root
        .1
        .lock()
        .map_err(|_| "Library operation failed. Restart the app.".to_string())?;
    if board_id != "home" {
        uuid(&board_id)?;
    }
    if !camera.x.is_finite() || !camera.y.is_finite() || !(0.1..=4.0).contains(&camera.zoom) {
        return Err("Invalid canvas viewport.".into());
    }
    let conn = db(&root.0)?;
    if board_id != "home" {
        validate_parent(&conn, "", Some(&board_id))?;
    }
    conn.execute(
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
    let lock = root.1.clone();
    let root = root.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock
            .lock()
            .map_err(|_| "Library operation failed. Restart the app.".to_string())?;
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
    let lock = root.1.clone();
    let root = root.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock
            .lock()
            .map_err(|_| "Library operation failed. Restart the app.".to_string())?;
        copy_image(&root, &bytes, "Pasted image".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportedFile {
    asset: String,
    name: String,
    size: u64,
    media_type: String,
}

fn copy_file(root: &Path, source: &Path) -> Result<ImportedFile> {
    use std::io::Write;
    let mut input = fs::File::open(source).map_err(|e| format!("Could not read file: {e}"))?;
    if !input.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("Choose a file, rather than a folder.".into());
    }
    let name = source
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Attachment")
        .to_string();
    let ext = source
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("bin")
        .to_ascii_lowercase();
    let ext =
        if !ext.is_empty() && ext.len() <= 12 && ext.chars().all(|c| c.is_ascii_alphanumeric()) {
            ext.as_str()
        } else {
            "bin"
        };
    let asset = format!("{}.{}", uuid::Uuid::new_v4(), ext);
    fs::create_dir_all(root.join("assets")).map_err(|e| e.to_string())?;
    let destination = asset_path(root, &asset)?;
    let staging = destination.with_extension("staging");
    let result = (|| {
        let mut output = fs::File::create(&staging).map_err(|e| e.to_string())?;
        let size = std::io::copy(&mut input, &mut output).map_err(|e| e.to_string())?;
        output.flush().map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&staging, destination).map_err(|e| e.to_string())?;
        let media_type = match ext {
            "pdf" => "application/pdf",
            "txt" | "md" | "csv" => "text/plain",
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "mp3" => "audio/mpeg",
            "mp4" => "video/mp4",
            _ => "application/octet-stream",
        }
        .into();
        Ok(ImportedFile {
            asset,
            name,
            size,
            media_type,
        })
    })();
    if result.is_err() {
        let _ = fs::remove_file(staging);
    }
    result
}

#[tauri::command]
async fn import_file(root: State<'_, LibraryPath>, path: String) -> Result<ImportedFile> {
    let lock = root.1.clone();
    let root = root.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock
            .lock()
            .map_err(|_| "Library operation failed. Restart the app.".to_string())?;
        copy_file(&root, Path::new(&path))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn validated_web_url(value: &str) -> Result<String> {
    if value
        .trim()
        .chars()
        .any(|character| character.is_whitespace() || character.is_control())
    {
        return Err("Enter an HTTP or HTTPS address without spaces or line breaks.".into());
    }
    let url = url::Url::parse(value.trim())
        .map_err(|_| "Enter a valid HTTP or HTTPS address.".to_string())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Only HTTP and HTTPS links without credentials can be opened.".into());
    }
    Ok(url.to_string())
}

#[tauri::command]
fn open_link(url: String) -> Result<()> {
    let url = validated_web_url(&url)?;
    let status = std::process::Command::new("/usr/bin/open")
        .arg(url)
        .status()
        .map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("Could not open the link in your browser.".into())
    }
}

fn existing_asset(root: &Path, asset: &str) -> Result<PathBuf> {
    let assets = root
        .join("assets")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let path = asset_path(root, asset)?
        .canonicalize()
        .map_err(|_| "This attachment is missing from the local library.".to_string())?;
    if path.parent() != Some(assets.as_path()) || !path.is_file() {
        return Err("Invalid library attachment.".into());
    }
    Ok(path)
}

#[tauri::command]
async fn open_asset(root: State<'_, LibraryPath>, asset: String, reveal: bool) -> Result<()> {
    let lock = root.1.clone();
    let root = root.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock
            .lock()
            .map_err(|_| "Library operation failed. Restart the app.".to_string())?;
        open_asset_copy(&root, &asset, reveal)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn open_asset_copy(root: &Path, asset: &str, reveal: bool) -> Result<()> {
    let original = existing_asset(root, asset)?;
    let library = read_library(root)?;
    let name = library
        .cards
        .iter()
        .flat_map(|card| &card.blocks)
        .find_map(|block| match block {
            Block::File {
                asset: stored,
                name,
                ..
            } if stored == asset => Some(name.as_str()),
            _ => None,
        })
        .unwrap_or(asset);
    let safe_name = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("Attachment");
    let directory = std::env::temp_dir()
        .join("Milanote-ish")
        .join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let path = directory.join(safe_name);
    fs::copy(original, &path).map_err(|e| e.to_string())?;
    let mut command = std::process::Command::new("/usr/bin/open");
    if reveal {
        command.arg("-R");
    }
    let status = command.arg(path).status().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("Could not open the attachment. Try Show in Finder.".into())
    }
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
            app.manage(LibraryPath(root, Default::default()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_library,
            save_card,
            save_patch,
            save_geometry,
            purge_items,
            backup::export_backup,
            backup::inspect_backup,
            backup::restore_backup,
            save_connector,
            save_board,
            save_camera,
            save_session,
            import_image,
            import_clipboard,
            import_file,
            open_asset,
            open_link,
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
    pub(super) fn board(id: String, parent_id: Option<String>) -> Board {
        Board {
            id,
            title: "Storyboard".into(),
            color: "yellow".into(),
            parent_id,
            x: -20.0,
            y: 30.0,
            trashed: false,
            order: 0.0,
        }
    }
    pub(super) fn card(board_id: String) -> Card {
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
                document: None,
            }],
            trashed: false,
            order: 0.0,
        }
    }
    fn line(board_id: &str, from_id: &str, to_id: &str) -> Connector {
        Connector {
            id: uuid::Uuid::new_v4().to_string(),
            board_id: board_id.into(),
            from_id: from_id.into(),
            to_id: to_id.into(),
            arrow: "target".into(),
            color: "#243b35".into(),
            trashed: false,
        }
    }
    #[test]
    fn checkpoints_preserve_new_text_and_deleted_assets_can_be_retained_or_removed() {
        let root = root();
        let owner = board(uuid::Uuid::new_v4().to_string(), None);
        store_board(&root, &owner).unwrap();
        let mut saved = card(owner.id.clone());
        store_card(&root, &saved).unwrap();
        saved.blocks = vec![Block::Text {
            id: uuid::Uuid::new_v4().to_string(),
            text: "latest typing".into(),
            document: None,
        }];
        store_card(&root, &saved).unwrap();
        store_geometry(
            &root,
            &[Geometry {
                id: saved.id.clone(),
                x: 60.0,
                y: 90.0,
                width: Some(400.0),
            }],
        )
        .unwrap();
        let loaded = read_library(&root).unwrap();
        assert!(
            matches!(&loaded.cards[0].blocks[0], Block::Text { text, .. } if text == "latest typing")
        );
        assert_eq!(loaded.cards[0].width, 400.0);
        let source = root.join("original.txt");
        fs::write(&source, b"retained").unwrap();
        let file = copy_file(&root, &source).unwrap();
        let file_id = uuid::Uuid::new_v4().to_string();
        saved.blocks.push(Block::File {
            id: file_id,
            asset: file.asset.clone(),
            name: file.name,
            size: file.size,
            media_type: file.media_type,
        });
        store_patch(
            &root,
            &Patch {
                cards: vec![saved.clone()],
                ..Default::default()
            },
        )
        .unwrap();
        fs::remove_file(asset_path(&root, &file.asset).unwrap()).unwrap();
        saved.x += 1.0;
        store_patch(
            &root,
            &Patch {
                cards: vec![saved.clone()],
                ..Default::default()
            },
        )
        .unwrap();
        let mut fresh = saved.clone();
        fresh.id = uuid::Uuid::new_v4().to_string();
        assert!(store_patch(
            &root,
            &Patch {
                cards: vec![fresh],
                ..Default::default()
            }
        )
        .is_err());
        saved.trashed = true;
        store_patch(
            &root,
            &Patch {
                cards: vec![saved],
                ..Default::default()
            },
        )
        .unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn permanent_deletion_reclaims_only_unreferenced_assets_and_removes_views() {
        let root = root();
        let owner = board(uuid::Uuid::new_v4().to_string(), None);
        store_board(&root, &owner).unwrap();
        let source = root.join("script.txt");
        fs::write(&source, b"shared").unwrap();
        let file = copy_file(&root, &source).unwrap();
        let mut a = card(owner.id.clone());
        a.blocks = vec![Block::File {
            id: uuid::Uuid::new_v4().to_string(),
            asset: file.asset.clone(),
            name: file.name,
            size: file.size,
            media_type: file.media_type,
        }];
        let mut b = a.clone();
        b.id = uuid::Uuid::new_v4().to_string();
        if let Block::File { id, .. } = &mut b.blocks[0] {
            *id = uuid::Uuid::new_v4().to_string();
        }
        store_patch(
            &root,
            &Patch {
                cards: vec![a.clone(), b.clone()],
                ..Default::default()
            },
        )
        .unwrap();
        purge(
            &root,
            &Patch {
                removed: Removed {
                    cards: vec![a.id],
                    ..Default::default()
                },
                ..Default::default()
            },
        )
        .unwrap();
        assert!(asset_path(&root, &file.asset).unwrap().exists());
        let conn = db(&root).unwrap();
        conn.execute(
            "INSERT INTO cameras VALUES (?1, ?2)",
            params![owner.id, "{\"x\":0,\"y\":0,\"zoom\":1}"],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings VALUES ('last_canvas', ?1)",
            [&owner.id],
        )
        .unwrap();
        drop(conn);
        purge(
            &root,
            &Patch {
                removed: Removed {
                    cards: vec![b.id],
                    boards: vec![owner.id.clone()],
                    ..Default::default()
                },
                ..Default::default()
            },
        )
        .unwrap();
        assert!(!asset_path(&root, &file.asset).unwrap().exists());
        let library = read_library(&root).unwrap();
        assert!(!library.cameras.contains_key(&owner.id));
        assert_eq!(library.last_canvas.as_deref(), Some("home"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn group_mutations_move_lines_and_roll_back_invalid_graphs() {
        let root = root();
        let source = board(uuid::Uuid::new_v4().to_string(), None);
        let destination = board(uuid::Uuid::new_v4().to_string(), None);
        let a = card(source.id.clone());
        let b = card(source.id.clone());
        let edge = line(&source.id, &a.id, &b.id);
        let initial = Patch {
            boards: vec![source.clone(), destination.clone()],
            cards: vec![a.clone(), b.clone()],
            connectors: vec![edge.clone()],
            ..Default::default()
        };
        store_patch(&root, &initial).unwrap();
        let mut moved_a = a.clone();
        moved_a.board_id = destination.id.clone();
        let invalid = Patch {
            cards: vec![moved_a.clone()],
            ..Default::default()
        };
        assert!(store_patch(&root, &invalid).is_err());
        let conn = db(&root).unwrap();
        assert_eq!(
            conn.query_row::<String, _, _>(
                "SELECT board_id FROM cards WHERE id=?1",
                [&a.id],
                |row| row.get(0)
            )
            .unwrap(),
            source.id
        );
        drop(conn);
        let mut moved_b = b.clone();
        moved_b.board_id = destination.id.clone();
        let mut moved_line = edge.clone();
        moved_line.board_id = destination.id;
        store_patch(
            &root,
            &Patch {
                cards: vec![moved_a, moved_b],
                connectors: vec![moved_line],
                ..Default::default()
            },
        )
        .unwrap();
        store_patch(&root, &initial).unwrap();
        let mut deleted = source.clone();
        deleted.trashed = true;
        store_patch(
            &root,
            &Patch {
                boards: vec![deleted],
                ..Default::default()
            },
        )
        .unwrap();
        store_patch(&root, &initial).unwrap();
        let mut cycle = source.clone();
        cycle.parent_id = Some(source.id.clone());
        assert!(store_patch(
            &root,
            &Patch {
                boards: vec![cycle],
                ..Default::default()
            }
        )
        .is_err());
        assert!(store_patch(
            &root,
            &Patch {
                removed: Removed {
                    cards: vec![a.id.clone()],
                    ..Default::default()
                },
                ..Default::default()
            }
        )
        .is_err());
        store_patch(
            &root,
            &Patch {
                removed: Removed {
                    connectors: vec![edge.id],
                    cards: vec![a.id, b.id],
                    boards: vec![source.id],
                },
                ..Default::default()
            },
        )
        .unwrap();
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn mixed_content_and_formatting_survive_reopen() {
        let root = root();
        let owner = board(uuid::Uuid::new_v4().to_string(), None);
        store_board(&root, &owner).unwrap();
        let source = root.join("story.pdf");
        fs::write(&source, b"a file fixture").unwrap();
        let imported = copy_file(&root, &source).unwrap();
        fs::remove_file(source).unwrap();
        let mut saved = card(owner.id.clone());
        let uid = || uuid::Uuid::new_v4().to_string();
        let doc: Vec<TextLine> = serde_json::from_value(serde_json::json!([
            {"kind":"paragraph","spans":[{"text":"Bold","bold":true,"italic":true,"underline":true,"strike":true,"href":"https://example.com"}]},
            {"kind":"bullet","spans":[{"text":"A list"}]}])).unwrap();
        saved.blocks = vec![
            Block::Text {
                id: uid(),
                text: "Bold\nA list".into(),
                document: Some(doc),
            },
            Block::Quote {
                id: uid(),
                text: "A quotation".into(),
                attribution: "Author".into(),
            },
            Block::Link {
                id: uid(),
                url: "unfinished address".into(),
                title: "Reference".into(),
            },
            Block::Checklist {
                id: uid(),
                items: vec![ChecklistItem {
                    id: uid(),
                    text: "A shot".into(),
                    done: true,
                }],
            },
            Block::File {
                id: uid(),
                asset: imported.asset.clone(),
                name: imported.name,
                size: imported.size,
                media_type: imported.media_type,
            },
        ];
        store_card(&root, &saved).unwrap();
        let conn = db(&root).unwrap();
        let json: String = conn
            .query_row("SELECT data FROM cards", [], |row| row.get(0))
            .unwrap();
        assert_eq!(serde_json::from_str::<Card>(&json).unwrap().blocks.len(), 5);
        assert_eq!(
            serde_json::to_value(&saved).unwrap(),
            serde_json::from_str::<serde_json::Value>(&json).unwrap()
        );
        assert_eq!(
            fs::read(existing_asset(&root, &imported.asset).unwrap()).unwrap(),
            b"a file fixture"
        );
        drop(conn);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn files_stream_copy_and_validate_owned_paths_and_sizes() {
        let root = root();
        let owner = board(uuid::Uuid::new_v4().to_string(), None);
        store_board(&root, &owner).unwrap();
        let source = root.join("recording.MP4");
        let bytes = vec![42u8; 2 * 1024 * 1024];
        fs::write(&source, &bytes).unwrap();
        let imported = copy_file(&root, &source).unwrap();
        assert_eq!(imported.media_type, "video/mp4");
        assert_eq!(imported.name, "recording.MP4");
        assert_eq!(imported.size, bytes.len() as u64);
        assert!(imported.asset.ends_with(".mp4"));
        fs::remove_file(source).unwrap();
        assert_eq!(
            fs::read(existing_asset(&root, &imported.asset).unwrap()).unwrap(),
            bytes
        );
        assert!(copy_file(&root, &root).is_err());
        assert!(existing_asset(&root, "../library.sqlite3").is_err());
        assert!(existing_asset(&root, "absent.pdf").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(
                root.join("library.sqlite3"),
                root.join("assets/escape.pdf"),
            )
            .unwrap();
            assert!(existing_asset(&root, "escape.pdf").is_err());
        }
        let mut saved = card(owner.id);
        saved.blocks = vec![Block::File {
            id: uuid::Uuid::new_v4().to_string(),
            asset: imported.asset,
            name: imported.name,
            size: imported.size + 1,
            media_type: imported.media_type,
        }];
        assert!(store_card(&root, &saved).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_links_formatting_and_duplicate_checklist_ids_are_rejected() {
        for link in [
            "javascript:alert(1)",
            "file:///tmp/test",
            "https://user:pass@example.com",
            "not an address",
        ] {
            assert!(validated_web_url(link).is_err());
        }
        assert_eq!(
            validated_web_url(" https://example.com/path ").unwrap(),
            "https://example.com/path"
        );
        let root = root();
        let owner = board(uuid::Uuid::new_v4().to_string(), None);
        store_board(&root, &owner).unwrap();
        let mut saved = card(owner.id);
        let item = ChecklistItem {
            id: uuid::Uuid::new_v4().to_string(),
            text: "One".into(),
            done: false,
        };
        saved.blocks = vec![Block::Checklist {
            id: uuid::Uuid::new_v4().to_string(),
            items: vec![item.clone(), item],
        }];
        assert!(store_card(&root, &saved).unwrap_err().contains("Duplicate"));
        saved.blocks = vec![Block::Text {
            id: uuid::Uuid::new_v4().to_string(),
            text: "different".into(),
            document: Some(
                serde_json::from_value(
                    serde_json::json!([{"kind":"paragraph","spans":[{"text":"original"}]}]),
                )
                .unwrap(),
            ),
        }];
        assert!(store_card(&root, &saved)
            .unwrap_err()
            .contains("does not match"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn version_three_update_preserves_cards_and_recovery_snapshot() {
        let root = root();
        let owner = board(uuid::Uuid::new_v4().to_string(), None);
        store_board(&root, &owner).unwrap();
        let saved = card(owner.id);
        store_card(&root, &saved).unwrap();
        let conn = db(&root).unwrap();
        conn.pragma_update(None, "user_version", 3).unwrap();
        drop(conn);
        let conn = db(&root).unwrap();
        assert_eq!(
            conn.pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            4
        );
        let backup = fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| path.to_string_lossy().contains("v3-recovery"))
            .unwrap();
        let backup = Connection::open(backup).unwrap();
        assert_eq!(
            backup
                .pragma_query_value::<i64, _>(None, "user_version", |row| row.get(0))
                .unwrap(),
            3
        );
        let json: String = backup
            .query_row("SELECT data FROM cards", [], |row| row.get(0))
            .unwrap();
        assert_eq!(serde_json::from_str::<Card>(&json).unwrap().id, saved.id);
        drop(backup);
        drop(conn);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn connectors_persist_reconnect_and_reject_foreign_or_missing_endpoints() {
        let root = root();
        let owner = board(uuid::Uuid::new_v4().to_string(), None);
        store_board(&root, &owner).unwrap();
        let tile = board(uuid::Uuid::new_v4().to_string(), Some(owner.id.clone()));
        store_board(&root, &tile).unwrap();
        let a = card(owner.id.clone());
        let b = card(owner.id.clone());
        store_card(&root, &a).unwrap();
        store_card(&root, &b).unwrap();
        let mut edge = line(&owner.id, &a.id, &b.id);
        store_connector(&root, &edge).unwrap();
        edge.to_id = tile.id.clone();
        edge.arrow = "none".into();
        edge.color = "#a04732".into();
        store_connector(&root, &edge).unwrap();
        let conn = db(&root).unwrap();
        let saved: String = conn
            .query_row("SELECT data FROM connectors WHERE id=?1", [&edge.id], |r| {
                r.get(0)
            })
            .unwrap();
        let saved: Connector = serde_json::from_str(&saved).unwrap();
        assert_eq!(saved.to_id, tile.id);
        assert_eq!(saved.arrow, "none");
        assert_eq!(saved.color, "#a04732");
        let foreign = card(tile.id.clone());
        store_card(&root, &foreign).unwrap();
        for target in [
            &foreign.id,
            &a.id,
            &owner.id,
            &uuid::Uuid::new_v4().to_string(),
        ] {
            edge.to_id = target.clone();
            assert!(store_connector(&root, &edge).is_err());
        }
        edge.to_id = tile.id;
        edge.color = "url(https://example.com)".into();
        assert!(store_connector(&root, &edge).is_err());
        assert_eq!(
            conn.query_row::<String, _, _>(
                "SELECT data FROM connectors WHERE id=?1",
                [&edge.id],
                |r| r.get(0)
            )
            .unwrap(),
            serde_json::to_string(&saved).unwrap()
        );
        drop(conn);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn endpoint_and_subtree_trash_atomically_hide_lines_without_reviving_manual_deletions() {
        let root = root();
        let mut owner = board(uuid::Uuid::new_v4().to_string(), None);
        store_board(&root, &owner).unwrap();
        let mut tile = board(uuid::Uuid::new_v4().to_string(), Some(owner.id.clone()));
        store_board(&root, &tile).unwrap();
        let mut a = card(owner.id.clone());
        store_card(&root, &a).unwrap();
        let mut edge = line(&owner.id, &a.id, &tile.id);
        store_connector(&root, &edge).unwrap();
        let conn = db(&root).unwrap();
        assert!(connector_available(&conn, &edge).unwrap());
        a.trashed = true;
        store_card(&root, &a).unwrap();
        assert!(!connector_available(&conn, &edge).unwrap());
        assert!(store_connector(&root, &edge).is_err());
        a.trashed = false;
        store_card(&root, &a).unwrap();
        assert!(connector_available(&conn, &edge).unwrap());
        tile.trashed = true;
        store_board(&root, &tile).unwrap();
        assert!(!connector_available(&conn, &edge).unwrap());
        tile.trashed = false;
        store_board(&root, &tile).unwrap();
        owner.trashed = true;
        store_board(&root, &owner).unwrap();
        assert!(!connector_available(&conn, &edge).unwrap());
        owner.trashed = false;
        store_board(&root, &owner).unwrap();
        assert!(connector_available(&conn, &edge).unwrap());
        edge.trashed = true;
        store_connector(&root, &edge).unwrap();
        a.trashed = true;
        store_card(&root, &a).unwrap();
        a.trashed = false;
        store_card(&root, &a).unwrap();
        let json: String = conn
            .query_row("SELECT data FROM connectors WHERE id=?1", [&edge.id], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(serde_json::from_str::<Connector>(&json).unwrap().trashed);
        // Retained endpoints may not be swapped for arbitrary missing IDs while trashed.
        edge.to_id = uuid::Uuid::new_v4().to_string();
        assert!(store_connector(&root, &edge).is_err());
        drop(conn);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn version_two_migration_preserves_existing_data_and_recovery_copy() {
        let root = root();
        let owner = board(uuid::Uuid::new_v4().to_string(), None);
        store_board(&root, &owner).unwrap();
        let saved = card(owner.id.clone());
        store_card(&root, &saved).unwrap();
        let conn = db(&root).unwrap();
        conn.execute_batch("DROP TABLE connectors; PRAGMA user_version=2;")
            .unwrap();
        drop(conn);
        let conn = db(&root).unwrap();
        let json: String = conn
            .query_row("SELECT data FROM cards", [], |r| r.get(0))
            .unwrap();
        assert_eq!(serde_json::from_str::<Card>(&json).unwrap().id, saved.id);
        assert_eq!(
            conn.query_row::<i64, _, _>("SELECT COUNT(*) FROM connectors", [], |r| r.get(0))
                .unwrap(),
            0
        );
        let recovery = fs::read_dir(&root)
            .unwrap()
            .map(|r| r.unwrap().path())
            .find(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .contains("v2-recovery")
            })
            .unwrap();
        let backup = Connection::open(recovery).unwrap();
        assert_eq!(
            backup
                .pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
                .unwrap(),
            2
        );
        assert_eq!(
            backup
                .query_row::<String, _, _>("SELECT data FROM cards", [], |r| r.get(0))
                .unwrap(),
            json
        );
        drop(backup);
        drop(conn);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn hierarchy_rejects_cycles_and_keeps_subtree_on_restore() {
        let root = root();
        let mut parent = board(uuid::Uuid::new_v4().to_string(), None);
        store_board(&root, &parent).unwrap();
        let mut last = parent.id.clone();
        for _ in 0..20 {
            let child = board(uuid::Uuid::new_v4().to_string(), Some(last));
            store_board(&root, &child).unwrap();
            last = child.id;
        }
        let saved = card(last.clone());
        store_card(&root, &saved).unwrap();
        parent.parent_id = Some(last.clone());
        assert!(store_board(&root, &parent)
            .unwrap_err()
            .contains("descendant"));
        parent.parent_id = Some(uuid::Uuid::new_v4().to_string());
        assert!(store_board(&root, &parent).is_err());
        parent.parent_id = None;
        parent.trashed = true;
        store_board(&root, &parent).unwrap();
        assert!(store_card(&root, &saved).unwrap_err().contains("Trash"));
        assert!(store_board(
            &root,
            &board(uuid::Uuid::new_v4().to_string(), Some(last.clone()))
        )
        .is_err());
        parent.trashed = false;
        store_board(&root, &parent).unwrap();
        let conn = db(&root).unwrap();
        validate_parent(&conn, "", Some(&last)).unwrap();
        assert_eq!(
            conn.query_row::<i64, _, _>("SELECT COUNT(*) FROM boards", [], |r| r.get(0))
                .unwrap(),
            21
        );
        let json: String = conn
            .query_row("SELECT data FROM cards WHERE id=?1", [&saved.id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(serde_json::from_str::<Card>(&json).unwrap().board_id, last);
        drop(conn);
        fs::remove_dir_all(root).unwrap();
    }

    fn legacy_library(root: &Path, id: &str, json: &str) {
        fs::create_dir_all(root).unwrap();
        let conn = Connection::open(root.join("library.sqlite3")).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL;
          CREATE TABLE boards (id TEXT PRIMARY KEY, data TEXT NOT NULL);
          CREATE TABLE cards (id TEXT PRIMARY KEY, board_id TEXT REFERENCES boards(id), data TEXT NOT NULL);
          CREATE TABLE cameras (board_id TEXT PRIMARY KEY REFERENCES boards(id), data TEXT NOT NULL);
          PRAGMA user_version=1;").unwrap();
        conn.execute("INSERT INTO boards VALUES (?1, ?2)", params![id, json])
            .unwrap();
        conn.execute(
            "INSERT INTO cameras VALUES (?1, '{\"x\":123,\"y\":456,\"zoom\":0.8}')",
            [id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO cards VALUES (?1, ?2, ?3)",
            params![
                uuid::Uuid::new_v4().to_string(),
                id,
                serde_json::to_string(&card(id.into())).unwrap()
            ],
        )
        .unwrap();
    }

    #[test]
    fn migration_preserves_cards_cameras_and_makes_consistent_recovery_copy() {
        let root = root();
        let id = uuid::Uuid::new_v4().to_string();
        let original =
            serde_json::json!({"id":id,"title":"Existing board","color":"pink"}).to_string();
        legacy_library(&root, &id, &original);
        let conn = db(&root).unwrap();
        let migrated = read_board(&conn, &id).unwrap();
        assert_eq!(migrated.title, "Existing board");
        assert!(migrated.parent_id.is_none());
        assert!(!migrated.trashed);
        let recovery = fs::read_dir(&root)
            .unwrap()
            .map(|r| r.unwrap().path())
            .find(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .contains("recovery")
            })
            .unwrap();
        let backup = Connection::open(recovery).unwrap();
        assert_eq!(
            backup
                .pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
                .unwrap(),
            1
        );
        assert_eq!(
            backup
                .query_row::<String, _, _>("SELECT data FROM boards", [], |r| r.get(0))
                .unwrap(),
            original
        );
        for table in ["cards", "cameras"] {
            assert_eq!(
                conn.query_row::<String, _, _>(&format!("SELECT data FROM {table}"), [], |r| r
                    .get(0))
                    .unwrap(),
                backup
                    .query_row::<String, _, _>(&format!("SELECT data FROM {table}"), [], |r| r
                        .get(0))
                    .unwrap()
            );
        }
        conn.execute(
            "INSERT INTO cameras VALUES ('home', '{\"x\":0,\"y\":0,\"zoom\":1}')",
            [],
        )
        .unwrap();
        drop(backup);
        drop(conn);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_migration_preserves_original_version_and_board() {
        let root = root();
        let id = uuid::Uuid::new_v4().to_string();
        legacy_library(&root, &id, "{}");
        assert!(db(&root).is_err());
        let conn = Connection::open(root.join("library.sqlite3")).unwrap();
        assert_eq!(
            conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
                .unwrap(),
            1
        );
        assert_eq!(
            conn.query_row::<String, _, _>("SELECT data FROM boards", [], |r| r.get(0))
                .unwrap(),
            "{}"
        );
        drop(conn);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn card_survives_reopen_and_foreign_boards_are_rejected() {
        let root = root();
        let conn = db(&root).unwrap();
        let board_id = uuid::Uuid::new_v4().to_string();
        let board = board(board_id.clone(), None);
        drop(conn);
        store_board(&root, &board).unwrap();
        let conn = db(&root).unwrap();
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
            alt: None,
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
        conn.pragma_update(None, "user_version", 5).unwrap();
        drop(conn);
        assert!(db(&root).unwrap_err().contains("newer"));
        let conn = Connection::open(root.join("library.sqlite3")).unwrap();
        assert_eq!(
            conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0))
                .unwrap(),
            5
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

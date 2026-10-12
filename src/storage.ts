import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import type { Board, Camera, Card, Connector, Library } from "./model";

export const desktop = isTauri();
let root = "";

// Browser previews are deliberately ephemeral. Only the desktop library is authoritative.
export async function loadLibrary(): Promise<Library> {
  if (!desktop)
    return {
      boards: [],
      cards: [],
      connectors: [],
      cameras: {},
      lastCanvas: null,
    };
  root = await appDataDir();
  return invoke("load_library");
}
export async function imageSrc(name: string): Promise<string> {
  return desktop ? convertFileSrc(await join(root, "assets", name)) : name;
}
export async function saveCard(card: Card) {
  if (desktop) await invoke("save_card", { card });
}
export async function saveBoard(board: Board) {
  if (desktop) await invoke("save_board", { board });
}
export async function saveConnector(connector: Connector) {
  if (desktop) await invoke("save_connector", { connector });
}
export async function saveCamera(boardId: string, camera: Camera) {
  if (desktop) await invoke("save_camera", { boardId, camera });
}
export async function saveSession(canvasId: string) {
  if (desktop) await invoke("save_session", { canvasId });
}
export async function importImage(
  path: string,
): Promise<{ asset: string; thumbnail: string; name: string }> {
  return invoke("import_image", { path });
}
export async function importClipboard(
  bytes: number[],
): Promise<{ asset: string; thumbnail: string; name: string }> {
  return invoke("import_clipboard", { bytes });
}

export async function importFile(
  path: string,
): Promise<{ asset: string; name: string; size: number; mediaType: string }> {
  return invoke("import_file", { path });
}
export async function openFile(asset: string, reveal = false) {
  if (desktop) await invoke("open_asset", { asset, reveal });
}
export async function openLink(url: string) {
  if (desktop) await invoke("open_link", { url });
  else window.open(url, "_blank", "noopener,noreferrer");
}

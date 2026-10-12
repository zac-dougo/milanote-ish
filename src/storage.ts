import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import type { Board, Camera, Card, Library } from "./model";

export const desktop = isTauri();
let root = "";

// Browser previews are deliberately ephemeral. Only the desktop library is authoritative.
export async function loadLibrary(): Promise<Library> {
  if (!desktop) return { boards: [], cards: [], cameras: {}, lastCanvas: null };
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

use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use tauri_plugin_notification::NotificationExt;
use tiny_http::{Header, Method, Request, Response, Server};

const DEFAULT_PORT: u16 = 47321;
const ASK_TIMEOUT: Duration = Duration::from_secs(5 * 60); // keep below the hook's `timeout` in settings

// ask id -> HTTP request held open until the user picks an answer.
// shortcut: a killed hook leaves its card up until clicked/timed out, detect disconnects if that annoys.
#[derive(Default)]
struct Pending(Mutex<HashMap<u64, Request>>);

fn port() -> u16 {
    std::env::var("BUDDY_PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(DEFAULT_PORT)
}

// System notifications are on unless the user turned them off; the choice is a marker file so it survives restarts.
static NOTIFY: AtomicBool = AtomicBool::new(true);

fn notify_off_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("notifications-off"))
}

fn toggle_notify(app: &AppHandle) {
    let on = !NOTIFY.fetch_xor(true, Ordering::Relaxed);
    if let Some(f) = notify_off_file(app) {
        let _ = if on { std::fs::remove_file(&f) } else { std::fs::create_dir_all(f.parent().unwrap()).and_then(|_| std::fs::write(&f, "")) };
    }
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    if NOTIFY.load(Ordering::Relaxed) {
        let _ = app.notification().builder().title(title).body(body).show();
    }
}

fn finish_ask(app: &AppHandle, id: u64, result: &Value) {
    let Some(req) = app.state::<Pending>().0.lock().unwrap().remove(&id) else { return };
    let header = Header::from_bytes("Content-Type", "application/json").unwrap();
    let _ = req.respond(Response::from_string(result.to_string()).with_header(header));
    let _ = app.emit("ask-closed", id);
}

// Browsers add Origin to cross-site requests; the hook script never does. Without this check any open web page
// could POST fake events and prompts to 127.0.0.1.
fn from_browser(headers: &[Header]) -> bool {
    headers.iter().any(|h| h.field.equiv("Origin"))
}

fn serve(app: AppHandle, server: Server) {
    let mut next_id = 1u64;
    for mut req in server.incoming_requests() {
        if from_browser(req.headers()) {
            let _ = req.respond(Response::empty(403));
            continue;
        }
        if *req.method() != Method::Post {
            let _ = req.respond(Response::empty(404));
            continue;
        }
        let mut raw = String::new();
        let parsed = req.as_reader().take(1_000_000).read_to_string(&mut raw).ok()
            .and_then(|_| serde_json::from_str::<Value>(if raw.is_empty() { "{}" } else { &raw }).ok());
        let Some(mut body) = parsed else {
            let _ = req.respond(Response::empty(400));
            continue;
        };
        let agent = body["agent"].as_str().unwrap_or("Agent").to_string();

        match req.url().to_string().as_str() {
            "/event" => {
                let _ = app.emit("event", &body);
                if body["kind"] == "done" {
                    let msg = body["message"].as_str().filter(|m| !m.is_empty()).or(body["project"].as_str()).unwrap_or("");
                    notify(&app, &format!("{agent} finished"), msg);
                }
                let _ = req.respond(Response::empty(204));
            }
            "/ask" => {
                let id = next_id;
                next_id += 1;
                let what = if body["kind"] == "permission" {
                    format!("Allow {}?", body["tool"].as_str().unwrap_or("tool"))
                } else {
                    "Has a question for you".to_string()
                };
                app.state::<Pending>().0.lock().unwrap().insert(id, req);
                body["id"] = json!(id);
                let _ = app.emit("ask", &body);
                notify(&app, &format!("{agent} needs you"), &what);
                let app = app.clone();
                thread::spawn(move || {
                    thread::sleep(ASK_TIMEOUT);
                    finish_ask(&app, id, &json!({}));
                });
            }
            _ => {
                let _ = req.respond(Response::empty(404));
            }
        }
    }
}

#[tauri::command]
fn answer(app: AppHandle, id: u64, result: Value) {
    finish_ask(&app, id, &result);
}

// Grow/shrink the window around its bottom-right corner so transparent space doesn't block clicks.
#[tauri::command]
fn resize(window: WebviewWindow, width: f64, height: f64) -> tauri::Result<()> {
    let scale = window.scale_factor()?;
    let pos = window.outer_position()?;
    let old = window.outer_size()?;
    let (w, h) = ((width * scale).round() as i32, (height * scale).round() as i32);
    window.set_size(PhysicalSize::new(w as u32, h as u32))?;
    window.set_position(PhysicalPosition::new(pos.x + old.width as i32 - w, pos.y + old.height as i32 - h))
}

#[tauri::command]
fn menu(window: WebviewWindow, skin: String) -> tauri::Result<()> {
    let app = window.app_handle();
    let info = MenuItem::with_id(app, "port", format!("Listening on 127.0.0.1:{}", port()), false, None::<&str>)?;
    let blob = CheckMenuItem::with_id(app, "skin:blob", "Skin: Clay blob", true, skin == "blob", None::<&str>)?;
    let akatsuki = CheckMenuItem::with_id(app, "skin:akatsuki", "Skin: Itachi", true, skin == "akatsuki", None::<&str>)?;
    let notif = CheckMenuItem::with_id(app, "notify", "System notifications", true, NOTIFY.load(Ordering::Relaxed), None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Buddy", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let m = Menu::with_items(app, &[&info, &sep, &blob, &akatsuki, &PredefinedMenuItem::separator(app)?, &notif, &PredefinedMenuItem::separator(app)?, &quit])?;
    window.popup_menu(&m)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // GNOME ignores always-on-top for native Wayland windows; XWayland honours it.
    #[cfg(target_os = "linux")]
    if std::env::var_os("GDK_BACKEND").is_none() {
        std::env::set_var("GDK_BACKEND", "x11");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .manage(Pending::default())
        .invoke_handler(tauri::generate_handler![answer, resize, menu])
        .on_menu_event(|app, e| {
            if e.id() == "quit" {
                app.exit(0);
            } else if e.id() == "notify" {
                toggle_notify(app);
            } else if let Some(skin) = e.id().as_ref().strip_prefix("skin:") {
                let _ = app.emit("skin", skin);
            }
        })
        .setup(|app| {
            NOTIFY.store(!notify_off_file(app.handle()).is_some_and(|f| f.exists()), Ordering::Relaxed);
            let win = app.get_webview_window("main").expect("main window");
            if let Some(m) = win.primary_monitor()? {
                let area = m.work_area();
                let size = win.outer_size()?;
                let margin = (24.0 * m.scale_factor()) as i32;
                win.set_position(PhysicalPosition::new(
                    area.position.x + area.size.width as i32 - size.width as i32 - margin,
                    area.position.y + area.size.height as i32 - size.height as i32 - margin,
                ))?;
            }
            let server = Server::http(("127.0.0.1", port()))
                .map_err(|e| format!("Buddy: cannot listen on port {}: {e}", port()))?;
            let handle = app.handle().clone();
            thread::spawn(move || serve(handle, server));
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Buddy");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_only_browser_requests() {
        let h = |k: &str, v: &str| Header::from_bytes(k, v).unwrap();
        assert!(from_browser(&[h("Origin", "https://evil.example")]));
        assert!(from_browser(&[h("origin", "null")])); // header names are case-insensitive
        assert!(!from_browser(&[h("Content-Type", "application/json"), h("Host", "127.0.0.1:47321")])); // the hook script
    }
}

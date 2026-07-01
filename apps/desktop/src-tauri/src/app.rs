use serde::Serialize;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopCapabilities {
    desktop: bool,
    weixin_bridge: WeixinBridgeCapability,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WeixinBridgeCapability {
    managed_available: bool,
    rpc_url: String,
    reason: Option<String>,
}

#[tauri::command]
fn desktop_capabilities() -> DesktopCapabilities {
    let bridge_live = weixin_bridge_live();
    DesktopCapabilities {
        desktop: true,
        weixin_bridge: WeixinBridgeCapability {
            managed_available: bridge_live,
            rpc_url: "http://127.0.0.1:18790/api/v1/admin/rpc".to_string(),
            reason: if bridge_live { None } else { Some("not_running".to_string()) },
        },
    }
}

fn weixin_bridge_live() -> bool {
    let Ok(mut stream) = TcpStream::connect_timeout(
        &"127.0.0.1:18790".parse().expect("valid bridge address"),
        Duration::from_millis(500),
    ) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));
    if stream
        .write_all(b"GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
        .is_err()
    {
        return false;
    }
    let mut response = String::new();
    if stream.read_to_string(&mut response).is_err() {
        return false;
    }
    response.starts_with("HTTP/1.1 200") && response.contains("\"ok\":true")
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![desktop_capabilities])
        .run(tauri::generate_context!())
        .expect("error while running Nexus desktop");
}

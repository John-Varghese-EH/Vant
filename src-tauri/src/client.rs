use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::{mpsc, Mutex};
use tokio::time::Duration;

use crate::transport;

#[derive(Error, Debug)]
pub enum ClientError {
    #[error("Not connected")]
    NotConnected,
    #[error("Transport error: {0}")]
    Transport(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Host rejected connection")]
    HostRejected,
}

#[derive(Serialize, Clone, Debug)]
pub enum ConnectionStatus {
    Disconnected,
    Connecting,
    Connected {
        mode: String,
        latency_ms: u32,
        host_name: String,
    },
    Reconnecting {
        attempt: u32,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HttpProxyRequest {
    pub action: String, // "http_proxy"
    pub req_id: String,
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body_base64: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_port: Option<u16>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HttpProxyResponseChunk {
    pub action: String, // "http_proxy_chunk"
    pub req_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_code: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<Vec<(String, String)>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_base64: Option<String>,
    pub done: bool,
}

pub struct ClientConnection {
    status: ConnectionStatus,
    sender: Option<mpsc::Sender<Vec<u8>>>,
    routers: Arc<Mutex<HashMap<String, mpsc::Sender<serde_json::Value>>>>,
    last_address: Option<String>,
    last_port: Option<u16>,
    last_peer_id: Option<String>,
}

impl ClientConnection {
    pub fn new() -> Self {
        Self {
            status: ConnectionStatus::Disconnected,
            sender: None,
            routers: Arc::new(Mutex::new(HashMap::new())),
            last_address: None,
            last_port: None,
            last_peer_id: None,
        }
    }

    pub async fn connect(
        &mut self,
        noise_priv: [u8; 32],
        peer_id: &str,
        address: &str,
        port: u16,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<(), ClientError> {
        let url = format!("ws://{}:{}", address, port);
        self.connect_url(noise_priv, &url, app_handle).await?;
        self.last_address = Some(address.to_string());
        self.last_port = Some(port);
        self.last_peer_id = Some(peer_id.to_string());
        Ok(())
    }

    pub async fn connect_url(
        &mut self,
        noise_priv: [u8; 32],
        url: &str,
        app_handle: Option<tauri::AppHandle>,
    ) -> Result<(), ClientError> {
        self.status = ConnectionStatus::Connecting;

        let mut clean_url = url.trim().to_string();

        // 1. Deep link unpacker: vant://pair?url=...&token=... (or ghostcompute://)
        if clean_url.starts_with("vant://") || clean_url.starts_with("ghostcompute://") {
            if let Ok(parsed) = url::Url::parse(&clean_url) {
                let mut target_url = None;
                let mut token = None;
                for (k, v) in parsed.query_pairs() {
                    if k == "url" {
                        target_url = Some(v.into_owned());
                    } else if k == "token" {
                        token = Some(v.into_owned());
                    }
                }
                if let Some(mut target) = target_url {
                    if let Some(tok) = token {
                        if !target.contains("token=") {
                            let sep = if target.contains('?') { "&" } else { "?" };
                            target = format!("{}{}{}", target, sep, format!("token={}", tok));
                        }
                    }
                    clean_url = target;
                }
            }
        }

        // 2. Cleanly separate base endpoint from query parameters (e.g. ?token=...)
        let (raw_base, query) = match clean_url.split_once('?') {
            Some((base, q)) => (base.trim_end_matches('/'), Some(q)),
            None => (clean_url.trim_end_matches('/'), None),
        };

        let mut ws_base = raw_base.to_string();
        let has_scheme = ws_base.starts_with("ws://")
            || ws_base.starts_with("wss://")
            || ws_base.starts_with("http://")
            || ws_base.starts_with("https://");

        if !has_scheme {
            let is_tunnel = ws_base.contains("trycloudflare.com")
                || ws_base.contains("cloudflareaccess.com")
                || ws_base.contains(".pinggy.link");
            if !ws_base.contains(':') && !is_tunnel {
                ws_base = format!("{}:8384", ws_base);
            }
            if is_tunnel {
                ws_base = format!("wss://{}", ws_base);
            } else {
                ws_base = format!("ws://{}", ws_base);
            }
        } else if let Some(stripped) = ws_base.strip_prefix("http://") {
            ws_base = format!("ws://{}", stripped);
        } else if let Some(stripped) = ws_base.strip_prefix("https://") {
            ws_base = format!("wss://{}", stripped);
        }

        // 3. Ensure the WebSocket request-target has a valid root slash before query or path
        let ws_url = match query {
            Some(q) => format!("{}/?{}", ws_base, q),
            None => format!("{}/", ws_base),
        };

        let mut request =
            tokio_tungstenite::tungstenite::client::IntoClientRequest::into_client_request(
                ws_url.as_str(),
            )
            .map_err(|e| ClientError::Transport(format!("Invalid URL '{}': {}", ws_url, e)))?;

        // Add standard User-Agent so Cloudflare Edge WAF / bot mitigations do not reject the connection
        request.headers_mut().insert(
            tokio_tungstenite::tungstenite::http::header::USER_AGENT,
            tokio_tungstenite::tungstenite::http::HeaderValue::from_static(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Vant/0.1.0 Safari/537.36",
            ),
        );

        log::info!("[Client] Initiating connection to: {}", ws_url);

        // Allow 15 seconds for WAN / Cloudflare edge tunnel connections to establish
        let connect_timeout = tokio::time::timeout(
            Duration::from_secs(15),
            tokio_tungstenite::connect_async(request),
        )
        .await;

        match connect_timeout {
            Ok(Ok((ws_stream, response))) => {
                log::info!("[Client] WebSocket transport established with {} (HTTP status: {})", ws_url, response.status());
                use futures_util::StreamExt;
                let (tx, rx) = ws_stream.split();
                let tx: crate::transport::BoxSink = Box::new(tx);
                let rx: crate::transport::BoxStream = Box::new(rx);

                // Allow 15 seconds for Noise cryptographic handshake over WAN tunnels
                log::info!("[Client] Commencing Noise-XX cryptographic handshake with {}", ws_url);
                let handshake_timeout = tokio::time::timeout(
                    Duration::from_secs(15),
                    transport::handshake_as_initiator(tx, rx, &noise_priv),
                )
                .await;

                match handshake_timeout {
                    Ok(Ok(mut session)) => {
                        let remote_id = session.peer_id().to_string();
                        log::info!("[Client] Cryptographic handshake SUCCESS with peer: {}", remote_id);
                        self.last_peer_id = Some(remote_id.clone());
                        self.last_address = Some(ws_url.clone());
                        
                        let (tx_send, mut rx_send) = mpsc::channel::<Vec<u8>>(100);
                        self.sender = Some(tx_send);
                        
                        let routers = self.routers.clone();
                        let app_routers = self.routers.clone();
                        let app_clone = app_handle.clone();
                        let remote_peer_for_actor = remote_id.clone();
                        let ws_url_for_actor = ws_url.clone();
                        
                        // Spawn background actor loop
                        tokio::spawn(async move {
                            loop {
                                tokio::select! {
                                    payload = rx_send.recv() => {
                                        if let Some(p) = payload {
                                            if let Err(e) = session.send(&p).await {
                                                log::error!("Error sending to session: {}", e);
                                                break;
                                            }
                                        } else {
                                            break;
                                        }
                                    }
                                    recv_res = session.recv() => {
                                        match recv_res {
                                            Ok(chunk) => {
                                                if let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&chunk) {
                                                    let action = parsed.get("action").and_then(|v| v.as_str()).unwrap_or("");
                                                    if action == "http_proxy_chunk" {
                                                        if let Some(req_id) = parsed.get("req_id").and_then(|v| v.as_str()) {
                                                            let mut r = routers.lock().await;
                                                            if let Some(sender) = r.get(req_id) {
                                                                if sender.send(parsed.clone()).await.is_err() {
                                                                    // Channel closed, remove it
                                                                    r.remove(req_id);
                                                                }
                                                            }
                                                        }
                                                    } else if action == "pair_ok" {
                                                        log::info!("[Client] Received pair_ok approval from host!");
                                                        if let Some(ref app) = app_clone {
                                                            use tauri::Manager;
                                                            use tauri::Emitter;
                                                            if let Some(app_state) = app.try_state::<crate::AppState>() {
                                                                let store = app_state.peer_store.lock().await;
                                                                let _ = store.add_peer(&remote_peer_for_actor, &ws_url_for_actor, &remote_peer_for_actor);
                                                                let mut ps = app_state.pairing_state.lock().await;
                                                                *ps = crate::pairing::PairingState::Completed { peer_id: remote_peer_for_actor.clone() };
                                                                let _ = app.emit("pairing-state-changed", ());
                                                                log::info!("[Client] Pairing state set to Completed and saved to trusted peers for {}", remote_peer_for_actor);
                                                            }
                                                        }
                                                        let r = routers.lock().await;
                                                        if let Some(sender) = r.get("pairing") {
                                                            let _ = sender.send(parsed.clone()).await;
                                                        }
                                                    } else if action == "pair_sas" {
                                                        let r = routers.lock().await;
                                                        if let Some(sender) = r.get("pairing") {
                                                            let _ = sender.send(parsed.clone()).await;
                                                        }
                                                    } else if action == "sys_stats_response" {
                                                        let r = routers.lock().await;
                                                        if let Some(sender) = r.get("sys_stats") {
                                                            let _ = sender.send(parsed.clone()).await;
                                                        }
                                                    } else if action == "pong" {
                                                        let r = routers.lock().await;
                                                        if let Some(sender) = r.get("ping") {
                                                            let _ = sender.send(parsed.clone()).await;
                                                        }
                                                    }
                                                }
                                            }
                                            Err(_) => {
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                            // Clean up
                            let mut r = app_routers.lock().await;
                            r.clear();
                        });

                        let initial_latency = self.measure_latency().await.unwrap_or(0);

                        self.status = ConnectionStatus::Connected {
                            mode: if ws_url.starts_with("wss") {
                                "WAN (WSS)".to_string()
                            } else {
                                "LAN (WS)".to_string()
                            },
                            latency_ms: initial_latency,
                            host_name: remote_id[..8.min(remote_id.len())].to_string(),
                        };
                        Ok(())
                    }
                    Ok(Err(e)) => {
                        self.status = ConnectionStatus::Disconnected;
                        Err(ClientError::Transport(format!("Noise cryptographic handshake failed: {}", e)))
                    }
                    Err(_) => {
                        self.status = ConnectionStatus::Disconnected;
                        Err(ClientError::Transport(format!("Cryptographic handshake timed out with {}. The host did not reply.", ws_url)))
                    }
                }
            }
            Ok(Err(e)) => {
                self.status = ConnectionStatus::Disconnected;
                let err_str = e.to_string();
                log::warn!("[Client] Transport connection failed for {}: {}", ws_url, err_str);
                let friendly = if err_str.contains("530") {
                    format!("Cloudflare Tunnel returned HTTP 530 (Origin Down or Expired). The Quick Tunnel URL has expired or is still provisioning. On the Host PC, click 'Restart Tunnel' to obtain a fresh URL.", )
                } else if err_str.contains("400") {
                    format!("Connection rejected (HTTP 400 Bad Request) by {}. The WebSocket handshake request was malformed or rejected by edge proxy.", ws_url)
                } else if err_str.contains("refused") || err_str.contains("10061") || err_str.contains("111") {
                    format!("Connection refused by {}. Verify that Vant is actively running in Server Mode on the Host PC and port 8384 is allowed through Windows Firewall.", ws_url)
                } else {
                    format!("Failed to connect to {}: {}", ws_url, err_str)
                };
                Err(ClientError::Transport(friendly))
            }
            Err(_) => {
                self.status = ConnectionStatus::Disconnected;
                log::warn!("[Client] Connection timeout (15s) waiting for {}", ws_url);
                Err(ClientError::Transport(format!(
                    "Connection to {} timed out after 15 seconds. If connecting over Wi-Fi, ensure Windows Defender Firewall allows port 8384. If on another network, ensure the Cloudflare Quick Tunnel is active on the Host.",
                    ws_url
                )))
            }
        }
    }

    pub async fn disconnect(&mut self) {
        self.sender = None;
        self.status = ConnectionStatus::Disconnected;
    }

    pub async fn send_payload(&self, payload: &[u8]) -> Result<(), ClientError> {
        let sender = self.sender.as_ref().ok_or(ClientError::NotConnected)?;
        sender
            .send(payload.to_vec())
            .await
            .map_err(|e| ClientError::Transport(e.to_string()))?;
        Ok(())
    }

    pub async fn send_request(&mut self, payload: &[u8]) -> Result<Vec<u8>, ClientError> {
        let sender = self.sender.as_ref().ok_or(ClientError::NotConnected)?;
        
        // For pairing, we use a special "pairing" channel
        let (tx, mut rx) = mpsc::channel(1);
        self.routers.lock().await.insert("pairing".to_string(), tx);
        
        sender
            .send(payload.to_vec())
            .await
            .map_err(|e| ClientError::Transport(e.to_string()))?;
            
        let res = match tokio::time::timeout(Duration::from_secs(10), rx.recv()).await {
            Ok(Some(msg)) => serde_json::to_vec(&msg).map_err(|_| ClientError::Transport("serialization failed".into())),
            Ok(None) => Err(ClientError::Transport("connection closed".into())),
            Err(_) => Err(ClientError::Transport("timeout".into())),
        };
        
        self.routers.lock().await.remove("pairing");
        res
    }

    pub fn last_peer_id(&self) -> Option<String> { self.last_peer_id.clone() }
    pub fn last_address(&self) -> Option<String> { self.last_address.clone() }

    pub fn status(&self) -> ConnectionStatus {
        self.status.clone()
    }
    
    pub async fn proxy_http_request(
        &mut self,
        request: HttpProxyRequest,
    ) -> Result<mpsc::Receiver<serde_json::Value>, ClientError> {
        let sender = self.sender.as_ref().ok_or(ClientError::NotConnected)?.clone();
        
        let (tx, rx) = mpsc::channel(100);
        self.routers.lock().await.insert(request.req_id.clone(), tx);
        
        let payload = serde_json::to_vec(&request).map_err(|e| ClientError::Transport(e.to_string()))?;
        sender.send(payload).await.map_err(|e| ClientError::Transport(e.to_string()))?;
        
        Ok(rx)
    }
    
    pub async fn remove_proxy_router(&self, req_id: &str) {
        self.routers.lock().await.remove(req_id);
    }

    pub fn update_latency(&mut self, rtt_ms: u32) {
        if let ConnectionStatus::Connected { mode, host_name, .. } = &self.status {
            self.status = ConnectionStatus::Connected {
                mode: mode.clone(),
                latency_ms: rtt_ms,
                host_name: host_name.clone(),
            };
        }
    }

    pub async fn measure_latency(&mut self) -> Result<u32, ClientError> {
        let sender = self.sender.as_ref().ok_or(ClientError::NotConnected)?.clone();
        let (tx, mut rx) = mpsc::channel(1);
        self.routers.lock().await.insert("ping".to_string(), tx);

        let payload = serde_json::to_vec(&serde_json::json!({ "action": "ping" }))
            .map_err(|e| ClientError::Transport(e.to_string()))?;

        let started = std::time::Instant::now();
        sender.send(payload).await.map_err(|e| ClientError::Transport(e.to_string()))?;

        let res = match tokio::time::timeout(Duration::from_secs(3), rx.recv()).await {
            Ok(Some(_)) => {
                let rtt = started.elapsed().as_millis().max(1) as u32;
                self.update_latency(rtt);
                Ok(rtt)
            }
            Ok(None) => Err(ClientError::Transport("connection closed".into())),
            Err(_) => Err(ClientError::Transport("ping timeout".into())),
        };

        self.routers.lock().await.remove("ping");
        res
    }
}

impl ClientConnection {
    pub async fn prepare_chat_stream(
        &mut self,
        payload: &[u8],
    ) -> Result<(String, mpsc::Receiver<serde_json::Value>, Arc<Mutex<HashMap<String, mpsc::Sender<serde_json::Value>>>>), ClientError> {
        let v: serde_json::Value = serde_json::from_slice(payload)
            .map_err(|e| ClientError::Transport(format!("Invalid chat payload: {}", e)))?;

        let message = v
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_string();

        let explicit_model = v
            .get("model")
            .and_then(|m| m.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string());

        let system_prompt = v
            .get("system_prompt")
            .and_then(|s| s.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string());

        let temperature = v.get("temperature").and_then(|t| t.as_f64());

        let target_model = if let Some(m) = explicit_model {
            m
        } else {
            let remote_models = self.get_remote_models().await.unwrap_or_default();
            remote_models
                .into_iter()
                .next()
                .unwrap_or_else(|| "llama3.2".to_string())
        };

        let mut chat_messages: Vec<serde_json::Value> = Vec::new();
        if let Some(sys) = system_prompt {
            chat_messages.push(serde_json::json!({
                "role": "system",
                "content": sys
            }));
        }

        if let Some(history) = v.get("messages").and_then(|m| m.as_array()) {
            for item in history {
                if let (Some(role), Some(content)) = (
                    item.get("role").and_then(|r| r.as_str()),
                    item.get("content").and_then(|c| c.as_str()),
                ) {
                    chat_messages.push(serde_json::json!({
                        "role": role,
                        "content": content
                    }));
                }
            }
        } else {
            chat_messages.push(serde_json::json!({
                "role": "user",
                "content": message
            }));
        }

        let mut ollama_req = serde_json::json!({
            "model": target_model,
            "messages": chat_messages,
            "stream": true,
            "keep_alive": "30m"
        });

        if let Some(temp) = temperature {
            if let Some(obj) = ollama_req.as_object_mut() {
                obj.insert(
                    "options".to_string(),
                    serde_json::json!({ "temperature": temp }),
                );
            }
        }

        let req_id = uuid::Uuid::new_v4().to_string();
        let req = HttpProxyRequest {
            action: "http_proxy".to_string(),
            req_id: req_id.clone(),
            method: "POST".to_string(),
            path: "/api/chat".to_string(),
            headers: vec![("Content-Type".to_string(), "application/json".to_string())],
            body_base64: Some(base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                serde_json::to_vec(&ollama_req)?,
            )),
            target_port: None,
        };

        let rx = self.proxy_http_request(req).await?;
        Ok((req_id, rx, self.routers.clone()))
    }

    pub async fn stream_chat_chunks(
        req_id: &str,
        mut rx: mpsc::Receiver<serde_json::Value>,
        routers: Arc<Mutex<HashMap<String, mpsc::Sender<serde_json::Value>>>>,
        app: tauri::AppHandle,
    ) -> Result<(), ClientError> {
        use tauri::Emitter;
        let mut line_buffer = String::new();
        let mut error_msg: Option<String> = None;
        let mut http_error_status: Option<u16> = None;
        let mut saw_done = false;

        while let Some(chunk) = rx.recv().await {
            if let Ok(proxy_chunk) = serde_json::from_value::<HttpProxyResponseChunk>(chunk) {
                if let Some(code) = proxy_chunk.status_code {
                    if code >= 400 {
                        http_error_status = Some(code);
                    }
                }
                if let Some(b64) = proxy_chunk.data_base64 {
                    if let Ok(bytes) =
                        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64)
                    {
                        let text = String::from_utf8_lossy(&bytes);
                        line_buffer.push_str(&text);
                        while let Some(newline_pos) = line_buffer.find('\n') {
                            let line = line_buffer[..newline_pos].trim().to_string();
                            line_buffer = line_buffer[newline_pos + 1..].to_string();
                            if line.is_empty() {
                                continue;
                            }
                            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&line) {
                                if let Some(err) = parsed.get("error").and_then(|e| e.as_str()) {
                                    error_msg = Some(err.to_string());
                                } else {
                                    if parsed.get("done").and_then(|d| d.as_bool()) == Some(true) {
                                        saw_done = true;
                                    }
                                    let _ = app.emit("chat-chunk", parsed);
                                }
                            }
                        }
                    }
                }
                if proxy_chunk.done {
                    let rem = line_buffer.trim();
                    if !rem.is_empty() {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(rem) {
                            if let Some(err) = parsed.get("error").and_then(|e| e.as_str()) {
                                error_msg = Some(err.to_string());
                            } else {
                                if parsed.get("done").and_then(|d| d.as_bool()) == Some(true) {
                                    saw_done = true;
                                }
                                let _ = app.emit("chat-chunk", parsed);
                            }
                        } else if http_error_status.is_some() {
                            error_msg = Some(rem.to_string());
                        }
                    }
                    break;
                }
            }
        }

        routers.lock().await.remove(req_id);

        if let Some(err) = error_msg {
            let _ = app.emit("chat-chunk", serde_json::json!({"error": err, "done": true}));
            return Err(ClientError::Transport(err));
        }

        if let Some(code) = http_error_status {
            let msg = if code == 502 {
                "Host Ollama engine is offline or unreachable on port 11434.".to_string()
            } else {
                format!("Host AI engine returned HTTP {}", code)
            };
            let _ = app.emit("chat-chunk", serde_json::json!({"error": msg, "done": true}));
            return Err(ClientError::Transport(msg));
        }

        if !saw_done {
            let _ = app.emit("chat-chunk", serde_json::json!({"done": true}));
        }

        Ok(())
    }

    pub async fn get_remote_models(&mut self) -> Result<Vec<String>, ClientError> {
        let req_id = uuid::Uuid::new_v4().to_string();
        let req = HttpProxyRequest {
            action: "http_proxy".to_string(),
            req_id: req_id.clone(),
            method: "GET".to_string(),
            path: "/api/tags".to_string(),
            headers: vec![],
            body_base64: None,
            target_port: None,
        };

        let mut rx = self.proxy_http_request(req).await?;
        let mut full_body = Vec::new();

        while let Some(chunk) = rx.recv().await {
            if let Ok(proxy_chunk) = serde_json::from_value::<HttpProxyResponseChunk>(chunk) {
                if let Some(b64) = proxy_chunk.data_base64 {
                    if let Ok(bytes) =
                        base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64)
                    {
                        full_body.extend(bytes);
                    }
                }
                if proxy_chunk.done {
                    break;
                }
            }
        }

        self.remove_proxy_router(&req_id).await;

        if let Ok(parsed) = serde_json::from_slice::<serde_json::Value>(&full_body) {
            if let Some(models) = parsed.get("models").and_then(|m| m.as_array()) {
                let names = models
                    .iter()
                    .filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(|s| s.to_string()))
                    .collect();
                return Ok(names);
            }
        }
        Ok(vec![])
    }

    pub async fn get_host_sys_stats(&mut self) -> Result<serde_json::Value, ClientError> {
        let sender = self.sender.as_ref().ok_or(ClientError::NotConnected)?;

        let (tx, mut rx) = mpsc::channel(1);
        self.routers.lock().await.insert("sys_stats".to_string(), tx);

        let payload = serde_json::to_vec(&serde_json::json!({ "action": "get_sys_stats" }))
            .map_err(|e| ClientError::Transport(e.to_string()))?;

        let started = std::time::Instant::now();
        sender
            .send(payload)
            .await
            .map_err(|e| ClientError::Transport(e.to_string()))?;

        let res = match tokio::time::timeout(Duration::from_secs(5), rx.recv()).await {
            Ok(Some(msg)) => {
                let rtt = started.elapsed().as_millis().max(1) as u32;
                self.update_latency(rtt);
                if let Some(data) = msg.get("data") {
                    Ok(data.clone())
                } else {
                    Err(ClientError::Transport("Invalid sys_stats format".into()))
                }
            }
            Ok(None) => Err(ClientError::Transport("connection closed".into())),
            Err(_) => Err(ClientError::Transport("timeout".into())),
        };

        self.routers.lock().await.remove("sys_stats");
        res
    }
}

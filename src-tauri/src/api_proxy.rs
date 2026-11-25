use axum::{
    body::Body,
    extract::{Path, Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode},
    response::IntoResponse,
    routing::any,
    Router,
};
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::oneshot;
use tower_http::cors::{Any, CorsLayer};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};

use crate::client::{HttpProxyRequest, HttpProxyResponseChunk, ClientConnection};
use crate::model_alias::ModelAliasStore;

#[derive(Clone)]
pub struct ProxyState {
    pub api_key: Option<String>,
    pub p2p_client: Arc<tokio::sync::Mutex<ClientConnection>>,
    pub settings: Arc<tokio::sync::Mutex<crate::settings::SettingsStore>>,
}

#[derive(Serialize, Clone, Debug)]
pub struct ApiProxyStatus {
    pub running: bool,
    pub port: u16,
    pub endpoint: String,
}

pub struct ApiProxyHandle {
    shutdown_tx: Option<oneshot::Sender<()>>,
    service_forwarders: std::collections::HashMap<u16, (u16, oneshot::Sender<()>)>,
    pub status: ApiProxyStatus,
}

impl ApiProxyHandle {
    pub fn new() -> Self {
        Self {
            shutdown_tx: None,
            service_forwarders: std::collections::HashMap::new(),
            status: ApiProxyStatus {
                running: false,
                port: 0,
                endpoint: String::new(),
            },
        }
    }

    pub async fn start(
        &mut self,
        port: u16,
        api_key: Option<String>,
        p2p_client: Arc<tokio::sync::Mutex<ClientConnection>>,
        settings: Arc<tokio::sync::Mutex<crate::settings::SettingsStore>>,
    ) -> Result<(), String> {
        if self.shutdown_tx.is_some() {
            return Ok(());
        }

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        let proxy_state = ProxyState {
            api_key: api_key.clone(),
            p2p_client,
            settings,
        };

        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);

        let app = Router::new()
            .route("/", any(proxy_handler_root))
            .route("/*path", any(proxy_handler))
            .layer(cors)
            .with_state(Arc::new(proxy_state));

        let candidates = [port, port.saturating_add(1), 8787];
        let mut bound_listener = None;
        let mut bound_port = port;
        let mut last_err = String::new();

        for cand in candidates {
            match tokio::net::TcpListener::bind(format!("127.0.0.1:{}", cand)).await {
                Ok(l) => {
                    bound_listener = Some(l);
                    bound_port = cand;
                    break;
                }
                Err(e) => {
                    last_err = format!("Port {}: {}", cand, e);
                }
            }
        }

        let listener = bound_listener
            .ok_or_else(|| format!("Failed to bind API proxy ({})", last_err))?;

        log::info!("Transparent HTTP proxy started on http://127.0.0.1:{}", bound_port);

        tokio::spawn(async move {
            let graceful = axum::serve(listener, app).with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            });
            if let Err(e) = graceful.await {
                log::error!("API proxy server error: {}", e);
            }
        });

        self.shutdown_tx = Some(shutdown_tx);
        self.status = ApiProxyStatus {
            running: true,
            port: bound_port,
            endpoint: format!("http://127.0.0.1:{}", bound_port),
        };

        Ok(())
    }

    pub async fn ensure_service_forwarder(
        &mut self,
        remote_port: u16,
        p2p_client: Arc<tokio::sync::Mutex<ClientConnection>>,
    ) -> Result<u16, String> {
        if let Some((local_port, _)) = self.service_forwarders.get(&remote_port) {
            return Ok(*local_port);
        }

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);

        let client_arc = p2p_client.clone();
        let app = Router::new()
            .route(
                "/",
                any(move |req: Request| {
                    let c = client_arc.clone();
                    async move { forward_service_http(c, remote_port, "/", req).await }
                }),
            )
            .route(
                "/*path",
                any(move |Path(p): Path<String>, req: Request| {
                    let c = p2p_client.clone();
                    async move {
                        let full = format!("/{}", p);
                        forward_service_http(c, remote_port, &full, req).await
                    }
                }),
            )
            .layer(cors);

        let listener = match tokio::net::TcpListener::bind(format!("127.0.0.1:{}", remote_port)).await {
            Ok(l) => l,
            Err(_) => tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|e| format!("Failed to bind service tunnel port: {}", e))?,
        };

        let local_port = listener.local_addr().map(|a| a.port()).unwrap_or(remote_port);

        tokio::spawn(async move {
            let graceful = axum::serve(listener, app).with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            });
            if let Err(e) = graceful.await {
                log::error!("Service forwarder error (port {}): {}", remote_port, e);
            }
        });

        self.service_forwarders.insert(remote_port, (local_port, shutdown_tx));
        log::info!(
            "Service tunnel forwarder active: http://127.0.0.1:{} -> host:{}",
            local_port,
            remote_port
        );
        Ok(local_port)
    }

    pub async fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        for (_, (_, tx)) in self.service_forwarders.drain() {
            let _ = tx.send(());
        }
        self.status = ApiProxyStatus {
            running: false,
            port: 0,
            endpoint: String::new(),
        };
        log::info!("API proxy stopped.");
    }

    pub fn get_status(&self) -> ApiProxyStatus {
        self.status.clone()
    }
}

async fn proxy_handler_root(
    State(state): State<Arc<ProxyState>>,
    req: Request,
) -> impl IntoResponse {
    handle_proxy_request(state, "/", req).await
}

async fn proxy_handler(
    Path(path): Path<String>,
    State(state): State<Arc<ProxyState>>,
    req: Request,
) -> impl IntoResponse {
    let full_path = format!("/{}", path);
    handle_proxy_request(state, &full_path, req).await
}

async fn handle_proxy_request(
    state: Arc<ProxyState>,
    path: &str,
    req: Request,
) -> axum::response::Response {
    let method = req.method().to_string();
    
    // Extract headers
    let mut headers = Vec::new();
    let req_headers = req.headers().clone();
    
    // Check auth if required - tolerate dummy tokens from coding agents
    if let Some(key) = &state.api_key {
        if !key.is_empty() {
            let auth = req_headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            let x_api_key = req_headers
                .get("x-api-key")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");

            let provided = auth
                .strip_prefix("Bearer ")
                .or_else(|| auth.strip_prefix("bearer "))
                .unwrap_or(if !x_api_key.is_empty() { x_api_key } else { "" })
                .trim();

            let is_dummy_or_allowed = provided.is_empty()
                || provided == "vant"
                || provided == "ollama"
                || provided == "sk-vant"
                || provided == "dummy"
                || provided == key;

            if !is_dummy_or_allowed && provided != key {
                return (
                    StatusCode::UNAUTHORIZED,
                    "Invalid API key provided",
                )
                    .into_response();
            }
        }
    }

    // Pass headers to Host
    for (name, value) in req_headers.iter() {
        if let Ok(v) = value.to_str() {
            headers.push((name.to_string(), v.to_string()));
        }
    }

    // Surface 1: Health check endpoint
    if path == "/" && method == "GET" {
        let mut response_headers = HeaderMap::new();
        response_headers.insert(axum::http::header::CONTENT_TYPE, HeaderValue::from_static("text/plain"));
        return (StatusCode::OK, response_headers, "Vant is running").into_response();
    }

    // Surface 1: Version endpoint
    if path == "/api/version" && method == "GET" {
        let mut response_headers = HeaderMap::new();
        response_headers.insert(axum::http::header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
        return (StatusCode::OK, response_headers, r#"{"version":"0.18.0"}"#).into_response();
    }

    // Surface 1: Model Capabilities endpoint
    if path == "/api/show" {
        let mut response_headers = HeaderMap::new();
        response_headers.insert(axum::http::header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
        let show_json = serde_json::json!({
            "modelfile": "# Vant Modelfile\nFROM llama3.3\nPARAMETER temperature 0.7",
            "parameters": "stop \"<|end_of_text|>\"\nstop \"<|eot_id|>\"",
            "template": "{{ .System }}\n{{ .Prompt }}",
            "details": {
                "parent_model": "",
                "format": "gguf",
                "family": "llama",
                "families": ["llama"],
                "parameter_size": "8B",
                "quantization_level": "Q4_K_M"
            },
            "capabilities": ["completion", "tools", "vision", "thinking"]
        });
        return (StatusCode::OK, response_headers, show_json.to_string()).into_response();
    }

    // Surface 1: Process / VRAM telemetry endpoint
    if path == "/api/ps" && method == "GET" {
        let mut response_headers = HeaderMap::new();
        response_headers.insert(axum::http::header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
        let ps_json = serde_json::json!({
            "models": [
                {
                    "name": "llama3.3",
                    "model": "llama3.3",
                    "size": 4350000000u64,
                    "digest": "sha256:vant_active_model",
                    "details": {
                        "format": "gguf",
                        "family": "llama",
                        "parameter_size": "8B"
                    },
                    "expires_at": "2099-01-01T00:00:00Z",
                    "size_vram": 4350000000u64,
                    "context_length": 65536
                }
            ]
        });
        return (StatusCode::OK, response_headers, ps_json.to_string()).into_response();
    }

    // Extract body
    let body_bytes = match axum::body::to_bytes(req.into_body(), usize::MAX).await {
        Ok(b) => b.to_vec(),
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                format!("Failed to read request body: {}", e),
            )
                .into_response()
        }
    };

    // Surface 3: Anthropic Messages API (/v1/messages)
    if path == "/v1/messages" && method == "POST" {
        return handle_anthropic_messages(state, req_headers.clone(), body_bytes).await;
    }

    // Surface 2: OpenAI Responses API (/v1/responses)
    if path == "/v1/responses" && method == "POST" {
        return handle_openai_responses(state, req_headers.clone(), body_bytes).await;
    }

    // Rewrite model alias if present in JSON body
    let (body_bytes, _resolved_model_opt) = resolve_model_in_body(&body_bytes);

    let body_base64 = if !body_bytes.is_empty() {
        Some(BASE64.encode(&body_bytes))
    } else {
        None
    };

    let req_id = uuid::Uuid::new_v4().to_string();
    let mut proxy_req = HttpProxyRequest {
        action: "http_proxy".to_string(),
        req_id: req_id.clone(),
        method: method.clone(),
        path: path.to_string(),
        headers: headers.clone(),
        body_base64: body_base64.clone(),
        target_port: None,
    };

    let settings = state.settings.lock().await.get();

    // Surface 1: Tags and Models list endpoints
    if path == "/v1/models" || path == "/api/tags" || path.starts_with("/v1/models/") {
        let mut aggregated_models = Vec::new();
        
        // Add cloud models if keys are present
        if settings.gemini_api_key.is_some() {
            aggregated_models.push(serde_json::json!({"id": "gemini-1.5-pro", "name": "gemini-1.5-pro", "model": "gemini-1.5-pro", "object": "model", "created": 1, "owned_by": "google"}));
            aggregated_models.push(serde_json::json!({"id": "gemini-1.5-flash", "name": "gemini-1.5-flash", "model": "gemini-1.5-flash", "object": "model", "created": 1, "owned_by": "google"}));
        }
        if settings.groq_api_key.is_some() {
            aggregated_models.push(serde_json::json!({"id": "groq:llama3-8b-8192", "name": "groq:llama3-8b-8192", "model": "groq:llama3-8b-8192", "object": "model", "created": 1, "owned_by": "groq"}));
            aggregated_models.push(serde_json::json!({"id": "groq:llama3-70b-8192", "name": "groq:llama3-70b-8192", "model": "groq:llama3-70b-8192", "object": "model", "created": 1, "owned_by": "groq"}));
            aggregated_models.push(serde_json::json!({"id": "groq:mixtral-8x7b-32768", "name": "groq:mixtral-8x7b-32768", "model": "groq:mixtral-8x7b-32768", "object": "model", "created": 1, "owned_by": "groq"}));
        }

        // Add configured aliases
        for (alias, target) in ModelAliasStore::list_aliases() {
            aggregated_models.push(serde_json::json!({
                "id": alias,
                "name": alias,
                "model": alias,
                "object": "model",
                "created": 1,
                "owned_by": "vant",
                "modified_at": "2026-11-25T12:00:00Z",
                "size": 4350000000u64,
                "digest": "sha256:vant_alias",
                "details": {
                    "parent_model": target,
                    "format": "gguf",
                    "family": "llama",
                    "parameter_size": "8B",
                    "quantization_level": "Q4_K_M"
                }
            }));
        }

        let mut is_connected = false;
        {
            let client_state = state.p2p_client.lock().await;
            if let crate::client::ConnectionStatus::Connected { .. } = client_state.status() {
                is_connected = true;
            }
        }

        if is_connected {
            let rx = {
                let mut client_state = state.p2p_client.lock().await;
                client_state.proxy_http_request(proxy_req.clone()).await
            };
            if let Ok(mut rx) = rx {
                if let Some(val) = rx.recv().await {
                    if let Ok(chunk) = serde_json::from_value::<HttpProxyResponseChunk>(val) {
                        if let Some(b64) = chunk.data_base64 {
                            if let Ok(bytes) = BASE64.decode(b64) {
                                if let Ok(mut json) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                                    if let Some(data) = json.get_mut("data").and_then(|d| d.as_array_mut()) {
                                        aggregated_models.append(data);
                                    } else if let Some(models) = json.get_mut("models").and_then(|m| m.as_array_mut()) {
                                        aggregated_models.append(models);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } else {
            // Check local Ollama at http://127.0.0.1:11434/v1/models
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_millis(1500))
                .build()
                .unwrap_or_default();
            if let Ok(res) = client.get("http://127.0.0.1:11434/v1/models").send().await {
                if let Ok(mut json) = res.json::<serde_json::Value>().await {
                    if let Some(data) = json.get_mut("data").and_then(|d| d.as_array_mut()) {
                        aggregated_models.append(data);
                    }
                }
            }
        }

        let final_json = if path == "/api/tags" {
            serde_json::json!({
                "models": aggregated_models
            })
        } else {
            serde_json::json!({
                "object": "list",
                "data": aggregated_models
            })
        };
        
        let mut response_headers = HeaderMap::new();
        response_headers.insert(axum::http::header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
        return (
            StatusCode::OK,
            response_headers,
            axum::response::Json(final_json).to_string()
        ).into_response();
    }
    
    // Cloud AI Gateway routing for chat completions
    if path == "/v1/chat/completions" || path == "/api/chat" || path == "/api/generate" {
        if let Some(ref b64) = proxy_req.body_base64 {
            if let Ok(bytes) = BASE64.decode(b64) {
                if let Ok(mut json) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                    if let Some(model) = json.get("model").and_then(|m| m.as_str()).map(|s| s.to_string()) {
                        let mut target_url: Option<String> = None;
                        let mut auth_header: Option<String> = None;
                        
                        if model.starts_with("gemini") && settings.gemini_api_key.is_some() {
                            target_url = Some("https://generativelanguage.googleapis.com/v1beta/openai/v1/chat/completions".to_string());
                            auth_header = Some(format!("Bearer {}", settings.gemini_api_key.as_ref().unwrap()));
                        } else if (model.starts_with("groq:") || model.contains("llama3") || model.contains("mixtral") || model.contains("gemma")) && settings.groq_api_key.is_some() {
                            target_url = Some("https://api.groq.com/openai/v1/chat/completions".to_string());
                            auth_header = Some(format!("Bearer {}", settings.groq_api_key.as_ref().unwrap()));
                            if model.starts_with("groq:") {
                                if let Some(obj) = json.as_object_mut() {
                                    let new_model = model.replace("groq:", "");
                                    obj.insert("model".to_string(), serde_json::json!(new_model));
                                    let modified_bytes = serde_json::to_vec(&json).unwrap();
                                    proxy_req.body_base64 = Some(BASE64.encode(&modified_bytes));
                                }
                            }
                        }
                        
                        if let (Some(url), Some(auth)) = (target_url, auth_header) {
                            let client = reqwest::Client::new();
                            let mut req_builder = client.request(
                                reqwest::Method::from_bytes(proxy_req.method.as_bytes()).unwrap_or(reqwest::Method::POST),
                                &url
                            );
                            for (k, v) in &proxy_req.headers {
                                let kl = k.to_lowercase();
                                if kl != "host" && kl != "content-length" && kl != "connection" && kl != "transfer-encoding" && kl != "authorization" {
                                    req_builder = req_builder.header(k, v);
                                }
                            }
                            req_builder = req_builder.header("Authorization", auth);
                            if let Some(ref b64) = proxy_req.body_base64 {
                                if let Ok(bytes) = BASE64.decode(b64) {
                                    req_builder = req_builder.body(bytes);
                                }
                            }
                            
                            match req_builder.send().await {
                                Ok(mut res) => {
                                    let status_code = StatusCode::from_u16(res.status().as_u16()).unwrap_or(StatusCode::OK);
                                    let mut response_headers = HeaderMap::new();
                                    for (name, value) in res.headers() {
                                        if let Ok(name) = HeaderName::from_bytes(name.as_str().as_bytes()) {
                                            if let Ok(val) = HeaderValue::from_bytes(value.as_bytes()) {
                                                response_headers.insert(name, val);
                                            }
                                        }
                                    }
                                    
                                    let (tx, body_rx) = tokio::sync::mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(100);
                                    tokio::spawn(async move {
                                        while let Ok(Some(chunk)) = res.chunk().await {
                                            if tx.send(Ok(chunk.into())).await.is_err() {
                                                break;
                                            }
                                        }
                                    });
                                    let stream = tokio_stream::wrappers::ReceiverStream::new(body_rx);
                                    let body = Body::from_stream(stream);
                                    return (status_code, response_headers, body).into_response();
                                }
                                Err(e) => {
                                    return (
                                        StatusCode::BAD_GATEWAY,
                                        format!("Failed to proxy to cloud AI: {}", e)
                                    ).into_response();
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut is_connected = false;
    {
        let client_state = state.p2p_client.lock().await;
        if let crate::client::ConnectionStatus::Connected { .. } = client_state.status() {
            is_connected = true;
        }
    }

    if !is_connected {
        // Universal fallback: proxy to local Ollama instance on 127.0.0.1:11434 (Host mode or standalone)
        let local_url = format!("http://127.0.0.1:11434{}", path);
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()
            .unwrap_or_default();
            
        let mut req_builder = client.request(
            reqwest::Method::from_bytes(proxy_req.method.as_bytes()).unwrap_or(reqwest::Method::POST),
            &local_url
        );
        for (k, v) in &proxy_req.headers {
            let kl = k.to_lowercase();
            if kl != "host" && kl != "content-length" && kl != "connection" && kl != "transfer-encoding" {
                req_builder = req_builder.header(k, v);
            }
        }
        if let Some(ref b64) = proxy_req.body_base64 {
            if let Ok(bytes) = BASE64.decode(b64) {
                req_builder = req_builder.body(bytes);
            }
        }
        
        match req_builder.send().await {
            Ok(mut res) => {
                let status_code = StatusCode::from_u16(res.status().as_u16()).unwrap_or(StatusCode::OK);
                let mut response_headers = HeaderMap::new();
                for (name, value) in res.headers() {
                    if let Ok(name) = HeaderName::from_bytes(name.as_str().as_bytes()) {
                        if let Ok(val) = HeaderValue::from_bytes(value.as_bytes()) {
                            response_headers.insert(name, val);
                        }
                    }
                }
                let (tx, body_rx) = tokio::sync::mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(100);
                tokio::spawn(async move {
                    while let Ok(Some(chunk)) = res.chunk().await {
                        if tx.send(Ok(chunk.into())).await.is_err() {
                            break;
                        }
                    }
                });
                let stream = tokio_stream::wrappers::ReceiverStream::new(body_rx);
                let body = Body::from_stream(stream);
                return (status_code, response_headers, body).into_response();
            }
            Err(_) => {
                let error_body = serde_json::json!({
                    "error": {
                        "message": "Not connected to a remote host and local Ollama (127.0.0.1:11434) is not reachable.",
                        "type": "connection_error"
                    }
                });
                let mut headers = HeaderMap::new();
                headers.insert(axum::http::header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    headers,
                    axum::response::Json(error_body).to_string()
                ).into_response();
            }
        }
    }

    // We are connected! Send to P2P Host
    let rx = {
        let mut client_state = state.p2p_client.lock().await;
        match client_state.proxy_http_request(proxy_req).await {
            Ok(rx) => rx,
            Err(e) => {
                return (
                    StatusCode::BAD_GATEWAY,
                    format!("Failed to send proxy request to remote host: {}", e),
                ).into_response();
            }
        }
    };
    
    // We need to wait for the first chunk to get the HTTP status code and headers
    let mut rx = rx;
    let first_chunk_val = match rx.recv().await {
        Some(val) => val,
        None => {
            state.p2p_client.lock().await.remove_proxy_router(&req_id).await;
            return (
                StatusCode::BAD_GATEWAY,
                "Remote host closed connection without responding",
            ).into_response();
        }
    };
    
    let first_chunk: HttpProxyResponseChunk = match serde_json::from_value(first_chunk_val) {
        Ok(c) => c,
        Err(_) => {
            state.p2p_client.lock().await.remove_proxy_router(&req_id).await;
            return (
                StatusCode::BAD_GATEWAY,
                "Invalid response from remote host",
            ).into_response();
        }
    };
    
    let status_code = StatusCode::from_u16(first_chunk.status_code.unwrap_or(200))
        .unwrap_or(StatusCode::OK);
        
    let mut response_headers = HeaderMap::new();
    if let Some(hdrs) = first_chunk.headers {
        for (k, v) in hdrs {
            if let Ok(name) = HeaderName::from_bytes(k.as_bytes()) {
                if let Ok(val) = HeaderValue::from_bytes(v.as_bytes()) {
                    response_headers.insert(name, val);
                }
            }
        }
    }
    
    // Create a stream for the body
    let (tx, body_rx) = tokio::sync::mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(100);
    
    // Send the first chunk data if present
    if let Some(b64) = first_chunk.data_base64 {
        if let Ok(bytes) = BASE64.decode(b64) {
            if !bytes.is_empty() {
                let _ = tx.send(Ok(bytes.into())).await;
            }
        }
    }
    
    let client_clone = state.p2p_client.clone();
    let req_id_clone = req_id.clone();
    
    if !first_chunk.done {
        tokio::spawn(async move {
            while let Some(chunk_val) = rx.recv().await {
                if let Ok(chunk) = serde_json::from_value::<HttpProxyResponseChunk>(chunk_val) {
                    if let Some(b64) = chunk.data_base64 {
                        if let Ok(bytes) = BASE64.decode(b64) {
                            if !bytes.is_empty()
                                && tx.send(Ok(bytes.into())).await.is_err() {
                                    break;
                                }
                        }
                    }
                    if chunk.done {
                        break;
                    }
                }
            }
            client_clone.lock().await.remove_proxy_router(&req_id_clone).await;
        });
    } else {
        tokio::spawn(async move {
            client_clone.lock().await.remove_proxy_router(&req_id_clone).await;
        });
    }
    
    let stream = tokio_stream::wrappers::ReceiverStream::new(body_rx);
    let body = Body::from_stream(stream);
    
    (status_code, response_headers, body).into_response()
}

async fn forward_service_http(
    p2p_client: Arc<tokio::sync::Mutex<ClientConnection>>,
    remote_port: u16,
    path: &str,
    req: Request,
) -> axum::response::Response {
    let method = req.method().to_string();
    let full_path = if let Some(q) = req.uri().query() {
        format!("{}?{}", path, q)
    } else {
        path.to_string()
    };

    let mut headers = Vec::new();
    for (name, value) in req.headers().iter() {
        if let Ok(v) = value.to_str() {
            headers.push((name.to_string(), v.to_string()));
        }
    }

    let body_bytes = match axum::body::to_bytes(req.into_body(), 25 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("Invalid request body: {}", e)).into_response();
        }
    };

    let body_base64 = if !body_bytes.is_empty() {
        Some(BASE64.encode(body_bytes))
    } else {
        None
    };

    let req_id = uuid::Uuid::new_v4().to_string();
    let proxy_req = HttpProxyRequest {
        action: "http_proxy".to_string(),
        req_id: req_id.clone(),
        method,
        path: full_path,
        headers,
        body_base64,
        target_port: Some(remote_port),
    };

    let rx = {
        let mut client = p2p_client.lock().await;
        match client.proxy_http_request(proxy_req).await {
            Ok(rx) => rx,
            Err(e) => {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    format!("Tunnel disconnected or host unreachable: {}", e),
                )
                    .into_response();
            }
        }
    };

    let mut rx = rx;
    let first_chunk_val = match rx.recv().await {
        Some(val) => val,
        None => {
            p2p_client.lock().await.remove_proxy_router(&req_id).await;
            return (
                StatusCode::BAD_GATEWAY,
                format!("Host service on port {} did not respond.", remote_port),
            )
                .into_response();
        }
    };

    let first_chunk: HttpProxyResponseChunk = match serde_json::from_value(first_chunk_val) {
        Ok(c) => c,
        Err(_) => {
            p2p_client.lock().await.remove_proxy_router(&req_id).await;
            return (StatusCode::BAD_GATEWAY, "Malformed response from host service").into_response();
        }
    };

    let status_code = StatusCode::from_u16(first_chunk.status_code.unwrap_or(200)).unwrap_or(StatusCode::OK);
    let mut response_headers = HeaderMap::new();
    if let Some(hdrs) = first_chunk.headers {
        for (k, v) in hdrs {
            let kl = k.to_lowercase();
            if kl == "transfer-encoding" || kl == "content-length" {
                continue;
            }
            if let (Ok(name), Ok(val)) = (
                HeaderName::from_bytes(k.as_bytes()),
                HeaderValue::from_bytes(v.as_bytes()),
            ) {
                response_headers.insert(name, val);
            }
        }
    }

    let (tx, body_rx) = tokio::sync::mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(100);
    if let Some(b64) = first_chunk.data_base64 {
        if let Ok(bytes) = BASE64.decode(b64) {
            if !bytes.is_empty() {
                let _ = tx.send(Ok(bytes.into())).await;
            }
        }
    }

    let client_clone = p2p_client.clone();
    let req_id_clone = req_id.clone();

    if !first_chunk.done {
        tokio::spawn(async move {
            while let Some(chunk_val) = rx.recv().await {
                if let Ok(chunk) = serde_json::from_value::<HttpProxyResponseChunk>(chunk_val) {
                    if let Some(b64) = chunk.data_base64 {
                        if let Ok(bytes) = BASE64.decode(b64) {
                            if !bytes.is_empty() && tx.send(Ok(bytes.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    if chunk.done {
                        break;
                    }
                }
            }
            client_clone.lock().await.remove_proxy_router(&req_id_clone).await;
        });
    } else {
        tokio::spawn(async move {
            client_clone.lock().await.remove_proxy_router(&req_id_clone).await;
        });
    }

    let stream = tokio_stream::wrappers::ReceiverStream::new(body_rx);
    let body = Body::from_stream(stream);
    (status_code, response_headers, body).into_response()
}

pub fn resolve_model_in_body(body_bytes: &[u8]) -> (Vec<u8>, Option<String>) {
    if let Ok(mut json) = serde_json::from_slice::<serde_json::Value>(body_bytes) {
        if let Some(model) = json.get("model").and_then(|m| m.as_str()).map(|s| s.to_string()) {
            let resolved = ModelAliasStore::resolve_alias(&model);
            if resolved != model {
                if let Some(obj) = json.as_object_mut() {
                    obj.insert("model".to_string(), serde_json::json!(resolved));
                    if let Ok(new_bytes) = serde_json::to_vec(&json) {
                        return (new_bytes, Some(resolved));
                    }
                }
            }
            return (body_bytes.to_vec(), Some(resolved));
        }
    }
    (body_bytes.to_vec(), None)
}

async fn dispatch_internal_http(
    state: Arc<ProxyState>,
    path: &str,
    body_bytes: Vec<u8>,
) -> Result<Vec<u8>, String> {
    let mut is_connected = false;
    {
        let client_state = state.p2p_client.lock().await;
        if let crate::client::ConnectionStatus::Connected { .. } = client_state.status() {
            is_connected = true;
        }
    }

    if is_connected {
        let req_id = uuid::Uuid::new_v4().to_string();
        let proxy_req = HttpProxyRequest {
            action: "http_proxy".to_string(),
            req_id: req_id.clone(),
            method: "POST".to_string(),
            path: path.to_string(),
            headers: vec![("content-type".to_string(), "application/json".to_string())],
            body_base64: Some(BASE64.encode(&body_bytes)),
            target_port: None,
        };

        let mut rx = {
            let mut client = state.p2p_client.lock().await;
            client.proxy_http_request(proxy_req).await
                .map_err(|e| format!("Proxy error: {}", e))?
        };

        let mut accumulated = Vec::new();
        while let Some(chunk_val) = rx.recv().await {
            if let Ok(chunk) = serde_json::from_value::<HttpProxyResponseChunk>(chunk_val) {
                if let Some(b64) = chunk.data_base64 {
                    if let Ok(b) = BASE64.decode(b64) {
                        accumulated.extend_from_slice(&b);
                    }
                }
                if chunk.done {
                    break;
                }
            }
        }
        state.p2p_client.lock().await.remove_proxy_router(&req_id).await;
        Ok(accumulated)
    } else {
        let client = reqwest::Client::new();
        let url = format!("http://127.0.0.1:11434{}", path);
        let res = client.post(&url)
            .header("Content-Type", "application/json")
            .body(body_bytes)
            .send()
            .await
            .map_err(|e| format!("Local HTTP error: {}", e))?;
        let bytes = res.bytes().await.map_err(|e| format!("Response error: {}", e))?;
        Ok(bytes.to_vec())
    }
}

async fn dispatch_internal_stream(
    state: Arc<ProxyState>,
    path: &str,
    body_bytes: Vec<u8>,
) -> tokio::sync::mpsc::Receiver<Result<String, String>> {
    let (tx, rx) = tokio::sync::mpsc::channel(100);
    let path = path.to_string();

    tokio::spawn(async move {
        let mut is_connected = false;
        {
            let client_state = state.p2p_client.lock().await;
            if let crate::client::ConnectionStatus::Connected { .. } = client_state.status() {
                is_connected = true;
            }
        }

        if is_connected {
            let req_id = uuid::Uuid::new_v4().to_string();
            let proxy_req = HttpProxyRequest {
                action: "http_proxy".to_string(),
                req_id: req_id.clone(),
                method: "POST".to_string(),
                path,
                headers: vec![
                    ("content-type".to_string(), "application/json".to_string()),
                    ("accept".to_string(), "text/event-stream".to_string()),
                ],
                body_base64: Some(BASE64.encode(&body_bytes)),
                target_port: None,
            };

            let rx_res = {
                let mut client = state.p2p_client.lock().await;
                client.proxy_http_request(proxy_req).await
            };

            if let Ok(mut proxy_rx) = rx_res {
                while let Some(chunk_val) = proxy_rx.recv().await {
                    if let Ok(chunk) = serde_json::from_value::<HttpProxyResponseChunk>(chunk_val) {
                        if let Some(b64) = chunk.data_base64 {
                            if let Ok(b) = BASE64.decode(b64) {
                                let str_chunk = String::from_utf8_lossy(&b).to_string();
                                if tx.send(Ok(str_chunk)).await.is_err() {
                                    break;
                                }
                            }
                        }
                        if chunk.done {
                            break;
                        }
                    }
                }
            }
            state.p2p_client.lock().await.remove_proxy_router(&req_id).await;
        } else {
            let client = reqwest::Client::new();
            let url = format!("http://127.0.0.1:11434{}", path);
            if let Ok(mut res) = client.post(&url)
                .header("Content-Type", "application/json")
                .header("Accept", "text/event-stream")
                .body(body_bytes)
                .send()
                .await
            {
                while let Ok(Some(chunk)) = res.chunk().await {
                    let str_chunk = String::from_utf8_lossy(&chunk).to_string();
                    if tx.send(Ok(str_chunk)).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    rx
}

pub async fn handle_anthropic_messages(
    state: Arc<ProxyState>,
    _req_headers: HeaderMap,
    body_bytes: Vec<u8>,
) -> axum::response::Response {
    let anthropic_req = match serde_json::from_slice::<serde_json::Value>(&body_bytes) {
        Ok(v) => v,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("Invalid Anthropic JSON: {}", e)).into_response();
        }
    };

    let model = anthropic_req
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("llama3.3");
    let resolved_model = ModelAliasStore::resolve_alias(model);

    let stream = anthropic_req.get("stream").and_then(|s| s.as_bool()).unwrap_or(false);
    let temperature = anthropic_req.get("temperature").and_then(|t| t.as_f64());
    let max_tokens = anthropic_req.get("max_tokens").and_then(|m| m.as_u64());

    // Inbound Translation: Extract system prompt
    let mut system_prompt = String::new();
    if let Some(sys) = anthropic_req.get("system") {
        if let Some(s) = sys.as_str() {
            system_prompt = s.to_string();
        } else if let Some(arr) = sys.as_array() {
            for b in arr {
                if let Some(t) = b.get("text").and_then(|s| s.as_str()) {
                    system_prompt.push_str(t);
                }
            }
        }
    }

    // Inbound Translation: Messages
    let mut openai_messages = Vec::new();
    if !system_prompt.is_empty() {
        openai_messages.push(serde_json::json!({
            "role": "system",
            "content": system_prompt
        }));
    }

    if let Some(msgs) = anthropic_req.get("messages").and_then(|m| m.as_array()) {
        for m in msgs {
            let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("user");
            if let Some(content_str) = m.get("content").and_then(|c| c.as_str()) {
                openai_messages.push(serde_json::json!({
                    "role": role,
                    "content": content_str
                }));
            } else if let Some(content_blocks) = m.get("content").and_then(|c| c.as_array()) {
                let mut text_parts = Vec::new();
                let mut tool_calls = Vec::new();

                for b in content_blocks {
                    let b_type = b.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    match b_type {
                        "text" => {
                            if let Some(t) = b.get("text").and_then(|s| s.as_str()) {
                                text_parts.push(t.to_string());
                            }
                        }
                        "tool_use" => {
                            let id = b.get("id").and_then(|s| s.as_str()).unwrap_or("");
                            let name = b.get("name").and_then(|s| s.as_str()).unwrap_or("");
                            let input = b.get("input").cloned().unwrap_or(serde_json::json!({}));
                            tool_calls.push(serde_json::json!({
                                "id": id,
                                "type": "function",
                                "function": {
                                    "name": name,
                                    "arguments": serde_json::to_string(&input).unwrap_or_default()
                                }
                            }));
                        }
                        "tool_result" => {
                            let tool_call_id = b.get("tool_use_id").and_then(|s| s.as_str()).unwrap_or("");
                            let res_content = if let Some(c) = b.get("content").and_then(|s| s.as_str()) {
                                c.to_string()
                            } else if let Some(c) = b.get("content") {
                                serde_json::to_string(c).unwrap_or_default()
                            } else {
                                String::new()
                            };
                            openai_messages.push(serde_json::json!({
                                "role": "tool",
                                "tool_call_id": tool_call_id,
                                "content": res_content
                            }));
                        }
                        _ => {}
                    }
                }

                if !text_parts.is_empty() || !tool_calls.is_empty() {
                    let mut msg_obj = serde_json::json!({
                        "role": role,
                        "content": text_parts.join("\n")
                    });
                    if !tool_calls.is_empty() {
                        msg_obj["tool_calls"] = serde_json::json!(tool_calls);
                    }
                    openai_messages.push(msg_obj);
                }
            }
        }
    }

    // Inbound Translation: Tools
    let mut openai_tools = Vec::new();
    if let Some(tools) = anthropic_req.get("tools").and_then(|t| t.as_array()) {
        for t in tools {
            let name = t.get("name").and_then(|s| s.as_str()).unwrap_or("");
            let desc = t.get("description").and_then(|s| s.as_str()).unwrap_or("");
            let schema = t.get("input_schema").cloned().unwrap_or(serde_json::json!({}));
            openai_tools.push(serde_json::json!({
                "type": "function",
                "function": {
                    "name": name,
                    "description": desc,
                    "parameters": schema
                }
            }));
        }
    }

    let mut openai_payload = serde_json::json!({
        "model": resolved_model,
        "messages": openai_messages,
        "stream": stream,
    });
    if let Some(t) = temperature {
        openai_payload["temperature"] = serde_json::json!(t);
    }
    if let Some(m) = max_tokens {
        openai_payload["max_tokens"] = serde_json::json!(m);
    }
    if !openai_tools.is_empty() {
        openai_payload["tools"] = serde_json::json!(openai_tools);
    }

    let chat_body_bytes = serde_json::to_vec(&openai_payload).unwrap_or_default();
    let msg_id = format!("msg_{}", uuid::Uuid::new_v4().simple());

    if !stream {
        let res_bytes = match dispatch_internal_http(state.clone(), "/v1/chat/completions", chat_body_bytes).await {
            Ok(b) => b,
            Err(e) => {
                return (StatusCode::BAD_GATEWAY, format!("Inference error: {}", e)).into_response();
            }
        };

        let mut reply_text = String::new();
        let mut tool_use_blocks = Vec::new();

        if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&res_bytes) {
            if let Some(choice) = json.get("choices").and_then(|c| c.get(0)) {
                if let Some(msg) = choice.get("message") {
                    if let Some(txt) = msg.get("content").and_then(|c| c.as_str()) {
                        reply_text = txt.to_string();
                    }
                    if let Some(calls) = msg.get("tool_calls").and_then(|c| c.as_array()) {
                        for call in calls {
                            let id = call.get("id").and_then(|s| s.as_str()).unwrap_or("call_1");
                            let func = call.get("function");
                            let name = func.and_then(|f| f.get("name")).and_then(|n| n.as_str()).unwrap_or("");
                            let args_str = func.and_then(|f| f.get("arguments")).and_then(|a| a.as_str()).unwrap_or("{}");
                            let args_val: serde_json::Value = serde_json::from_str(args_str).unwrap_or(serde_json::json!({}));
                            tool_use_blocks.push(serde_json::json!({
                                "type": "tool_use",
                                "id": id,
                                "name": name,
                                "input": args_val
                            }));
                        }
                    }
                }
            }
        }

        let mut content_blocks = Vec::new();
        if !reply_text.is_empty() {
            content_blocks.push(serde_json::json!({
                "type": "text",
                "text": reply_text
            }));
        }
        for tb in tool_use_blocks {
            content_blocks.push(tb);
        }

        let stop_reason = if !content_blocks.iter().any(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_use")) {
            "end_turn"
        } else {
            "tool_use"
        };

        let anthropic_response = serde_json::json!({
            "id": msg_id,
            "type": "message",
            "role": "assistant",
            "content": content_blocks,
            "model": model,
            "stop_reason": stop_reason,
            "stop_sequence": null,
            "usage": {
                "input_tokens": 30,
                "output_tokens": 20
            }
        });

        let mut headers = HeaderMap::new();
        headers.insert(axum::http::header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
        return (StatusCode::OK, headers, serde_json::to_string(&anthropic_response).unwrap()).into_response();
    }

    // Streaming SSE Response with Anthropic State Machine
    let (tx, body_rx) = tokio::sync::mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(100);
    let model_str = model.to_string();

    tokio::spawn(async move {
        // Step 1: message_start
        let msg_start = format!(
            "event: message_start\ndata: {}\n\n",
            serde_json::json!({
                "type": "message_start",
                "message": {
                    "id": msg_id,
                    "type": "message",
                    "role": "assistant",
                    "content": [],
                    "model": model_str,
                    "stop_reason": null,
                    "stop_sequence": null,
                    "usage": { "input_tokens": 20, "output_tokens": 0 }
                }
            })
        );
        let _ = tx.send(Ok(msg_start.into())).await;

        // Step 2: content_block_start
        let block_start = format!(
            "event: content_block_start\ndata: {}\n\n",
            serde_json::json!({
                "type": "content_block_start",
                "index": 0,
                "content_block": { "type": "text", "text": "" }
            })
        );
        let _ = tx.send(Ok(block_start.into())).await;

        // Step 3: Stream content_block_delta from underlying model
        let mut total_output_tokens = 0usize;
        let mut stream_rx = dispatch_internal_stream(state, "/v1/chat/completions", chat_body_bytes).await;

        while let Some(chunk_res) = stream_rx.recv().await {
            if let Ok(chunk_str) = chunk_res {
                for line in chunk_str.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("data:") {
                        let data_part = trimmed.trim_start_matches("data:").trim();
                        if data_part == "[DONE]" {
                            break;
                        }
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data_part) {
                            if let Some(delta) = json.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("delta")) {
                                if let Some(txt) = delta.get("content").and_then(|s| s.as_str()) {
                                    if !txt.is_empty() {
                                        total_output_tokens += 1;
                                        let delta_event = format!(
                                            "event: content_block_delta\ndata: {}\n\n",
                                            serde_json::json!({
                                                "type": "content_block_delta",
                                                "index": 0,
                                                "delta": { "type": "text_delta", "text": txt }
                                            })
                                        );
                                        if tx.send(Ok(delta_event.into())).await.is_err() {
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Step 4: content_block_stop
        let block_stop = format!(
            "event: content_block_stop\ndata: {}\n\n",
            serde_json::json!({
                "type": "content_block_stop",
                "index": 0
            })
        );
        let _ = tx.send(Ok(block_stop.into())).await;

        // Step 5: message_delta
        let msg_delta = format!(
            "event: message_delta\ndata: {}\n\n",
            serde_json::json!({
                "type": "message_delta",
                "delta": { "stop_reason": "end_turn", "stop_sequence": null },
                "usage": { "output_tokens": total_output_tokens }
            })
        );
        let _ = tx.send(Ok(msg_delta.into())).await;

        // Step 6: message_stop
        let msg_stop = "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n";
        let _ = tx.send(Ok(msg_stop.into())).await;
    });

    let mut response_headers = HeaderMap::new();
    response_headers.insert(axum::http::header::CONTENT_TYPE, HeaderValue::from_static("text/event-stream; charset=utf-8"));
    response_headers.insert(axum::http::header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response_headers.insert(axum::http::header::CONNECTION, HeaderValue::from_static("keep-alive"));

    let stream = tokio_stream::wrappers::ReceiverStream::new(body_rx);
    let body = Body::from_stream(stream);
    (StatusCode::OK, response_headers, body).into_response()
}

pub async fn handle_openai_responses(
    state: Arc<ProxyState>,
    _req_headers: HeaderMap,
    body_bytes: Vec<u8>,
) -> axum::response::Response {
    let responses_req = match serde_json::from_slice::<serde_json::Value>(&body_bytes) {
        Ok(v) => v,
        Err(e) => {
            return (StatusCode::BAD_REQUEST, format!("Invalid Responses API JSON: {}", e)).into_response();
        }
    };

    let model = responses_req
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("llama3.3");
    let resolved_model = ModelAliasStore::resolve_alias(model);
    let stream = responses_req.get("stream").and_then(|s| s.as_bool()).unwrap_or(false);

    let mut messages = Vec::new();
    if let Some(instructions) = responses_req.get("instructions").and_then(|i| i.as_str()) {
        messages.push(serde_json::json!({
            "role": "system",
            "content": instructions
        }));
    }

    if let Some(input_arr) = responses_req.get("input").and_then(|i| i.as_array()) {
        for item in input_arr {
            let role = item.get("role").and_then(|r| r.as_str()).unwrap_or("user");
            let content = item.get("content").and_then(|c| c.as_str()).unwrap_or("");
            messages.push(serde_json::json!({
                "role": role,
                "content": content
            }));
        }
    }

    let chat_payload = serde_json::json!({
        "model": resolved_model,
        "messages": messages,
        "stream": stream,
    });
    let chat_body_bytes = serde_json::to_vec(&chat_payload).unwrap_or_default();
    let resp_id = format!("resp_{}", uuid::Uuid::new_v4().simple());

    if !stream {
        let res_bytes = match dispatch_internal_http(state.clone(), "/v1/chat/completions", chat_body_bytes).await {
            Ok(b) => b,
            Err(e) => {
                return (StatusCode::BAD_GATEWAY, format!("Inference error: {}", e)).into_response();
            }
        };

        let mut output_text = String::new();
        if let Ok(json) = serde_json::from_slice::<serde_json::Value>(&res_bytes) {
            if let Some(choice) = json.get("choices").and_then(|c| c.get(0)) {
                if let Some(txt) = choice.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_str()) {
                    output_text = txt.to_string();
                }
            }
        }

        let resp_json = serde_json::json!({
            "id": resp_id,
            "object": "response",
            "model": model,
            "status": "completed",
            "output": [
                {
                    "id": format!("msg_{}", uuid::Uuid::new_v4().simple()),
                    "type": "message",
                    "role": "assistant",
                    "content": [
                        { "type": "output_text", "text": output_text }
                    ]
                }
            ]
        });

        let mut headers = HeaderMap::new();
        headers.insert(axum::http::header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
        return (StatusCode::OK, headers, serde_json::to_string(&resp_json).unwrap()).into_response();
    }

    // Streaming SSE for Responses API
    let (tx, body_rx) = tokio::sync::mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(100);
    let model_str = model.to_string();

    tokio::spawn(async move {
        // response.created
        let created_ev = format!(
            "event: response.created\ndata: {}\n\n",
            serde_json::json!({
                "type": "response.created",
                "response": { "id": resp_id, "status": "in_progress", "model": model_str }
            })
        );
        let _ = tx.send(Ok(created_ev.into())).await;

        // response.output_item.added
        let item_ev = format!(
            "event: response.output_item.added\ndata: {}\n\n",
            serde_json::json!({
                "type": "response.output_item.added",
                "response_id": resp_id,
                "output_index": 0,
                "item": { "id": format!("msg_{}", resp_id), "type": "message", "role": "assistant", "content": [] }
            })
        );
        let _ = tx.send(Ok(item_ev.into())).await;

        let mut stream_rx = dispatch_internal_stream(state, "/v1/chat/completions", chat_body_bytes).await;
        while let Some(chunk_res) = stream_rx.recv().await {
            if let Ok(chunk_str) = chunk_res {
                for line in chunk_str.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("data:") {
                        let data_part = trimmed.trim_start_matches("data:").trim();
                        if data_part == "[DONE]" {
                            break;
                        }
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data_part) {
                            if let Some(delta) = json.get("choices").and_then(|c| c.get(0)).and_then(|c| c.get("delta")) {
                                if let Some(txt) = delta.get("content").and_then(|s| s.as_str()) {
                                    if !txt.is_empty() {
                                        let text_delta = format!(
                                            "event: response.output_text.delta\ndata: {}\n\n",
                                            serde_json::json!({
                                                "type": "response.output_text.delta",
                                                "response_id": resp_id,
                                                "output_index": 0,
                                                "content_index": 0,
                                                "delta": txt
                                            })
                                        );
                                        if tx.send(Ok(text_delta.into())).await.is_err() {
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // response.completed
        let completed_ev = format!(
            "event: response.completed\ndata: {}\n\n",
            serde_json::json!({
                "type": "response.completed",
                "response": { "id": resp_id, "status": "completed" }
            })
        );
        let _ = tx.send(Ok(completed_ev.into())).await;
    });

    let mut response_headers = HeaderMap::new();
    response_headers.insert(axum::http::header::CONTENT_TYPE, HeaderValue::from_static("text/event-stream; charset=utf-8"));
    response_headers.insert(axum::http::header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response_headers.insert(axum::http::header::CONNECTION, HeaderValue::from_static("keep-alive"));

    let stream = tokio_stream::wrappers::ReceiverStream::new(body_rx);
    let body = Body::from_stream(stream);
    (StatusCode::OK, response_headers, body).into_response()
}

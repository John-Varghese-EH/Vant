# Using Vant with Claude Code

[Claude Code](https://github.com/anthropics/claude-code) is an AI agent for terminal-based software engineering and coding.

With Vant, you run Claude Code on your client laptop or desktop without installing Ollama or downloading heavy model weights locally. Vant acts as a local proxy on your client machine and streams all inference requests over an encrypted P2P Noise tunnel to your remote Host GPU.

---

## Key Highlights

- **Zero Local Model Storage**: Your client laptop does not need Ollama installed and does not store multi-gigabyte models.
- **Full Host GPU Offload**: All token generation and attention layers execute on your remote Host workstation or server.
- **End-to-End Encrypted**: All code prompts and inference chunks travel through Noise-XX protocol with ChaCha20-Poly1305 encryption.

---

## Prerequisites

1. **Host PC**: Vant running in Host mode with Ollama active and at least one coding model pulled (e.g. `qwen2.5-coder:32b`, `llama3.3`, or `deepseek-coder`).
2. **Client Laptop**: Vant running in Client mode and paired to your Host.
3. **Node.js**: Installed on your client laptop (Node.js 18 or newer).

---

## Step 1: Install Claude Code on Client Laptop

On your client laptop, install the Claude Code CLI globally via npm:

```bash
npm install -g @anthropic-ai/claude-code
```

*(You do not need to install Ollama or any Python dependencies on your laptop.)*

---

## Step 2: Ensure Vant Client API Proxy is Active

When Vant on your client laptop connects to your Host, it automatically starts a local compatibility proxy on:
```text
http://127.0.0.1:11434
```
You can verify this in the **Client Terminal** under the **Agents** tab. Click **"Verify Client Endpoint"** to confirm that models running on your Host are visible from your laptop.

---

## Step 3: Run Claude Code

Navigate to any software project on your client laptop and launch Claude Code pointing to Vant's local proxy:

### On macOS / Linux (Bash / Zsh):
```bash
export OLLAMA_HOST=http://127.0.0.1:11434
claude --provider ollama --model qwen2.5-coder:32b
```

### On Windows (PowerShell):
```powershell
$env:OLLAMA_HOST = "http://127.0.0.1:11434"
claude --provider ollama --model qwen2.5-coder:32b
```

### Inline One-Liner (Bash / Zsh):
```bash
OLLAMA_HOST=http://127.0.0.1:11434 claude --provider ollama --model qwen2.5-coder:32b
```

---

## Step 4 (Optional): Permanent Configuration

To avoid setting `OLLAMA_HOST` in every new terminal session, add it to your shell configuration profile on your laptop:

### macOS / Linux:
Add this line to `~/.bashrc` or `~/.zshrc`:
```bash
export OLLAMA_HOST="http://127.0.0.1:11434"
```

### Windows:
Add a User Environment Variable named `OLLAMA_HOST` with value `http://127.0.0.1:11434`.

---

## How It Works Under the Hood

```
[Laptop Terminal: Claude Code CLI]
               | HTTP requests (/api/chat, /api/tags)
               v
[Vant Client Proxy: 127.0.0.1:11434]
               | Encrypted P2P Noise Protocol (WebRTC / Cloudflare Tunnel)
               v
[Vant Host Daemon]
               | Local HTTP (127.0.0.1:11434)
               v
[Host GPU: Ollama Engine]
```

Claude Code issues standard HTTP requests to `127.0.0.1:11434`. Vant's Layer 7 transparent proxy intercepts the requests, packs them into encrypted P2P frames, and forwards them across the network. The Host forwards the payload to its GPU inference engine and streams response chunks back in real time.

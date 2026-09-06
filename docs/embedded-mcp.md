# Embedded MCP

Messs uses the official Model Context Protocol SDK with linked in-memory
transports. No listener, subprocess transport, external client configuration or
API key is needed. The SDK loads lazily on the first tool operation.

Both Agent views reach the shared `ai:chat` handler. Its existing model-output
adapter maps host operations to MCP `read_file`, `fetch_url`, `run_command`, and
isolated work to `execute_isolated`. This does not add native model-side MCP
support or change the provider request protocol.

Each operation creates and closes its own MCP client/server pair. Account,
renderer and permission-session identity are supplied only by the host, never
by model arguments. File reads, network requests and commands retain the host
permission service. Isolated execution retains its worker sandbox and limits.
This transport is not itself a sandbox. Previously approved operations already
running are subject to the existing host timeouts, not process interruption on
MCP disconnect. Expired contexts cannot receive results.

Artifact validation, storage and download stay in the existing account-scoped
pipeline after MCP execution. Encoded file descriptions can pass through MCP;
materialized binary downloads stay in the existing artifact store.
There is no public MCP endpoint, external-server installer or extra UI.

Run `node scripts/test-embedded-mcp.cjs` for protocol, authorization, worker and
lifecycle tests. Desktop UI end-to-end and packaged Windows/macOS smoke tests
remain separate release checks.

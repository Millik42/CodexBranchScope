# BranchScope technical specification

This specification implements the [product requirements](requirements.md). BranchScope consists of a Codex launch integration, a local Git service, and a graph UI.

## Codex integration

Begin with a Windows proof of concept. Package a local Codex plugin with a minimal local MCP tool and UI resource. Launch it from a Git project and verify that the target Codex build can open the UI beside a chat, invoke its local tool, and identify the selected checkout. Repeat from a linked worktree and after switching projects. Record the Codex build, launch method, and observed behavior. [Plugin packaging](https://developers.openai.com/plugins/build/plugins) · [MCP UI resources](https://developers.openai.com/plugins/build/chatgpt-ui) · [Conversation panels](https://developers.openai.com/plugins/build/extensions)

If the panel or checkout integration is unavailable, provide an **Open BranchScope** project action. The action passes its current project directory to a local launcher, which resolves the repository and opens a loopback URL in the built-in browser. Bind to `127.0.0.1` on an available port and use a short-lived session token to scope requests to that checkout. Bundle the UI with the launcher. Both launch modes use the same Git service and graph UI. [Project actions](https://learn.chatgpt.com/docs/environments/local-environment#actions) · [Local previews](https://learn.chatgpt.com/docs/browser#preview-a-page)

## Local Git service

- Resolve the checkout from the launch directory via Git. Record the worktree root, the active worktree's `HEAD`, its symbolic branch when available, and the shallow state. Scope each session to one resolved worktree. Treat a nested project directory as part of its containing repository.
- Enumerate local refs under `refs/heads/` and remote-tracking refs under `refs/remotes/`. Group remote-tracking refs by the configured remote and omit symbolic aliases such as `origin/HEAD`. Retain ref kind, full ref name, display name, and target object ID. Include the active worktree's detached commit as a history root when applicable.
- Capture ref targets and `HEAD` as object IDs at snapshot creation. Traverse those captured tips in topological order and capture each commit's ordered parent list. Deduplicate by full object ID across all tips. Use machine-readable Git output with explicit framing for metadata and messages, and treat object IDs as opaque strings. A missing parent at a shallow boundary is represented as a boundary, with no fabricated link.
- Model each graph row with the commit ID, parent IDs, subject, ref labels, and graph geometry. Return full message, author and date on demand. Keep one ordered row index and one object-ID-to-row lookup per snapshot. Use a snapshot ID and page cursor so a refresh cannot combine pages from different histories. Discard stale responses in the UI.
- Implement equivalent operations for project status, the first graph page, subsequent pages, commit details, jump to a ref or commit, local refresh, and fetch. Resolve jump targets in the current snapshot. If the target is outside the loaded range, load rows through the target in bounded pages before scrolling it into view. Return an explicit unavailable result for parents outside the recorded history.
- Spawn Git with argument arrays and the session's worktree as the working directory. Resolve commit and remote arguments against the session data. Render Git output as text. Keep repository contents and graph data on the machine.

## Graph layout and interaction

Allocate lanes in snapshot order. For each row, continue the current lane toward the first parent and join any already active lane for that parent. Allocate or reuse lanes for additional parents and draw the corresponding merge edges. Preserve active lane assignments and colors across page boundaries. Retire a lane once it has no pending ancestry edge.

Render commit rows and their graph geometry in the same scroll viewport so scrolling, resize, and virtualized rendering keep markers aligned. Keep branch and `HEAD` identification visible through labels or icons. Only render visible rows and a small overscan window. Show loading and error states in the current graph view, preserving the selected commit across refresh whenever its object ID remains reachable.

## Fetch and concurrency

Refresh replaces the current snapshot only after a new snapshot loads successfully. Fetch runs against the explicitly selected and configured remote using Git's configured refspec and credentials. The first release uses the repository's normal pruning policy. If pruning is disabled, deleted server branches can remain in the local remote-tracking list until Git prunes them. Serialize refresh and fetch mutations per session, block duplicate fetch requests while one is running, and keep the previous snapshot usable until replacement. A fetch failure returns a useful message without exposing credentials.

## Verification and release deliverables

- Exercise all seven acceptance scenarios from the product requirements. Use reproducible local fixtures, including a bare Git repository as the fetch target, a shallow clone, a linked worktree, and a history longer than one page. Verify row order, parent endpoints, ref targets, and page and jump behavior against Git.
- Smoke-test the chosen launch route in Codex Desktop on Windows. Confirm that opening the graph from two projects and two linked worktrees on the same machine resolves the right checkout each time.
- Deliver the plugin or project-action launcher, Git service, graph UI, fixtures, and English installation and usage instructions. Document which Codex launch mode was verified and how to enable it.

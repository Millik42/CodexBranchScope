# BranchScope

BranchScope is a local Git history viewer for Codex Desktop on Windows. It shows commit ancestry, merge parents, local and remote-tracking branch tips, and details for each commit. It supports linked worktrees. Git data stays on the machine.

## Requirements

- Codex Desktop on Windows
- Node.js 20 or newer
- Git for Windows 2.45 or newer, available on `PATH`

BranchScope runs directly from the checkout with Node.js.

## Open the graph

Open this repository or another Git checkout in Codex Desktop. In this repository, the **Open BranchScope** project action is configured in `.codex/environments/environment.toml`; run it from the project to start the viewer. The action runs `node src/open.mjs` with the project directory as its working directory.

The launcher prints a loopback URL. Click or open that URL in the Codex built-in browser. The server closes after 20 minutes without a graph request. Press Ctrl+C in the launcher process to close it sooner.

For another project, add an **Open BranchScope** action to that project's Codex environment configuration. Set its command to invoke `node` with the absolute path to this checkout's `src/open.mjs`. The action's working directory should be the project directory. If it cannot set a working directory, pass the checkout path as the optional second command argument:

```toml
[[actions]]
name = "Open BranchScope"
icon = "run"
command = 'node "D:\tools\GitGraf\src\open.mjs" "D:\work\my-project"'
```

BranchScope resolves a repository subdirectory to its containing checkout. Launch separately from each linked worktree to see that worktree's own `HEAD` and path.

## Use the graph

The graph starts with up to 200 commits in topological order. Scroll to load older history. Select a branch in the branch list to jump to its tip. Select a commit to view its full message, author, date, object ID, and parents. Use **Copy object ID** or select an available parent to jump to it. **Refresh graph** rereads local state. **Fetch** contacts only the selected remote and updates the graph on success. Remote-tracking labels show the state recorded locally by Git.

Opening, scrolling, and refreshing work offline. Fetch uses the selected remote's refspec, transport, credentials, and pruning policy. If pruning is disabled, Git can retain local refs for branches deleted on the remote.

## Development

Run `node src/open.mjs` from the repository root to launch the viewer, or pass a checkout path with `node src/open.mjs "D:\work\my-project"`. Run `npm.cmd test` on Windows to exercise the local acceptance fixtures. See the [verification notes](docs/verification.md) for the Windows smoke test and the panel compatibility probe.

Product scope and design details are in the [requirements](docs/requirements.md) and [technical specification](docs/technical-specification.md).

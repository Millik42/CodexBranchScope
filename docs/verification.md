# BranchScope verification

## Automated acceptance coverage

Run `npm.cmd test` with Node.js 20+ and Git for Windows 2.45+ available on `PATH`. Reproducible fixtures and assertions live in `test/fixtures.mjs` and `test/branchscope.test.mjs`.

| Acceptance | Coverage |
| --- | --- |
| AC-01 | Three-parent merge, one row per commit, topological order, and parent edge endpoints. |
| AC-02 | Two remotes, shared tips, and branch grouping with a custom fetch refspec. |
| AC-03 | Bare-repository fetch target, selected-remote fetch, moved tracking ref, rejected concurrent and ambiguous group fetches, and failed-fetch snapshot preservation without leaking the URL. |
| AC-04 | Same history from the main checkout and attached and detached linked worktrees, each with its own path and `HEAD`. |
| AC-05 | More than 200 commits, stable lanes over the page boundary, and a jump to a ref beyond the first page. |
| AC-06 | Nested project path containing spaces and Cyrillic characters, Unicode author and multiline commit message, and full commit details. |
| AC-07 | Shallow boundary and unavailable parent, empty repository, non-Git directory, and missing Git executable. |

The suite also verifies token enforcement, origin validation, stale page rejection, and the JSON-RPC exchanges for both the MCP panel and the compatibility probe.

## Native panel verification

The Windows installer registered and enabled `branchscope@branchscope-local` using Codex CLI `0.171.0-alpha.13`. The local Codex app server discovered the BranchScope thread entrypoint and inline display preference and returned its self-contained `text/html;profile=mcp-app` resource. This check exercised the installed plugin through the Codex app server.

The installed plugin was exercised through the same app-server version with two ephemeral chats in different repositories and a third chat in a linked worktree. Calling the graph in the order A → B → A, with no directory argument, returned each chat's checkout and branch. Reusing the first chat's graph session recovered its original snapshot. The linked worktree returned its own checkout and branch.

To verify rendering in Codex Desktop, open **+ → More tools → Plugins and MCPs → BranchScope** in the right panel of each chat, then switch between them. Confirm that each tab displays its own checkout and branch without opening the checkout picker. The visual tab-switch check remains manual on Windows.

In a chat created before BranchScope was installed, the right tab appeared in the picker but the Desktop log recorded `unknown MCP server 'branchscope'` on both the tool call and the resource read. Open the tab from a local chat created after installation. The log showed BranchScope reaching `ready` in newer threads.

## Windows smoke-test record

Observed on Windows with Codex Desktop package `OpenAI.Codex_26.1117.4957.0_x64`, Node `24.18.0`, and Git `2.53.0.windows.1`:

- Started local BranchScope servers from the shell for the GitGraf checkout and a temporary fixture in a nested path containing Unicode characters.
- Opened the printed loopback URL in the Codex built-in browser. The graph showed the correct repository, checkout path, and `HEAD`. The branch jump reached the expected commit, the details showed the complete Unicode message, and the copy button reported **Copied**.
- Repeated with two linked worktrees, one attached and one detached. Each showed the shared history with its own checkout path and correct `HEAD`.
- Launching from the toolbar and rendering the native panel in Codex Desktop still need manual verification. The app-server checks above cover plugin registration and checkout binding.

## Manual project-action check

1. Open this repository as a project in Codex Desktop and run **Open BranchScope** from the project actions.
2. Click/open the URL printed by the action in the Codex built-in browser.
3. Confirm the repository, checkout path, and `HEAD`. Select a branch and a commit, use the copy control, then refresh.
4. Repeat from an attached linked worktree and a detached linked worktree. Confirm each path and `HEAD` reflect the launched worktree.
5. For another project, configure the action with the absolute script path as described in the README. Set its working directory to the project, or pass the checkout path as an explicit argument.

## Optional Codex panel compatibility probe

`integration/panel-probe` contains a local stdio MCP probe and a thread UI resource. Its `.mcp.json` sets `cwd` to the probe package directory. The probe reports the MCP process working directory and the Git checkout resolved from it.

To repeat the probe, add a local marketplace entry whose source path is `./integration/panel-probe`. Install **BranchScope Panel Probe** from that marketplace, open its thread UI, and choose **Read local checkout**. Compare **MCP directory** and **Git checkout** with the selected project. Repeat after switching projects and from both linked worktrees. [Packaging and local installation](https://developers.openai.com/plugins/build/plugins) · [Conversation panels](https://developers.openai.com/plugins/build/extensions)

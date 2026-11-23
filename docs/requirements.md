# BranchScope product requirements

## Purpose

Open the Git history of the selected Codex project and answer three questions at a glance. Where did a branch diverge, where was it merged, and which commits do the local and remote-tracking branches currently point to?

## Release scope

The first release targets Codex Desktop on Windows. It supports local Git checkouts and linked worktrees. The preferred interface is a panel beside the project chat. If the target Codex build cannot host the panel, a project action opens the same graph in the built-in browser.

## Functional requirements

| ID | Requirement |
| --- | --- |
| BR-01 | Open the graph from the active Codex project. Show the repository name, the active branch or detached `HEAD`, and the checkout path so users can distinguish linked worktrees. |
| BR-02 | Show one row per commit, with colored ancestry lines on the left and the commit subject on the right. Show branch points and every recorded parent of a merge commit. Arrange loaded commits in topological order with children above their parents. |
| BR-03 | Label the commit targeted by each local branch and remote-tracking branch. Show all labels when several branches share a tip. Distinguish local and remote-tracking labels with text or icons, and highlight the current worktree's `HEAD`. |
| BR-04 | List local branches and group remote-tracking branches by remote. Selecting a branch jumps to its tip, including when the tip lies beyond the first loaded page. |
| BR-05 | Selecting a commit shows its full message, author, authored date and time, full object ID, and parents. Allow users to copy the object ID and jump to each available parent. |
| BR-06 | Load up to 200 commits initially and load older rows on demand as users scroll. Keep the existing layout and ancestry lines stable as rows are appended. |
| BR-07 | **Refresh graph** rereads local Git state. **Fetch** contacts only the selected remote, through Git, and refreshes the graph after success. Opening, scrolling, and refreshing the graph locally work offline. The interface identifies remote-tracking labels as the states recorded by local Git. |
| BR-08 | Explain the corrective action for a missing Git executable, a non-Git folder, a repository with no commits, or a failed fetch. Show shallow history boundaries in the graph. Preserve the previous graph if refresh or fetch fails. |

The release scope covers viewing history and requesting an explicit fetch. Branch creation, checkout, merge, rebase, push, cloud execution, and public marketplace distribution are outside the first release.

## Acceptance criteria

| ID | Scenario | Expected result |
| --- | --- | --- |
| AC-01 | Open a repository with diverging branches and a merge with three parents. | Every commit appears once. All three parent lines lead to the correct commits. |
| AC-02 | Open a repository with a local branch ahead of or behind its remote-tracking branch, plus a second remote. | Labels point to their actual commits. The branch list groups refs by remote, and shared tips display all labels. |
| AC-03 | Advance a remote branch and fetch that remote from BranchScope. Then try a fetch that fails. | The successful fetch moves the remote-tracking label. The failed fetch reports the error and preserves the preceding graph. |
| AC-04 | Open the same repository from two linked worktrees with different checked-out commits, one detached. | Both show the shared history. Each highlights its own `HEAD`. |
| AC-05 | Open a history exceeding 200 commits, with an ancestry edge crossing the page boundary. Select a branch whose tip is beyond the first page. | The edge continues to the right parent, the branch jump reaches the correct row, and previously drawn lanes remain stable. |
| AC-06 | Open a project inside a repository whose path contains spaces and Cyrillic characters. Read a commit with a multiline Unicode message. | The graph opens from Codex on Windows. The details show the complete message and copy the correct object ID. |
| AC-07 | Open shallow, empty, and non-Git fixtures, then repeat with the Git executable unavailable. | The shallow graph marks its boundary. Each unavailable state identifies its cause. |

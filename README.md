# @webship.co/workspace-gitea

**Gitea and Forgejo**, the open-source self-hosted Git forges, for the
[Webship Workspace](https://github.com/webship/workspace), a container-based workspace (DDEV by default). One plugin
covers both: Forgejo is the fork of Gitea that keeps its API, so the same builder, forge and tracker serve either, and
the menu and messages carry the name of the one you use. The plugin brings:

- **a builder**, `cmd-gitea-project.sh`: a real Gitea, or a Forgejo with `--product forgejo`, from the product's own
  image on the project's own PostgreSQL, on DDEV (the default), Docker Compose, Podman or Kubernetes, with its default
  accounts, a private sample repository and its issues and milestone;
- **a tool**, `cmd-tools-gitea-cli.sh`: what a site is and its accounts, the forge's own commands in its container,
  the default accounts, the sample content, a clean-up after a stopped test run, and the dashboard's connection;
- **the forge**, for a project whose git remote is on your own Gitea or Forgejo
  ([`@webship.co/workspace-forge`](https://github.com/webship/workspace-forge)): the GITEA (or FORGEJO) menu on its
  row, the repository chip, the credential for the host, and "Clone a repository" when a new folder is made;
- **the issues as work items** of the tracker family
  ([`@webship.co/workspace-tracker`](https://github.com/webship/workspace-tracker)), in that menu: list them, read one,
  analyze it, and let the workspace's AI CLI work it on a branch and open its pull request, with a person in charge;
- **the step pack** [`@webship-js/gitea-steps`](https://github.com/webship/gitea-steps), one for both forges, wired
  into the workspace's testing setup, with a first feature for a site;
- **AI items** in their folders: three agents, a skill, a command and two prompts.

## Install

From the workspace's root, the same four steps as Settings → Plugins:

```bash
bash core/scripts/plugins.sh --require @webship.co/workspace-gitea
bash core/scripts/plugins.sh --activate gitea --with-needs
bash core/scripts/plugins.sh --install gitea --with-needs
bash core/scripts/plugins.sh --configure gitea
```

## What it needs

- A sites folder: one of the `dev`, `test`, `sandboxes` or `demos` plugins. The commands are placed there.
- The AI folders `ai-agents`, `ai-skills`, `ai-commands` and `ai-prompts`, where its AI items land.
- A container runtime: DDEV, or Docker, Podman or a kind cluster with the workspace's container runtimes
  (`--runtime docker`, `podman`, `kubernetes`).
- About 200 MB of disk for an image the first time, and about 200 MB of memory for a running site.

## Build a site

```bash
cd ~/workspace/sandboxes                      # or dev, test, demos
bash cmd-gitea-project.sh mysite --install --add-users --sample-content                     # Gitea
bash cmd-gitea-project.sh myforge --product forgejo --install --add-users --sample-content  # Forgejo
bash cmd-gitea-project.sh mysite --install --add-users --runtime docker                     # or podman, kubernetes
```

| Flag | What it does |
| --- | --- |
| `--product gitea` or `--product forgejo` | The forge: Gitea (the default) or Forgejo |
| `--install` | The workspace account (`account` of `core/config/settings.yml`) becomes an administrator of the site. The forge asks a password of at least eight characters |
| `--add-users` | With `--install`: the default accounts, and their access to the private repository owner/webship-site |
| `--sample-content` | With `--install --add-users`: `greeting.sh`, three issues, the milestone "Sprint 1", the label bug and a comment |
| `--release <x.y.z>` | The release of the image: 1.27.3 for Gitea, 17.0.2 for Forgejo by default |
| `--runtime ddev`, `docker`, `podman` or `kubernetes` | DDEV (the default, or `container.runtime` of `settings.yml`), Docker Compose, Podman or Kubernetes (a kind cluster) |
| `--launch` | Open the site when it is ready |

A project of the same name is deleted first, with its database and its repositories.

- **On DDEV** the product's image (`gitea/gitea`, or `codeberg.org/forgejo/forgejo`) is a service of a generic project,
  on the project's PostgreSQL 17, at `https://mysite.ddev.site`. Its own start writes its configuration the first time
  and runs the forge as its git user. The project's web container keeps the mail catcher, at
  `https://mysite.ddev.site:8026`.
- **On Docker Compose and Podman** the product's image is the web container's (the workspace's generic stack), on the
  project's PostgreSQL 17, at `http://127.0.0.1:<port>`; the build says the address. The forge runs as your user, its
  repositories and data in the project's `gitea/data`. The image is named with its registry
  (`docker.io/gitea/gitea`), as Podman resolves no short name without asking.
- **On Kubernetes** (the workspace's kind cluster) the same image is the web pod's, the project's folder mounted from
  this machine, at the node's address and a NodePort (`http://<node>:<port>`). The forge waits for its PostgreSQL
  before it starts, as on the other runtimes. Its address is written into the site when it is built: build it again if
  the cluster's address changes.
- Lando and Docksal are not proven for these forges yet: asked for one, the builder says so and changes nothing.

Every build makes the site's own administrator, `forge-admin`, with a password the forge makes. It and the site's other
values (its secret key, its internal token) are kept in `gitea/env` of the project, which only you can read. The builder
never prints them, and its scripts talk to the forge's own REST API with no secret on a command line.

### The default accounts

| Account | Address | To the private repository owner/webship-site |
| --- | --- | --- |
| `owner` | `owner@example.com` | Its owner |
| `member` | `member@example.com` | A collaborator with write access |
| `reader` | `reader@example.com` | A collaborator with read access: reads it, opens issues and comments |
| `stranger` | `stranger@example.com` | No access: the forge answers 404 for the repository |

Each has the password of the workspace's other default lists, `dD.123123ddd`. They are configuration: a test suite
never creates or deletes one. `bash cmd-tools-add-users.sh mysite gitea` and
`bash cmd-tools-cancel-users.sh mysite gitea` (the row's Tests menu) add them and keep them from logging in.

### The sample content

In owner/webship-site: `greeting.sh`, a script that greets, with two typos; "The greeting script says Helo instead of
Hello" (opened by the owner, assigned to the member, in the milestone "Sprint 1", labelled bug, with a comment); "The
usage line spells greeting as greting" (opened by the member); and "An issue opened by someone outside the project"
(opened by the reader, who may only read: the tracker treats it as from outside the project).

## The tool

```bash
bash cmd-tools-gitea-cli.sh mysite                              # what the site is: product, release, address, accounts
bash cmd-tools-gitea-cli.sh mysite --run "admin user list"      # one of the forge's own commands, in its container
bash cmd-tools-gitea-cli.sh mysite --sample-content             # the sample content, where it is missing
bash cmd-tools-gitea-cli.sh mysite --tidy                       # the issues a stopped test run left
bash cmd-tools-gitea-cli.sh mysite --add-users                  # the default accounts and their access
bash cmd-tools-gitea-cli.sh mysite --cancel-users               # keep them from logging in
bash cmd-tools-gitea-cli.sh mysite --connect member             # the dashboard reads this site as member
```

`--connect <login>` makes a new access token of the account with the forge's own admin command (scopes write:issue,
write:repository, read:user) and writes it, with the site's address, the account and the product, into
`core/config/plugin.gitea.settings.yml`, and the sample repository as the tracker's default one when none was set.
The token is never shown.

## The forge, and the issues as work items

With the address of your Gitea or Forgejo and an access token in the settings (`--connect` writes both for a site the
workspace built; for your own instance, the token is in Settings → Applications), every project whose git remote is on
that instance (its host, with its port when it has one) gets the **GITEA** menu on its row (**FORGEJO** with
`product: forgejo`): open the repository, its open issues and pull requests, a new pull request from the branch, a new
issue, the clone URL. The repository chip shows on its card, and New folder offers to clone a repository of the
instance. In that menu, "Issues — get, analyze, work…" opens the tracker:

- **The list**: the open issues, mine, assigned to someone, the current milestone (the open one due first), and a
  search.
- **One issue**: its text, its author and its comments, each with their standing.
- **Analyze**: the AI CLI reads it and proposes a plan, with reading tools only.
- **Do the work**: the AI CLI works it on a new branch of the project (or a worktree), made from the repository's
  default branch, in a screen session you watch. The issue is saved as data, never as instructions.
- **Result**: the branch, its commits and the notes, the reviewer role, and the comment to post.
- With writes on (`allow_writes: true` in the tracker block): the branch pushed and its pull request opened (its title
  starts with WIP: while it is a draft), a comment, tracked time, closing and reopening, labels and an assignee, each
  your click after a preview.

**Who is inside.** Another user's permission is for the forge's administrators only, so the standing comes from the
repository's own lists, which anyone who may read it can see: its owner is the owner, who may be assigned (write access
and above) is a member. A collaborator who may only read, and anyone else (on a public repository, anyone may open an
issue), are outside: their issues are analyze only unless you confirm one by its author's name
(`outsider_items: refuse` refuses them).

**Credentials.** The token travels in a file only you can read (curl), or in the environment of one git process
(askpass), never on a command line. Before anything is posted, the text is checked for credentials: the ones the
tracker family knows, and the token of the settings. A Gitea or Forgejo token is 40 hex digits, the shape of a git
commit too, so it has no shape of its own to look for.

### Settings

`core/config/plugin.gitea.settings.yml` (Settings → Plugins → Gitea):

| Key | What it is |
| --- | --- |
| `url` | The address of your Gitea or Forgejo, without a trailing slash |
| `product` | `gitea` or `forgejo`: the name the menu and the messages carry |
| `username` | The account name the forge knows you by |
| `email` | The address commits pushed there carry. Blank falls back to `contributor.email` |
| `token` | The access token of that account (write:issue, write:repository, read:user). Never printed |
| `allow_writes` | Pushes and pull requests, comments, time, close and reopen, labels, assignees and new issues; `false` by default |
| `max_agents` | Author sessions at once |
| `default_scope` | The repository (owner/name) a workspace project works against when its remote is not on this forge and it remembers none |
| `scopes` | The repositories the list may be switched to; empty is any |
| `work_in` | `branch` (a new branch in the project) or `worktree` (outside the workspace folders) |
| `sandbox` | `required` (the AI CLI's sandbox, and no session without it) or `off` (a person's choice) |
| `network_domains` | The domains the sandbox allows (the project's package registries) |
| `allow_web` | Web fetch and web search in the author session |
| `comments_from` | The comments a saved issue keeps: `members` (write access and above), `all`, `none` |
| `outsider_items` | An issue from outside the repository: `analyze` (work it only after a confirmation by name) or `refuse` |
| `draft` | Open pull requests as drafts (`WIP:` in the title); `true` by default |

The keys from `allow_writes` on sit in the settings' `tracker:` block.

## Testing a site

```bash
bash cmd-tools-testing.sh mysite                       # webship-js, the step pack, the users registry, a first feature
bash cmd-tools-testing.sh mysite --run
```

The testing setup adds `@webship-js/gitea-steps` to the project, its step definitions to `cucumber.js`, the managing
account (`owner`, which makes and removes the test content through the site's REST API), the repository of the steps
(`owner/webship-site`), the users registry (`owner`, `member`, `reader`, `stranger`), and `tests/features/site.feature`.
The same suite runs on Gitea and on Forgejo, and leaves the site as it found it.

## AI items

| Kind | Item | What it is for |
| --- | --- | --- |
| Agent | `gitea-site-builder` | Build, look after and remove Gitea and Forgejo sites |
| Agent | `gitea-tester` | Test a site with the step pack: look at the screens first, write scenarios, run, read |
| Agent | `gitea-issue-worker` | Work an issue on a branch, the writes left to a person |
| Skill | `gitea-scenarios` | The pack's phrases by area, the traps found on real sites, whole features |
| Command | `/gitea-test <site>` | Set the testing stack up, run the suite, report |
| Prompt | `gitea-build-and-test` | Build a site and prove it with its first feature |
| Prompt | `gitea-issue-to-branch` | Work an issue on a branch |

## License

ISC (see `LICENSE`). Gitea is MIT and Forgejo GPL-3.0-or-later; the plugin runs their images and carries none of their
code.

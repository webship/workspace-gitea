# @webship.co/workspace-gitea

Gitea and Forgejo, the open-source self-hosted Git forges, for the [Webship Workspace](https://github.com/webship/workspace)
dashboard. One plugin covers both: Forgejo is a fork of Gitea that keeps its API, so the same builder, forge and tracker
work for either. It brings a builder that makes a real Gitea or Forgejo in containers (DDEV by default,
`--product gitea|forgejo`), its default accounts and a sample repository with its issues and a milestone, the step pack
wired into the workspace's testing setup, the forge side for a project whose remote is on your own Gitea or Forgejo
(the row menu, the repository chip, the credential), and its issues as work items of the tracker family
([`@webship.co/workspace-tracker`](https://github.com/webship/workspace-tracker)): read one, analyze it, and let the
workspace's AI CLI work it on a branch and open its pull request, with a person in charge.

The builder, the provider, the tests and CI come with the first release, `1.0.0`.

## License

ISC (see `LICENSE`).

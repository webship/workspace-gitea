---
name: gitea-scenarios
description: Write webship-js scenarios for a Gitea or Forgejo site (the open-source self-hosted Git forges; one step pack serves both) of the Webship Workspace from phrases that exist — the step pack's steps by area (logging in and out and a refused login, a repository and who may open it, the issue list, one issue with its comments, state, time, assignee and milestone, a new issue, the milestones, what a reader or a stranger may not do, test content), the traps found on real sites, and whole features. Use when asked to write, extend or fix scenarios for a Gitea or Forgejo site, or when a scenario of the site fails on a phrase.
---

# gitea-scenarios

Scenarios for a site built with the Gitea plugin (`bash cmd-gitea-project.sh <site> --install --add-users
--sample-content`, with `--product forgejo` for a Forgejo) in a container-based workspace (DDEV by default), tested
with webship-js and `@webship-js/gitea-steps` once `bash cmd-tools-testing.sh <site>` set the project up. Every phrase
below exists in the pack or in webship-js, and runs on Gitea and Forgejo alike; a scenario names no platform.

## Accounts

- `Given I am a logged in user with the "member" user`: `owner` (the owner of the private repository
  owner/webship-site), `member` (write access), `reader` (read access), `stranger` (no access). `Given I am not logged
  in` for a visitor.
- The accounts are made by the build (`cmd-tools-gitea-cli.sh <site> --add-users`); a suite never creates or deletes
  one, and never writes a password: it logs in by the handle.

## Phrases by area

| Area | Steps |
| --- | --- |
| Session | `I am a logged in user with the "member" user`, `I log in with the "member" user`, `I log in as "member" with the password "…"`, `the login should be refused with "Username or password is incorrect."`, `I am not logged in`, `I log out`, `I should be logged in as "member"` (or the full name, `"Member Test"`), `I should not be logged in` |
| Repositories | `I open the repository "owner/webship-site"`, `I should be refused the repository "owner/webship-site"` (`@js-off`) |
| Test content | `there is an issue "Webship test …" in the repository "owner/webship-site"` (it goes after the scenario), `there is an issue "Webship test …" in the milestone "Sprint 1"`, `there is no issue "Webship test …" in the repository "owner/webship-site"` |
| The list | `I open the issues of the repository "owner/webship-site"`, `the issue list should show "…"` (`should not show`), `I create an issue "Webship test …" in the repository "owner/webship-site"` (it goes after the scenario) |
| One issue | `I open the issue "…"`, `I add the comment "…" to the issue`, `the issue should show the comment "…"` (`… by "member"`), `I close the issue`, `I reopen the issue`, `the issue should be "open"` (`"closed"`), `I log "0.5" hours on the issue`, `the time spent on the issue should be "30 minutes"`, `I assign the issue to "member"`, `the issue should be assigned to "member"` (or `"Member Test"`), `the milestone of the issue should be "Sprint 1"` |
| What an account may not do | `I should not be able to close the issue`, `I should not be able to assign the issue`, `I should not be able to log time on the issue`, `I should be refused the repository "owner/webship-site"` |
| Milestones | `I open the milestones of the repository "owner/webship-site"`, `the milestones should list "Sprint 1"` (`should not list`), `I open the milestone "Sprint 1" of the repository "owner/webship-site"`, `the milestone should list the issue "…"` (`should not list the issue`) |

## The sample content

`--sample-content` adds, in the private repository owner/webship-site: `greeting.sh` (with two typos), "The greeting
script says Helo instead of Hello" (opened by the owner, assigned to member, in the milestone "Sprint 1", labelled bug,
with the owner's comment "The script is in the repository: `greeting.sh`."), "The usage line spells greeting as
greting" (opened by the member) and "An issue opened by someone outside the project" (opened by the reader, who may
only read). A suite reads them and never changes them.

## Traps found on real sites

- A comment stays in the timeline: change only an issue the scenario made (`there is an issue "Webship test …"`),
  which goes after it with all of it.
- The list shows the open issues: a closed one leaves it, and comes back reopened.
- An assignee is saved when the sidebar's menu closes; the step closes it and waits for the sidebar to show the name.
- A milestone changed on the page makes Forgejo's own script log errors: put an issue in a milestone through
  `there is an issue "…" in the milestone "…"`, and read it with `the milestone of the issue should be "…"`.
- The forge's search learns a new issue a moment late; the steps find test content by listing, not searching.
- A reader comments, but has no close button for someone else's issue, no time tracker and a disabled sidebar.
- A private repository answers 404 to an account with no access: tag those scenarios `@js-off`. A refused login
  answers 200 and needs no tag.
- A run that was stopped half way leaves its "Webship test …" issues: `bash cmd-tools-gitea-cli.sh <site> --tidy`
  removes them, with their comments and time.

## Whole features

`examples/` holds three features that pass on Gitea and on Forgejo built with `--install --add-users --sample-content`:
the session (`session.feature`), an issue worked by a member (`issue.feature`) and the roles (`roles.feature`).

## The book

For any automated functional testing in this work (a Gherkin feature, a step definition, choosing a
step, a test run and its failures), read the book *Automated Functional Testing Recipes* first.

- **Where.** Use the first that exists: `.claude/automated-functional-testing-recipes/` in the project,
  `~/.claude/automated-functional-testing-recipes/` (installed by webship/webship-js-ai-agent,
  webship/webship-js-skills or webship/ai-agents), or
  https://github.com/webship/webship-js-ai-agent/tree/2.0.x/automated-functional-testing-recipes
- **How.** Its `README.md` first, then the chapter that matches the task (one file per chapter,
  named by its subject), not the single complete file.
- **Which wins.** The installed webship-js package and the step pack are the source of truth for
  step phrasing. When they differ from the book, follow them and say so.
- **For a site.** Start with `ch10-authentication-authorization.md` (logins, refusals and what each account may do),
  `ch07-waiting-dynamic-content.md` (waiting on the app's own signals) and `ch26-testing-cms-applications.md`
  (content made and removed, roles, a workflow across roles).

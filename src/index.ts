/**
 * Gitea and Forgejo for Webship Workspace: one plugin for both (Forgejo is the fork of Gitea that keeps its API and its
 * screens), a platform plugin, a provider of the forge family and a provider of the tracker family.
 *
 * What the package carries is placed by the installer from the manifest: the builder and the tool in the sites folders,
 * their functions and argparse under core/scripts/plugins/gitea/ (with the compose file of the forge's service, the
 * script that talks to a site's API, the start of a site on Docker Compose and the first feature of a site), and its AI
 * items (ai/ in this package) in the folder of their kind.
 *
 * What register() adds, for a project whose git remote is on your own Gitea or Forgejo (the address of the plugin's
 * settings): the GITEA (or FORGEJO) menu on its row (the repository, open issues and pull requests, a new pull request
 * from the branch, the clone URL), the repository chip, "Clone a repository" when a new folder is made, and the
 * credential the dashboard uses for the host (@webship.co/workspace-forge). Its issues are work items
 * (@webship.co/workspace-tracker): "Issues — get, analyze, work…" in that menu opens the list, one issue, analyze, do
 * the work with the workspace's AI CLI on a branch, the result and, with writes on, a pull request, a comment, tracked
 * time, close and reopen, labels and an assignee, each a person's click after a preview. And what the assistant is told.
 *
 * Everything the dashboard is asked for goes through `api`; this package requires nothing from the dashboard's own
 * files, so it can be installed from npm and removed without a trace.
 */

import type { PluginApi, RowContext } from '@webship.co/workspace-plugin-api';
import { registerForge } from '@webship.co/workspace-forge';
import { registerTracker } from '@webship.co/workspace-tracker';

import { giteaProvider } from './lib/provider';
import { giteaTracker } from './lib/tracker';

export { giteaProvider, giteaTracker };

/** The plugin's name: a site is a generic project in containers that the plugin claims, and the core's tools call its functions under it. */
export const PLATFORM = 'gitea';

/** The commands the installer places in every sites folder. */
export const COMMANDS = ['cmd-gitea-project.sh', 'cmd-tools-gitea-cli.sh'];

/** The agents the installer places in the AI Agents folder. */
export const AGENTS = ['gitea-site-builder', 'gitea-tester', 'gitea-issue-worker'];

/** The skill the installer places in the AI Skills folder (a folder each, with its SKILL.md). */
export const SKILLS = ['gitea-scenarios'];

/** The slash command the installer places in the AI Commands folder. */
export const AI_COMMANDS = ['gitea-test'];

/** The prompts the installer places in the AI Prompts folder: each a whole launch command for a new session. */
export const PROMPTS = ['gitea-build-and-test', 'gitea-issue-to-branch'];

/** What the assistant is told about Gitea and Forgejo sites in this workspace (the issues are told by the tracker). */
export function assistantContext(): string {
  return [
    'Gitea and Forgejo (one plugin, @webship.co/workspace-gitea; Forgejo is the fork of Gitea that keeps its API), the self-hosted Git forges: a site is built with',
    '`bash cmd-gitea-project.sh <name> --install --add-users --sample-content` from a sites folder (dev, test, sandboxes, demos), Gitea by default or Forgejo with `--product forgejo`:',
    'the product\'s own image (Gitea 1.27.3, Forgejo 17.0.2 by default, `--release`) on the project\'s own PostgreSQL, on DDEV at https://<name>.ddev.site, or with `--runtime docker` on Docker Compose at http://127.0.0.1:<port>.',
    'Every build makes the site\'s own administrator (forge-admin, its password in the project\'s gitea/env); `--install` makes the workspace account an administrator; `--add-users` adds the default accounts',
    '(owner: the owner of the private repository owner/webship-site, member and reader: its collaborators with write and read access, stranger: no access), each @example.com;',
    '`--sample-content` adds greeting.sh, three issues (one opened by the reader, from outside), the milestone "Sprint 1" and a comment.',
    '`bash cmd-tools-gitea-cli.sh <name>` says what the site is and lists its accounts; `--run "<command>"` runs one of the forge\'s own commands in its container (`--run "admin user list"`),',
    '`--sample-content` adds the sample content later, `--tidy` removes the issues a stopped test run left ("Webship test …"), `--add-users` and `--cancel-users` manage the default accounts,',
    'and `--connect <login>` points the dashboard\'s Gitea at the site as that account (a new access token in the plugin\'s settings, never shown).',
    '`bash cmd-tools-testing.sh <name>` sets up webship-js with the Gitea and Forgejo step pack; `--run` runs the suite.',
    `For Gitea and Forgejo sites hand over to the agent \`${AGENTS[0]}\`, for testing one to \`${AGENTS[1]}\`, for working an issue to \`${AGENTS[2]}\`.`,
    `The plugin also places the skill ${SKILLS.map((a) => `\`${a}\``).join(', ')} (the step pack's phrases, by area) in ai-skills/,`,
    `the command ${AI_COMMANDS.map((a) => `\`/${a} <site>\``).join(', ')} in ai-commands/ and the prompts ${PROMPTS.map((a) => `\`${a}\``).join(' and ')} in ai-prompts/.`,
    'Never run the forge\'s tools on the host for a project; removing the project removes its database and its repositories too.',
  ].join(' ');
}

export function register(api: PluginApi): void {
  const forge = giteaProvider(api);
  // The issues as work items (the tracker family): their entry goes into the forge's menu, so the forge keeps one button.
  const tracker = registerTracker(api, giteaTracker(api, forge), { menu: 'none', settingsBlock: 'tracker', typeAction: null });
  // The provider keeps its getters (the name follows the product of the settings), so its own entries are set on it.
  forge.menuItems = (ctx: RowContext) => tracker.menuItems(ctx, { header: false, whenBlocked: 'none' });
  registerForge(api, forge);
  if (typeof api.addAssistantContext === 'function') api.addAssistantContext(assistantContext);
}

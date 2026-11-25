/**
 * Gitea and Forgejo, as one forge provider: your own instance, at the address of plugin.gitea.settings.yml (Forgejo is
 * the fork of Gitea that keeps its API, so the same calls serve both). The REST API v1 does the lists with the access
 * token of the settings; the New pull request page is linked for the row's branch, since neither has a CLI the
 * dashboard can count on.
 *
 * The host is the address's, with its port when it has one (a site on Docker Compose answers at 127.0.0.1:<port>), so a
 * remote of a self-hosted instance finds its row menu, its repository chip and its credential.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PluginApi, PluginLib } from '@webship.co/workspace-plugin-api';
import { repoPathAt } from '@webship.co/workspace-forge';
import type { ForgeItem, ForgeProvider, ForgeRepo } from '@webship.co/workspace-forge';

export const configured = (v: unknown) => { const s = String(v == null ? '' : v).trim(); return s && s !== 'CHANGE_ME' ? s : ''; };

/** The instance's address of the settings, as a URL, or null when it is not set (or not an address). */
export function instanceOf(value: unknown): URL | null {
  const s = configured(value);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u : null;
  } catch (_) { return null; }
}

/** The product the settings name: forgejo, else gitea. */
export function productOf(value: unknown): 'gitea' | 'forgejo' {
  return String(value || '').trim().toLowerCase() === 'forgejo' ? 'forgejo' : 'gitea';
}

/**
 * Run `fn` with curl arguments that read these header lines from a file only this user can read, removed after. On
 * curl's command line a token is readable by every account of the machine for as long as curl runs (`ps`,
 * /proc/<pid>/cmdline); `-H @file` (curl 7.55+) keeps it off.
 */
export async function withHeaderFile<T>(headers: string[], fn: (args: string[]) => Promise<T>): Promise<T> {
  if (!headers.length) return fn([]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-curl-'));
  const file = path.join(dir, 'headers');
  fs.writeFileSync(file, `${headers.join('\n')}\n`, { mode: 0o600 });
  try { return await fn(['-H', `@${file}`]); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

export function giteaProvider(api: PluginApi): ForgeProvider {
  const settings = () => api.settings.read() || {};
  const instance = () => instanceOf(settings().url);
  const host = () => { const u = instance(); return u ? u.host.toLowerCase() : ''; };
  const origin = () => { const u = instance(); return u ? `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}` : ''; };
  const product = () => productOf(settings().product);

  const env = (): NodeJS.ProcessEnv | null => {
    const t = configured(settings().token);
    return t && origin() ? { ...process.env, GITEA_TOKEN: t, GITEA_SERVER_URL: origin() } : null;
  };

  async function rest(lib: PluginLib, e: NodeJS.ProcessEnv, url: string): Promise<any[]> {
    // The token in a header file, never on curl's command line (withHeaderFile).
    const secret = e.GITEA_TOKEN ? [`Authorization: token ${e.GITEA_TOKEN}`] : [];
    const out = await withHeaderFile(secret, (auth) => lib.run('curl', ['-sS', '-m', '30', '-H', 'Accept: application/json', ...auth, url], process.env.HOME, { timeoutMs: 40 * 1000, env: process.env }));
    if (!out.ok) throw new Error(lib.cliError(String(out.stderr || out.stdout)));
    const data = JSON.parse(String(out.stdout));
    if (data && data.message && !Array.isArray(data)) throw new Error(String(data.message));
    return data;
  }

  async function list(kind: 'issues' | 'pulls', repo: ForgeRepo, lib: PluginLib, e: NodeJS.ProcessEnv): Promise<ForgeItem[]> {
    const q = kind === 'issues' ? 'state=open&type=issues&limit=20' : 'state=open&limit=20';
    const data = await rest(lib, e, `${origin()}/api/v1/repos/${repo.path}/${kind}?${q}`);
    return data.map((i) => ({ number: i.number, title: i.title, url: i.html_url, author: i.user && i.user.login, updated: i.updated_at }));
  }

  const provider: ForgeProvider = {
    id: 'gitea',
    // The name on the button and in sentences follows the product of the settings: a Forgejo reads FORGEJO.
    get label() { return product() === 'forgejo' ? 'FORGEJO' : 'GITEA'; },
    get title() { return product() === 'forgejo' ? 'Forgejo' : 'Gitea'; },
    host,
    pullsLabel: 'Pull requests',
    env,
    auth: () => { const s = settings(); return { username: configured(s.username) || undefined, email: configured(s.email) || undefined, how: configured(s.token) ? 'token' : 'none' }; },
    repoOf: (url, remote) => {
      if (!host()) return null;
      const p = repoPathAt(host(), url);
      return p && /^[\w.-]+\/[\w.-]+$/.test(p) ? { path: p, web: `${origin()}/${p}`, remote } : null;
    },
    cloneUrl: (spec) => (/^(https?:\/\/|git@)/.test(spec) ? spec : `${origin()}/${spec.replace(/\.git$/, '')}.git`),
    urls: (repo) => ({
      issues: `${repo.web}/issues`,
      pulls: `${repo.web}/pulls`,
      newIssue: `${repo.web}/issues/new`,
      newPull: (branch) => (branch ? `${repo.web}/compare/${encodeURIComponent(branch)}` : `${repo.web}/pulls`),
    }),
    listIssues: (repo, lib, e) => list('issues', repo, lib, e),
    listPulls: (repo, lib, e) => list('pulls', repo, lib, e),
    clone: { pattern: /^[\w.-]+\/[\w.-]+$|^(https?:\/\/|git@)[\w.:-]+[:/][\w./-]+$/, placeholder: 'owner/name', help: 'A repository of your Gitea or Forgejo is owner/name, or its clone URL.' },
    tokenHint: 'token in core/config/plugin.gitea.settings.yml',
  };
  return provider;
}

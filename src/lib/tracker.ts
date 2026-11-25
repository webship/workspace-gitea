/**
 * Gitea and Forgejo, as a provider of the tracker family (@webship.co/workspace-tracker): the issues of the repository a
 * remote names, over the REST API v1 with the access token of plugin.gitea.settings.yml. Forgejo keeps Gitea's API, so
 * one provider serves both.
 *
 * Reads: the open issues, mine, assigned to someone, the current milestone, a search, and one issue with its comments.
 * Each author's standing comes from the repository's own lists (another user's permission is for administrators only):
 * its owner is the owner, who may be assigned (write access and above) is a member; a collaborator who may only read
 * (who may open issues and comment, never push) and anyone else count as outside, so the base keeps their issues
 * analyze-only unless a person confirms by name. A description is edited only by its author or
 * by someone with write access, so no one outside can be its last editor: none is asked for.
 *
 * Writes, which the base offers only with writes on, each after a person's click: a comment, tracked time, close and
 * reopen, labels, an assignee, a new issue, and a pull request from the run's branch (its title marked WIP: while it
 * is a draft), which the dashboard pushes itself.
 *
 * The token goes in a header file (curl) or in the environment of one git process (askpass); never on a command
 * line, never in what is shown.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import type { PluginApi } from '@webship.co/workspace-plugin-api';
import { gitRemotes, repoOnForge } from '@webship.co/workspace-forge';
import type { ForgeProvider } from '@webship.co/workspace-forge';
import { GIT_SAFE } from '@webship.co/workspace-tracker';
import type { Person, RequestSpec, TrackerItem, TrackerItemFull, TrackerProvider, TrackerScope, WriteResult } from '@webship.co/workspace-tracker';

import { configured, instanceOf, productOf } from './provider';

const PATH_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const LOGIN_RE = /^[A-Za-z0-9_.-]{1,40}$/;

/**
 * Who someone is to the repository, as the base reads it: its owner; a member when the forge lets them be assigned
 * (write access and above); a contributor when they are a collaborator who may only read; outside otherwise. The
 * permission of another user is for administrators only, so the repository's own lists answer instead: they are open
 * to anyone who may read it.
 */
export function rosterAssociation(login: string, owner: string, roster: { writers: string[]; collaborators: string[] }): Person['association'] {
  const who = String(login || '').toLowerCase();
  if (!who) return 'unknown';
  if (who === String(owner || '').toLowerCase()) return 'owner';
  if (roster.writers.map((x) => x.toLowerCase()).includes(who)) return 'member';
  if (roster.collaborators.map((x) => x.toLowerCase()).includes(who)) return 'contributor';
  return 'outside';
}

/** One issue of the REST API, as the base reads an item. */
export function itemOf(i: any): TrackerItem {
  const state = String(i.state || '') === 'open' ? 'open' : 'closed';
  return {
    id: String(i.number),
    title: String(i.title || ''),
    url: String(i.html_url || ''),
    state,
    stateClass: state === 'open' ? 'open' : 'done',
    assignees: (i.assignees || (i.assignee ? [i.assignee] : [])).map((a: any) => String((a && a.login) || '')).filter(Boolean),
    labels: (i.labels || []).map((l: any) => String((l && l.name) || '')).filter(Boolean),
    iteration: i.milestone && i.milestone.title ? `milestone ${i.milestone.title}` : undefined,
    updated: i.updated_at || undefined,
  };
}

/** The open milestone a "current milestone" view means: the next one due, else the first open one without a date. */
export function currentMilestone(list: any[], now = new Date()): string {
  const open = (list || []).filter((m) => m && m.title && String(m.state || 'open') === 'open');
  const due = open.filter((m) => m.due_on && Date.parse(m.due_on) >= now.getTime() - 24 * 3600 * 1000)
    .sort((a, b) => Date.parse(a.due_on) - Date.parse(b.due_on));
  return String((due[0] || open.find((m) => !m.due_on) || {}).title || '');
}

function tempDir(): { dir: string; done: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-gitea-'));
  return { dir, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

export function giteaTracker(api: PluginApi, forge: ForgeProvider): TrackerProvider {
  const lib = api.lib;
  const settings = () => api.settings.read() || {};
  const host = () => forge.host();
  const origin = () => { const u = instanceOf(settings().url); return u ? `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}` : ''; };
  const token = () => configured(settings().token);
  const title = () => (productOf(settings().product) === 'forgejo' ? 'Forgejo' : 'Gitea');
  const rp = (s: TrackerScope) => s.id.split('/').map(encodeURIComponent).join('/');

  /** One call of the REST API: the token and the body in files only this user reads, removed after. */
  async function call(method: string, p: string, body?: unknown): Promise<{ status: number; data: any; text: string }> {
    if (!origin()) throw new Error(`no address in ${api.settings.file}`);
    const t = tempDir();
    try {
      const args = ['-sS', '-m', '30', '-X', method, '-w', '\n%{http_code}', '-H', 'Accept: application/json'];
      const secret = token();
      if (secret) {
        const h = path.join(t.dir, 'headers');
        fs.writeFileSync(h, `Authorization: token ${secret}\n`, { mode: 0o600 });
        args.push('-H', `@${h}`);
      }
      if (body !== undefined) {
        const b = path.join(t.dir, 'body.json');
        fs.writeFileSync(b, JSON.stringify(body), { mode: 0o600 });
        args.push('-H', 'Content-Type: application/json', '--data-binary', `@${b}`);
      }
      args.push(`${origin()}/api/v1${p}`);
      const r = await lib.run('curl', args, process.env.HOME || '/', { timeoutMs: 40 * 1000, env: process.env });
      const out = String(r.stdout || '');
      const at = out.lastIndexOf('\n');
      const status = Number(out.slice(at + 1)) || 0;
      const text = at >= 0 ? out.slice(0, at) : out;
      if (!r.ok && !status) throw new Error(lib.cliError(String(r.stderr || 'curl did not answer')));
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
      return { status, data, text };
    } finally { t.done(); }
  }
  const why = (r: { status: number; data: any; text: string }) => {
    const m = r.data && (r.data.message || r.data.error);
    return `${title()} answered ${r.status}: ${typeof m === 'string' ? m : JSON.stringify(m || r.text).slice(0, 200)}`;
  };
  async function get(p: string): Promise<any> {
    const r = await call('GET', p);
    if (r.status < 200 || r.status >= 300) throw new Error(why(r));
    return r.data;
  }
  async function write(method: string, p: string, body: unknown, url = ''): Promise<WriteResult & { data?: any }> {
    try {
      const r = await call(method, p, body);
      if (r.status < 200 || r.status >= 300) return { ok: false, error: why(r) };
      return { ok: true, error: '', url: url || (r.data && r.data.html_url) || '', data: r.data };
    } catch (e) { return { ok: false, error: String((e as Error).message || e) }; }
  }

  // The repository's writers (who may be assigned) and collaborators, asked once per repository for a few minutes.
  const rosters = new Map<string, { at: number; writers: string[]; collaborators: string[] }>();
  async function roster(scope: TrackerScope): Promise<{ writers: string[]; collaborators: string[] } | null> {
    const hit = rosters.get(scope.id);
    if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit;
    try {
      const logins = (list: any) => (Array.isArray(list) ? list : []).map((u: any) => String((u && u.login) || '')).filter(Boolean);
      const [writers, collaborators] = await Promise.all([
        get(`/repos/${rp(scope)}/assignees`),
        get(`/repos/${rp(scope)}/collaborators?limit=50`),
      ]);
      const r = { at: Date.now(), writers: logins(writers), collaborators: logins(collaborators) };
      rosters.set(scope.id, r);
      return r;
    } catch (_) { return null; }
  }
  async function standing(scope: TrackerScope, login: unknown): Promise<Person['association']> {
    const who = String(login || '');
    if (!LOGIN_RE.test(who)) return 'unknown';
    const owner = scope.id.split('/')[0];
    if (who.toLowerCase() === owner.toLowerCase()) return 'owner';
    const r = await roster(scope);
    return r ? rosterAssociation(who, owner, r) : 'unknown';
  }

  /** The remote of a project folder whose URL is the scope's repository on this host, or ''. */
  const remoteOf = (dir: string, scope: TrackerScope) => {
    const remotes = gitRemotes(dir);
    return Object.keys(remotes).find((n) => { const repo = forge.repoOf(remotes[n], n); return repo && repo.path === scope.id; }) || '';
  };

  let who: { at: number; login: string } = { at: 0, login: '' };
  async function me(): Promise<string> {
    if (who.login && Date.now() - who.at < 10 * 60 * 1000) return who.login;
    const u = await get('/user');
    who = { at: Date.now(), login: String(u.login || '') };
    return who.login;
  }

  /** git with hooks off and the token through an askpass that reads it from git's own environment. */
  async function gitWithToken(dir: string, args: string[], timeoutMs = 120 * 1000) {
    let login = 'oauth2';
    try { login = (await me()) || login; } catch (_) { /* the token alone is enough for the forge */ }
    const t = tempDir();
    try {
      const askpass = path.join(t.dir, 'askpass.sh');
      fs.writeFileSync(askpass, '#!/bin/sh\ncase "$1" in Username*) printf \'%s\\n\' "$WS_GITEA_LOGIN" ;; *) printf \'%s\\n\' "$WS_GITEA_TOKEN" ;; esac\n', { mode: 0o700 });
      return await lib.run('git', [...GIT_SAFE, '-c', 'credential.helper=', '-C', dir, ...args], dir,
        { timeoutMs, env: { ...process.env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: '0', WS_GITEA_TOKEN: token(), WS_GITEA_LOGIN: login } });
    } finally { t.done(); }
  }
  const defaults = new Map<string, { at: number; branch: string }>();

  const provider: TrackerProvider = {
    id: api.name,
    get title() { return title(); },
    get label() { return title().toUpperCase(); },
    noun: { one: 'issue', many: 'issues' },
    capabilities: {
      views: ['open', 'mine', 'assigned', 'iteration', 'query'],
      iterationWord: 'milestone',
      comment: true, worklog: true, transition: true, labels: true, assign: true, create: true,
      request: 'open', requestNoun: 'pull request',
    },
    idPattern: /^[1-9][0-9]{0,8}$/,
    cli: 'tea',
    tokenVariables: ['GITEA_TOKEN', 'GITEA_SERVER_TOKEN', 'FORGEJO_TOKEN', 'FJ_TOKEN'],
    secret: () => token(),
    ready: () => (!origin() ? `no address in ${api.settings.file}: set url to your Gitea or Forgejo`
      : token() ? '' : `no token in ${api.settings.file}: set an access token with write:issue, write:repository and read:user`),
    scopeOf: (ref) => {
      const repo = repoOnForge(forge, ref.dir);
      return repo ? { id: repo.path, name: repo.path, web: repo.web } : null;
    },
    parseScope: (text) => {
      const t = String(text || '').trim().replace(/\.git$/, '');
      return PATH_RE.test(t) && origin() ? { id: t, name: t, web: `${origin()}/${t}` } : null;
    },
    urlOf: (s, id) => `${s.web}/issues/${encodeURIComponent(id)}`,
    account: async () => { try { return await me(); } catch (_) { return ''; } },

    defaultBranch: async (scope) => {
      const hit = defaults.get(scope.id);
      if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.branch;
      const branch = String((await get(`/repos/${rp(scope)}`)).default_branch || '');
      if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error(`no default branch for ${scope.id}`);
      defaults.set(scope.id, { at: Date.now(), branch });
      return branch;
    },
    fetchBranch: async (scope, dir, branch) => {
      const remote = remoteOf(dir, scope);
      if (!remote) return { ok: false, error: `No remote of ${dir} is ${scope.id} on ${host()}.`, ref: '' };
      const f = await gitWithToken(dir, ['fetch', '--quiet', `${origin()}/${scope.id}.git`, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]);
      return f.ok ? { ok: true, error: '', ref: `${remote}/${branch}` } : { ok: false, error: lib.cliError(String(f.stderr || f.stdout || '')), ref: '' };
    },

    list: async (scope, q) => {
      const params = new URLSearchParams({ state: 'open', type: 'issues', limit: String(Math.max(1, Math.min(q.limit, 50))), page: '1' });
      if (q.view === 'mine') params.set('assigned_by', await me());
      if (q.view === 'assigned') { if (!q.who || !LOGIN_RE.test(q.who)) return []; params.set('assigned_by', q.who); }
      if (q.view === 'iteration') {
        const name = currentMilestone(await get(`/repos/${rp(scope)}/milestones?state=open&limit=50`));
        if (!name) return [];
        params.set('milestones', name);
      }
      if (q.view === 'query') params.set('q', String(q.text || ''));
      return ((await get(`/repos/${rp(scope)}/issues?${params.toString()}`)) as any[]).map(itemOf);
    },

    get: async (scope, id) => {
      const [i, comments] = await Promise.all([
        get(`/repos/${rp(scope)}/issues/${id}`),
        get(`/repos/${rp(scope)}/issues/${id}/comments`),
      ]);
      if (i && i.pull_request) throw new Error(`#${id} of ${scope.id} is a pull request, not an issue`);
      const login = String((i.user && i.user.login) || 'unknown');
      const author: Person = { name: login, association: await standing(scope, login) };
      const notes = [];
      for (const c of comments || []) {
        const by = String((c.user && c.user.login) || 'unknown');
        notes.push({ author: { name: by, association: await standing(scope, by) }, body: String(c.body || ''), at: String(c.created_at || '') });
      }
      const full: TrackerItemFull = { ...itemOf(i), body: String(i.body || ''), author, comments: notes };
      return full;
    },

    comment: async (scope, id, markdown) => {
      const r = await write('POST', `/repos/${rp(scope)}/issues/${id}/comments`, { body: markdown });
      return r.ok ? { ok: true, error: '', url: r.url || `${scope.web}/issues/${id}`, id: String(r.data && r.data.id) } : r;
    },
    // Tracked time, in seconds: the forge keeps the time, not a note with it.
    worklog: async (scope, id, entry) => write('POST', `/repos/${rp(scope)}/issues/${id}/times`, { time: Math.max(60, Math.round(entry.minutes) * 60) }, `${scope.web}/issues/${id}`),
    transitions: async (scope, id) => {
      const i = await get(`/repos/${rp(scope)}/issues/${id}`);
      return String(i.state) === 'open' ? [{ id: 'close', name: 'Close' }] : [{ id: 'reopen', name: 'Reopen' }];
    },
    transition: async (scope, id, to) => {
      if (to !== 'close' && to !== 'reopen') return { ok: false, error: `not a move: ${to}` };
      return write('PATCH', `/repos/${rp(scope)}/issues/${id}`, { state: to === 'close' ? 'closed' : 'open' }, `${scope.web}/issues/${id}`);
    },
    labels: async (scope, id, add, remove) => {
      const url = `${scope.web}/issues/${id}`;
      let known: any[] = [];
      try { known = (await get(`/repos/${rp(scope)}/labels?limit=50`)) || []; } catch (e) { return { ok: false, error: String((e as Error).message || e) }; }
      const idOf = (name: string) => { const l = known.find((x) => String(x.name) === name); return l ? Number(l.id) : 0; };
      const missing = [...add, ...remove].filter((n) => !idOf(n));
      if (missing.length) return { ok: false, error: `not a label of ${scope.id}: ${missing.join(', ')}` };
      if (add.length) { const r = await write('POST', `/repos/${rp(scope)}/issues/${id}/labels`, { labels: add.map(idOf) }, url); if (!r.ok) return r; }
      for (const n of remove) { const r = await write('DELETE', `/repos/${rp(scope)}/issues/${id}/labels/${idOf(n)}`, undefined, url); if (!r.ok) return r; }
      return { ok: true, error: '', url };
    },
    assign: async (scope, id, whom) => {
      let login = '';
      try {
        if (whom === 'me') login = await me();
        else if (LOGIN_RE.test(whom)) { const r = await call('GET', `/users/${encodeURIComponent(whom)}`); login = r.status === 200 ? String(r.data && r.data.login || '') : ''; }
      } catch (e) { return { ok: false, error: String((e as Error).message || e) }; }
      if (!login) return { ok: false, error: `no user ${whom} on ${host()}` };
      return write('PATCH', `/repos/${rp(scope)}/issues/${id}`, { assignees: [login] }, `${scope.web}/issues/${id}`);
    },
    create: async (scope, item) => {
      const r = await write('POST', `/repos/${rp(scope)}/issues`, { title: item.title, body: item.body });
      return r.ok ? { ok: true, error: '', url: r.url, id: String(r.data && r.data.number) } : r;
    },

    /**
     * Push the run's branch to the scope's own repository (over the instance's address, the token through askpass, hooks
     * off) and open a pull request from it, its title marked WIP: while it is a draft. The remote must be the scope's.
     */
    openRequest: async (scope, r: RequestSpec) => {
      if (!remoteOf(r.dir, scope)) return { ok: false, error: `No remote of ${r.dir} is ${scope.id} on ${host()}: nothing was pushed.` };
      if (!token()) return { ok: false, error: `no token in ${api.settings.file}: nothing was pushed.` };
      const push = await gitWithToken(r.dir, ['push', `${origin()}/${scope.id}.git`, `refs/heads/${r.branch}:refs/heads/${r.branch}`]);
      if (!push.ok) return { ok: false, error: `git push did not go: ${lib.cliError(String(push.stderr || push.stdout || ''))}` };
      const pr = await write('POST', `/repos/${rp(scope)}/pulls`, { head: r.branch, base: r.base, title: r.draft ? `WIP: ${r.title}` : r.title, body: r.body });
      return pr.ok ? { ok: true, error: '', url: pr.url, id: String(pr.data && pr.data.number) } : pr;
    },
  };
  return provider;
}

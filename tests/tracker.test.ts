import test, { after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { register } from '../src/index';
import { giteaProvider, instanceOf, productOf } from '../src/lib/provider';
import { currentMilestone, giteaTracker, itemOf, rosterAssociation } from '../src/lib/tracker';

// Recorded from a Gitea 1.27.3 site the plugin's builder made (--install --add-users --sample-content), read as the
// account member, its address made anonymous (https://forge.test). owner owns the private repository
// owner/webship-site; member may write, reader may only read; stranger has no access. Forgejo 17 answers the same.
const PKG = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
const FIX = path.join(PKG, 'tests', 'fixtures', 'tracker');
const fixture = (f: string) => fs.readFileSync(path.join(FIX, f), 'utf8');
const made: string[] = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const TOKEN = '0123456789abcdef'.repeat(2) + '01234567';
const SETTINGS = { url: 'https://forge.test', token: TOKEN, product: 'gitea', tracker: { default_scope: 'owner/webship-site' } };
const SCOPE = { id: 'owner/webship-site', name: 'owner/webship-site', web: 'https://forge.test/owner/webship-site' };

/** A workspace folder with a project whose origin is `remote`. */
function tree(remote = 'https://forge.test/owner/webship-site.git') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitea-tracker-'));
  made.push(root);
  const p = path.join(root, 'dev', 'site1');
  fs.mkdirSync(path.join(p, '.git'), { recursive: true });
  fs.writeFileSync(path.join(p, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(p, '.git', 'config'), `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${remote}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`);
  return root;
}

/** What a curl call asked: its method, the URL, the headers file and the body file's JSON. Read while they exist. */
function readCurl(args: string[]) {
  const at = (flag: string) => args.indexOf(flag);
  const headerFile = args.find((a) => a.startsWith('@') && a.endsWith('/headers'));
  const bodyFile = args.find((a) => a.startsWith('@') && a.endsWith('/body.json'));
  const url = args[args.length - 1];
  return {
    method: at('-X') >= 0 ? args[at('-X') + 1] : 'GET',
    url,
    query: decodeURIComponent(url),
    headers: headerFile ? fs.readFileSync(headerFile.slice(1), 'utf8') : '',
    body: bodyFile ? JSON.parse(fs.readFileSync(bodyFile.slice(1), 'utf8')) : undefined,
  };
}

/** The api, with a `run` that answers curl from the recorded fixtures (and `answers` first), remembering each call. */
function fakeApi(root: string, settings: Record<string, unknown> = SETTINGS, answers: (c: ReturnType<typeof readCurl>) => any = () => null) {
  const calls: any = { rowMenus: {}, actions: {}, fragments: [], ran: [] as any[], context: [] as any[], chips: [] as any[], forges: {} as any };
  const ok = (body: unknown, status = 200) => ({ ok: true, code: 0, stdout: `${typeof body === 'string' ? body : JSON.stringify(body)}\n${status}`, stderr: '' });
  const api: any = {
    name: 'gitea', config: {}, settings: { file: 'plugin.gitea.settings.yml', read: () => settings, set() {}, setList() {} },
    lib: {
      esc: (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)),
      ROOT: root, workspaceDir: (ws: string) => path.join(root, ws), listProjects: (dir: string) => fs.readdirSync(dir), isValidWorkspace: () => true,
      screenAction: () => {}, iconHtml: () => '', NAME_RE: /^[a-zA-Z0-9_-]+$/, screensCached: () => [], listScreens: async () => [],
      cliError: (t: string) => String(t).trim().split('\n').slice(-3).join(' '),
      run: async (cmd: string, args: string[], _cwd?: string, opts?: any) => {
        if (cmd !== 'curl') { calls.ran.push({ cmd, args, env: opts && opts.env }); return { ok: true, code: 0, stdout: '', stderr: '' }; }
        const c = readCurl(args);
        calls.ran.push({ cmd, args, ...c });
        const a = answers(c);
        if (a) return a;
        const u = c.url.replace('https://forge.test/api/v1', '');
        const R = '/repos/owner/webship-site';
        if (u === R) return ok(fixture('repo.json'));
        if (u.startsWith(`${R}/issues?`) && c.method === 'GET') return ok(fixture('issues-open.json'));
        if (u === `${R}/issues` && c.method === 'POST') return ok({ number: 4, title: c.body.title, html_url: 'https://forge.test/owner/webship-site/issues/4' }, 201);
        if (u.startsWith(`${R}/milestones?`)) return ok(fixture('milestones.json'));
        if (u === `${R}/assignees`) return ok(fixture('assignees.json'));
        if (u.startsWith(`${R}/collaborators?`)) return ok(fixture('collaborators.json'));
        if (u.startsWith(`${R}/labels?`)) return ok([{ id: 1, name: 'bug' }, { id: 2, name: 'documentation' }]);
        const comments = u.match(/^\/repos\/owner\/webship-site\/issues\/(\d+)\/comments$/);
        if (comments && c.method === 'GET') return fs.existsSync(path.join(FIX, `comments-${comments[1]}.json`)) ? ok(fixture(`comments-${comments[1]}.json`)) : ok([]);
        if (comments && c.method === 'POST') return ok({ id: 9, body: c.body.body, html_url: `https://forge.test/owner/webship-site/issues/${comments[1]}#issuecomment-9` }, 201);
        const issue = u.match(/^\/repos\/owner\/webship-site\/issues\/(\d+)$/);
        if (issue && c.method === 'GET') return fs.existsSync(path.join(FIX, `issue-${issue[1]}.json`)) ? ok(fixture(`issue-${issue[1]}.json`)) : ok({ message: 'issue does not exist' }, 404);
        if (issue && c.method === 'PATCH') return ok({ number: Number(issue[1]), html_url: `https://forge.test/owner/webship-site/issues/${issue[1]}` }, 201);
        if (/^\/repos\/owner\/webship-site\/issues\/\d+\/times$/.test(u)) return ok({ id: 3, time: c.body.time }, 200);
        if (/^\/repos\/owner\/webship-site\/issues\/\d+\/labels/.test(u)) return ok([], 200);
        if (u === `${R}/pulls` && c.method === 'POST') return ok({ number: 5, html_url: 'https://forge.test/owner/webship-site/pulls/5' }, 201);
        if (u === '/user') return ok(fixture('user.json'));
        if (u === '/users/owner') return ok({ id: 3, login: 'owner' });
        return ok({ message: `no fixture for ${c.method} ${u}` }, 404);
      },
    },
    addRowMenu: (slot: string, spec: any, fn: any) => { calls.rowMenus[slot] = { spec, fn }; },
    addProjectChip: (fn: any) => calls.chips.push(fn), addAction: (name: string, fn: any) => { calls.actions[name] = fn; }, addFolderSetup() {}, addCss() {},
    addFragment: (fn: any) => calls.fragments.push(fn), addProjectBadge() {}, addAssistantContext: (fn: any) => calls.context.push(fn), addSettingsOptions() {},
    addForge: (host: string, spec: any) => { calls.forges[host] = spec; },
  };
  return { api, calls };
}

test('standing comes from the repository\'s own lists: its owner, who may be assigned, a collaborator who reads, anyone else', () => {
  const roster = { writers: ['member', 'owner'], collaborators: ['member', 'reader'] };
  assert.deepStrictEqual(['owner', 'member', 'Reader', 'stranger', ''].map((l) => rosterAssociation(l, 'owner', roster)), ['owner', 'member', 'contributor', 'outside', 'unknown']);
  assert.strictEqual(rosterAssociation('stranger', 'owner', { writers: ['owner'], collaborators: [] }), 'outside', 'a public repository: who reads it is no collaborator');
  assert.strictEqual(productOf('Forgejo'), 'forgejo');
  assert.strictEqual(productOf(''), 'gitea');
  assert.strictEqual(instanceOf('CHANGE_ME'), null);
  assert.strictEqual(instanceOf('ftp://forge.test'), null);
  assert.strictEqual(instanceOf('http://127.0.0.1:39787')!.host, '127.0.0.1:39787');
});

test('the issues read as items with their milestone; the current milestone is the open one due first from today', () => {
  const items = JSON.parse(fixture('issues-open.json')).map(itemOf);
  assert.deepStrictEqual(items.map((i: any) => [i.id, i.state, i.stateClass]), [['3', 'open', 'open'], ['2', 'open', 'open'], ['1', 'open', 'open']]);
  const greeting = items.find((i: any) => i.id === '1');
  assert.deepStrictEqual([greeting.url, greeting.iteration, greeting.assignees], ['https://forge.test/owner/webship-site/issues/1', 'milestone Sprint 1', ['member']]);
  assert.strictEqual(itemOf({ number: 7, state: 'closed' }).stateClass, 'done');
  const milestones = JSON.parse(fixture('milestones.json'));
  assert.strictEqual(currentMilestone(milestones, new Date('2026-11-25T12:00:00Z')), 'Sprint 1');
  assert.strictEqual(currentMilestone(milestones, new Date('2027-01-30T12:00:00Z')), '', 'past its date, no milestone is current');
  assert.strictEqual(currentMilestone([{ title: 'Later', state: 'open' }, { title: 'Done', state: 'closed', due_on: '2026-12-01T00:00:00Z' }]), 'Later', 'an open milestone with no date');
});

test('the token goes in a header file, never on curl\'s command line; the views ask the forge what they mean', async () => {
  const root = tree();
  const { api, calls } = fakeApi(root);
  const t = giteaTracker(api, giteaProvider(api));
  assert.strictEqual(t.ready(), '');
  assert.strictEqual((await t.list(SCOPE, { view: 'open', limit: 30 })).length, 3);
  const first = calls.ran[0];
  assert.strictEqual(first.headers, `Authorization: token ${TOKEN}\n`);
  assert.match(first.url, /^https:\/\/forge\.test\/api\/v1\/repos\/owner\/webship-site\/issues\?state=open&type=issues&limit=30&page=1$/);
  await t.list(SCOPE, { view: 'mine', limit: 5 });
  assert.match(calls.ran[calls.ran.length - 1].url, /assigned_by=member/, 'mine: the account of the token');
  await t.list(SCOPE, { view: 'iteration', limit: 5 });
  assert.match(calls.ran[calls.ran.length - 1].url, /milestones=Sprint\+1/, 'a space as +, which the forge reads as a space');
  await t.list(SCOPE, { view: 'assigned', who: 'owner', limit: 5 });
  assert.match(calls.ran[calls.ran.length - 1].url, /assigned_by=owner/);
  assert.deepStrictEqual(await t.list(SCOPE, { view: 'assigned', who: 'a b; rm', limit: 5 }), [], 'not a login: nothing asked');
  await t.list(SCOPE, { view: 'query', text: 'greeting "$(id)"', limit: 5 });
  assert.match(calls.ran[calls.ran.length - 1].query, /q=greeting\+"\$\(id\)"/);
  for (const c of calls.ran) assert.ok(!c.args.join(' ').includes(TOKEN), 'no token on a command line');
});

test('one issue: its comments, and each author\'s standing from the repository\'s lists, asked once', async () => {
  const { api, calls } = fakeApi(tree());
  const t = giteaTracker(api, giteaProvider(api));
  const greeting = await t.get(SCOPE, '1');
  assert.deepStrictEqual(greeting.author, { name: 'owner', association: 'owner' });
  assert.match(greeting.body, /greeting\.sh Ada/);
  assert.deepStrictEqual(greeting.comments.map((c) => [c.author.name, c.author.association, c.body]), [['owner', 'owner', 'The script is in the repository: `greeting.sh`.']]);
  assert.strictEqual(greeting.lastEditor, undefined, 'only its author or a writer may edit a description: no one outside is asked for');
  const outside = await t.get(SCOPE, '3');
  assert.deepStrictEqual(outside.author, { name: 'reader', association: 'contributor' }, 'a reader is outside for the base');
  assert.strictEqual(calls.ran.filter((c: any) => /\/assignees$/.test(c.url)).length, 1, 'the writers are asked once for the repository');
  assert.strictEqual(calls.ran.filter((c: any) => /\/collaborators\?/.test(c.url)).length, 1);
  assert.ok(!calls.ran.some((c: any) => /\/permission$/.test(c.url)), 'another user\'s permission is for administrators only: never asked');
  const { api: a2 } = fakeApi(tree(), SETTINGS, (c) => (/\/issues\/1$/.test(c.url) && c.method === 'GET'
    ? { ok: true, code: 0, stdout: `${JSON.stringify({ ...JSON.parse(fixture('issue-1.json')), pull_request: { merged: false } })}\n200`, stderr: '' } : null));
  await assert.rejects(giteaTracker(a2, giteaProvider(a2)).get(SCOPE, '1'), /is a pull request, not an issue/);
});

test('writes: a comment, tracked time, close and reopen, labels, an assignee and a new issue, each in a body file', async () => {
  const { api, calls } = fakeApi(tree());
  const t = giteaTracker(api, giteaProvider(api));
  const note = await t.comment!(SCOPE, '2', 'Done on a branch `$(id)`');
  assert.deepStrictEqual([note.ok, note.url, note.id], [true, 'https://forge.test/owner/webship-site/issues/2#issuecomment-9', '9']);
  const post = calls.ran.find((c: any) => c.method === 'POST');
  assert.deepStrictEqual(post.body, { body: 'Done on a branch `$(id)`' });
  assert.ok(!post.args.join(' ').includes('$(id)'), 'the body is in a file');
  assert.ok((await t.worklog!(SCOPE, '2', { minutes: 25, text: 'Fixed the typo' })).ok);
  assert.deepStrictEqual(calls.ran.find((c: any) => /\/times$/.test(c.url)).body, { time: 1500 });
  assert.deepStrictEqual(await t.transitions!(SCOPE, '2'), [{ id: 'close', name: 'Close' }]);
  assert.ok((await t.transition!(SCOPE, '2', 'close')).ok);
  assert.deepStrictEqual(calls.ran.filter((c: any) => c.method === 'PATCH').pop().body, { state: 'closed' });
  assert.strictEqual((await t.transition!(SCOPE, '2', 'closed; rm')).ok, false);
  assert.ok((await t.labels!(SCOPE, '2', ['bug'], ['documentation'])).ok);
  assert.deepStrictEqual(calls.ran.find((c: any) => /\/issues\/2\/labels$/.test(c.url) && c.method === 'POST').body, { labels: [1] });
  assert.ok(calls.ran.some((c: any) => /\/issues\/2\/labels\/2$/.test(c.url) && c.method === 'DELETE'));
  assert.match((await t.labels!(SCOPE, '2', ['wontfix'], [])).error, /not a label of owner\/webship-site: wontfix/);
  assert.ok((await t.assign!(SCOPE, '2', 'me')).ok);
  assert.deepStrictEqual(calls.ran.filter((c: any) => c.method === 'PATCH').pop().body, { assignees: ['member'] });
  assert.ok((await t.assign!(SCOPE, '2', 'owner')).ok);
  assert.deepStrictEqual(calls.ran.filter((c: any) => c.method === 'PATCH').pop().body, { assignees: ['owner'] });
  const nobody = await t.assign!(SCOPE, '2', 'nobody');
  assert.deepStrictEqual([nobody.ok, /no user nobody on forge\.test/.test(nobody.error)], [false, true]);
  const created = await t.create!(SCOPE, { title: 'A new one', body: 'Its text' });
  assert.deepStrictEqual([created.ok, created.id, created.url], [true, '4', 'https://forge.test/owner/webship-site/issues/4']);
});

test('a pull request: the branch is pushed with the token through askpass, then opened as WIP: while a draft', async () => {
  const root = tree();
  const { api, calls } = fakeApi(root);
  const t = giteaTracker(api, giteaProvider(api));
  const dir = path.join(root, 'dev', 'site1');
  const r = await t.openRequest!(SCOPE, { dir, branch: 'gitea-2-usage', base: 'main', title: 'Spell greeting', body: 'Closes #2', draft: true } as any);
  assert.deepStrictEqual([r.ok, r.url, r.id], [true, 'https://forge.test/owner/webship-site/pulls/5', '5']);
  const push = calls.ran.find((c: any) => c.cmd === 'git');
  assert.ok(push.args.includes('push') && push.args.includes('https://forge.test/owner/webship-site.git'));
  assert.ok(!push.args.join(' ').includes(TOKEN), 'the token is in git\'s environment, read by askpass');
  assert.strictEqual(push.env.WS_GITEA_TOKEN, TOKEN);
  assert.strictEqual(push.env.WS_GITEA_LOGIN, 'member');
  assert.deepStrictEqual(calls.ran.find((c: any) => /\/pulls$/.test(c.url)).body, { head: 'gitea-2-usage', base: 'main', title: 'WIP: Spell greeting', body: 'Closes #2' });
  const elsewhere = tree('https://github.com/webship/webship-site.git');
  const { api: a2 } = fakeApi(elsewhere);
  const no = await giteaTracker(a2, giteaProvider(a2)).openRequest!(SCOPE, { dir: path.join(elsewhere, 'dev', 'site1'), branch: 'b', base: 'main', title: 't', body: '', draft: true } as any);
  assert.deepStrictEqual([no.ok, /nothing was pushed/.test(no.error)], [false, true]);
});

test('a refused write says what the forge answered; an unset address or token says what is missing', async () => {
  const { api } = fakeApi(tree(), SETTINGS, (c) => (c.method === 'POST' ? { ok: true, code: 0, stdout: '{"message":"issue is locked"}\n403', stderr: '' } : null));
  const r = await giteaTracker(api, giteaProvider(api)).comment!(SCOPE, '2', 'x');
  assert.deepStrictEqual(r, { ok: false, error: 'Gitea answered 403: issue is locked' });
  const fj = fakeApi(tree(), { ...SETTINGS, product: 'forgejo' }, (c) => (c.method === 'POST' ? { ok: true, code: 0, stdout: '{"message":"no"}\n422', stderr: '' } : null)).api;
  assert.strictEqual((await giteaTracker(fj, giteaProvider(fj)).comment!(SCOPE, '2', 'x')).error, 'Forgejo answered 422: no');
  const noUrl = fakeApi(tree(), { token: TOKEN }).api;
  assert.match(giteaTracker(noUrl, giteaProvider(noUrl)).ready(), /no address in plugin\.gitea\.settings\.yml/);
  const noToken = fakeApi(tree(), { url: 'https://forge.test', token: 'CHANGE_ME' }).api;
  assert.match(giteaTracker(noToken, giteaProvider(noToken)).ready(), /no token/);
  const t = giteaTracker(api, giteaProvider(api));
  assert.deepStrictEqual(t.parseScope('owner/webship-site'), SCOPE);
  assert.deepStrictEqual(t.parseScope('owner/webship-site.git'), SCOPE);
  for (const bad of ['', 'webship-site', 'a/b/c', '../x/y', 'owner/web site']) assert.strictEqual(t.parseScope(bad), null, bad);
  assert.strictEqual(t.secret!(), TOKEN, 'the token is known to the base, which refuses it in what is posted');
  assert.strictEqual((t as any).tokenShapes, undefined, 'a forge token is 40 hex digits, a commit\'s shape too: no shape of its own');
});

test('the forge: a remote on your own instance, with its port, finds the row menu, the chip and the credential', async () => {
  const { api } = fakeApi(tree());
  const f = giteaProvider(api);
  assert.deepStrictEqual(f.repoOf('https://forge.test/owner/webship-site.git', 'origin'), { path: 'owner/webship-site', web: 'https://forge.test/owner/webship-site', remote: 'origin' });
  assert.deepStrictEqual(f.repoOf('git@forge.test:owner/webship-site.git', 'up')!.path, 'owner/webship-site');
  assert.strictEqual(f.repoOf('https://github.com/owner/webship-site.git', 'origin'), null);
  assert.strictEqual(f.repoOf('https://forge.test/owner/webship-site/sub.git', 'origin'), null, 'owner/name only');
  const docker = fakeApi(tree(), { url: 'http://127.0.0.1:39787', token: TOKEN }).api;
  const fd = giteaProvider(docker);
  assert.strictEqual(fd.host(), '127.0.0.1:39787');
  assert.deepStrictEqual(fd.repoOf('http://127.0.0.1:39787/owner/webship-site.git', 'origin'), { path: 'owner/webship-site', web: 'http://127.0.0.1:39787/owner/webship-site', remote: 'origin' });
  assert.strictEqual(fd.repoOf('http://127.0.0.1:4171/owner/webship-site.git', 'origin'), null, 'another port is another site');
  const none = giteaProvider(fakeApi(tree(), {}).api);
  assert.strictEqual(none.repoOf('/home/me/webship-site', 'origin'), null, 'no address: no remote is the forge\'s');
  assert.strictEqual(none.env(), null);
  assert.deepStrictEqual([f.label, f.title], ['GITEA', 'Gitea']);
  const fj = giteaProvider(fakeApi(tree(), { ...SETTINGS, product: 'forgejo' }).api);
  assert.deepStrictEqual([fj.label, fj.title], ['FORGEJO', 'Forgejo']);
  assert.strictEqual(f.urls({ path: 'owner/webship-site', web: 'https://forge.test/owner/webship-site', remote: 'origin' }).newPull('fix/usage'), 'https://forge.test/owner/webship-site/compare/fix%2Fusage');
  assert.strictEqual(f.cloneUrl('owner/webship-site'), 'https://forge.test/owner/webship-site.git');
  assert.ok(f.clone.pattern.test('owner/webship-site') && !f.clone.pattern.test('owner'));
  const env = f.env()!;
  assert.deepStrictEqual([env.GITEA_TOKEN, env.GITEA_SERVER_URL], [TOKEN, 'https://forge.test']);
});

test('register(): the forge\'s menu on a row whose remote is on the instance, with the issues in it; nothing elsewhere', () => {
  const root = tree();
  const ctx: any = { key: 'dev', project: 'site1', dir: path.join(root, 'dev'), meta: {}, allowed: new Set(['code']), vals: () => '' };
  const { api, calls } = fakeApi(root);
  register(api);
  assert.deepStrictEqual(Object.keys(calls.rowMenus), ['gitea']);
  assert.ok(calls.forges['forge.test'], 'the credential for the instance\'s host');
  const menu = calls.rowMenus.gitea.fn(ctx);
  assert.match(menu, /GITEA/);
  assert.match(menu, /owner\/webship-site/);
  assert.match(menu, /Issues — get, analyze, work…/);
  for (const a of ['tracker-work', 'tracker-analyze', 'tracker-comment', 'tracker-worklog', 'tracker-move', 'tracker-assign']) assert.ok(calls.actions[a], a);
  const elsewhere = tree('https://github.com/webship/webship-site.git');
  const { api: a2, calls: c2 } = fakeApi(elsewhere);
  register(a2);
  assert.strictEqual(c2.rowMenus.gitea.fn({ ...ctx, dir: path.join(elsewhere, 'dev') }), null, 'a remote on another forge: no menu');
  const fjRoot = tree();
  const { api: a3, calls: c3 } = fakeApi(fjRoot, { ...SETTINGS, product: 'forgejo' });
  register(a3);
  assert.match(c3.rowMenus.gitea.fn({ ...ctx, dir: path.join(fjRoot, 'dev') }), /FORGEJO/);
  const told = calls.context.map((f: any) => f()).join(' ');
  assert.match(told, /cmd-gitea-project\.sh <name> --install --add-users --sample-content/);
  assert.match(told, /--product forgejo/);
});

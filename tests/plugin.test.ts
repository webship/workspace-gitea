import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

import { assistantContext, PLATFORM, COMMANDS, AGENTS, SKILLS, AI_COMMANDS, PROMPTS } from '../src/index';

// Compiled, these tests run from dist/tests, so the package root is one folder further up.
const PKG = fs.existsSync(path.join(__dirname, '..', 'package.json')) ? path.join(__dirname, '..') : path.join(__dirname, '..', '..');
const read = (f: string) => fs.readFileSync(path.join(PKG, f), 'utf8');
const pkg = JSON.parse(read('package.json'));
const manifest = pkg.workspacePlugin;
const FUN = read('scripts/functions/fun-gitea.sh');

test('the manifest names the platform, says Forgejo is covered, and every file it names ships', () => {
  assert.strictEqual(manifest.name, PLATFORM);
  assert.match(manifest.summary, /Gitea and Forgejo/, 'a Forgejo user finds it');
  assert.match(pkg.description, /Gitea and Forgejo/);
  const named = [...manifest.commands.files, ...manifest.scripts.functions, ...manifest.scripts.args, ...manifest.scripts.machine,
    ...manifest.ai.agents, ...manifest.ai.skills, ...manifest.ai.commands, ...manifest.ai.prompts, ...manifest.features, manifest.settingsTemplate, manifest.labels];
  for (const f of named) assert.ok(fs.existsSync(path.join(PKG, f)), `${f} is in the package`);
  for (const f of named) assert.ok(pkg.files.includes(f.split('/')[0]), `${f} is published with the package`);
  assert.deepStrictEqual(manifest.commands.files.map((f: string) => path.basename(f)), COMMANDS);
  assert.deepStrictEqual(manifest.ai.agents.map((f: string) => path.basename(f, '.md')), AGENTS);
  assert.deepStrictEqual(manifest.ai.skills.map((f: string) => path.basename(f)), SKILLS);
  assert.deepStrictEqual(manifest.ai.commands.map((f: string) => path.basename(f, '.md')), AI_COMMANDS);
  assert.deepStrictEqual(manifest.ai.prompts.map((f: string) => path.basename(f, '.md')), PROMPTS);
  assert.deepStrictEqual(manifest.commands.types, ['sites'], 'the commands go to sites folders only');
  // The machine files land side by side in core/scripts/plugins/gitea/: no two may share a name.
  const names = manifest.scripts.machine.map((f: string) => path.basename(f));
  assert.strictEqual(new Set(names).size, names.length, 'the machine files have names of their own');
  assert.strictEqual(manifest.featuresSite, 'cmd-gitea-project.sh ci-gitea --install --add-users --sample-content --runtime docker', 'CI builds a site on Docker Compose for the features');
  assert.deepStrictEqual(pkg.dependencies, { '@webship.co/workspace-forge': '^1.0.11', '@webship.co/workspace-tracker': '^1.0.2' });
});

test('every command finds the workspace by itself, names its folder, and sources its args from where the installer puts them', () => {
  for (const f of manifest.commands.files) {
    const src = read(f);
    assert.match(src, /^#!\/usr\/bin\/env bash/, `${f} is a bash script`);
    assert.match(src, /WORKSPACE_SCRIPTS="\$\{WORKSPACE_SCRIPTS:-\$\(cd "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)\/\.\.\/core\/scripts" && pwd\)\}"/, `${f} locates the tooling from its own path`);
    assert.match(src, /workspace\.__WORKSPACE__\.settings\.yml/, `${f} loads the settings of the folder it is installed into`);
    assert.match(src, /source \$\{WORKSPACE_SCRIPTS\}\/plugins\/gitea\/args\/arg-[a-z-]+\.sh \|\| exit 1 ;/, `${f} reads its arguments from the plugin's args`);
    const last = src.trim().split('\n').pop() as string;
    assert.match(FUN, new RegExp(`^function ${last.replace(/ ;$/, '')}\\(\\)`, 'm'), `${f} ends by calling a function the plugin defines`);
  }
  assert.match(read('commands/cmd-gitea-project.sh'), /^# workspace-name: Gitea or Forgejo \(self-hosted Git forge\)$/m, 'the builder carries the name the Build list shows');
  assert.doesNotMatch(read('commands/cmd-tools-gitea-cli.sh'), /^# workspace-name:/m, 'a tool is not a builder');
  assert.match(read('scripts/args/arg-gitea.sh'), /'--product',[\s\S]*?choices=\['gitea', 'forgejo'\]/, 'either product');
});

test('every shell script parses; the site\'s script talks to the API with no secret on a command line', () => {
  for (const f of [...manifest.commands.files, ...manifest.scripts.functions, ...manifest.scripts.args, 'scripts/gitea-serve.sh']) {
    const r = spawnSync('bash', ['-n', path.join(PKG, f)], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `${f}: ${r.stderr}`);
  }
  const py = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', path.join(PKG, 'scripts/gitea-site.py')], { encoding: 'utf8' });
  assert.strictEqual(py.status, 0, py.stderr);
  const site = read('scripts/gitea-site.py');
  for (const verb of ['accounts', 'content', 'tidy', 'list', 'version']) assert.match(site, new RegExp(`verb == '${verb}'`), `the site script answers ${verb}`);
  assert.match(site, /'private': True/, 'the sample repository is private: a stranger is refused it');
  assert.match(site, /req\.add_header\('Sudo', sudo\)/, 'the sample content is made as its authors, not changed after');
  assert.match(site, /'must_change_password': False/, 'the default accounts log in at once');
  assert.doesNotMatch(site, /sys\.argv\[[3-9]\]/, 'nothing but the folder and the verbs on its command line');
});

test('the runtimes: DDEV, Docker Compose, Podman and Kubernetes; another is refused before anything is changed', () => {
  assert.match(read('scripts/args/arg-gitea.sh'), /choices=\['ddev', 'docker', 'podman', 'kubernetes'\]/);
  const build = FUN.slice(FUN.indexOf('function gitea_build()'));
  const guard = build.indexOf('case "${runtime}" in');
  assert.ok(guard > 0 && guard < build.indexOf('drop_database') && guard < build.indexOf('ddev config'), 'the runtime is asked first');
  assert.match(build, /case "\$\{runtime\}" in\n\s+ddev\|docker\|podman\|kubernetes\) ;;/, 'the four runtimes the plugin was proven on');
  assert.ok(build.includes('builds on DDEV, Docker Compose, Podman and Kubernetes for now (--runtime ddev, docker, podman or kubernetes), not on ${runtime}: that runtime is not proven for it yet. Nothing was changed.'));
  assert.ok(build.indexOf('gitea_write_env') > build.indexOf('gitea_write_config'), 'the address is known (the port on Docker Compose) before the values are written');
  assert.ok(build.indexOf('gitea_site_admin') > build.indexOf('gitea_wait'), 'the site\'s own administrator once the forge answers');
  const write = FUN.slice(FUN.indexOf('function gitea_write_config()'), FUN.indexOf('function gitea_write_env()'));
  assert.match(write, /rt_claim gitea && rt_stack image "\$\{image\}"/, 'the product\'s image, pinned, is the web container\'s');
  assert.match(write, /rt_serve 3000 "bash \$\{GITEA_FILES\}\/gitea-serve\.sh"/);
  const env = FUN.slice(FUN.indexOf('function gitea_write_env()'), FUN.indexOf('function gitea_exec()'));
  assert.match(env, /umask 077/, 'the site\'s own values are readable by their owner only');
  assert.match(env, /\[ "\$\{product\}" = 'forgejo' \] && prefix='FORGEJO'/, 'Forgejo reads FORGEJO__ values, Gitea GITEA__');
  assert.match(FUN, /forgejo\) echo "codeberg\.org\/forgejo\/forgejo:\$2" ;;/);
  assert.match(FUN, /\*\) echo "docker\.io\/gitea\/gitea:\$2" ;;/, 'with its registry: Podman resolves no short name without asking');
  // The tool starts a project of another runtime only when the forge does not answer: on Podman a start makes every
  // container of the project again (webship/workspace#906).
  const tool = FUN.slice(FUN.indexOf('function gitea_cli_tool()'));
  assert.match(tool, /\[ "\$\(gitea_probe\)" = '200' \] \|\| ddev start < \/dev\/null > \/dev\/null 2>&1 \|\| ddev start -y/, 'a forge that answers is left as it is');
  assert.match(tool, /ddev describe -j 2>\/dev\/null \| grep -q '"status":"running"' \|\| ddev start -y/, 'DDEV keeps its own check');
  const serve = read('scripts/gitea-serve.sh');
  assert.match(serve, /RUN_USER = \$\(id -un\)/, 'on Docker Compose the forge runs as the host user');
  assert.match(serve, /exec gitea web --config "\$\{ini\}"/);
});

test('the service on DDEV: the product\'s image takes the project\'s address, waits for the project\'s database, keeps no secret', () => {
  const compose = read('scripts/docker-compose.gitea.yaml');
  assert.match(compose, /image: "\$\{GITEA_IMAGE:-gitea\/gitea:1\.27\.3\}"/);
  assert.match(compose, /VIRTUAL_HOST: \$\{DDEV_HOSTNAME\}/);
  assert.match(compose, /HTTP_EXPOSE: "80:3000"/);
  assert.match(compose, /HTTPS_EXPOSE=8457:80,8026:8025/, 'the web container moves, its mail catcher stays at :8026');
  assert.match(compose, /depends_on:\n\s+db:\n\s+condition: service_healthy/, 'the forge starts once the new database answers');
  assert.match(compose, /env_file:\n\s+- \$\{DDEV_APPROOT\}\/gitea\/env/, 'the site\'s own values from its file');
  assert.match(compose, /name: ddev-\$\{DDEV_SITENAME\}-gitea-data/, 'the data volume is the project\'s, removed with it');
  assert.doesNotMatch(compose, /SECRET_KEY|INTERNAL_TOKEN|PASSWD/, 'no secret in the compose file');
});

test('the functions carry the names the core\'s tools look for, and run the forge\'s tools in its container as its user', () => {
  for (const fn of ['set_gitea_users', 'add_gitea_users', 'cancel_gitea_users', 'testing_configure_gitea', 'gitea_build', 'gitea_cli_tool', 'gitea_connect']) {
    assert.match(FUN, new RegExp(`^function ${fn}\\(\\) \\{`, 'm'), `${fn} is defined`);
  }
  assert.match(FUN, /ddev exec -s gitea "su-exec git bash -c/, 'on DDEV in the forge\'s container, as its git user');
  assert.match(FUN, /--random-password --must-change-password=false/, 'the site\'s administrator gets a password the forge makes, never on a command line');
  assert.match(FUN, /users=\(owner member reader stranger\);/);
  assert.match(FUN, /user_owner_role='owner' ;\n\s+user_member_role='write' ;\n\s+user_reader_role='read' ;\n\s+user_stranger_role='' ;/);
  assert.doesNotMatch(FUN, /ddev stop -y/, 'ddev stop takes no -y');
  const connect = FUN.slice(FUN.indexOf('function gitea_connect()'), FUN.indexOf('function gitea_cli_tool()'));
  assert.match(connect, /generate-access-token --username \$\{login\} --token-name webship-workspace-\$\(date \+%s\) --scopes write:issue,write:repository,read:user --raw/);
  assert.match(connect, /GITEA_NEW_TOKEN="\$\{token\}" python3/, 'the token reaches the settings writer in its environment only');
  assert.match(connect, /0o600/, 'the settings file stays readable by its owner only');
  assert.doesNotMatch(connect, /echo[^\n]*\$\{token\}/, 'the token is never printed');
});

test('the assistant is told how to build either product, test and connect a site', () => {
  const told = assistantContext();
  for (const c of COMMANDS) assert.ok(told.includes(c), `the assistant is told about ${c}`);
  for (const a of AGENTS) assert.ok(told.includes(a), `the assistant is told about ${a}`);
  assert.match(told, /--runtime docker/);
  assert.match(told, /--product forgejo/);
  assert.match(told, /--connect <login>/);
});

test('the docs say container-based, say Forgejo is covered, name only what ships, and carry no personal value', () => {
  const docs = ['README.md', ...manifest.ai.agents, 'scripts/functions/fun-gitea.sh', 'config/plugin.gitea.settings.yml'];
  for (const f of docs) {
    const src = read(f);
    assert.doesNotMatch(src, /DDEV-only/i, `${f}: the workspace is container-based, DDEV by default`);
    assert.doesNotMatch(src, /\/home\/(?!YOUR_USER)[a-z]/, `${f} carries no personal path`);
    assert.doesNotMatch(src, /redmine|openproject/i, `${f} names no other platform's leftovers`);
    const mails = src.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[a-z]{2,}/g) || [];
    for (const m of mails) assert.match(m, /@example\.(com|org|invalid)$/, `${f}: ${m} is not an example address`);
  }
  const readme = read('README.md');
  assert.match(readme.split('\n').slice(0, 6).join('\n'), /Forgejo/, 'the README says Forgejo at its top');
  for (const c of COMMANDS) assert.ok(readme.includes(c), `the README lists ${c}`);
  const settings = read('config/plugin.gitea.settings.yml');
  const keys = [...settings.matchAll(/^ {0,2}([a-z_]+):/gm)].map((m) => m[1]).filter((k) => k !== 'tracker');
  assert.ok(keys.length >= 15);
  for (const k of keys) assert.ok(readme.includes(`\`${k}\``), `the README describes the setting ${k}`);
});

test('the testing setup writes the accounts and the sample content in the project, and says which part did not work', () => {
  const testing = FUN.slice(FUN.indexOf('function testing_configure_gitea()'));
  // add_gitea_users ends in the sites folder: the sample content is asked for in the project again (#11).
  assert.match(FUN, /^function add_gitea_users\(\) \{[\s\S]*?\n  cd \$\{WORKSPACE_ROOT\}\/\$\{doc_name\};\n  return \$\{status\} ;\n\}/m);
  assert.match(testing, /elif ! \( cd "\$\{project_path\}" && add_gitea_users > \/dev\/null 2>&1 \) ; then/, 'the accounts, in the project');
  assert.match(testing, /elif ! \( cd "\$\{project_path\}" && gitea_site content < \/dev\/null > \/dev\/null 2>&1 \) ; then/, 'the sample content, in the project');
  assert.doesNotMatch(testing, /add_gitea_users[^\n]*&& gitea_site content/, 'never after add_gitea_users in one subshell, which ends in the sites folder');
  for (const said of ['does not answer', 'The default accounts could not be written', 'The sample content could not be written']) assert.ok(testing.includes(said), said);
});

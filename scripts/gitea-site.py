#!/usr/bin/env python3
"""The site of a Gitea or Forgejo project of the Webship Workspace, through the forge's own REST API.

Run by the Gitea builder and its tool (fun-gitea.sh) on the machine that runs them, never with a secret on a command
line: the site's address and its administrator's password come from the site's own values (gitea/env, which only
you can read), and the accounts travel on the input, as the base64 of a JSON list.

    python3 gitea-site.py <project folder> <verb>...

  accounts   make the accounts of the input, or give them back their names, passwords and access; the repository's
             owner makes owner/webship-site, private, and the others are its collaborators with write or read
             access; a row with action "lock" is kept from logging in
  content    the sample content, where it is missing: greeting.sh, the milestone Sprint 1, the label bug, three issues
             and a comment
  tidy       remove the issues a stopped test run left ("Webship test …"), with their comments and time
  list       what the site holds: the accounts, their access, the issues and the milestones
  version    the release the site runs
Works the same on Gitea and Forgejo: Forgejo keeps Gitea's API.
"""

import base64
import datetime
import json
import os
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

REPO_OWNER = 'owner'
REPO_NAME = 'webship-site'
REPO = REPO_OWNER + '/' + REPO_NAME
MILESTONE = 'Sprint 1'
LABEL = {'name': 'bug', 'color': '#ee0701', 'description': 'Something is not working'}
TEST_PREFIX = 'Webship test'

GREETING = '''#!/usr/bin/env bash
# Greets the person named on the command line.
# Usage: greeting.sh <name>
if [ -z "$1" ]; then
  echo "Usage: greting.sh <name>"
  exit 1
fi
echo "Helo, $1!"
'''
README = '''# Webship site

The sample repository of a Gitea or Forgejo site built by the Webship Workspace: a script that greets, its issues and
a milestone. It is test content: the step pack and the tracker are tested on it.
'''

# The sample issues: who opens each, what it says, and what it holds. The reader's issue comes from outside: a reader
# may open an issue and comment, never push.
ISSUES = [
    {'title': 'The greeting script says Helo instead of Hello', 'author': 'owner', 'assignee': 'member',
     'milestone': True, 'label': True,
     'body': 'Run `./greeting.sh Ada`: it prints "Helo, Ada!". It should print "Hello, Ada!".',
     'comment': "The script is in the repository: `greeting.sh`."},
    {'title': 'The usage line spells greeting as greting', 'author': 'member', 'assignee': None, 'milestone': False,
     'label': False,
     'body': 'Run `./greeting.sh` with no name: it prints "Usage: greting.sh <name>". It should say greeting.sh.',
     'comment': None},
    {'title': 'An issue opened by someone outside the project', 'author': 'reader', 'assignee': None, 'milestone': False,
     'label': False,
     'body': 'A reader of the repository opened this issue: the tracker treats it as from outside the project.',
     'comment': None},
]


def fail(message):
    print(message, file=sys.stderr)
    sys.exit(1)


def site_values(folder):
    values = {}
    try:
        with open(os.path.join(folder, 'gitea', 'env')) as f:
            for line in f:
                line = line.rstrip('\n')
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    values[key] = value
    except OSError as e:
        fail('The site\'s own values could not be read (%s): build the site again.' % e)
    return values


def tls_context():
    ctx = ssl.create_default_context()
    # The local certificate authority DDEV uses, when this machine has it, besides the system's own.
    try:
        root = subprocess.run(['mkcert', '-CAROOT'], capture_output=True, text=True, timeout=10).stdout.strip()
        if root and os.path.isfile(os.path.join(root, 'rootCA.pem')):
            ctx.load_verify_locations(os.path.join(root, 'rootCA.pem'))
    except (OSError, subprocess.SubprocessError):
        pass
    return ctx


class Site:
    def __init__(self, folder):
        values = site_values(folder)
        # GITEA_SITE_URL reaches the site another way than its own address (CI: the plain HTTP of the same host).
        self.base = (os.environ.get('GITEA_SITE_URL') or values.get('ROOT_URL', '')).rstrip('/')
        self.admin = values.get('GITEA_SITE_ADMIN', '')
        password = values.get('GITEA_SITE_ADMIN_PASSWORD', '')
        if not self.base or not self.admin or not password:
            fail('The site\'s own values have no address or administrator: build the site again.')
        self.auth = 'Basic ' + base64.b64encode(('%s:%s' % (self.admin, password)).encode()).decode()
        self.ctx = tls_context()

    def call(self, method, path, body=None, sudo=None, ok=(200, 201, 204), query=None):
        url = '%s/api/v1%s' % (self.base, path)
        if query:
            url += '?' + urllib.parse.urlencode(query)
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header('Authorization', self.auth)
        req.add_header('Accept', 'application/json')
        if data is not None:
            req.add_header('Content-Type', 'application/json')
        if sudo:
            req.add_header('Sudo', sudo)
        try:
            with urllib.request.urlopen(req, context=self.ctx, timeout=60) as r:
                raw = r.read()
                return r.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                payload = json.loads(raw) if raw else None
            except ValueError:
                payload = None
            if e.code in ok:
                return e.code, payload
            return e.code, payload
        except urllib.error.URLError as e:
            fail('The site at %s does not answer (%s).' % (self.base, e.reason))

    def must(self, method, path, body=None, sudo=None, query=None, what=''):
        code, payload = self.call(method, path, body, sudo, query=query)
        if code not in (200, 201, 204):
            message = (payload or {}).get('message') if isinstance(payload, dict) else ''
            fail('%s: %s %s answered %s %s' % (what or 'The site', method, path, code, message or ''))
        return payload

    def pages(self, path, query=None, sudo=None):
        out, page = [], 1
        while True:
            q = dict(query or {}, page=page, limit=50)
            items = self.must('GET', path, query=q, sudo=sudo) or []
            out += items
            if len(items) < 50:
                return out
            page += 1


def read_rows():
    raw = sys.stdin.read().strip()
    if not raw:
        return []
    try:
        return json.loads(base64.b64decode(raw).decode())
    except ValueError:
        fail('The accounts on the input are not the base64 of a JSON list.')


def repository(site, create):
    code, repo = site.call('GET', '/repos/%s' % REPO)
    if code == 200:
        return repo
    if not create:
        return None
    return site.must('POST', '/admin/users/%s/repos' % REPO_OWNER, {
        'name': REPO_NAME, 'description': 'The sample repository of a Webship Workspace site', 'private': True,
        'auto_init': True, 'default_branch': 'main', 'readme': 'Default'}, what='The sample repository')


def accounts(site, rows):
    owner_made = False
    for row in rows:
        login = row['login']
        code, user = site.call('GET', '/users/%s' % urllib.parse.quote(login))
        if row.get('action') == 'lock':
            if code == 200:
                site.must('PATCH', '/admin/users/%s' % login, {'login_name': login, 'source_id': 0, 'prohibit_login': True},
                          what='Blocking %s' % login)
                print('%s: kept from logging in' % login)
            continue
        if code != 200:
            site.must('POST', '/admin/users', {
                'username': login, 'email': row['mail'], 'password': row['password'], 'full_name': row['fullname'],
                'login_name': login, 'source_id': 0, 'must_change_password': False, 'send_notify': False,
                'visibility': 'public'}, what='Making %s' % login)
        site.must('PATCH', '/admin/users/%s' % login, {
            'login_name': login, 'source_id': 0, 'email': row['mail'], 'password': row['password'],
            'full_name': row['fullname'], 'must_change_password': False, 'prohibit_login': False, 'active': True,
            'admin': bool(row.get('admin'))}, what='Updating %s' % login)
        print('%s: account ready (%s)%s' % (login, row['mail'], ', an administrator' if row.get('admin') else ''))
        if row.get('role') == 'owner':
            repository(site, True)
            owner_made = True
            print('%s: the owner of %s' % (login, REPO))
    roles = [r for r in rows if r.get('role') in ('write', 'read') and r.get('action') != 'lock']
    if roles:
        if not repository(site, owner_made):
            fail('The repository %s is not there: add the owner first.' % REPO)
        for row in roles:
            site.must('PUT', '/repos/%s/collaborators/%s' % (REPO, row['login']), {'permission': row['role']},
                      what='Giving %s %s access' % (row['login'], row['role']))
            print('%s: a collaborator of %s with %s access' % (row['login'], REPO, row['role']))
    for row in rows:
        if not row.get('role') and not row.get('admin') and row.get('action') != 'lock':
            code, _ = site.call('DELETE', '/repos/%s/collaborators/%s' % (REPO, row['login']))
            print('%s: no access to %s' % (row['login'], REPO))


def content(site):
    if not repository(site, False):
        fail('The repository %s is not there: add the default accounts first (--add-users).' % REPO)
    code, _ = site.call('GET', '/repos/%s/contents/greeting.sh' % REPO)
    if code != 200:
        site.must('POST', '/repos/%s/contents/greeting.sh' % REPO, {
            'content': base64.b64encode(GREETING.encode()).decode(), 'message': 'Add the greeting script',
            'branch': 'main'}, sudo='owner', what='greeting.sh')
    milestones = site.pages('/repos/%s/milestones' % REPO, {'state': 'all'})
    milestone = next((m for m in milestones if m['title'] == MILESTONE), None)
    if not milestone:
        due = (datetime.date.today() + datetime.timedelta(days=11)).isoformat() + 'T23:59:59Z'
        milestone = site.must('POST', '/repos/%s/milestones' % REPO, {
            'title': MILESTONE, 'description': 'The current iteration of the sample repository.', 'due_on': due},
            sudo='owner', what='The milestone')
    labels = site.pages('/repos/%s/labels' % REPO)
    label = next((l for l in labels if l['name'] == LABEL['name']), None)
    if not label:
        label = site.must('POST', '/repos/%s/labels' % REPO, LABEL, sudo='owner', what='The label')
    issues = site.pages('/repos/%s/issues' % REPO, {'state': 'all', 'type': 'issues'})
    for spec in ISSUES:
        if any(i['title'] == spec['title'] for i in issues):
            continue
        body = {'title': spec['title'], 'body': spec['body']}
        if spec['assignee']:
            body['assignees'] = [spec['assignee']]
        if spec['milestone']:
            body['milestone'] = milestone['id']
        if spec['label']:
            body['labels'] = [label['id']]
        issue = site.must('POST', '/repos/%s/issues' % REPO, body, sudo=spec['author'], what=spec['title'])
        if spec['comment']:
            site.must('POST', '/repos/%s/issues/%s/comments' % (REPO, issue['number']), {'body': spec['comment']},
                      sudo=spec['author'], what='The comment')
    issues = site.pages('/repos/%s/issues' % REPO, {'state': 'all', 'type': 'issues'})
    print('content: %s holds %d issues, %s (%s)' % (REPO, len(issues), MILESTONE, milestone['state']))


def tidy(site):
    if not repository(site, False):
        print('No repository %s: nothing to tidy.' % REPO)
        return
    # The whole list, not the search: the forge's search reads an index that takes a moment to learn a new issue.
    left = [i for i in site.pages('/repos/%s/issues' % REPO, {'state': 'all', 'type': 'issues'})
            if i['title'].startswith(TEST_PREFIX)]
    for issue in left:
        site.must('DELETE', '/repos/%s/issues/%s' % (REPO, issue['number']), what='Removing #%s' % issue['number'])
    print('tidy: %d issue(s) a test run left removed' % len(left))


def listing(site):
    users = site.pages('/admin/users')
    repo = repository(site, False)
    print('Accounts:')
    for u in sorted(users, key=lambda u: u['id']):
        access = 'administrator' if u.get('is_admin') else ''
        if not access and repo:
            if u['login'] == REPO_OWNER:
                access = 'owner of %s' % REPO
            else:
                code, perm = site.call('GET', '/repos/%s/collaborators/%s/permission' % (REPO, u['login']))
                access = ('%s access' % perm['permission']) if code == 200 and perm and perm.get('permission') not in (None, 'none') else 'no access'
        state = 'blocked' if u.get('prohibit_login') else ('active' if u.get('active') else 'inactive')
        print('  %-12s %-28s %-9s %s' % (u['login'], u.get('email', ''), state, access))
    if repo:
        issues = site.pages('/repos/%s/issues' % REPO, {'state': 'all', 'type': 'issues'})
        open_ = [i for i in issues if i['state'] == 'open']
        milestones = site.pages('/repos/%s/milestones' % REPO, {'state': 'all'})
        print('%s: %d issues (%d open), %d milestone(s)' % (REPO, len(issues), len(open_), len(milestones)))


def version(site):
    payload = site.must('GET', '/version', what='The release')
    print('VERSION %s' % payload.get('version', ''))


def main():
    if len(sys.argv) < 3:
        fail(__doc__)
    folder, verbs = sys.argv[1], sys.argv[2:]
    site = Site(folder)
    rows = read_rows() if 'accounts' in verbs else []
    for verb in verbs:
        if verb == 'accounts':
            accounts(site, rows)
        elif verb == 'content':
            content(site)
        elif verb == 'tidy':
            tidy(site)
        elif verb == 'list':
            listing(site)
        elif verb == 'version':
            version(site)
        else:
            fail('No verb %s: %s' % (verb, 'accounts, content, tidy, list, version'))


if __name__ == '__main__':
    main()

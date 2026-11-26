#!/usr/bin/env bash

# Gitea and Forgejo for the Webship Workspace: build a site of Gitea, or of Forgejo (the fork of Gitea that keeps its
# API and its screens), from the product's own image, run the forge's own admin commands in its container, add its
# default accounts and their access to the sample repository, add its sample content, and wire its step pack into the
# testing setup.
#
# Placed by `plugins.sh --install gitea` in core/scripts/plugins/gitea/functions/, where bootstrap sources it after the
# core's own functions. Everything runs in containers, never on the host:
#   - DDEV (the default): the product's image is a service of a generic project, on the project's own PostgreSQL (the
#     db service), at https://<name>.ddev.site; the project's web container keeps the mail catcher.
#   - Docker Compose, Podman and Kubernetes (--runtime docker, podman, kubernetes): the product's image is the web
#     container's (rt_stack image), on the project's PostgreSQL, its server started by the stack (rt_serve) as the host
#     user, its data in the project's gitea/data; at http://127.0.0.1:<port>, or on Kubernetes (kind) at the node's
#     address and a NodePort, the project's folder mounted from the host.
# Lando and Docksal are not proven yet: asked for one, the builder says so and changes nothing.
# The site's accounts and content go through the forge's own REST API (gitea-site.py, on this machine), the same on
# Gitea and Forgejo.
#
# The container tool has no project type for these forges, so a site of this plugin is recognised by a file on DDEV
# (.ddev/config.gitea.yaml, written by the builder) and by the plugin's claim on the other runtimes (rt_claim).
# Four names are the ones the core's tools look for:
#   set_gitea_users          the default accounts                          (cmd-tools-add-users.sh <project> gitea)
#   add_gitea_users          make them, and their access                   (the same tool, and --add-users of the builder)
#   cancel_gitea_users       keep them from logging in                     (cmd-tools-cancel-users.sh <project> gitea)
#   testing_configure_gitea  the step pack in the testing stack            (cmd-tools-testing.sh <project>)

# The step pack a site is tested with, and the release line it is required at.
readonly GITEA_STEPS_PACKAGE='@webship-js/gitea-steps';
readonly GITEA_STEPS_VERSION='^2.0.0';

# The product the builder makes when none is asked for, and each product's release (a tag of its image).
readonly GITEA_DEFAULT_PRODUCT='gitea';
readonly GITEA_DEFAULT_RELEASE='1.27.3';
readonly FORGEJO_DEFAULT_RELEASE='17.0.2';

# The sample repository the default accounts have access to, and the folder of a site with the plugin's scripts and
# the site's own values.
readonly GITEA_REPO='owner/webship-site';
readonly GITEA_FILES='gitea';

# The site's own administrator, made by every build with a password of the site only: the builder and the tool work
# through it. A forge keeps the name admin for itself.
readonly GITEA_SITE_ADMIN='forge-admin';

# The default accounts, the ones a scenario logs in as: the owner of the sample repository (owner), its collaborators
# with write access (member) and read access (reader), and an account with no access to it (stranger), whom the
# private repository is refused. A reader may open an issue, which the tracker treats as from outside the project.
# Accounts are configuration, made once on the site; a test suite never creates or deletes one. The workspace account
# the builder makes with --install is an administrator of its own and is not in this list.
function set_gitea_users() {
  users=(owner member reader stranger);
  local user ;
  for user in "${users[@]}" ; do
    printf -v "user_${user}_name" '%s' "${user}" ;
    printf -v "user_${user}_mail" '%s' "${user}@example.com" ;
    printf -v "user_${user}_password" '%s' 'dD.123123ddd' ;
    printf -v "user_${user}_fullname" '%s' "${user^} Test" ;
  done
  user_owner_role='owner' ;
  user_member_role='write' ;
  user_reader_role='read' ;
  user_stranger_role='' ;
}

# The runtime of the project in this folder, or of a new build (--runtime, else the workspace's setting, else DDEV).
# A core without the runtime layer has DDEV only.
function gitea_runtime() {
  if declare -f runtime_of > /dev/null ; then runtime_of "$@" ; else echo 'ddev' ; fi
}

# The address of the site in this folder (or of a new build named PROJECT_NAME, on DDEV).
function gitea_url() {
  if [ "$(gitea_runtime)" != 'ddev' ] && declare -f rt_url > /dev/null ; then rt_url ; return ; fi
  echo "https://${1:-${PROJECT_NAME}}.ddev.site" ;
}

# Is this folder a Gitea or Forgejo site of this plugin? On DDEV the builder leaves .ddev/config.gitea.yaml in it;
# on another runtime the project carries the plugin's claim.
function gitea_is_project() {
  local project_path="$1" ;
  [ -f "${project_path}/.ddev/config.gitea.yaml" ] && return 0 ;
  if declare -f rt_is_platform > /dev/null ; then rt_is_platform "${project_path}" gitea ; return $? ; fi
  return 1 ;
}

# Go to the project a tool was asked about, or say why not.
function gitea_enter_project() {
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}";
  if [ ! -d "${project_path}" ] ; then
    echo "No project ${PROJECT_NAME} in ${WORKSPACE_ROOT}/${doc_name}." ;
    return 1 ;
  fi
  if ! gitea_is_project "${project_path}" ; then
    echo "${doc_name}/${PROJECT_NAME} is not a Gitea or Forgejo site of this plugin." ;
    return 1 ;
  fi
  gitea_refresh_files "${project_path}" || return 1 ;
  cd "${project_path}" || return 1 ;
}

# The site's copy of the plugin's scripts (gitea/), brought up to the installed plugin's, so a plugin updated with
# --install reaches the sites built before it. The site's own values (gitea/env) are left as they are.
function gitea_refresh_files() {
  local project_path="$1" from="${WORKSPACE_SCRIPTS}/plugins/gitea" f ;
  [ -d "${project_path}/${GITEA_FILES}" ] || return 0 ;
  for f in gitea-site.py gitea-serve.sh ; do
    if [ -f "${from}/${f}" ] && ! cmp -s "${from}/${f}" "${project_path}/${GITEA_FILES}/${f}" ; then
      cp "${from}/${f}" "${project_path}/${GITEA_FILES}/${f}" || return 1 ;
    fi
  done
}

# A value of the site's own values (gitea/env), never printed by the tools: GITEA_PRODUCT, GITEA_RELEASE.
function gitea_setting() {
  sed -n "s/^$1=\\(.*\\)\$/\\1/p" "${2:-.}/${GITEA_FILES}/env" 2>/dev/null | head -n 1 ;
}

# A value made for this site only: letters and digits.
function gitea_secret() {
  head -c 96 /dev/urandom | base64 -w0 | tr -dc 'A-Za-z0-9' | head -c "${1:-64}" ;
}

# The image of a product at a release, with its registry: Podman resolves no short name without asking.
function gitea_image() {
  case "$1" in
    forgejo) echo "codeberg.org/forgejo/forgejo:$2" ;;
    *) echo "docker.io/gitea/gitea:$2" ;;
  esac
}

# The product's name for a person: Gitea or Forgejo.
function gitea_title() {
  if [ "$1" = 'forgejo' ] ; then echo 'Forgejo' ; else echo 'Gitea' ; fi
}

# Write the project's files: on DDEV the product's service (.ddev/docker-compose.gitea.yaml), its image in .ddev/.env
# and the claim (.ddev/config.gitea.yaml); on another runtime (Docker Compose, Podman, Kubernetes) the claim, the
# product's image as the web container's and its start (rt_claim, rt_stack, rt_serve). Then the plugin's scripts.
function gitea_write_config() {
  local project_path="$1" product="$2" release="$3" runtime="$4" ;
  local from="${WORKSPACE_SCRIPTS}/plugins/gitea" f image ;
  image="$(gitea_image "${product}" "${release}")" ;
  for f in docker-compose.gitea.yaml gitea-site.py gitea-serve.sh ; do
    if [ ! -f "${from}/${f}" ] ; then
      echo "${f} is not in ${from}: install the plugin (plugins.sh --install gitea)." ;
      return 1 ;
    fi
  done
  mkdir -p "${project_path}/${GITEA_FILES}" || return 1 ;
  for f in gitea-site.py gitea-serve.sh ; do
    cp "${from}/${f}" "${project_path}/${GITEA_FILES}/${f}" || return 1 ;
  done

  if [ "${runtime}" = 'ddev' ] ; then
    cp "${from}/docker-compose.gitea.yaml" "${project_path}/.ddev/docker-compose.gitea.yaml" || return 1 ;
    printf 'GITEA_IMAGE=%s\n' "${image}" > "${project_path}/.ddev/.env" || return 1 ;
    cat > "${project_path}/.ddev/config.gitea.yaml" <<YAMLEOF
# $(gitea_title "${product}") in this project: its service (docker-compose.gitea.yaml), its image in .env, the site's own
# values in ../gitea/env. Written by the Gitea builder of the workspace; build again rather than editing.
web_environment:
  - GITEA_PRODUCT=${product}
  - GITEA_RELEASE=${release}
YAMLEOF
    return 0 ;
  fi

  # Another runtime: the product's image is the web container's, and the stack starts it (gitea-serve.sh).
  ( cd "${project_path}" && rt_claim gitea && rt_stack image "${image}" ) || return 1 ;
  ( cd "${project_path}" && rt_serve 3000 "bash ${GITEA_FILES}/gitea-serve.sh" ) || return 1 ;
}

# The site's own values (gitea/env, which only you can read): how the product writes its app.ini the first time, its
# GITEA__ (FORGEJO__ for Forgejo) values for every start, its secret key and internal token, and the address.
function gitea_write_env() {
  local project_path="$1" product="$2" release="$3" base_url="$4" ;
  local prefix='GITEA' host="${base_url#*://}" ;
  [ "${product}" = 'forgejo' ] && prefix='FORGEJO' ;
  host="${host%%/*}" ;
  ( umask 077 && cat > "${project_path}/${GITEA_FILES}/env" <<ENVEOF
# The values of this $(gitea_title "${product}") site, made by the Gitea builder of the workspace: its secret key and
# internal token are of this site only. Read by the site's container and by the plugin's scripts; never printed.
GITEA_PRODUCT=${product}
GITEA_RELEASE=${release}
GITEA_IMAGE=$(gitea_image "${product}" "${release}")
APP_NAME=Webship site
DOMAIN=${host%%:*}
ROOT_URL=${base_url}/
HTTP_PORT=3000
DISABLE_SSH=true
DB_TYPE=postgres
DB_HOST=db:5432
DB_NAME=db
DB_USER=db
DB_PASSWD=db
SECRET_KEY=$(gitea_secret 64)
DISABLE_REGISTRATION=true
REQUIRE_SIGNIN_VIEW=false
${prefix}__security__INTERNAL_TOKEN=$(gitea_secret 100)
${prefix}__server__OFFLINE_MODE=true
${prefix}__server__LANDING_PAGE=explore
${prefix}__mailer__ENABLED=false
${prefix}__repository__DEFAULT_BRANCH=main
${prefix}__service__DEFAULT_KEEP_EMAIL_PRIVATE=true
${prefix}__cron_0x2E_update_checker__ENABLED=false
${prefix}__log__LEVEL=Warn
ENVEOF
  ) ;
}

# Run a command line in the forge's container, as the forge's own user, with its configuration; what is piped in
# reaches it.
function gitea_exec() {
  local line="$1" ;
  if [ "$(gitea_runtime)" = 'ddev' ] ; then
    ddev exec -s gitea "su-exec git bash -c $(printf '%q' "cd /app/gitea && ${line}")" ;
  else
    ddev exec "set -a ; . /var/www/html/${GITEA_FILES}/env ; set +a ; cd /var/www/html && ${line}" ;
  fi
}

# The forge's own command, with the site's configuration, for gitea_exec.
function gitea_cmd() {
  if [ "$(gitea_runtime)" = 'ddev' ] ; then
    echo "gitea --config /data/gitea/conf/app.ini --work-path /app/gitea" ;
  else
    echo "gitea --config /var/www/html/${GITEA_FILES}/data/gitea/conf/app.ini --work-path /var/www/html/${GITEA_FILES}/data --custom-path /var/www/html/${GITEA_FILES}/data/gitea" ;
  fi
}

# The answer of the forge's health check (200 when it serves and reaches its database), asked inside the project's
# network: on DDEV from the web container, elsewhere inside its own container.
function gitea_probe() {
  local where='http://gitea:3000' ;
  [ "$(gitea_runtime)" = 'ddev' ] || where='http://127.0.0.1:3000' ;
  ddev exec "curl -s -o /dev/null -m 10 -w '%{http_code}' ${where}/api/healthz" < /dev/null 2>/dev/null | tr -d '\r' | tail -1 ;
}

# Wait until the site answers, in the project's folder: up to five minutes, as the first start migrates the database.
function gitea_wait() {
  local attempt code="" ;
  for attempt in $(seq 1 100) ; do
    code="$(gitea_probe)" ;
    [ "${code}" == '200' ] && return 0 ;
    sleep 3 ;
  done
  echo "The forge did not answer (its health check: ${code:-none}); the end of its log:" ;
  if [ "$(gitea_runtime)" = 'ddev' ] ; then ddev logs -s gitea --tail 40 < /dev/null 2>/dev/null ; else ddev logs < /dev/null 2>/dev/null | tail -n 40 ; fi
  return 1 ;
}

# Run verbs of gitea-site.py (accounts, content, tidy, list, version) on this machine, against the site's API. A
# payload (accounts, passwords) travels on the input, never on a command line.
function gitea_site() {
  local project_path ; project_path="$(pwd)" ;
  python3 "${project_path}/${GITEA_FILES}/gitea-site.py" "${project_path}" "$@" ;
}

# The release the site runs, as the forge says it.
function gitea_version() {
  ( cd "${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" 2>/dev/null && gitea_site version < /dev/null 2>/dev/null ) | sed -n 's/^VERSION //p' | tail -n 1 ;
}

# The site's own administrator, with a password the forge makes and the builder keeps in gitea/env (never printed).
function gitea_site_admin() {
  local project_path="$1" out password ;
  out="$(gitea_exec "$(gitea_cmd) admin user create --admin --username ${GITEA_SITE_ADMIN} --email ${GITEA_SITE_ADMIN}@example.invalid --random-password --must-change-password=false" < /dev/null 2>&1)" ;
  password="$(printf '%s\n' "${out}" | tr -d '\r' | sed -n "s/^.*generated random password is '\\(.*\\)'.*\$/\\1/p" | tail -n 1)" ;
  out='' ;
  if [ -z "${password}" ] ; then echo "The site's administrator could not be made." ; return 1 ; fi
  ( umask 077 && printf 'GITEA_SITE_ADMIN=%s\nGITEA_SITE_ADMIN_PASSWORD=%s\n' "${GITEA_SITE_ADMIN}" "${password}" >> "${project_path}/${GITEA_FILES}/env" ) ;
  password='' ;
}

# Rows of accounts for gitea-site.py, as the base64 of its JSON list: "login|mail|password|fullname|admin|role|action"
# lines in GITEA_ROWS, which travel to Python in the environment, never on a command line.
function gitea_accounts_payload() {
  GITEA_ROWS="$1" python3 -c '
import base64, json, os
rows = []
for line in os.environ["GITEA_ROWS"].split("\x1e"):
    if not line:
        continue
    login, mail, password, fullname, admin, role, action = line.split("\x1f")
    rows.append({"login": login, "mail": mail, "password": password, "fullname": fullname, "admin": admin == "yes",
                 "role": role, "action": action})
print(base64.b64encode(json.dumps(rows).encode()).decode())' ;
}

# Build a Gitea or Forgejo site from nothing: the project and the forge; with --install the workspace account as an
# administrator; with --add-users the default accounts and their access to the sample repository; with
# --sample-content its issues, milestone and comment the step pack is tested on.
function gitea_build() {
  trim_project_name ;
  local product="${PRODUCT:-${site_gitea_product:-${GITEA_DEFAULT_PRODUCT}}}" release ;
  case "${product}" in gitea|forgejo) ;; *) echo "--product takes gitea or forgejo, not ${product}. Nothing was changed." ; exit 1 ;; esac
  release="${FORGE_VERSION:-}" ;
  if [ -z "${release}" ] ; then
    if [ "${product}" = 'forgejo' ] ; then release="${site_forgejo_release:-${FORGEJO_DEFAULT_RELEASE}}" ; else release="${site_gitea_release:-${GITEA_DEFAULT_RELEASE}}" ; fi
  fi
  local title ; title="$(gitea_title "${product}")" ;
  local project_path="${WORKSPACE_ROOT}/${doc_name}/${PROJECT_NAME}" ;
  local runtime ; runtime="$(cd "${WORKSPACE_ROOT}/${doc_name}" && gitea_runtime)" ;

  case "${runtime}" in
    ddev|docker|podman|kubernetes) ;;
    *) echo "${title} builds on DDEV, Docker Compose, Podman and Kubernetes for now (--runtime ddev, docker, podman or kubernetes), not on ${runtime}: that runtime is not proven for it yet. Nothing was changed." ; exit 1 ;;
  esac
  if [ "${runtime}" != 'ddev' ] && ! declare -f rt_stack > /dev/null ; then
    echo "--runtime ${runtime} needs a Webship Workspace with the container runtimes (webship/workspace#694, #841): update the workspace, or build on DDEV." ;
    exit 1 ;
  fi
  if ! [[ "${release}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ; then
    echo "--release takes a release of ${title} (1.27.3 for Gitea, 17.0.2 for Forgejo), not ${release}. Nothing was changed." ;
    exit 1 ;
  fi
  if [ "${ADD_USERS}" == 'yes' ] && [ "${INSTALL}" != 'yes' ] ; then
    echo "--add-users needs --install: the default accounts go into the site --install sets up." ;
    exit 1 ;
  fi
  if [ "${SAMPLE_CONTENT}" == 'yes' ] && [ "${ADD_USERS}" != 'yes' ] ; then
    echo "--sample-content needs --add-users: the sample repository belongs to the default accounts." ;
    exit 1 ;
  fi
  if [ ${#PROJECT_NAME} -gt 40 ] || ! [[ "${PROJECT_NAME}" =~ ^[a-z0-9][a-z0-9-]*$ ]] ; then
    echo "The project name ${PROJECT_NAME} must be small letters, digits and dashes (its address and its containers take it). Nothing was changed." ;
    exit 1 ;
  fi
  if [ "${INSTALL}" == 'yes' ] && [ ${#account_pass} -lt 8 ] ; then
    echo "The workspace account's password (core/config/settings.yml) has fewer than eight characters, which ${title} asks of a password: --install makes it an account of the site. Nothing was changed." ;
    exit 1 ;
  fi
  if [ "${INSTALL}" == 'yes' ] && [[ "${account_name}" =~ ^(admin|${GITEA_SITE_ADMIN})$ ]] ; then
    echo "The workspace account's name ${account_name} is one ${title} keeps for itself. Nothing was changed." ;
    exit 1 ;
  fi

  cd ${WORKSPACE_ROOT}/${doc_name} || exit 1 ;

  # A project of the same name goes first, with its containers and its volumes (the forge's database and data).
  drop_database ;
  rm -rf "${PROJECT_NAME:?}" ;
  mkdir -p "${PROJECT_NAME}" ;
  cd "${project_path}" || exit 1 ;

  # A generic project on PostgreSQL 17.
  if [ "${runtime}" = 'ddev' ] ; then
    ddev config --project-type=generic --project-name=${PROJECT_NAME} --database=postgres:17 \
      --nodejs-version=$(ddev_nodejs_version) < /dev/null || exit 1 ;
  else
    # The runtime's own project: Docker Compose, Podman or Kubernetes, through the runtime layer.
    ddev config --project-type=generic --webserver-type=generic --project-name=${PROJECT_NAME} --database=postgres:17 --auto < /dev/null || exit 1 ;
  fi
  gitea_write_config "${project_path}" "${product}" "${release}" "${runtime}" || exit 1 ;
  local base_url ; base_url="$(gitea_url)" ;
  gitea_write_env "${project_path}" "${product}" "${release}" "${base_url}" || exit 1 ;

  echo "Starting the project and ${title} ${release}: its image is about 200 MB the first time, and the first start migrates the database." ;
  ddev_up start -y < /dev/null || exit 1 ;
  gitea_wait || exit 1 ;
  gitea_site_admin "${project_path}" || exit 1 ;

  if [ "${INSTALL}" == 'yes' ] ; then
    echo "Making the workspace account an administrator of the site." ;
    local rows ;
    rows="${account_name}"$'\x1f'"${account_mail:-${account_name}@example.com}"$'\x1f'"${account_pass}"$'\x1f'"${account_name^} Workspace"$'\x1f''yes'$'\x1f'$'\x1f'$'\x1e' ;
    gitea_accounts_payload "${rows}" | gitea_site accounts || { echo "The workspace account could not be made." ; exit 1 ; } ;
    if [ "${ADD_USERS}" == 'yes' ] ; then
      set_gitea_users ;
      add_gitea_users || exit 1 ;
      if [ "${SAMPLE_CONTENT}" == 'yes' ] ; then
        echo "Adding the sample content: the issues of ${GITEA_REPO}, its milestone Sprint 1 and a comment." ;
        ( cd "${project_path}" && gitea_site content < /dev/null ) || exit 1 ;
      fi
      users=() ;
    fi
    echo "${doc_name} ${PROJECT_NAME} has been installed: ${title} $(gitea_version).";
    echo "The site: ${base_url}" ;
    echo "The workspace account logs in as ${account_name}; the site's own administrator (${GITEA_SITE_ADMIN}) has a password of this site only, in ${doc_name}/${PROJECT_NAME}/${GITEA_FILES}/env.";
  else
    echo "${doc_name} ${PROJECT_NAME} is ready: ${title} $(gitea_version) at ${base_url}.";
    echo "Its own administrator (${GITEA_SITE_ADMIN}) has a password of this site only, in ${doc_name}/${PROJECT_NAME}/${GITEA_FILES}/env. Build it again with --install (and --add-users) for the workspace account and the default accounts.";
  fi

  if [ "${LAUNCH}" == 'yes' ] ; then
    ddev launch ;
  fi

  cd ${WORKSPACE_ROOT}/${doc_name};
}
# Make the default accounts, or give them back their names, passwords and access: the owner owns the sample
# repository (made with it), the member and the reader are its collaborators with write and read access, the stranger
# has none. The list is loaded by the caller (set_gitea_users): the core's add_users, the builder, the tool.
function add_gitea_users() {
  gitea_enter_project || return 1 ;
  local user user_name user_mail user_password user_fullname user_role rows="" ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_mail="user_${user}_mail";
    user_password="user_${user}_password"; user_fullname="user_${user}_fullname"; user_role="user_${user}_role";

    echo " ---------------------------------------------------------------- ";
    echo "      User name: ${!user_name}";
    echo "      User mail: ${!user_mail}";
    echo "  User password: ${!user_password}";
    echo "      User role: ${!user_role:-no access} (${GITEA_REPO})";
    echo " ================================================================= ";
    rows="${rows}${!user_name}"$'\x1f'"${!user_mail}"$'\x1f'"${!user_password}"$'\x1f'"${!user_fullname}"$'\x1f''no'$'\x1f'"${!user_role}"$'\x1f'$'\x1e' ;
  done
  gitea_accounts_payload "${rows}" | gitea_site accounts ;
  local status=$? ;
  cd ${WORKSPACE_ROOT}/${doc_name};
  return ${status} ;
}

# Keep the default accounts from logging in (their work stays), never the workspace account.
function cancel_gitea_users() {
  gitea_enter_project || return 1 ;
  local user user_name user_mail rows="" ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_mail="user_${user}_mail";
    echo " ---------------------------------------------------------------- ";
    echo "      User name: ${!user_name}";
    echo "      User mail: ${!user_mail}";
    echo " ================================================================= ";
    rows="${rows}${!user_name}"$'\x1f'"${!user_mail}"$'\x1f'$'\x1f'$'\x1f''no'$'\x1f'$'\x1f''lock'$'\x1e' ;
  done
  gitea_accounts_payload "${rows}" | gitea_site accounts ;
  local status=$? ;
  cd ${WORKSPACE_ROOT}/${doc_name};
  return ${status} ;
}

# Point the dashboard's Gitea (core/config/plugin.gitea.settings.yml) at this site, as an account of it: a new access
# token of that account (made by the forge's own admin command, its scopes the tracker's) goes into the settings file,
# which only you can read, never on a screen or in a log; with it the site's address, and the sample repository as the
# default one when none was set.
function gitea_connect() {
  local login="$1" settings="${WORKSPACE_CONFIG}/plugin.gitea.settings.yml" out token url ;
  if ! [[ "${login}" =~ ^[A-Za-z0-9._-]+$ ]] ; then echo "--connect takes the login of an account of the site." ; return 1 ; fi
  if [ ! -f "${settings}" ] ; then echo "No ${settings}: install the plugin first (plugins.sh --install gitea)." ; return 1 ; fi
  out="$(gitea_exec "$(gitea_cmd) admin user generate-access-token --username ${login} --token-name webship-workspace-$(date +%s) --scopes write:issue,write:repository,read:user --raw" < /dev/null 2>/dev/null)" ;
  token="$(printf '%s\n' "${out}" | tr -d '\r' | grep -E '^[0-9a-f]{40}$' | tail -n 1)" ;
  out='' ;
  if [ -z "${token}" ] ; then echo "No access token could be made for ${login} (is it an account of the site?)." ; return 1 ; fi
  url="$(gitea_url)" ;
  GITEA_NEW_TOKEN="${token}" python3 - "${settings}" "${url}" "${GITEA_REPO}" "${login}" "$(gitea_setting GITEA_PRODUCT)" <<'PYEOF' || return 1
import os, re, sys
path, url, repo, login, product = sys.argv[1:6]
token = os.environ['GITEA_NEW_TOKEN']
text = open(path).read()
def put(text, key, value):
    line = '%s: %s' % (key, value)
    if re.search(r'^%s:.*$' % key, text, re.M):
        return re.sub(r'^%s:.*$' % key, lambda m: line, text, count=1, flags=re.M)
    return text.rstrip('\n') + '\n' + line + '\n'
text = put(text, 'url', url)
text = put(text, 'token', token)
text = put(text, 'username', login)
text = put(text, 'product', 'forgejo' if product == 'forgejo' else 'gitea')
# The sample repository as the tracker's default one, in its block, when none was set.
block = re.search(r'^tracker:[ \t]*\n((?:[ \t]+.*\n|[ \t]*#.*\n|[ \t]*\n)*)', text, re.M)
if block:
    body = block.group(1)
    scope = re.search(r'^([ \t]+)default_scope:[ \t]*(.*)$', body, re.M)
    if scope and scope.group(2).strip() in ('', '""', "''"):
        body = body[:scope.start()] + '%sdefault_scope: %s' % (scope.group(1), repo) + body[scope.end():]
    elif not scope:
        body = '  default_scope: %s\n' % repo + body
    text = text[:block.start(1)] + body + text[block.end(1):]
else:
    text = text.rstrip('\n') + '\ntracker:\n  default_scope: %s\n' % repo
fd = os.open(path + '.new', os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write(text)
os.replace(path + '.new', path)
PYEOF
  token='' ;
  echo "The dashboard reads the issues of ${url} as ${login} now: a new access token of that account is in ${settings} (not shown here), and ${GITEA_REPO} is the default repository when none was set." ;
}

# What cmd-tools-gitea-cli.sh does: the first of --run, --add-users, --cancel-users, --sample-content, --tidy,
# --connect that was asked for; with none of them, what the site is and its accounts.
function gitea_cli_tool() {
  trim_project_name ;
  gitea_enter_project || exit 1 ;

  if [ "$(gitea_runtime)" = 'ddev' ] ; then
    ddev describe -j 2>/dev/null | grep -q '"status":"running"' || ddev start -y < /dev/null || exit 1 ;
  else
    # A forge that answers is left as it is: on Podman a start makes every container of the project again
    # (webship/workspace#906).
    [ "$(gitea_probe)" = '200' ] || ddev start < /dev/null > /dev/null 2>&1 || ddev start -y < /dev/null || exit 1 ;
  fi
  gitea_wait > /dev/null || { echo "The forge of ${PROJECT_NAME} does not answer; start it again (ddev restart in ${doc_name}/${PROJECT_NAME})." ; exit 1 ; } ;

  if [ ! "${RUN}" == '_none_' ] ; then
    # The forge's own commands (gitea <command>), in its container, as its user.
    gitea_exec "$(gitea_cmd) ${RUN}" < /dev/null ;
    exit $? ;
  fi

  set_gitea_users ;
  if [ "${ADD_USERS}" == 'yes' ] ; then
    add_gitea_users ;
  elif [ "${CANCEL_USERS}" == 'yes' ] ; then
    cancel_gitea_users ;
  elif [ "${SAMPLE_CONTENT}" == 'yes' ] ; then
    gitea_site content list < /dev/null ;
  elif [ "${TIDY}" == 'yes' ] ; then
    # What a test run that was stopped half way left: its issues ("Webship test …"), with their comments and time.
    gitea_site tidy list < /dev/null ;
  elif [ "${CONNECT}" != '_none_' ] ; then
    gitea_connect "${CONNECT}" ;
  else
    echo "${doc_name}/${PROJECT_NAME}: $(gitea_title "$(gitea_setting GITEA_PRODUCT)") $(gitea_version)" ;
    echo "  the site:  $(gitea_url)" ;
    echo "" ;
    gitea_site list < /dev/null ;
  fi
  cd ${WORKSPACE_ROOT}/${doc_name};
}

# The step pack in the testing stack of a Gitea or Forgejo site. The core's testing_configure calls this in the project
# folder once webship-js is scaffolded and before the dependencies are installed; for a project that is not one of
# this plugin's it changes nothing.
#
# It adds the pack to package.json, lists its step definitions in cucumber.js after webship-js's own, gives cucumber.js
# the tags that keep the pack's assertions that must fail out of a normal run, the account that prepares and removes
# test content (manager), the repository the steps work in when they name none, and the users registry of the default
# accounts (a handle a scenario reads, mapped to an account; never the workspace account), and writes a first feature
# when the project has none of its own. Every part is skipped when it is already there, so a second run adds what the
# first missed and never resets a suite.
function testing_configure_gitea() {
  local project_path="$1";
  gitea_is_project "${project_path}" || return 0 ;
  if [ ! -f "${project_path}/cucumber.js" ] || [ ! -f "${project_path}/package.json" ] ; then
    echo "  Gitea: cucumber.js is not here yet — run the testing setup again once webship-js is scaffolded." ;
    return 1 ;
  fi

  echo "Adding the Gitea and Forgejo step pack (${GITEA_STEPS_PACKAGE} ${GITEA_STEPS_VERSION}).";
  set_gitea_users ;
  local registry="" user user_name user_password user_fullname ;
  for user in "${users[@]}" ; do
    user_name="user_${user}_name"; user_password="user_${user}_password"; user_fullname="user_${user}_fullname";
    registry="${registry}${user}|${!user_name}|${!user_password}|${!user_fullname}"$'\n' ;
  done

  local address ;
  address="$(cd "${project_path}" && gitea_url "$(sed -n 's/^name:[[:space:]]*"\{0,1\}\([A-Za-z0-9._-]*\)"\{0,1\}[[:space:]]*$/\1/p' .ddev/config.yaml 2>/dev/null | head -n 1)")" ;

  python3 - "${project_path}" "${GITEA_STEPS_PACKAGE}" "${GITEA_STEPS_VERSION}" 'GITEA' "${registry}" "${address}" "${GITEA_REPO}" <<'PYEOF' || return 1
import json, re, sys

project, pack, version, prefix, registry, address, sample = sys.argv[1:8]

# package.json: the pack as a dev dependency, at the release line this plugin was proven on.
pkg_file = project + '/package.json'
pkg = json.load(open(pkg_file))
if pack not in pkg.get('dependencies', {}) and pack not in pkg.get('devDependencies', {}):
    pkg.setdefault('devDependencies', {})[pack] = version
    open(pkg_file, 'w').write(json.dumps(pkg, indent=4) + '\n')
    print('  package.json: %s %s' % (pack, version))

cucumber_file = project + '/cucumber.js'
src = open(cucumber_file).read()
before = src

if ('node_modules/%s/' % pack) not in src:
    line = "'node_modules/%s/tests/step-definitions/**/*.js'," % pack
    core = re.search(r"^([ \t]*)'node_modules/webship-js/tests/step-definitions/[^']*',.*$", src, re.M)
    opening = re.search(r"^([ \t]*)require:[ \t]*\[[ \t]*$", src, re.M)
    if core:
        src = src[:core.end()] + '\n' + core.group(1) + line + src[core.end():]
    elif opening:
        src = src[:opening.end()] + '\n' + opening.group(1) + '  ' + line + src[opening.end():]
    else:
        sys.exit("  cucumber.js has no require list this can add to. Add this line to it:\n    " + line)
    print('  cucumber.js: the step definitions of %s' % pack)

if not re.search(r"^[ \t]*tags:", src, re.M):
    default = re.search(r"^([ \t]*)default:[ \t]*\{[ \t]*$", src, re.M)
    if default:
        pad = default.group(1) + '  '
        block = [
            pad + "// The pack's assertions that must fail are no part of a normal run.",
            pad + "tags: process.env.CUCUMBER_TAGS || 'not @wip and not @must-fail',",
        ]
        src = src[:default.end()] + '\n' + '\n'.join(block) + src[default.end():]
        print('  cucumber.js: the tags that keep the assertions that must fail out of a normal run')

world = re.search(r"^([ \t]*)worldParameters:[ \t]*\{[ \t]*$", src, re.M)
if not world:
    sys.exit("  cucumber.js has no worldParameters block to add the users registry to.")
pad = world.group(1) + '  '
additions = []
if not re.search(r"^[ \t]*manager:", src, re.M):
    additions += [
        pad + "// The account that prepares and removes test content through the site's API: the repository's owner.",
        pad + "manager: process.env.MANAGER || 'owner',",
    ]
if not re.search(r"^[ \t]*repository:", src, re.M):
    additions += [
        pad + "// The repository the steps work in when they name none (owner/name).",
        pad + "repository: process.env.REPOSITORY || '%s'," % sample,
    ]
if not re.search(r"^[ \t]*users:[ \t]*\{", src, re.M):
    rows = [r.split('|') for r in registry.splitlines() if r.strip()]
    additions += [
        pad + "// The users registry: a handle a scenario reads, mapped to an account of the site (the default accounts:",
        pad + "// cmd-tools-gitea-cli.sh --add-users). Override one with %s_<HANDLE>_USER and %s_<HANDLE>_PASSWORD." % (prefix, prefix),
        pad + "users: {",
    ]
    for handle, login, password, fullname in rows:
        env = '%s_%s' % (prefix, handle.upper())
        additions.append(pad + "  %s: { username: process.env.%s_USER || '%s', password: process.env.%s_PASSWORD || '%s', name: '%s' }," % (handle, env, login, env, password, fullname))
    additions.append(pad + "},")
    print('  cucumber.js: the users registry (%s)' % ', '.join(r[0] for r in rows))
if additions:
    src = src[:world.end()] + '\n' + '\n'.join(additions) + src[world.end():]
    print('  cucumber.js: the managing account and the repository of the steps')

# The address the suite opens when LAUNCH_URL is not set: the placeholder of the scaffold becomes the site's.
placeholder = "process.env.LAUNCH_URL || 'http://localhost:8080'"
if placeholder in src:
    src = src.replace(placeholder, "process.env.LAUNCH_URL || '%s'" % address)
    print('  cucumber.js: the address of the site (%s)' % address)

if src != before:
    open(cucumber_file, 'w').write(src)
PYEOF

  # A first feature, when the project has none for the site yet.
  local feature="${WORKSPACE_SCRIPTS}/plugins/gitea/site.feature" ;
  if [ -f "${feature}" ] && [ ! -f "${project_path}/tests/features/site.feature" ] ; then
    mkdir -p "${project_path}/tests/features" && cp "${feature}" "${project_path}/tests/features/site.feature" \
      && echo "  tests/features/site.feature: a first feature for the issues" ;
  fi

  # The scenarios log in as the default accounts and read the sample repository: make sure the site has them, once it
  # answers again (installing the testing stack may restart the project, and the forge with it). Each part runs in the
  # project and says when it did not work: add_gitea_users ends in the sites folder, so the sample content is asked for
  # in the project again (webship/workspace-gitea#11).
  if ! ( cd "${project_path}" && gitea_wait > /dev/null 2>&1 ) ; then
    echo "  The forge does not answer: is the site running (ddev start in ${project_path})? The default accounts and the sample content were not checked." ;
  elif ! ( cd "${project_path}" && add_gitea_users > /dev/null 2>&1 ) ; then
    echo "  The default accounts could not be written (bash cmd-tools-gitea-cli.sh <site> --add-users says why)." ;
  elif ! ( cd "${project_path}" && gitea_site content < /dev/null > /dev/null 2>&1 ) ; then
    echo "  The sample content could not be written (bash cmd-tools-gitea-cli.sh <site> --sample-content says why)." ;
  else
    echo "  the default accounts and the sample content are on the site (${users[*]})" ;
  fi
}

#!/usr/bin/env bash
# The forge's own server in the web container of the generic stack (Docker Compose, rt_serve): Gitea or Forgejo from
# the product's image, run as the host user, its repositories and data in the project's gitea/data. Written by the
# Gitea builder of the workspace; the site's own values are in gitea/env, which only you can read.
cd /var/www/html || exit 1
set -a ; . ./gitea/env ; set +a
data=/var/www/html/gitea/data
custom="${data}/gitea"
ini="${custom}/conf/app.ini"
mkdir -p "${custom}/conf" "${data}/git/repositories" || exit 1
# The first start writes app.ini, every path in the project's folder; then the product's own GITEA__ (or FORGEJO__)
# values of gitea/env go into it at every start, as the image's own start does.
if [ ! -f "${ini}" ] ; then
  ( umask 077 && cat > "${ini}" <<INIEOF
APP_NAME = ${APP_NAME:-Webship site}
RUN_MODE = prod
RUN_USER = $(id -un)
WORK_PATH = ${data}

[repository]
ROOT = ${data}/git/repositories

[server]
APP_DATA_PATH = ${custom}
DOMAIN = ${DOMAIN}
HTTP_PORT = ${HTTP_PORT:-3000}
ROOT_URL = ${ROOT_URL}
DISABLE_SSH = true
START_SSH_SERVER = false
LFS_START_SERVER = false

[database]
DB_TYPE = ${DB_TYPE}
HOST = ${DB_HOST}
NAME = ${DB_NAME}
USER = ${DB_USER}
PASSWD = ${DB_PASSWD}

[log]
MODE = console
LEVEL = info
ROOT_PATH = ${custom}/log

[security]
INSTALL_LOCK = true
SECRET_KEY = ${SECRET_KEY}

[service]
DISABLE_REGISTRATION = ${DISABLE_REGISTRATION:-true}
INIEOF
  ) || exit 1
fi
environment-to-ini --config "${ini}" || exit 1
exec gitea web --config "${ini}" --work-path "${data}" --custom-path "${custom}"

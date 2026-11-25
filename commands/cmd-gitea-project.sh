#!/usr/bin/env bash

# workspace-name: Gitea or Forgejo (self-hosted Git forge)

# Installed by the Gitea plugin (plugins.sh --install gitea); __WORKSPACE__ is the workspace it was installed into.
#
# Build a Gitea site, or a Forgejo one with --product forgejo, in containers from the product's own image, on the
# project's own PostgreSQL: on DDEV at https://<name>.ddev.site (the default), or on Docker Compose with
# --runtime docker at http://127.0.0.1:<port>. With --install the workspace account is an administrator of the site;
# with --add-users the default accounts and their access to the repository owner/webship-site; with --sample-content
# its issues, its milestone Sprint 1 and a comment.

# Bootstrap.
# Find the workspace tooling from this script, so a fresh clone needs no setup.
WORKSPACE_SCRIPTS="${WORKSPACE_SCRIPTS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../core/scripts" && pwd)}";
source ${WORKSPACE_SCRIPTS}/bootstrap.sh || exit 1 ;

# Load workspace settings.
eval $(parse_yaml ${WORKSPACE_CONFIG}/workspace.__WORKSPACE__.settings.yml);

# Distribution.
distribution_name="gitea";
distribution_title="Gitea or Forgejo";

ARGPARSE_DESCRIPTION="Build a ${distribution_title} site in __WORKSPACE__"
# The args file comes with the plugin: core/scripts/plugins/gitea/ is where plugins.sh --install puts it.
source ${WORKSPACE_SCRIPTS}/plugins/gitea/args/arg-gitea.sh || exit 1 ;

shift $#;

gitea_build ;

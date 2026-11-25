#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the project: its folder, its project in containers and its host name.')
parser.add_argument('-p', '--product',
                    dest='PRODUCT',
                    default="gitea",
                    choices=['gitea', 'forgejo'],
                    help='The forge to build: gitea (the default) or forgejo (the fork of Gitea, which keeps its API and its screens).')
parser.add_argument('--runtime',
                    dest='RUNTIME',
                    default="_none_",
                    choices=['ddev', 'docker'],
                    help='The container runtime to build on: ddev (the default, or container.runtime of settings.yml) or docker (Docker Compose). Gitea and Forgejo are not proven on the other runtimes yet.')
parser.add_argument('-i', '--install',
                    action='store_true',
                    default=False,
                    help='Make the workspace account an administrator of the site.')
parser.add_argument('-a', '--add-users',
                    action='store_true',
                    default=False,
                    help='With --install, add the default accounts (owner: the owner of the repository owner/webship-site; member and reader: its collaborators with write and read access; stranger: no access): the ones the test scenarios log in as.')
parser.add_argument('-s', '--sample-content',
                    action='store_true',
                    default=False,
                    help='With --install and --add-users, add the sample content the step pack and the tracker are tested on: the issues of owner/webship-site, its milestone Sprint 1 and a comment.')
parser.add_argument('-v', '--release',
                    dest='FORGE_VERSION',
                    default="",
                    help='The release of the site (a tag of the product\'s image): 1.27.3 for Gitea and 17.0.2 for Forgejo by default. Example: --release 1.27.3 (or --product forgejo --release 17.0.2)')
parser.add_argument('-l', '--launch',
                    action='store_true',
                    default=False,
                    help='Open the site in a browser when it is ready.')
ARGEOF

#!/usr/bin/env bash

argparse "$@" <<ARGEOF || exit 1
parser.add_argument('PROJECT_NAME',
                    help='The name of the Gitea or Forgejo project in this folder.')
parser.add_argument('-r', '--run',
                    default="_none_",
                    help='Run one of the forge\'s own admin commands in its container, as its user. Example: --run "admin user list"')
parser.add_argument('-a', '--add-users',
                    action='store_true',
                    default=False,
                    help='Make the default accounts (owner, member, reader, stranger) and their access to owner/webship-site, or give them back their names, passwords and access.')
parser.add_argument('-c', '--cancel-users',
                    action='store_true',
                    default=False,
                    help='Block the default accounts from logging in: their work stays.')
parser.add_argument('-s', '--sample-content',
                    action='store_true',
                    default=False,
                    help='Add the sample content the step pack and the tracker are tested on, where it is missing.')
parser.add_argument('-t', '--tidy',
                    action='store_true',
                    default=False,
                    help='Remove what a test run that was stopped half way left: its issues ("Webship test …"), with their comments and time.')
parser.add_argument('--connect',
                    default="_none_",
                    help='Point the dashboard\'s Gitea at this site as this account: a new access token of it goes into core/config/plugin.gitea.settings.yml (never shown), with the site\'s address. Example: --connect member')
ARGEOF

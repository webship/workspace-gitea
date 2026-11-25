Feature: The Gitea plugin on the dashboard
  Once the plugin is activated and installed, the sites folders offer the builder of Gitea and Forgejo, each AI folder
  lists the items of its kind the plugin ships, the Plugins page lists the plugin with its settings, and a project whose
  git remote is on the connected Gitea or Forgejo carries the forge's menu, with its issues as work items.

  # Settings lists every plugin that was added; the package and what the plugin ships are on its own page.
  Scenario: Settings lists the plugin, and its own page names its package, what it ships and its settings
    Given I am on "/settings"
     Then I should see "Gitea"
     When I go to "/settings/plugin/gitea"
     Then I should see "@webship.co/workspace-gitea"
      And I should see "cmd-gitea-project.sh"
      And I should see "gitea-site-builder"
      And I should see "Forgejo"
      And I should see "Writes to the forge (issues as work items)"

  Scenario: A sites folder offers the builder of Gitea and Forgejo
    Given I am on "/dev"
     Then "option[value='cmd-gitea-project.sh']" should be attached

  # The AI folders are searched by name: with every plugin on, a folder lists more than one page of items.
  Scenario: The AI Agents folder lists the agents the plugin ships
    Given I am on "/ai-agents?q=gitea-"
     Then I should see "gitea-site-builder"
      And I should see "gitea-tester"
      And I should see "gitea-issue-worker"

  Scenario: The AI Skills folder lists the skill the plugin ships
    Given I am on "/ai-skills?q=gitea-scenarios"
     Then I should see "gitea-scenarios"

  Scenario: The AI Commands folder lists the command the plugin ships
    Given I am on "/ai-commands?q=gitea-test"
     Then I should see "gitea-test"

  Scenario: The AI Prompts folder lists the prompts the plugin ships
    Given I am on "/ai-prompts?q=gitea-"
     Then I should see "gitea-build-and-test"
      And I should see "gitea-issue-to-branch"

  # The issues as work items (@webship.co/workspace-tracker), in the forge's menu of a project whose remote is on the
  # connected instance. The list asks the forge again when its View or its filter changes. It needs an address and a
  # token in the settings and such a project in the dev folder: CI has none, so it skips this, saying why.
  @needs-setting-gitea-url @needs-setting-gitea-token @needs-project-dev
  Scenario: The issue list follows its View and its filter
    Given I am on "/dev"
     When I click on the element ".act-menu-gitea > button"
      And I click on the element ".act-menu-gitea a[hx-get*='/tracker/list/']"
     Then eventually I should see "All open issues ·" within 30 seconds
     When I select "Current milestone" from "view"
     Then eventually I should see "Current milestone ·" within 30 seconds

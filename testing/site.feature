@site
Feature: The issues of the site
  A first feature of a Gitea or Forgejo site of the Webship Workspace, placed by the testing setup: a member logs in,
  reads the sample repository's issues and milestone, and works an issue of its own, which goes after the scenario. It
  passes on a site built with --install --add-users --sample-content; add your own features beside it.

  Scenario: A member reads the sample repository
    Given I am a logged in user with the "member" user
    When I open the issues of the repository "owner/webship-site"
    Then the issue list should show "The greeting script says Helo instead of Hello"
    When I open the milestone "Sprint 1" of the repository "owner/webship-site"
    Then the milestone should list the issue "The greeting script says Helo instead of Hello"

  Scenario: A member works an issue of its own
    Given there is an issue "Webship test site" in the repository "owner/webship-site"
    And I am a logged in user with the "member" user
    When I open the issue "Webship test site"
    And I add the comment "Checked on the test site" to the issue
    And I log "0.5" hours on the issue
    Then the issue should show the comment "Checked on the test site" by "member"
    And the time spent on the issue should be "30 minutes"

  @js-off
  Scenario: An account with no access is refused the repository
    Given I am a logged in user with the "stranger" user
    Then I should be refused the repository "owner/webship-site"

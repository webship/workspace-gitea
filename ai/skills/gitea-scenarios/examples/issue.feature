@issues
Feature: An issue worked by a member
  A member comments on an issue of its own, logs time on it, assigns it, closes it and reopens it. The issue goes
  after the scenario, with all of it.

  Scenario: A comment, the time spent, the assignee, closed and reopened
    Given there is an issue "Webship test work" in the repository "owner/webship-site"
    And I am a logged in user with the "member" user
    When I open the issue "Webship test work"
    And I add the comment "Checked on the test site" to the issue
    And I log "0.5" hours on the issue
    And I assign the issue to "member"
    Then the issue should show the comment "Checked on the test site" by "member"
    And the time spent on the issue should be "30 minutes"
    And the issue should be assigned to "Member Test"
    When I close the issue
    Then the issue should be "closed"
    When I reopen the issue
    Then the issue should be "open"

@roles
Feature: What each account may do in the repository
  A reader reads the repository's issues and comments on them, but neither closes nor assigns someone else's issue
  nor logs time on it, and an account with no access is refused the private repository.

  Scenario: A reader comments, but neither closes, assigns nor logs time
    Given there is an issue "Webship test reader" in the repository "owner/webship-site"
    And I am a logged in user with the "reader" user
    When I open the issue "Webship test reader"
    Then I should not be able to close the issue
    And I should not be able to assign the issue
    And I should not be able to log time on the issue
    When I add the comment "Read on the test site" to the issue
    Then the issue should show the comment "Read on the test site" by "reader"

  @js-off
  Scenario: An account with no access is refused the private repository
    Given I am a logged in user with the "stranger" user
    Then I should be refused the repository "owner/webship-site"

import XCTest

/// Signs in with App Review's demo account against tare.news, then deletes it from Settings.
/// Runs only when the demo code is given: TEST_RUNNER_REVIEW_CODE=<code> xcodebuild … test
final class AccountDeletionUITests: XCTestCase {
    func testSignInThenDeleteAccount() throws {
        guard let code = ProcessInfo.processInfo.environment["REVIEW_CODE"] else { throw XCTSkip("set TEST_RUNNER_REVIEW_CODE to run") }
        let app = XCUIApplication()
        app.launchArguments = ["-onboarded", "YES"]
        app.launch()

        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 15))
        app.buttons["Settings"].tap()
        app.buttons["Sign in"].firstMatch.tap()
        let email = app.textFields["you@example.com"]
        XCTAssertTrue(email.waitForExistence(timeout: 5))
        email.tap()
        email.typeText("appreview@tare.news")
        app.buttons["Email me a code"].tap()
        let codeField = app.textFields["6-digit code"]
        XCTAssertTrue(codeField.waitForExistence(timeout: 15))
        codeField.tap()
        codeField.typeText(code)
        // The sheet's button, not the one in Settings underneath it.
        let signIn = app.buttons.matching(identifier: "Sign in").allElementsBoundByIndex.last { $0.isHittable }
        try XCTUnwrap(signIn).tap()

        let delete = app.buttons["Delete account"].firstMatch
        XCTAssertTrue(delete.waitForExistence(timeout: 15), "signed in")
        delete.tap()
        let confirm = app.buttons.matching(identifier: "Delete account").element(boundBy: 1)
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "asks to confirm")
        confirm.tap()
        XCTAssertTrue(app.buttons["Sign in"].waitForExistence(timeout: 15), "signed out after deleting")
        XCTAssertFalse(app.buttons["Delete account"].exists)
    }
}

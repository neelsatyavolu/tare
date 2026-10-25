import XCTest

/// The first-launch cards: page through them, leave notifications for later, land on the edition.
final class OnboardingUITests: XCTestCase {
    func testPagingThroughOnboardingToTheEdition() {
        let app = XCUIApplication()
        app.launchArguments = ["-showOnboarding", "YES"]
        app.launch()

        XCTAssertTrue(app.staticTexts["1 OF 4"].waitForExistence(timeout: 10))
        for n in 2...4 {
            app.buttons["Next"].tap()
            XCTAssertTrue(app.staticTexts["\(n) OF 4"].waitForExistence(timeout: 3))
        }
        XCTAssertFalse(app.buttons["Skip"].exists, "the last card has no Skip")
        XCTAssertTrue(app.switches["Breaking news"].exists)

        app.buttons["Not now"].tap()
        XCTAssertFalse(app.staticTexts["4 OF 4"].waitForExistence(timeout: 3), "the cards close")
        XCTAssertTrue(app.buttons["Settings"].waitForExistence(timeout: 10), "the edition is underneath")
    }
}

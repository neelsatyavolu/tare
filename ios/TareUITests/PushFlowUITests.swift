import XCTest

/// Drives the app like a reader: turn notifications on, receive a breaking-news push, tap it, land on the story.
/// The push is sent from outside with `xcrun simctl push` while this test waits (see ios/README.md).
final class PushFlowUITests: XCTestCase {
    func testTurningOnNotificationsAndOpeningAPushedStory() throws {
        let app = XCUIApplication()
        app.launch()
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

        // A fresh install starts with the onboarding cards; the last one turns notifications on.
        let next = app.buttons["Next"]
        if next.waitForExistence(timeout: 10) {
            for _ in 0..<3 { next.tap() }
            app.buttons["Turn on notifications"].tap()
            let allow = springboard.buttons["Allow"]
            if allow.waitForExistence(timeout: 10) { allow.tap() }
        }

        let turnOn = app.buttons["Turn on"]
        if turnOn.waitForExistence(timeout: 10) {
            turnOn.tap()
            let allow = springboard.buttons["Allow"]
            if allow.waitForExistence(timeout: 10) { allow.tap() }
        }
        XCTAssertFalse(app.buttons["Turn on"].waitForExistence(timeout: 3), "the prompt goes away once notifications are on")

        // Go to the home screen so the push shows as a banner, then tap it.
        XCUIDevice.shared.press(.home)
        let banner = springboard.otherElements["Notification"].firstMatch
        guard banner.waitForExistence(timeout: 90) else {
            throw XCTSkip("no push arrived; send one with `xcrun simctl push` while this test waits")
        }
        banner.tap()
        XCTAssertTrue(app.staticTexts["story-headline"].waitForExistence(timeout: 20), "tapping the push opens its story")
    }
}

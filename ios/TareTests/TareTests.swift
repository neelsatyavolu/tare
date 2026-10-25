import XCTest
@testable import Tare

final class TareTests: XCTestCase {
    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"))
        return try Data(contentsOf: url)
    }

    /// The app decodes exactly what tare.news serves (fixtures saved from the live API).
    func testDecodesTheLiveEdition() throws {
        let edition = try JSONDecoder().decode(Edition.self, from: fixture("edition"))
        XCTAssertFalse(edition.stories.isEmpty)
        XCTAssertEqual(edition.sections.first?.id, "front")
        let ids = Set(edition.stories.map(\.id))
        for section in edition.sections {
            XCTAssertTrue(section.storyIds.allSatisfy(ids.contains), "section \(section.id) points at a missing story")
        }
    }

    func testDecodesAFullStoryWithNumberedSources() throws {
        let story = try JSONDecoder().decode(Story.self, from: fixture("story"))
        XCTAssertFalse(story.sources.isEmpty)
        XCTAssertEqual(story.sources.map(\.n), Array(1...story.sources.count))
        let cited = story.summary.flatMap(\.cites)
        XCTAssertTrue(cited.allSatisfy { (1...story.sources.count).contains($0) })
    }

    func testParagraphsMatchTheSite() {
        let s = { (n: Int) in (0..<n).map { Sentence(text: "S\($0).", cites: [1]) } }
        XCTAssertEqual(ArticleText.paragraphs(s(6)).map(\.count), [3, 3])
        XCTAssertEqual(ArticleText.paragraphs(s(4)).map(\.count), [2, 2])
        XCTAssertEqual(ArticleText.paragraphs(s(7)).map(\.count), [3, 2, 2])
        XCTAssertEqual(ArticleText.paragraphs(s(2)).map(\.count), [2])
    }

    @MainActor
    func testEditionChoiceFollowsTheToggles() {
        let defaults = UserDefaults(suiteName: "tare-tests-\(UUID())")!
        let settings = NotificationSettings(defaults: defaults)
        XCTAssertEqual(settings.editions, "both")
        settings.evening = false
        XCTAssertEqual(settings.editions, "morning")
        settings.morning = false
        XCTAssertEqual(settings.editions, "none")
        XCTAssertFalse(NotificationSettings(defaults: defaults).morning, "choices persist")
    }

    func testStoryLinks() {
        let id = String(repeating: "a", count: 32)
        XCTAssertEqual(Router.storyId(from: URL(string: "tare://s/\(id)")!), id)
        XCTAssertEqual(Router.storyId(from: URL(string: "https://tare.news/s/\(id)")!), id)
        XCTAssertNil(Router.storyId(from: URL(string: "tare://s/nope")!))
    }

    @MainActor
    func testRouterOpensAStoryOnce() {
        let router = Router()
        router.open(storyId: "abc")
        router.open(storyId: "abc")
        XCTAssertEqual(router.path, [.story("abc")])
    }
}

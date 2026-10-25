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

    func testOnboardingShowsOnlyOnAFirstLaunch() {
        XCTAssertTrue(OnboardingView.shouldShow(onboarded: false, authorization: .notDetermined, signedIn: false))
        XCTAssertFalse(OnboardingView.shouldShow(onboarded: true, authorization: .notDetermined, signedIn: false))
        // Readers from before onboarding existed already chose about notifications, or signed in.
        XCTAssertFalse(OnboardingView.shouldShow(onboarded: false, authorization: .authorized, signedIn: false))
        XCTAssertFalse(OnboardingView.shouldShow(onboarded: false, authorization: .denied, signedIn: false))
        XCTAssertFalse(OnboardingView.shouldShow(onboarded: false, authorization: .notDetermined, signedIn: true))
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

    // MARK: Subtopics, distribution and the source spectrum

    /// The story fixture with `edit` applied to its JSON, for fields a fixture doesn't happen to carry.
    private func story(_ edit: (inout [String: Any]) -> Void = { _ in }) throws -> Story {
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: fixture("story")) as? [String: Any])
        edit(&json)
        return try JSONDecoder().decode(Story.self, from: JSONSerialization.data(withJSONObject: json))
    }

    func testDecodesDistributionAndSourceScores() throws {
        let story = try story()
        let d = try XCTUnwrap(story.distribution)
        let outlets = Spectrum.outlets(story.sources)
        XCTAssertEqual(d.total, outlets.count, "distribution counts distinct outlets")
        XCTAssertEqual(Bucket.allCases.map { d[$0] }.reduce(0, +) + d.unrated, d.total)
        for b in Bucket.allCases {
            XCTAssertEqual(d[b], outlets.filter { Bucket.of($0) == b }.count, "bucket \(b)")
        }
        XCTAssertEqual(d.unrated, outlets.filter { $0.bucket == "unrated" }.count)
        XCTAssertTrue(outlets.allSatisfy { ($0.zeta == nil) == ($0.bucket == "unrated") }, "only unrated outlets lack a score")
    }

    func testDecodesASubtopic() throws {
        let story = try story { $0["subtopic"] = "f1"; $0["subtopicName"] = "Formula 1" }
        XCTAssertEqual(story.subtopic, "f1")
        XCTAssertEqual(story.subtopicName, "Formula 1")
    }

    /// JSON from a server older than these fields still decodes, and a source's bucket falls back to its lean.
    func testDecodesAnOlderServersStory() throws {
        let story = try story { json in
            for key in ["subtopic", "subtopicName", "distribution"] { json.removeValue(forKey: key) }
            json["sources"] = (json["sources"] as? [[String: Any]])?.map { $0.filter { $0.key != "zeta" && $0.key != "bucket" } }
        }
        XCTAssertNil(story.subtopic)
        XCTAssertNil(story.distribution)
        let leanLeft = try XCTUnwrap(story.sources.first { $0.lean == "lean-left" })
        XCTAssertNil(leanLeft.bucket)
        XCTAssertEqual(Bucket.of(leanLeft), .leanLeft)
        XCTAssertTrue(Spectrum.marks(story.sources, width: 343, radius: 5, pad: 6).isEmpty, "no scores, nothing placed")
    }

    func testDistributionSentenceMatchesTheSite() {
        let d = Distribution(left: 0, leanLeft: 2, center: 6, leanRight: 0, right: 2, unrated: 1, total: 11)
        XCTAssertEqual(d.sentence, "Of the 10 rated outlets that covered it, 2 are left of center, 6 are center and 2 are right of center (2 of them in the Right group). 1 more is not rated.")
        XCTAssertEqual(d.label, "Outlets by lean, left to right: 0 left, 2 leaning left, 6 center, 0 leaning right, 2 right; 1 not rated.")
        let none = Distribution(left: 0, leanLeft: 0, center: 0, leanRight: 0, right: 0, unrated: 2, total: 2)
        XCTAssertEqual(none.sentence, "None of the 2 outlets that covered it has a lean score, so none can be placed left to right.")
    }

    func testSpectrumPlacesRatedOutletsWithoutOverlap() throws {
        let story = try story()
        let (width, r, pad) = (343.0, 5.0, 6.0)
        let marks = Spectrum.marks(story.sources, width: width, radius: r, pad: pad)
        XCTAssertEqual(marks.count, story.distribution?.rated)
        XCTAssertEqual(marks.map(\.zeta), marks.map(\.zeta).sorted(), "left to right by score")
        XCTAssertTrue(marks.allSatisfy { $0.x >= pad && $0.x <= width - pad })
        XCTAssertFalse(marks.contains { $0.source.zeta == nil }, "unrated outlets are never placed")
        for level in Set(marks.map(\.level)) {
            let xs = marks.filter { $0.level == level }.map(\.x)
            XCTAssertTrue(zip(xs, xs.dropFirst()).allSatisfy { $1 - $0 >= 2 * r }, "row \(level) overlaps")
        }
        let span = Spectrum.spanFor(story.sources)
        XCTAssertEqual(Spectrum.x(0, width: width, pad: pad, span: span), width / 2, accuracy: 0.001, "0 is the middle")
        XCTAssertGreaterThanOrEqual(span, story.sources.compactMap(\.zeta).map(abs).max() ?? 0, "no score falls off the axis")
        XCTAssertEqual(Spectrum.score(-0.8123), "−0.81")
        XCTAssertEqual(Spectrum.score(1.1), "+1.10")
    }

    func testReadAcrossPicksOnePerSide() throws {
        let story = try story()
        let picks = ReadAcross.picks(story)
        for (side, source) in picks { XCTAssertEqual(source.side, side) }
        XCTAssertEqual(Set(picks.keys), Set(story.sources.map(\.side)).subtracting(["unrated"]))
        XCTAssertTrue(ReadAcross.shows(picks))
        // Within a side, the source the summary cites most wins.
        let cited = { (s: SourceRef) in story.summary.filter { $0.cites.contains(s.n) }.count }
        for (side, source) in picks {
            XCTAssertEqual(cited(source), story.sources.filter { $0.side == side }.map(cited).max())
        }
        let oneSided = try self.story { json in
            json["sources"] = (json["sources"] as? [[String: Any]])?.filter { $0["side"] as? String == "center" }
        }
        XCTAssertFalse(ReadAcross.shows(ReadAcross.picks(oneSided)), "hidden when only one side covered it")
    }
}

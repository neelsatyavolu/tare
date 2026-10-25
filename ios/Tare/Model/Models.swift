import Foundation

/// The edition as `GET /api/v1/edition` returns it. The server lays it out; the app only renders it.
struct Edition: Codable, Sendable {
    let date: String
    let number: Int
    let isToday: Bool
    let slot: String?
    let updatedAt: Double?
    let sections: [EditionSection]
    let stories: [Story]
}

struct EditionSection: Codable, Sendable, Identifiable {
    let id: String
    let name: String
    let storyIds: [String]
}

struct Story: Codable, Sendable, Identifiable, Hashable {
    let id: String
    let url: String
    let front: Bool
    let topic: String
    let topicName: String
    /// Optional fields the API added later stay optional, so an older server's JSON still decodes.
    let subtopic: String?
    let subtopicName: String?
    let headline: String
    let cardLine: String
    let summary: [Sentence]
    let why: Sentence?
    let coverage: Coverage
    /// Distinct outlets per lean bucket, for the distribution bar and the spectrum.
    let distribution: Distribution?
    let blindspot: String?
    let importance: Int?
    let firstSeenAt: Double?
    let photo: Photo?
    let correction: Correction?
    let namedOutlets: String
    let differences: [Difference]
    let readFirst: ReadFirst?
    let sources: [SourceRef]

    /// Shown for a story's first three hours, like the site's "New" marker.
    var isNew: Bool {
        guard let first = firstSeenAt else { return false }
        return Date().timeIntervalSince1970 * 1000 - first < 3 * 3600 * 1000
    }

    var webURL: URL { URL(string: "https://tare.news\(url)")! }
}

struct Sentence: Codable, Sendable, Hashable {
    let text: String
    /// Source numbers, matching `SourceRef.n`.
    let cites: [Int]
}

struct Coverage: Codable, Sendable, Hashable {
    let left: Int
    let center: Int
    let right: Int
    let unrated: Int
    let total: Int
    /// Right share minus left share over their sum, from -1 (all left) to 1 (all right).
    let balance: Double
    let sideSize: SideSize
    let reading: Reading

    struct SideSize: Codable, Sendable, Hashable { let left: Int; let center: Int; let right: Int }
    struct Reading: Codable, Sendable, Hashable { let key: String; let sentence: String; let tag: String }

    /// Too few left- or right-leaning outlets to weigh: the scale is a single line.
    var isThin: Bool { reading.key == "thin" }
    var counts: String { "L \(left) · C \(center) · R \(right)\(unrated > 0 ? " · \(unrated) not rated" : "")" }
}

struct Photo: Codable, Sendable, Hashable {
    let url: URL
    let credit: String
}

struct Correction: Codable, Sendable, Hashable {
    let note: String
    let at: Double
}

struct Difference: Codable, Sendable, Hashable {
    let kind: String
    let label: String
    let text: String
    let cites: [Int]
    let quotes: [SourceRef]
}

struct ReadFirst: Codable, Sendable, Hashable {
    let label: String
    let title: String
    let url: URL
    let outlet: String
}

struct SourceRef: Codable, Sendable, Hashable, Identifiable {
    let n: Int
    let id: String
    let outlet: String
    let lean: String
    let leanLabel: String
    /// "left", "center", "right" or "unrated".
    let side: String
    /// The outlet's Eady 2025 audience-lean score; nil when it has none.
    let zeta: Double?
    /// "left", "leanLeft", "center", "leanRight", "right" or "unrated": a key into the story's `distribution`.
    let bucket: String?
    let title: String
    let url: URL
    let publishedAt: Double
    let snippet: String?
}

// MARK: Account and briefings

struct SignedIn: Decodable, Sendable {
    let token: String
    let email: String
}

struct Me: Decodable, Sendable {
    struct AI: Decodable, Sendable { let provider: String; let name: String }
    let email: String
    /// The Grok or ChatGPT account connected on tare.news, which writes this reader's briefings.
    let ai: AI?
}

/// A story's detailed briefing, as `GET /api/v1/stories/:id/briefing` returns it.
struct BriefingState: Decodable, Sendable, Equatable {
    struct Paragraph: Decodable, Sendable, Equatable { let text: String; let cites: [Int]; let web: [String] }
    struct Section: Decodable, Sendable, Equatable, Identifiable { let heading: String; let paragraphs: [Paragraph]; var id: String { heading } }
    struct WebPage: Decodable, Sendable, Equatable, Identifiable { let id: String; let title: String; let url: URL }

    /// "none", "writing", "ready" or "failed".
    let status: String
    let provider: String?
    let error: String?
    let sections: [Section]
    let web: [WebPage]

    enum CodingKeys: String, CodingKey { case status, provider, error, sections, web }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try c.decode(String.self, forKey: .status)
        provider = try c.decodeIfPresent(String.self, forKey: .provider)
        error = try c.decodeIfPresent(String.self, forKey: .error)
        sections = try c.decodeIfPresent([Section].self, forKey: .sections) ?? []
        web = try c.decodeIfPresent([WebPage].self, forKey: .web) ?? []
    }
}

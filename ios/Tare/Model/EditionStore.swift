import Foundation

/// Today's edition, fetched from tare.news and refreshed when it's likely to have changed.
@MainActor @Observable
final class EditionStore {
    private(set) var edition: Edition?
    private(set) var storiesById: [String: Story] = [:]
    private(set) var error: String?
    private(set) var isLoading = false
    private var loadedAt: Date?

    private let api: TareAPI
    /// The edition is rebuilt every hour; checking again after a few minutes away is enough.
    private let staleAfter: TimeInterval = 5 * 60

    init(api: TareAPI = .shared) {
        self.api = api
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            let edition = try await api.edition()
            self.edition = edition
            storiesById = Dictionary(edition.stories.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            loadedAt = Date()
            error = nil
        } catch {
            // Keep showing what's already loaded; only an empty screen needs the message.
            self.error = error.localizedDescription
        }
    }

    func refreshIfStale() async {
        if let loadedAt, Date().timeIntervalSince(loadedAt) < staleAfter { return }
        await load()
    }

    func stories(in section: EditionSection) -> [Story] {
        section.storyIds.compactMap { storiesById[$0] }
    }
}

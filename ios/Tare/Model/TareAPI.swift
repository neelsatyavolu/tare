import Foundation

/// The client for tare.news's JSON API.
struct TareAPI: Sendable {
    static let shared = TareAPI()

    var base = URL(string: "https://tare.news/api/v1/")!
    var session: URLSession = .shared

    enum APIError: LocalizedError {
        case status(Int)
        var errorDescription: String? {
            switch self {
            case .status(404): "There's no edition yet. Check back soon."
            case .status(let code): "Tare couldn't be reached (\(code)). Try again in a moment."
            }
        }
    }

    func edition() async throws -> Edition {
        // The phone's zone, so the edition is labeled morning or evening by the reader's clock.
        try await get("edition", query: [URLQueryItem(name: "tz", value: TimeZone.current.identifier)])
    }

    func story(_ id: String) async throws -> Story {
        try await get("stories/\(id)")
    }

    /// Registers this device's push token and its notification choices.
    func register(_ registration: DeviceRegistration) async throws {
        var request = URLRequest(url: base.appending(path: "devices"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONEncoder().encode(registration)
        let (_, response) = try await session.data(for: request)
        try check(response)
    }

    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        let url = base.appending(path: path)
        var request = URLRequest(url: query.isEmpty ? url : url.appending(queryItems: query))
        request.cachePolicy = .reloadRevalidatingCacheData
        let (data, response) = try await session.data(for: request)
        try check(response)
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func check(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { return }
        guard (200..<300).contains(http.statusCode) else { throw APIError.status(http.statusCode) }
    }
}

/// What the server keeps about a device: its token and which notifications it wants. No account, no email.
struct DeviceRegistration: Codable, Sendable, Equatable {
    let token: String
    /// "production" for TestFlight and App Store builds, "sandbox" for development builds.
    let environment: String
    /// "both", "morning", "evening" or "none".
    let editions: String
    let breaking: Bool
    /// The phone's IANA time zone: editions arrive at 7 a.m. and 6 p.m. here.
    var timezone: String = TimeZone.current.identifier
}

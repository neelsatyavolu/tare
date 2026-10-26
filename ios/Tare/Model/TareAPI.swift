import Foundation

/// The client for tare.news's JSON API.
struct TareAPI: Sendable {
    static let shared = TareAPI()

    var base = URL(string: "https://tare.news/api/v1/")!
    var session: URLSession = .shared

    enum APIError: LocalizedError {
        case status(Int)
        /// The server's own explanation, e.g. "That code didn't work."
        case message(Int, String)
        var errorDescription: String? {
            switch self {
            case .status(404): "There's no edition yet. Check back soon."
            case .status(let code): "Tare couldn't be reached (\(code)). Try again in a moment."
            case .message(_, let text): text
            }
        }
        var statusCode: Int {
            switch self {
            case .status(let code), .message(let code, _): code
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

    // MARK: Account (sign in with an emailed code; the token is a Tare session)

    func requestCode(email: String) async throws {
        let _: OK = try await send("signin", body: ["email": email])
    }

    func verify(email: String, code: String) async throws -> SignedIn {
        try await send("signin/verify", body: ["email": email, "code": code])
    }

    func me(token: String) async throws -> Me {
        try await send("me", method: "GET", token: token)
    }

    func setAutoBriefings(_ on: Bool, token: String) async throws {
        var request = URLRequest(url: base.appending(path: "me/auto-briefings"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        request.httpBody = try JSONEncoder().encode(["on": on])
        let (_, response) = try await session.data(for: request)
        try check(response)
    }

    func signOut(token: String) async throws {
        let _: OK = try await send("signout", token: token)
    }

    func deleteAccount(token: String) async throws {
        let _: OK = try await send("me", method: "DELETE", token: token)
    }

    func briefing(storyId: String) async throws -> BriefingState {
        try await send("stories/\(storyId)/briefing", method: "GET")
    }

    func requestBriefing(storyId: String, token: String) async throws {
        let _: OK = try await send("stories/\(storyId)/briefing", token: token)
    }

    /// An uncached JSON request; a failure carries the server's message when it sent one.
    private func send<T: Decodable>(_ path: String, method: String = "POST", body: [String: String]? = nil, token: String? = nil) async throws -> T {
        var request = URLRequest(url: base.appending(path: path))
        request.httpMethod = method
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await session.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            let message = (try? JSONDecoder().decode(ServerError.self, from: data))?.error
            throw message.map { APIError.message(http.statusCode, $0) } ?? APIError.status(http.statusCode)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private struct OK: Decodable {}
    private struct ServerError: Decodable { let error: String }

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

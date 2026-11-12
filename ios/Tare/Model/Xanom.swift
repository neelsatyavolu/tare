import AuthenticationServices
import CryptoKit
import Foundation
import SwiftUI

/// "Continue with Xanom": one account for the Xanom apps (accounts.xanom.co). tare.news runs the sign-in as
/// its own server-side client inside a browser sheet; the sheet comes back to `tare://xanom?ticket=…`, and the
/// app swaps that one-time ticket for the same Tare session token the emailed code gives.
enum XanomIntent: String, Sendable {
    case signin, link, convert
}

enum XanomCallback: Equatable {
    case ticket(String)
    case failure(String)

    /// Reads `tare://xanom?ticket=<64 hex>` or `tare://xanom?error=<code>&message=<text>`.
    init(url: URL) {
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let value = { (name: String) in items.first { $0.name == name }?.value }
        if url.scheme == "tare", url.host() == "xanom", let ticket = value("ticket"), ticket.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil {
            self = .ticket(ticket)
        } else {
            self = .failure(value("message") ?? "Xanom sign-in didn't go through. Try again.")
        }
    }
}

/// A PKCE-style pair: the start URL carries the challenge, and only this verifier can redeem the ticket.
struct XanomVerifier {
    let verifier: String
    let challenge: String

    init(verifier: String = XanomVerifier.random()) {
        self.verifier = verifier
        challenge = Self.base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    static func random() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return base64url(Data(bytes))
    }

    static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}

struct XanomError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

extension Account {
    /// Runs a Xanom sign-in, link or convert in a browser sheet that shares Safari's cookies (not ephemeral),
    /// so a reader already signed in to Xanom gets through in one tap. Cancelling is not an error.
    func continueWithXanom(_ intent: XanomIntent, using session: WebAuthenticationSession) async throws {
        let pair = XanomVerifier()
        let start = try await xanomStartURL(intent).appending(queryItems: [URLQueryItem(name: "challenge", value: pair.challenge)])
        let callback: URL
        do {
            callback = try await session.authenticate(using: start, callbackURLScheme: "tare", preferredBrowserSession: .shared)
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            return
        }
        try await finishXanom(callback: callback, verifier: pair.verifier)
    }
}

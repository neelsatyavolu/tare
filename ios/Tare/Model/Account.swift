import Foundation
import Security

/// The signed-in reader, if any. Signing in uses a code emailed to the reader; the session token lives in the
/// Keychain. Being signed in lets the app ask for detailed briefings with the Grok or ChatGPT account the
/// reader connected on tare.news.
@MainActor @Observable
final class Account {
    private(set) var email: String?
    private(set) var ai: Me.AI?
    /// The Xanom account this reader is linked to, if any.
    private(set) var xanom: Me.Xanom?
    private(set) var token: String? = Keychain.read()

    private let api = TareAPI.shared

    var isSignedIn: Bool { token != nil }

    func requestCode(email: String) async throws {
        try await api.requestCode(email: email)
    }

    func verify(email: String, code: String) async throws {
        let signedIn = try await api.verify(email: email, code: code)
        Keychain.save(signedIn.token)
        token = signedIn.token
        self.email = signedIn.email
        await refresh()
    }

    /// Reloads the email and AI connection (the reader may have connected one on the site since).
    func refresh() async {
        guard let token else { return }
        do {
            let me = try await api.me(token: token)
            email = me.email
            ai = me.ai
            xanom = me.xanom
        } catch let error as TareAPI.APIError where error.statusCode == 401 {
            forget()
        } catch {
            // Offline: keep what we know.
        }
    }

    /// Where the Xanom browser sheet starts. Linking and converting need a one-time URL for this reader.
    func xanomStartURL(_ intent: XanomIntent) async throws -> URL {
        if intent == .signin { return api.xanomSignInURL }
        guard let token else { throw XanomError(message: "Sign in first.") }
        return try await api.xanomStart(intent: intent.rawValue, token: token)
    }

    /// Swaps the ticket the sheet came back with for a session, replacing (and ending) any session we had.
    func finishXanom(callback url: URL, verifier: String) async throws {
        switch XanomCallback(url: url) {
        case .failure(let message):
            throw XanomError(message: message)
        case .ticket(let ticket):
            let signedIn = try await api.xanomExchange(ticket: ticket, verifier: verifier)
            if let old = token, old != signedIn.token { try? await api.signOut(token: old) }
            Keychain.save(signedIn.token)
            token = signedIn.token
            email = signedIn.email
            await refresh()
        }
    }

    func setAutoBriefings(_ on: Bool) async {
        guard let token else { return }
        try? await api.setAutoBriefings(on, token: token)
        await refresh()
    }

    func signOut() async {
        if let token { try? await api.signOut(token: token) }
        forget()
    }

    /// Deletes the account on Tare (email, sessions, connected AI account), then signs out here.
    func deleteAccount() async throws {
        guard let token else { return }
        try await api.deleteAccount(token: token)
        forget()
    }

    private func forget() {
        Keychain.delete()
        token = nil
        email = nil
        ai = nil
        xanom = nil
    }
}

/// One generic password item holding the session token, readable only on this device after first unlock.
private enum Keychain {
    private static var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "co.xanom.tare", kSecAttrAccount as String: "session"] }

    static func read() -> String? {
        var result: AnyObject?
        let status = SecItemCopyMatching(query.merging([kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]) { $1 } as CFDictionary, &result)
        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ token: String) {
        delete()
        let attributes: [String: Any] = [kSecValueData as String: Data(token.utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        SecItemAdd(query.merging(attributes) { $1 } as CFDictionary, nil)
    }

    static func delete() {
        SecItemDelete(query as CFDictionary)
    }
}

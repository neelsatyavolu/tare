import Foundation
import Security

/// The signed-in reader, if any. Signing in uses a code emailed to the reader; the session token lives in the
/// Keychain. Being signed in lets the app ask for detailed briefings with the Grok or ChatGPT account the
/// reader connected on tare.news.
@MainActor @Observable
final class Account {
    private(set) var email: String?
    private(set) var ai: Me.AI?
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
        } catch let error as TareAPI.APIError where error.statusCode == 401 {
            forget()
        } catch {
            // Offline: keep what we know.
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

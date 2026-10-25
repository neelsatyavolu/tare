import SwiftUI

/// Sign in with the email on a Tare account: Tare emails a six-digit code, the reader types it here.
struct SignInView: View {
    @Environment(Account.self) private var account
    @Environment(\.dismiss) private var dismiss
    @State private var email = ""
    @State private var code = ""
    @State private var sentTo: String?
    @State private var working = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                if let sentTo {
                    Section {
                        TextField("6-digit code", text: $code)
                            .keyboardType(.numberPad)
                            .textContentType(.oneTimeCode)
                            .font(Theme.mono(20))
                        Button("Sign in") { Task { await verify(sentTo) } }
                            .disabled(code.filter(\.isNumber).count != 6 || working)
                    } header: {
                        Text("Code")
                    } footer: {
                        Text("We emailed a code to \(sentTo). It works for 15 minutes. Nothing there? Check spam, or wait a few minutes and ask again.")
                    }
                    Section { Button("Use a different email") { self.sentTo = nil; code = "" } }
                } else {
                    Section {
                        TextField("you@example.com", text: $email)
                            .keyboardType(.emailAddress)
                            .textContentType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Button("Email me a code") { Task { await requestCode() } }
                            .disabled(!email.contains("@") || working)
                    } header: {
                        Text("Email")
                    } footer: {
                        Text("No password. Use the same email as on tare.news to use the Grok or ChatGPT account you connected there for detailed briefings. A new email makes a new account.")
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(Theme.ink2) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.paper)
            .navigationTitle("Sign in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .overlay { if working { ProgressView() } }
        }
    }

    private func requestCode() async {
        let address = email.trimmingCharacters(in: .whitespaces)
        await run {
            try await account.requestCode(email: address)
            sentTo = address
        }
    }

    private func verify(_ address: String) async {
        await run {
            try await account.verify(email: address, code: code.filter(\.isNumber))
            dismiss()
        }
    }

    private func run(_ work: () async throws -> Void) async {
        working = true
        error = nil
        do { try await work() } catch { self.error = error.localizedDescription }
        working = false
    }
}

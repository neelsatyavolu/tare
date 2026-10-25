import SwiftUI

struct SettingsView: View {
    @Environment(NotificationSettings.self) private var notifications
    @Environment(Account.self) private var account
    @State private var signingIn = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        @Bindable var notifications = notifications
        NavigationStack {
            Form {
                Section {
                    if let email = account.email ?? (account.isSignedIn ? "Signed in" : nil) {
                        LabeledContent("Signed in as", value: email)
                        LabeledContent("Briefings written with", value: account.ai?.name ?? "Not connected")
                        if let ai = account.ai {
                            Toggle("Automatic briefings", isOn: Binding(
                                get: { ai.autoBriefings ?? false },
                                set: { on in Task { await account.setAutoBriefings(on) } }
                            ))
                        } else {
                            Link("Connect Grok or ChatGPT on tare.news", destination: URL(string: "https://tare.news/account#ai")!)
                        }
                        Button("Sign out", role: .destructive) { Task { await account.signOut() } }
                    } else {
                        Button("Sign in") { signingIn = true }
                    }
                } header: {
                    Text("Account")
                } footer: {
                    Text("Signing in lets you ask for detailed briefings, written with the Grok or ChatGPT account you connect on tare.news. With automatic briefings on, that account also writes them for front-page stories in the background, at most 6 a day, using its fastest model at the lowest effort. Reading needs no account.")
                }
                Section {
                    if notifications.isOn {
                        Toggle("Morning edition", isOn: $notifications.morning)
                        Toggle("Evening edition", isOn: $notifications.evening)
                        Toggle("Breaking news", isOn: $notifications.breaking)
                    } else if notifications.authorization == .denied {
                        Text("Notifications are off for Tare.")
                        Button("Open Settings") { openURL(URL(string: UIApplication.openSettingsURLString)!) }
                    } else {
                        Button("Turn on notifications") { Task { await notifications.requestPermission() } }
                    }
                    if let error = notifications.lastError {
                        Text(error).font(.footnote).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Notifications")
                } footer: {
                    Text("The morning edition arrives at 7 a.m. and the evening edition at 6 p.m., your time. Breaking news is major new stories on the front page, as several outlets report them; at most three an hour. Tare keeps your device's notification token and these choices, nothing else.")
                }
                Section("About") {
                    Link("How Tare works", destination: URL(string: "https://tare.news/method")!)
                    Link("Get the edition by email", destination: URL(string: "https://tare.news/#subscribe")!)
                    Link("Open source (MIT)", destination: URL(string: "https://github.com/neelsatyavolu/tare")!)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.paper)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .sheet(isPresented: $signingIn) { SignInView() }
            .task { await account.refresh() }
        }
    }
}

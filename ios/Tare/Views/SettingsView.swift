import SwiftUI

struct SettingsView: View {
    @Environment(NotificationSettings.self) private var notifications
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    var body: some View {
        @Bindable var notifications = notifications
        NavigationStack {
            Form {
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
                    Text("The morning edition arrives by 7 a.m. Eastern and the evening edition by 6 p.m. Breaking news is only the most consequential stories, at most one an hour. Tare keeps your device's notification token and these choices, nothing else.")
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
        }
    }
}

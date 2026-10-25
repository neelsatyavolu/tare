import SwiftUI
import UserNotifications

/// The reader's notification choices, kept on the device and sent to Tare with the push token.
@MainActor @Observable
final class NotificationSettings {
    var morning: Bool { didSet { save() } }
    var evening: Bool { didSet { save() } }
    var breaking: Bool { didSet { save() } }
    private(set) var authorization: UNAuthorizationStatus = .notDetermined
    private(set) var lastError: String?

    private let defaults: UserDefaults
    private let api: TareAPI
    private var token: String?
    private var registered: DeviceRegistration?

    init(defaults: UserDefaults = .standard, api: TareAPI = .shared) {
        self.defaults = defaults
        self.api = api
        defaults.register(defaults: ["notify.morning": true, "notify.evening": true, "notify.breaking": true])
        morning = defaults.bool(forKey: "notify.morning")
        evening = defaults.bool(forKey: "notify.evening")
        breaking = defaults.bool(forKey: "notify.breaking")
    }

    /// What the server stores for the edition choice.
    var editions: String {
        switch (morning, evening) {
        case (true, true): "both"
        case (true, false): "morning"
        case (false, true): "evening"
        case (false, false): "none"
        }
    }

    var isOn: Bool { authorization == .authorized || authorization == .provisional || authorization == .ephemeral }

    func refreshAuthorization() async {
        authorization = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        if isOn { UIApplication.shared.registerForRemoteNotifications() }
    }

    /// Asks once; after a refusal only the Settings app can turn notifications on.
    func requestPermission() async {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        await refreshAuthorization()
    }

    func received(token: String) async {
        self.token = token
        await sync()
    }

    func registrationFailed(_ error: Error) {
        lastError = error.localizedDescription
    }

    /// Sends the current choices to Tare whenever they or the token change.
    func sync() async {
        guard let token else { return }
        let registration = DeviceRegistration(token: token, environment: Self.environment, editions: editions, breaking: breaking)
        guard registration != registered else { return }
        do {
            try await api.register(registration)
            registered = registration
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func save() {
        defaults.set(morning, forKey: "notify.morning")
        defaults.set(evening, forKey: "notify.evening")
        defaults.set(breaking, forKey: "notify.breaking")
        Task { await sync() }
    }

    /// Development builds get sandbox tokens; TestFlight and App Store builds get production ones.
    static var environment: String {
        #if DEBUG
        "sandbox"
        #else
        "production"
        #endif
    }
}

import UIKit
import UserNotifications

/// Owns the app's shared state and receives push callbacks, which only an app delegate gets.
@MainActor
// @preconcurrency: iOS calls the notification delegate on the main thread. The async forms of these callbacks
// complete off the main thread, which UIKit asserts against (it crashed on tapping a notification).
final class AppDelegate: NSObject, UIApplicationDelegate, @preconcurrency UNUserNotificationCenterDelegate {
    let router = Router()
    let editionStore = EditionStore()
    let notifications = NotificationSettings()
    let account = Account()

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        Task { await notifications.refreshAuthorization() }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { await notifications.received(token: token) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        notifications.registrationFailed(error)
    }

    // A notification arrives while Tare is open: show it as a banner anyway.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    // A notification is tapped: open its story, or the edition for an edition notification.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let storyId = response.notification.request.content.userInfo["storyId"] as? String
        Task { await editionStore.load() }
        if let storyId { router.open(storyId: storyId) } else { router.path = [] }
        completionHandler()
    }
}

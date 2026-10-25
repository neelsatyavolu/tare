import SwiftUI

@main
struct TareApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(delegate.router)
                .environment(delegate.editionStore)
                .environment(delegate.notifications)
                .tint(Theme.brass)
        }
        .onChange(of: scenePhase) { _, phase in
            // Coming back to the app: the edition may have been rebuilt since (it updates hourly).
            if phase == .active { Task { await delegate.editionStore.refreshIfStale() } }
        }
    }
}

/// Where the app is: the edition at the root, stories pushed on top. A tapped notification pushes its story.
@MainActor @Observable
final class Router {
    var path: [Route] = []

    enum Route: Hashable {
        case story(String)
    }

    /// The story id in `tare://s/<id>` or `https://tare.news/s/<id>`.
    nonisolated static func storyId(from url: URL) -> String? {
        let parts = (url.scheme == "tare" ? [url.host() ?? ""] + url.pathComponents : url.pathComponents).filter { $0 != "/" && !$0.isEmpty }
        guard parts.count == 2, parts[0] == "s", parts[1].range(of: "^[0-9a-f]{32}$", options: .regularExpression) != nil else { return nil }
        return parts[1]
    }

    func open(storyId: String) {
        if path.last != .story(storyId) { path.append(.story(storyId)) }
    }
}

import SwiftUI

struct RootView: View {
    @Environment(Router.self) private var router
    @Environment(EditionStore.self) private var store
    @Environment(NotificationSettings.self) private var notifications
    @Environment(Account.self) private var account
    @AppStorage("onboarded") private var onboarded = false
    @State private var onboarding = false

    var body: some View {
        @Bindable var router = router
        NavigationStack(path: $router.path) {
            EditionView()
                .navigationDestination(for: Router.Route.self) { route in
                    switch route {
                    case .story(let id): StoryView(id: id)
                    }
                }
        }
        .fullScreenCover(isPresented: $onboarding) {
            OnboardingView {
                onboarded = true
                onboarding = false
            }
        }
        .task {
            #if DEBUG
            // `-openStory <id>` at launch opens a story directly (screenshots and UI checks).
            if let id = UserDefaults.standard.string(forKey: "openStory") { router.open(storyId: id) }
            // `-showOnboarding YES` shows the first-launch cards whatever the reader chose before.
            if UserDefaults.standard.bool(forKey: "showOnboarding") { onboarding = true }
            #endif
            if !onboarded && !onboarding {
                await notifications.refreshAuthorization()
                if OnboardingView.shouldShow(onboarded: onboarded, authorization: notifications.authorization, signedIn: account.isSignedIn) {
                    onboarding = true
                } else {
                    onboarded = true
                }
            }
            if store.edition == nil { await store.load() }
        }
        // tare://s/<id> (and the site's own /s/<id> path) opens a story.
        .onOpenURL { url in
            if let id = Router.storyId(from: url) { router.open(storyId: id) }
        }
    }
}

import SwiftUI

struct RootView: View {
    @Environment(Router.self) private var router
    @Environment(EditionStore.self) private var store

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
        .task {
            #if DEBUG
            // `-openStory <id>` at launch opens a story directly (screenshots and UI checks).
            if let id = UserDefaults.standard.string(forKey: "openStory") { router.open(storyId: id) }
            #endif
            if store.edition == nil { await store.load() }
        }
        // tare://s/<id> (and the site's own /s/<id> path) opens a story.
        .onOpenURL { url in
            if let id = Router.storyId(from: url) { router.open(storyId: id) }
        }
    }
}

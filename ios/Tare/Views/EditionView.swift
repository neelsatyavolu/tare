import SwiftUI

/// Today's edition: masthead, the front page (lead first), blindspots, then each section.
struct EditionView: View {
    @Environment(EditionStore.self) private var store
    @Environment(NotificationSettings.self) private var notifications
    @State private var showingSettings = false

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                Masthead(edition: store.edition) { showingSettings = true }
                if !notifications.isOn && notifications.authorization == .notDetermined && store.edition != nil {
                    NotificationPrompt()
                }
                if let edition = store.edition {
                    ForEach(edition.sections) { section in
                        SectionHead(title: section.name)
                        let stories = store.stories(in: section)
                        ForEach(Array(stories.enumerated()), id: \.element.id) { index, story in
                            NavigationLink(value: Router.Route.story(story.id)) {
                                if section.id == "front" && index == 0 {
                                    LeadCard(story: story)
                                } else {
                                    StoryRow(story: story)
                                }
                            }
                            .buttonStyle(.plain)
                            Rectangle().fill(Theme.rule).frame(height: 1)
                        }
                    }
                    Text("That's the edition.")
                        .font(Theme.serifItalic(17))
                        .foregroundStyle(Theme.ink2)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 32)
                } else if let error = store.error {
                    ContentUnavailableView("No edition", systemImage: "newspaper", description: Text(error))
                        .padding(.top, 60)
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 80)
                }
            }
            .padding(.horizontal, 16)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.paper)
        .refreshable { await store.load() }
        // No navigation bar on the front page: it was an empty band that then covered the masthead. A paper
        // strip keeps scrolled text out from under the status bar.
        .toolbar(.hidden, for: .navigationBar)
        .overlay(alignment: .top) {
            Color.clear.frame(height: 0).background(Theme.paper.ignoresSafeArea(edges: .top))
        }
        .sheet(isPresented: $showingSettings) { SettingsView() }
    }
}

/// The wordmark between rules, and the edition line under it, as on the site.
struct Masthead: View {
    let edition: Edition?
    var openSettings: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 6) {
            Rectangle().fill(Theme.ink).frame(height: 3)
            Text("Tare")
                .font(Theme.display(52))
                .foregroundStyle(Theme.ink)
                .padding(.top, 6)
                .accessibilityAddTraits(.isHeader)
            Text("The news, zeroed.")
                .font(Theme.serifItalic(14))
                .foregroundStyle(Theme.ink2)
            Rectangle().fill(Theme.ink).frame(height: 1).padding(.top, 6)
            if let edition {
                Text(Self.line(edition))
                    .font(Theme.mono(11))
                    .tracking(0.8)
                    .foregroundStyle(Theme.ink3)
                    .multilineTextAlignment(.center)
                    .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 4)
        .overlay(alignment: .topTrailing) {
            if let openSettings {
                Button(action: openSettings) {
                    Image(systemName: "gearshape").font(.system(size: 19)).foregroundStyle(Theme.ink2).frame(width: 44, height: 44)
                }
                .accessibilityLabel("Settings")
                .padding(.top, 8)
            }
        }
    }

    static func line(_ edition: Edition) -> String {
        var parts = [EditionDate.long(edition.date).uppercased()]
        if let slot = edition.slot { parts.append(slot.uppercased()) }
        parts.append("\(edition.stories.count) STORIES")
        if let updated = edition.updatedAt { parts.append("UPDATED \(EditionDate.ago(updated).uppercased())") }
        return parts.joined(separator: " · ")
    }
}

/// Offered once, under the masthead: notifications are opt-in and explained before iOS asks.
struct NotificationPrompt: View {
    @Environment(NotificationSettings.self) private var notifications

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Get the morning and evening editions, and breaking news, as notifications.")
                .font(Theme.serif(16))
                .foregroundStyle(Theme.ink)
            HStack(spacing: 14) {
                Button("Turn on") { Task { await notifications.requestPermission() } }
                    .buttonStyle(InkButtonStyle())
                Text("Change them any time in Settings.")
                    .font(Theme.mono(11))
                    .foregroundStyle(Theme.ink3)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.sheet)
        .overlay(Rectangle().stroke(Theme.rule))
        .padding(.top, 16)
    }
}

enum EditionDate {
    private static let parser: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    /// "Sunday, October 25, 2026"
    static func long(_ date: String) -> String {
        guard let d = parser.date(from: date) else { return date }
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "EEEE, MMMM d, yyyy"
        return f.string(from: d)
    }

    /// "12 minutes ago"
    static func ago(_ ms: Double) -> String {
        let minutes = max(0, Int((Date().timeIntervalSince1970 * 1000 - ms) / 60_000))
        if minutes < 1 { return "just now" }
        if minutes < 60 { return "\(minutes) minute\(minutes == 1 ? "" : "s") ago" }
        let hours = minutes / 60
        return "\(hours) hour\(hours == 1 ? "" : "s") ago"
    }
}

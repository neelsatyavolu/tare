import SwiftUI
import UserNotifications

/// Shown once, over the first edition: what Tare is, how to read a story, and the notifications, explained
/// before iOS asks. Every card can be skipped; everything here can be changed later in Settings.
struct OnboardingView: View {
    @Environment(NotificationSettings.self) private var notifications
    let finish: () -> Void
    @State private var page = 0

    private static let pages = 4

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Kicker(text: "\(page + 1) of \(Self.pages)")
                Spacer()
                if page < Self.pages - 1 {
                    Button("Skip", action: finish)
                        .font(Theme.mono(13, medium: true))
                        .foregroundStyle(Theme.ink2)
                }
            }
            .frame(height: 44)
            .padding(.horizontal, 20)

            TabView(selection: $page) {
                IntroCard().tag(0)
                ScaleCard().tag(1)
                ReadingCard().tag(2)
                AlertsCard().tag(3)
            }
            .tabViewStyle(.page(indexDisplayMode: .never))

            VStack(spacing: 12) {
                if page < Self.pages - 1 {
                    Button { withAnimation { page += 1 } } label: { Text("Next").frame(maxWidth: .infinity) }
                        .buttonStyle(InkButtonStyle())
                } else {
                    Button {
                        Task {
                            await notifications.requestPermission()
                            finish()
                        }
                    } label: { Text("Turn on notifications").frame(maxWidth: .infinity) }
                        .buttonStyle(InkButtonStyle())
                    Button("Not now", action: finish)
                        .font(Theme.mono(13, medium: true))
                        .foregroundStyle(Theme.ink2)
                        .frame(height: 36)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
        }
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
        .background(Theme.paper)
    }

    /// First launch only, and not for readers who already chose about notifications or signed in (they've
    /// used the app before this screen existed).
    static func shouldShow(onboarded: Bool, authorization: UNAuthorizationStatus, signedIn: Bool) -> Bool {
        !onboarded && authorization == .notDetermined && !signedIn
    }
}

/// One card's layout: a kicker, a headline and its body, scrolling when the text is large.
private struct Card<Content: View>: View {
    let kicker: String
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Rectangle().fill(Theme.ink).frame(height: 1)
                Kicker(text: kicker, color: Theme.ink)
                Text(title)
                    .font(Theme.display(34))
                    .foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
                content
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
    }
}

private struct Para: View {
    let text: String
    var body: some View {
        Text(text)
            .font(Theme.serif(18))
            .lineSpacing(4)
            .foregroundStyle(Theme.ink)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct Footnote: View {
    let text: String
    var body: some View {
        Text(text)
            .font(Theme.mono(12))
            .foregroundStyle(Theme.ink3)
            .fixedSize(horizontal: false, vertical: true)
    }
}

private struct IntroCard: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(spacing: 6) {
                    Rectangle().fill(Theme.ink).frame(height: 3)
                    Text("Tare")
                        .font(Theme.display(64))
                        .foregroundStyle(Theme.ink)
                        .padding(.top, 6)
                        .accessibilityAddTraits(.isHeader)
                    Text("The news, zeroed.")
                        .font(Theme.serifItalic(15))
                        .foregroundStyle(Theme.ink2)
                    Rectangle().fill(Theme.ink).frame(height: 1).padding(.top, 6)
                }
                .frame(maxWidth: .infinity)
                Para(text: "Every hour, Tare reads over a hundred outlets from left to right and puts together the stories that matter: who covered them, and where their accounts differ.")
                Para(text: "It's named after the button that zeroes a scale, so you weigh only what's inside. Nothing is ranked by clicks or tuned to you, and every edition ends.")
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
    }
}

private struct ScaleCard: View {
    // An example, not a real story: 9 of 20 left-leaning, 6 of 30 center and 3 of 18 right-leaning outlets.
    private static let coverage = Coverage(
        left: 9, center: 6, right: 3, unrated: 2, total: 20, balance: -0.46,
        sideSize: .init(left: 20, center: 30, right: 18),
        reading: .init(key: "more-left", sentence: "More left- than right-leaning coverage", tag: "More left-leaning coverage")
    )
    private static let distribution = Distribution(left: 5, leanLeft: 4, center: 6, leanRight: 2, right: 1, unrated: 2, total: 20)

    var body: some View {
        Card(kicker: "How to read · The scale", title: "Who covered it") {
            Para(text: "Each story shows what share of Tare's left-leaning, center and right-leaning outlets covered it, and whether one side covered it more.")
            VStack(alignment: .leading, spacing: 14) {
                Kicker(text: "Example")
                CoverageScaleView(coverage: Self.coverage)
                DistBar(distribution: Self.distribution)
            }
            .padding(14)
            .background(Theme.sheet)
            .overlay(Rectangle().stroke(Theme.rule))
            Para(text: "The thin bar counts every outlet that covered it, left to right: darkest at the ends, lighter for those that lean, hatched for center.")
            Footnote(text: "The labels come from a published study of who reads each outlet (Eady et al., 2025). They say nothing about whether its reporting is accurate.")
        }
    }
}

private struct ReadingCard: View {
    var body: some View {
        Card(kicker: "How to read · A story", title: "Check the work") {
            Point(title: "The small numbers", text: "Every sentence ends with numbers. Each is a source: tap one to see the outlet's own headline and read the original article.")
            Point(title: "Where accounts differ", text: "Where outlets reported facts that can't both be true, or told the same event in ways that leave a different impression. Tare shows the headlines side by side and doesn't say who is right.")
            Point(title: "Blindspots", text: "Stories one side covered widely and the other barely touched, so you see what your usual sources might skip.")
        }
    }

    private struct Point: View {
        let title: String
        let text: String
        var body: some View {
            VStack(alignment: .leading, spacing: 6) {
                Kicker(text: title, color: Theme.ink)
                Text(text)
                    .font(Theme.serif(17))
                    .lineSpacing(3)
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, 6)
            .accessibilityElement(children: .combine)
        }
    }
}

private struct AlertsCard: View {
    @Environment(NotificationSettings.self) private var notifications

    var body: some View {
        @Bindable var notifications = notifications
        Card(kicker: "Notifications", title: "The edition, when it's ready") {
            Para(text: "A morning edition at 7 a.m. and an evening edition at 6 p.m., your time. Breaking news is a major new story on the front page as several outlets report it, at most three an hour.")
            VStack(spacing: 0) {
                Toggle("Morning edition", isOn: $notifications.morning)
                Rectangle().fill(Theme.rule).frame(height: 1).padding(.vertical, 10)
                Toggle("Evening edition", isOn: $notifications.evening)
                Rectangle().fill(Theme.rule).frame(height: 1).padding(.vertical, 10)
                Toggle("Breaking news", isOn: $notifications.breaking)
            }
            .font(Theme.serif(17))
            .foregroundStyle(Theme.ink)
            .padding(14)
            .background(Theme.sheet)
            .overlay(Rectangle().stroke(Theme.rule))
            Footnote(text: "iOS asks next. Change these any time in Settings. Tare keeps your device's notification token and these choices, nothing else.")
        }
    }
}

import SwiftUI

/// The story's detailed briefing: written once, on a reader's request, with that reader's own Grok or
/// ChatGPT reading the full articles, then shown to everyone. Same as the site's.
struct BriefingView: View {
    let storyId: String
    let open: (URL) -> Void
    @Environment(Account.self) private var account
    @State private var state: BriefingState?
    @State private var error: String?
    @State private var signingIn = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Rectangle().fill(Theme.rule).frame(height: 1)
            Kicker(text: "Detailed briefing", color: Theme.brass)
            content
            if let error {
                Text(error).font(Theme.serif(15)).foregroundStyle(Theme.ink2)
            }
        }
        .task(id: storyId) { await poll() }
        .sheet(isPresented: $signingIn) { SignInView() }
    }

    @ViewBuilder private var content: some View {
        switch state?.status {
        case "ready":
            if let state { ReadyBriefing(state: state, open: open) }
        case "writing":
            HStack(spacing: 10) {
                ProgressView()
                Text("Being written. This takes a minute or two; it appears here when it's done.")
                    .font(Theme.serif(15)).foregroundStyle(Theme.ink2)
            }
        case nil:
            ProgressView()
        default:
            if let failed = state?.error, state?.status == "failed" {
                Text(failed).font(Theme.serif(15)).foregroundStyle(Theme.ink2)
            }
            ask
        }
    }

    @ViewBuilder private var ask: some View {
        Text("A longer, cited briefing from the full articles, written with your own Grok or ChatGPT account and then shared with every reader.")
            .font(Theme.serif(16)).foregroundStyle(Theme.ink)
            .fixedSize(horizontal: false, vertical: true)
        if !account.isSignedIn {
            Button("Sign in to ask for one") { signingIn = true }.buttonStyle(InkButtonStyle())
        } else if let ai = account.ai {
            Button("Write it with \(ai.name)") { Task { await request() } }.buttonStyle(InkButtonStyle())
        } else {
            Text("Connect Grok or ChatGPT to your account on tare.news first, then come back.")
                .font(Theme.serif(15)).foregroundStyle(Theme.ink2)
            HStack(spacing: 14) {
                Button("Connect on tare.news") { open(URL(string: "https://tare.news/account#ai")!) }.buttonStyle(InkButtonStyle())
                Button("I've connected it") { Task { await account.refresh() } }
                    .font(Theme.mono(12)).foregroundStyle(Theme.brass)
            }
        }
    }

    private func request() async {
        guard let token = account.token else { return }
        error = nil
        do {
            try await TareAPI.shared.requestBriefing(storyId: storyId, token: token)
            await poll()
        } catch let failure as TareAPI.APIError where failure.statusCode == 409 {
            await account.refresh()
            error = failure.localizedDescription
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Loads the briefing, and keeps checking every 5 seconds while it's being written.
    private func poll() async {
        while !Task.isCancelled {
            do { state = try await TareAPI.shared.briefing(storyId: storyId) } catch { return }
            guard state?.status == "writing" else { return }
            try? await Task.sleep(for: .seconds(5))
        }
    }
}

private struct ReadyBriefing: View {
    let state: BriefingState
    let open: (URL) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(state.sections) { section in
                VStack(alignment: .leading, spacing: 8) {
                    Text(section.heading).font(Theme.display(22)).foregroundStyle(Theme.ink)
                    ForEach(Array(section.paragraphs.enumerated()), id: \.offset) { _, p in
                        (Text(p.text).font(Theme.serif(18)).foregroundStyle(Theme.ink)
                         + Text(cites(p)).font(Theme.mono(11)).foregroundStyle(Theme.ink3).baselineOffset(6))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            if !state.web.isEmpty {
                Kicker(text: "Other pages it read")
                ForEach(state.web) { page in
                    Button { open(page.url) } label: {
                        (Text("\(page.id) ").font(Theme.mono(11)).foregroundStyle(Theme.ink3)
                         + Text(page.title).font(Theme.serif(15)).foregroundStyle(Theme.brass).underline())
                            .multilineTextAlignment(.leading)
                    }
                    .buttonStyle(.plain)
                }
            }
            if let provider = state.provider {
                Text("Written with \(provider) from the sources listed below. Numbers point to them.")
                    .font(Theme.mono(11)).foregroundStyle(Theme.ink3)
            }
        }
    }

    private func cites(_ p: BriefingState.Paragraph) -> String {
        let all = p.cites.map(String.init) + p.web
        return all.isEmpty ? "" : " [\(all.joined(separator: ", "))]"
    }
}

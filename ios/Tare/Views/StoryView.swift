import SafariServices
import SwiftUI

/// One story: the full article, why it matters, the coverage scale, where accounts differ, and every source.
struct StoryView: View {
    let id: String
    @Environment(EditionStore.self) private var store
    @State private var full: Story?
    @State private var error: String?
    @State private var openURL: URL?

    /// The edition's copy paints at once; the full story (sources and quotes) replaces it when it arrives.
    private var story: Story? { full ?? store.storiesById[id] }

    var body: some View {
        ScrollView {
            if let story {
                VStack(alignment: .leading, spacing: 14) {
                    if let photo = story.photo { StoryPhoto(photo: photo, aspect: 2) }
                    StoryKicker(story: story)
                    Text(story.headline)
                        .font(Theme.display(32))
                        .foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityIdentifier("story-headline")
                    ArticleText(sentences: story.summary, size: 19)
                    if let why = story.why {
                        WhyItMatters(sentence: why)
                    }
                    if let correction = story.correction {
                        Note(label: "Correction", text: correction.note)
                    }
                    Text("Covered by \(story.namedOutlets)")
                        .font(Theme.serif(15))
                        .foregroundStyle(Theme.ink2)
                    if let first = story.readFirst {
                        Button { openURL = first.url } label: {
                            (Text(first.label.uppercased()).font(Theme.mono(11, medium: true)).foregroundStyle(Theme.ink3)
                             + Text("  \(first.title)").font(Theme.serif(16)).foregroundStyle(Theme.brass).underline()
                             + Text(" · \(first.outlet)").font(Theme.mono(11)).foregroundStyle(Theme.ink3))
                                .multilineTextAlignment(.leading)
                        }
                        .buttonStyle(.plain)
                    }
                    Rectangle().fill(Theme.rule).frame(height: 1)
                    CoverageScaleView(coverage: story.coverage)
                    if !story.differences.isEmpty {
                        DifferencesView(differences: story.differences) { openURL = $0 }
                    }
                    BriefingView(storyId: story.id) { openURL = $0 }
                    if !story.sources.isEmpty {
                        SourcesView(sources: story.sources) { openURL = $0 }
                    } else if full == nil {
                        ProgressView().frame(maxWidth: .infinity).padding()
                    }
                }
                .padding(16)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity)
            } else if let error {
                ContentUnavailableView("Story unavailable", systemImage: "newspaper", description: Text(error))
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 80)
            }
        }
        .background(Theme.paper)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let story {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: story.webURL, subject: Text(story.headline)) { Image(systemName: "square.and.arrow.up") }
                }
            }
        }
        .toolbarBackground(Theme.paper, for: .navigationBar)
        .task(id: id) {
            do { full = try await TareAPI.shared.story(id) } catch { self.error = error.localizedDescription }
        }
        .sheet(item: $openURL) { url in SafariView(url: url).ignoresSafeArea() }
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}

struct WhyItMatters: View {
    let sentence: Sentence
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Rectangle().fill(Theme.brass).frame(width: 2)
            VStack(alignment: .leading, spacing: 4) {
                Kicker(text: "Why it matters")
                Text(ArticleText.attributed([sentence], size: 17)).foregroundStyle(Theme.ink)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

struct Note: View {
    let label: String
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Kicker(text: label, color: Theme.brass)
            Text(text).font(Theme.serif(16)).foregroundStyle(Theme.ink)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.brassWash)
    }
}

/// Three labeled bars (share of each side's outlets that covered it) and a needle at the balance. With too few
/// left- or right-leaning outlets to compare, it's one plain line instead.
struct CoverageScaleView: View {
    let coverage: Coverage

    var body: some View {
        let c = coverage
        if c.isThin {
            Text("\(c.reading.sentence): \(c.left) of \(c.sideSize.left) left-leaning, \(c.center) of \(c.sideSize.center) center and \(c.right) of \(c.sideSize.right) right-leaning outlets covered it.")
                .font(Theme.mono(12))
                .foregroundStyle(Theme.ink3)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .top, spacing: 14) {
                    pan("Left", c.left, c.sideSize.left, hatched: false)
                    pan("Center", c.center, c.sideSize.center, hatched: true)
                    pan("Right", c.right, c.sideSize.right, hatched: false)
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Rectangle().fill(Theme.ink2).frame(height: 1).offset(y: 10)
                        Rectangle().fill(Theme.ink3).frame(width: 1, height: 10).offset(x: geo.size.width / 2)
                        let x = (c.reading.key == "even" ? 0.5 : (c.balance + 1) / 2) * geo.size.width
                        Rectangle().fill(Theme.brass).frame(width: 3, height: 14).offset(x: x - 1.5, y: -2)
                    }
                }
                .frame(height: 14)
                .accessibilityHidden(true)
                HStack {
                    Text("← Left").foregroundStyle(Theme.ink3)
                    Spacer()
                    Text(c.reading.sentence).foregroundStyle(Theme.ink).multilineTextAlignment(.center)
                    Spacer()
                    Text("Right →").foregroundStyle(Theme.ink3)
                }
                .font(Theme.mono(11, medium: true))
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(c.left) of \(c.sideSize.left) left-leaning outlets, \(c.center) of \(c.sideSize.center) center, \(c.right) of \(c.sideSize.right) right-leaning. \(c.reading.sentence).")
        }
    }

    private func pan(_ name: String, _ count: Int, _ size: Int, hatched: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(name).font(Theme.mono(12, medium: true)).foregroundStyle(Theme.ink)
            Text("\(count) of \(size)").font(Theme.mono(11)).foregroundStyle(Theme.ink3)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Rectangle().fill(Theme.rule)
                    Rectangle().fill(hatched ? Theme.ink3 : Theme.ink)
                        .frame(width: geo.size.width * CGFloat(count) / CGFloat(max(1, size)))
                }
            }
            .frame(height: 5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Collapsed by default: what the accounts disagree on, with the two headlines that show it.
struct DifferencesView: View {
    let differences: [Difference]
    let open: (URL) -> Void
    @State private var expanded = false

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(Array(differences.enumerated()), id: \.offset) { _, d in
                    VStack(alignment: .leading, spacing: 6) {
                        Kicker(text: d.label)
                        Text(d.text).font(Theme.serif(16)).foregroundStyle(Theme.ink)
                        ForEach(d.quotes) { q in
                            Button { open(q.url) } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(q.outlet) · \(q.leanLabel)").font(Theme.mono(10.5, medium: true)).foregroundStyle(Theme.ink3)
                                    Text(q.title).font(Theme.serif(15)).foregroundStyle(Theme.brass).multilineTextAlignment(.leading)
                                    if let snippet = q.snippet, !snippet.isEmpty {
                                        Text("“\(snippet)”").font(Theme.serifItalic(14)).foregroundStyle(Theme.ink2).lineLimit(4).multilineTextAlignment(.leading)
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.leading, 10)
                    .overlay(alignment: .leading) { Rectangle().fill(Theme.rule).frame(width: 2) }
                }
            }
            .padding(.top, 8)
        } label: {
            Text("WHERE ACCOUNTS DIFFER (\(differences.count))").font(Theme.mono(12, medium: true)).tracking(0.9).foregroundStyle(Theme.ink2)
        }
        .tint(Theme.brass)
    }
}

/// Every source, grouped by side, numbered as the article's citations are.
struct SourcesView: View {
    let sources: [SourceRef]
    let open: (URL) -> Void

    private static let sides: [(id: String, name: String)] = [("left", "Left"), ("center", "Center"), ("right", "Right"), ("unrated", "Not rated")]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHead(title: "Sources")
            ForEach(Self.sides, id: \.id) { side in
                let list = sources.filter { $0.side == side.id }
                if !list.isEmpty {
                    Kicker(text: side.name).padding(.top, 4)
                    ForEach(list) { s in
                        Button { open(s.url) } label: {
                            HStack(alignment: .top, spacing: 8) {
                                Text("\(s.n)").font(Theme.mono(11, medium: true)).foregroundStyle(Theme.ink3).frame(width: 22, alignment: .trailing)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("\(s.outlet) · \(s.leanLabel)").font(Theme.mono(10.5)).foregroundStyle(Theme.ink3)
                                    Text(s.title).font(Theme.serif(15)).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                                }
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

/// Outlets' articles open in Safari inside the app, so the reader comes straight back to Tare.
struct SafariView: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController { SFSafariViewController(url: url) }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

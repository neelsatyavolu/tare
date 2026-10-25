import SwiftUI

/// The kicker over every story: markers, section, and the coverage counts, plus a side word when one applies.
struct StoryKicker: View {
    let story: Story
    var showTag = true

    var body: some View {
        let c = story.coverage
        let parts: [String] = [
            story.isNew ? "New" : nil,
            story.blindspot != nil ? "Possible blindspot" : nil,
            story.topicName,
            "\(c.total) outlets",
        ].compactMap { $0 }
        let tag = showTag && !["even", "thin"].contains(c.reading.key) ? " · \(c.reading.tag)" : ""
        (Text(parts.joined(separator: " · ").uppercased())
            .foregroundStyle(story.isNew ? Theme.brass : Theme.ink3)
         + Text("  (\(c.counts))".uppercased()).foregroundStyle(Theme.ink3)
         + Text(tag.uppercased()).foregroundStyle(Theme.ink))
            .font(Theme.mono(10.5, medium: true))
            .tracking(0.9)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// A story's photo, cropped to `aspect`, with its credit under it.
struct StoryPhoto: View {
    let photo: Photo
    var aspect: CGFloat = 3 / 2
    var credit = true

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Color.clear
                .aspectRatio(aspect, contentMode: .fit)
                .overlay {
                    AsyncImage(url: photo.url, transaction: Transaction(animation: .easeIn(duration: 0.15))) { phase in
                        if let image = phase.image {
                            image.resizable().scaledToFill()
                        } else {
                            Theme.rule
                        }
                    }
                }
                .clipped()
                .accessibilityHidden(true)
            if credit {
                Text("Photo: \(photo.credit)")
                    .font(Theme.mono(10))
                    .foregroundStyle(Theme.ink3)
            }
        }
    }
}

/// The front page's lead: photo, headline and the opening of the article.
struct LeadCard: View {
    let story: Story

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let photo = story.photo { StoryPhoto(photo: photo) }
            StoryKicker(story: story)
            Text(story.headline)
                .font(Theme.display(30))
                .foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            ArticleText(sentences: Array(story.summary.prefix(4)), size: 18)
            if story.summary.count > 4 {
                Text("CONTINUE READING →")
                    .font(Theme.mono(12, medium: true))
                    .tracking(0.8)
                    .foregroundStyle(Theme.brass)
            }
        }
        .padding(.vertical, 16)
        .contentShape(Rectangle())
    }
}

/// Every other story: a thumbnail, the kicker, the headline and its one or two lines.
struct StoryRow: View {
    let story: Story

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                StoryKicker(story: story)
                // Semibold text serif, like the site's cards: the thin display cut reads lighter than the line under it.
                Text(story.headline)
                    .font(Theme.serif(18, weight: .semibold))
                    .foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if !story.cardLine.isEmpty {
                    Text(story.cardLine)
                        .font(Theme.serif(15))
                        .foregroundStyle(Theme.ink2)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            if let photo = story.photo {
                StoryPhoto(photo: photo, aspect: 1, credit: false)
                    .frame(width: 84)
            }
        }
        .padding(.vertical, 14)
        .contentShape(Rectangle())
    }
}

/// Article sentences in short paragraphs (two or three sentences each), each sentence followed by its sources.
struct ArticleText: View {
    let sentences: [Sentence]
    var size: CGFloat = 18
    var onCite: ((Int) -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(Self.paragraphs(sentences).enumerated()), id: \.offset) { _, paragraph in
                Text(Self.attributed(paragraph, size: size))
                    .foregroundStyle(Theme.ink)
                    .lineSpacing(4)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// Same grouping as the site: threes, with a four-sentence tail split two and two.
    static func paragraphs(_ sentences: [Sentence]) -> [[Sentence]] {
        var out: [[Sentence]] = []
        var i = 0
        while i < sentences.count {
            let left = sentences.count - i
            let size = left == 4 ? 2 : min(3, left)
            out.append(Array(sentences[i..<(i + size)]))
            i += size
        }
        return out
    }

    static func attributed(_ sentences: [Sentence], size: CGFloat) -> AttributedString {
        var text = AttributedString()
        for (i, s) in sentences.enumerated() {
            var body = AttributedString(s.text)
            body.font = Theme.serif(size)
            text += body
            if !s.cites.isEmpty {
                // Non-breaking spaces and a word joiner keep "[1, 16, 18]" on one line with the sentence's last word.
                var cite = AttributedString("\u{2060}[\(s.cites.prefix(3).map(String.init).joined(separator: ",\u{00A0}"))\(s.cites.count > 3 ? "\u{00A0}+\(s.cites.count - 3)" : "")]")
                cite.font = Theme.mono(size * 0.6)
                cite.baselineOffset = size * 0.35
                cite.foregroundColor = Theme.ink3
                text += cite
            }
            if i < sentences.count - 1 { text += AttributedString(" ") }
        }
        return text
    }
}

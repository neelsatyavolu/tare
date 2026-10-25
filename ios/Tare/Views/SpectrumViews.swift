import SwiftUI

/// Coverage by outlet, as the site draws it (`src/web/spectrum.tsx`): the five-bucket bar on cards, and the source
/// spectrum and "Read across the spectrum" on the story page. Sides are told apart by position and label in ink
/// tones; no hue or brass marks a side.

/// Center's fill: diagonal ink-3 hatching, like the site's center segment.
struct Hatch: View {
    var body: some View {
        Canvas { ctx, size in
            var path = Path()
            for x in stride(from: -size.height, through: size.width, by: 4) {
                path.move(to: CGPoint(x: x, y: size.height))
                path.addLine(to: CGPoint(x: x + size.height, y: 0))
            }
            ctx.stroke(path, with: .color(Theme.ink3), lineWidth: 1.4)
        }
        .clipped()
    }
}

/// A bucket's tone: Left and Right darkest, the lean buckets lighter, Center hatched.
@ViewBuilder func bucketFill(_ b: Bucket) -> some View {
    switch b {
    case .left, .right: Theme.ink
    case .leanLeft, .leanRight: Theme.ink2
    case .center: Hatch()
    }
}

/// A thin bar of the rated outlets that covered a story, left to right, each bucket as wide as its count. Unrated
/// outlets have no place on a left-right line, so they're a count beside it, not a segment.
struct DistBar: View {
    let distribution: Distribution

    var body: some View {
        let d = distribution
        if d.total > 0 {
            HStack(spacing: 6) {
                Text("L")
                GeometryReader { geo in
                    let shown = Bucket.allCases.filter { d[$0] > 0 }
                    let room = geo.size.width - CGFloat(max(0, shown.count - 1))
                    HStack(spacing: 1) {
                        ForEach(shown, id: \.self) { b in
                            bucketFill(b).frame(width: max(3, room * CGFloat(d[b]) / CGFloat(max(1, d.rated))))
                        }
                    }
                    .frame(width: geo.size.width, alignment: .leading)
                }
                .frame(minWidth: 80, maxWidth: 240)
                .frame(height: 8)
                .background(Theme.rule)
                Text("R")
                if d.unrated > 0 { Text("+\(d.unrated) not rated").lineLimit(1).fixedSize() }
            }
            .font(Theme.mono(11, medium: true))
            .monospacedDigit()
            .foregroundStyle(Theme.ink3)
            .frame(maxWidth: 320, alignment: .leading)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(d.label)
        }
    }
}

/// Every outlet that covered the story, placed left to right by its Eady 2025 score, with the center line and the
/// four bucket edges. Unrated outlets are named under it and never placed on the axis.
struct SpectrumView: View {
    let sources: [SourceRef]
    let distribution: Distribution

    @State private var width: CGFloat = 343

    private static let radius = 5.0
    private static let pad = 6.0
    private static let step = 2 * radius + 1.5
    private static let top = 4.0
    private static let minLevels = 2
    private static let bandText: [Bucket: String] = [.left: "Left", .leanLeft: "Leans\nleft", .center: "Center", .leanRight: "Leans\nright", .right: "Right"]

    var body: some View {
        let marks = Spectrum.marks(sources, width: width, radius: Self.radius, pad: Self.pad)
        let unrated = Spectrum.outlets(sources).filter { Bucket.of($0) == nil || $0.zeta == nil }
        VStack(alignment: .leading, spacing: 8) {
            Kicker(text: "Where the outlets sit")
            if marks.isEmpty {
                key("No rated outlet covered it, so there is nothing to place on the axis.")
            } else {
                VStack(spacing: 4) {
                    plot(marks)
                    bands
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(distribution.sentence)
                .accessibilityValue(Bucket.allCases.map { b in
                    let here = marks.filter { $0.bucket == b }.map { "\($0.source.outlet) (\(Spectrum.score($0.zeta)))" }
                    return "\(b.label): \(here.isEmpty ? "none" : here.joined(separator: ", "))."
                }.joined(separator: " "))
            }
            if !unrated.isEmpty {
                (Text("NOT RATED  ").font(Theme.mono(11, medium: true)).foregroundStyle(Theme.ink3)
                 + Text("\(unrated.map(\.outlet).joined(separator: ", ")). Not placed: they have no lean score.").font(Theme.serif(15)).foregroundStyle(Theme.ink2))
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !marks.isEmpty {
                key("Each dot is an outlet that covered it, placed by its audience-lean score (Eady et al. 2025), which measures who shares its links, not how accurate it is.")
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }

    private func key(_ text: String) -> some View {
        Text(text).font(Theme.mono(11)).foregroundStyle(Theme.ink3).fixedSize(horizontal: false, vertical: true)
    }

    private var span: Double { Spectrum.spanFor(sources) }
    private func x(_ z: Double) -> CGFloat { Spectrum.x(z, width: width, pad: Self.pad, span: span) }

    /// Band edges on the axis, left to right.
    private var bandRanges: [(bucket: Bucket, from: Double, to: Double)] {
        let e = Spectrum.edges
        return [(.left, -span, e[0]), (.leanLeft, e[0], e[1]), (.center, e[1], e[2]), (.leanRight, e[2], e[3]), (.right, e[3], span)]
    }

    private func plot(_ marks: [Spectrum.Mark]) -> some View {
        let levels = max(Self.minLevels, (marks.map(\.level).max() ?? 0) + 1)
        let axis = Self.top + Double(levels) * Self.step + 2
        let height = axis + 8
        // Everything the drawing needs, worked out here so the renderer captures plain values.
        let shaded = bandRanges.filter { $0.bucket != .left && $0.bucket != .right }
            .map { (rect: CGRect(x: x($0.from), y: Self.top, width: x($0.to) - x($0.from), height: axis - Self.top), opacity: $0.bucket == .center ? 0.7 : 0.35) }
        let edges = Spectrum.edges.map { x($0) }
        let zero = x(0)
        let (r, pad, top, step) = (Self.radius, Self.pad, Self.top, Self.step)
        return Canvas { ctx, size in
            for band in shaded {
                ctx.fill(Path(band.rect), with: .color(Theme.rule.opacity(band.opacity)))
            }
            for ex in edges {
                ctx.stroke(Self.line(ex, top, axis), with: .color(Theme.ink3), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
            }
            ctx.stroke(Self.line(zero, top, height), with: .color(Theme.ink2), lineWidth: 1.5)
            var axisLine = Path()
            axisLine.move(to: CGPoint(x: pad, y: axis))
            axisLine.addLine(to: CGPoint(x: size.width - pad, y: axis))
            ctx.stroke(axisLine, with: .color(Theme.ink), lineWidth: 1)
            for m in marks {
                let cy = axis - 2 - r - Double(m.level) * step
                let dot = Path(ellipseIn: CGRect(x: m.x - r, y: cy - r, width: 2 * r, height: 2 * r))
                ctx.fill(dot, with: .color(Theme.ink))
                ctx.stroke(dot, with: .color(Theme.paper), lineWidth: 1.5)
            }
        }
        .frame(height: height)
    }

    private static func line(_ x: CGFloat, _ y1: CGFloat, _ y2: CGFloat) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: x, y: y1))
        p.addLine(to: CGPoint(x: x, y: y2))
        return p
    }

    /// Each band's count over its label, centered under the band; the narrow lean bands' labels may run wider.
    private var bands: some View {
        ZStack(alignment: .topLeading) {
            ForEach(bandRanges, id: \.bucket) { band in
                VStack(spacing: 2) {
                    Text("\(distribution[band.bucket])").foregroundStyle(Theme.ink).monospacedDigit()
                    Text(Self.bandText[band.bucket] ?? "").foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
                }
                .font(Theme.mono(10, medium: true))
                .fixedSize()
                .frame(width: x(band.to) - x(band.from))
                .offset(x: x(band.from))
            }
        }
        .frame(maxWidth: .infinity, minHeight: 40, alignment: .topLeading)
    }
}

/// One headline from each side that covered it. Shown only when at least two sides did; a missing side says so.
struct ReadAcrossView: View {
    let story: Story
    let open: (URL) -> Void

    var body: some View {
        let picks = ReadAcross.picks(story)
        if ReadAcross.shows(picks) {
            VStack(alignment: .leading, spacing: 10) {
                Kicker(text: "Read across the spectrum", color: Theme.ink2).accessibilityAddTraits(.isHeader)
                ForEach(ReadAcross.sides, id: \.id) { side in
                    VStack(alignment: .leading, spacing: 2) {
                        Kicker(text: side.word)
                        if let s = picks[side.id] {
                            Button { open(s.url) } label: {
                                (Text(s.title).font(Theme.serif(16)).foregroundStyle(Theme.brass)
                                 + Text(" · \(s.outlet)").font(Theme.mono(11)).foregroundStyle(Theme.ink3))
                                    .multilineTextAlignment(.leading)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(side.word): \(s.title), \(s.outlet)")
                        } else {
                            Text("No \(side.id == "center" ? "center" : "\(side.id)-leaning") outlet in Tare's list covered it.")
                                .font(Theme.serif(16)).foregroundStyle(Theme.ink3)
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, 12)
                    .overlay(alignment: .leading) { Rectangle().fill(Theme.rule).frame(width: 2) }
                }
            }
        }
    }
}

/// "How balanced is this coverage?": the counts in words, the coverage scale, the spectrum and the read-across row.
struct BalanceSection: View {
    let story: Story
    let open: (URL) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("HOW BALANCED IS THIS COVERAGE?")
                .font(Theme.mono(12, medium: true)).tracking(0.9).foregroundStyle(Theme.ink2)
                .accessibilityAddTraits(.isHeader)
            if let d = story.distribution, d.total > 0 {
                Text(d.sentence).font(Theme.serif(16)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
            }
            CoverageScaleView(coverage: story.coverage)
            // The edition's copy of a story has no sources; the spectrum waits for the full story.
            if let d = story.distribution, d.total > 0, !story.sources.isEmpty {
                SpectrumView(sources: story.sources, distribution: d).padding(.top, 8)
            }
            ReadAcrossView(story: story, open: open).padding(.top, 8)
        }
    }
}

import Foundation

/// The five Eady 2025 buckets a story's outlets fall in, left to right, as `src/distribution.ts` names them. The
/// server assigns each source's bucket from its lean; the app only draws them.
enum Bucket: String, CaseIterable, Sendable {
    case left, leanLeft, center, leanRight, right

    /// The site's lean labels (`LEAN_LABEL`).
    var label: String {
        switch self {
        case .left: "Left"
        case .leanLeft: "Leans left"
        case .center: "Center"
        case .leanRight: "Leans right"
        case .right: "Right"
        }
    }

    /// Lowercase, for counts read aloud: "2 leaning left".
    var words: String {
        switch self {
        case .left: "left"
        case .leanLeft: "leaning left"
        case .center: "center"
        case .leanRight: "leaning right"
        case .right: "right"
        }
    }

    /// The API's `bucket`, or for an older server that doesn't send it, the bucket its `lean` names.
    static func of(_ source: SourceRef) -> Bucket? {
        if let b = source.bucket { return Bucket(rawValue: b) }
        return [
            "left": .left, "lean-left": .leanLeft, "center": .center, "lean-right": .leanRight, "right": .right,
        ][source.lean]
    }
}

/// Distinct outlets per bucket, as `distribution` on each story in `/api/v1`.
struct Distribution: Codable, Sendable, Hashable {
    let left: Int
    let leanLeft: Int
    let center: Int
    let leanRight: Int
    let right: Int
    let unrated: Int
    let total: Int

    subscript(_ b: Bucket) -> Int {
        switch b {
        case .left: left
        case .leanLeft: leanLeft
        case .center: center
        case .leanRight: leanRight
        case .right: right
        }
    }

    /// Outlets that can be placed left to right.
    var rated: Int { total - unrated }

    /// Every bucket, zeros included, so VoiceOver's counts add up to the total (the site's `distributionLabel`).
    var label: String {
        let parts = Bucket.allCases.map { "\(self[$0]) \($0.words)" }.joined(separator: ", ")
        return "Outlets by lean, left to right: \(parts)\(unrated > 0 ? "; \(unrated) not rated" : "")."
    }

    /// The counts in plain words, word for word the site's `distributionSentence`.
    var sentence: String {
        let more = unrated > 0 ? " \(unrated) \(unrated == 1 ? "more is" : "more are") not rated." : ""
        if rated == 0 { return "None of the \(total) outlets that covered it has a lean score, so none can be placed left to right." }
        let isAre = { (n: Int) in "\(n) \(n == 1 ? "is" : "are")" }
        let strong = { (n: Int, side: String) in n > 0 ? " (\(n) of them in the \(side) group)" : "" }
        return "Of the \(rated) rated \(rated == 1 ? "outlet" : "outlets") that covered it, \(isAre(left + leanLeft)) left of center\(strong(left, "Left")), \(isAre(center)) center and \(isAre(right + leanRight)) right of center\(strong(right, "Right")).\(more)"
    }
}

/// The source spectrum's geometry: the zeta axis, its bucket edges, and where each outlet's dot goes.
enum Spectrum {
    /// Bucket edges on the zeta scale (`ZETA_EDGES` in `src/outlets.ts`).
    static let edges: [Double] = [-1.24, -0.62, 0.62, 1.24]
    /// The site's axis half-width (`ZETA_SPAN`: the furthest score in the outlet list, rounded up). The API doesn't
    /// send it, so a story with a score past it widens its own axis rather than pinning a dot to the end.
    static let span = 3.2

    struct Mark: Sendable, Equatable {
        let source: SourceRef
        let zeta: Double
        let bucket: Bucket
        /// Points from the left edge of the drawing.
        let x: Double
        /// Row from the axis up: 0 sits on it, higher rows stack over dots they'd overlap.
        let level: Int
    }

    /// One source per outlet (the first, in source order): the spectrum places outlets, not articles.
    static func outlets(_ sources: [SourceRef]) -> [SourceRef] {
        var seen = Set<String>()
        return sources.filter { seen.insert($0.outlet).inserted }
    }

    static func spanFor(_ sources: [SourceRef]) -> Double {
        let far = sources.compactMap(\.zeta).map(abs).max() ?? 0
        return max(span, (far * 10).rounded(.up) / 10)
    }

    /// x in points for a score, with `pad` points kept clear at each end.
    static func x(_ zeta: Double, width: Double, pad: Double, span: Double) -> Double {
        let z = min(span, max(-span, zeta))
        return pad + (z + span) / (2 * span) * (width - 2 * pad)
    }

    /// Places each rated outlet at its score and stacks dots that would overlap, lowest free row first (the site's
    /// `spectrumMarks`). Unrated outlets are left out: they have no score to place.
    static func marks(_ sources: [SourceRef], width: Double, radius: Double, pad: Double) -> [Mark] {
        let s = spanFor(sources)
        let rated = outlets(sources)
            .compactMap { src -> (SourceRef, Double, Bucket)? in
                guard let z = src.zeta, let b = Bucket.of(src) else { return nil }
                return (src, z, b)
            }
            .sorted { $0.1 < $1.1 }
        var lastX: [Double] = []
        return rated.map { src, z, b in
            let px = x(z, width: width, pad: pad, span: s)
            // Sorted by x, so a row is free once its last dot is a full diameter to the left.
            let level = lastX.firstIndex { px - $0 >= 2 * radius } ?? lastX.count
            if level == lastX.count { lastX.append(px) } else { lastX[level] = px }
            return Mark(source: src, zeta: z, bucket: b, x: px, level: level)
        }
    }

    /// −0.81, +1.10: the score as a reader can look it up.
    static func score(_ z: Double) -> String { "\(z < 0 ? "−" : "+")\(String(format: "%.2f", abs(z)))" }
}

/// One headline from each side that covered a story, for "Read across the spectrum". Within a side: the source the
/// summary cites most, then the earliest report. (The site also prefers better-known outlets; the API doesn't send
/// that ranking, so the app can pick differently on a tie.)
enum ReadAcross {
    static let sides: [(id: String, word: String)] = [("left", "Left-leaning"), ("center", "Center"), ("right", "Right-leaning")]

    static func picks(_ story: Story) -> [String: SourceRef] {
        let cited = { (s: SourceRef) in story.summary.filter { $0.cites.contains(s.n) }.count }
        var out: [String: SourceRef] = [:]
        for side in sides {
            let best = story.sources.filter { $0.side == side.id }.min { a, b in
                cited(a) != cited(b) ? cited(a) > cited(b) : a.publishedAt < b.publishedAt
            }
            if let best { out[side.id] = best }
        }
        return out
    }

    /// Shown only when at least two sides covered it.
    static func shows(_ picks: [String: SourceRef]) -> Bool { picks.count >= 2 }
}

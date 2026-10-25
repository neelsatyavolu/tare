import SwiftUI
import UIKit

/// Tare's palette and type, from DESIGN.md: newsprint by day, night edition in dark mode. One accent (brass),
/// and no color ever marks a political side.
enum Theme {
    static let paper = dynamic(light: 0xF3EFE6, dark: 0x151410)
    static let sheet = dynamic(light: 0xFBF9F4, dark: 0x1C1B16)
    static let ink = dynamic(light: 0x1C1A16, dark: 0xEDE7DA)
    static let ink2 = dynamic(light: 0x5E594F, dark: 0xA59F92)
    static let ink3 = dynamic(light: 0x6F695E, dark: 0x8C8676)
    static let rule = dynamic(light: 0x1C1A16, dark: 0xEDE7DA, lightAlpha: 0.16, darkAlpha: 0.14)
    static let brass = dynamic(light: 0x8A5A12, dark: 0xD9A441)
    static let brassWash = dynamic(light: 0x8A5A12, dark: 0xD9A441, lightAlpha: 0.10, darkAlpha: 0.14)

    /// Headlines and the wordmark.
    static func display(_ size: CGFloat) -> Font { .custom("LibreCaslonDisplay-Regular", size: size, relativeTo: .title) }
    /// Reading text.
    static func serif(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .custom(weight == .regular ? "SourceSerif4-Regular" : "SourceSerif4-Semibold", size: size, relativeTo: .body)
    }
    static func serifItalic(_ size: CGFloat) -> Font { .custom("SourceSerif4-It", size: size, relativeTo: .body) }
    /// Labels, counts and kickers.
    static func mono(_ size: CGFloat, medium: Bool = false) -> Font {
        .custom(medium ? "IBMPlexMono-Medm" : "IBMPlexMono", size: size, relativeTo: .caption)
    }

    private static func dynamic(light: UInt32, dark: UInt32, lightAlpha: CGFloat = 1, darkAlpha: CGFloat = 1) -> Color {
        Color(UIColor { traits in
            traits.userInterfaceStyle == .dark ? UIColor(hex: dark, alpha: darkAlpha) : UIColor(hex: light, alpha: lightAlpha)
        })
    }
}

private extension UIColor {
    convenience init(hex: UInt32, alpha: CGFloat) {
        self.init(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
    }
}

/// The mono uppercase label used for kickers and section heads.
struct Kicker: View {
    let text: String
    var color: Color = Theme.ink3
    var body: some View {
        Text(text.uppercased())
            .font(Theme.mono(11, medium: true))
            .tracking(1.1)
            .foregroundStyle(color)
    }
}

/// A section head: a full-width rule with the section's name under it.
struct SectionHead: View {
    let title: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Rectangle().fill(Theme.ink).frame(height: 1)
            Kicker(text: title, color: Theme.ink)
        }
        .padding(.top, 28)
        .padding(.bottom, 4)
        .accessibilityAddTraits(.isHeader)
    }
}

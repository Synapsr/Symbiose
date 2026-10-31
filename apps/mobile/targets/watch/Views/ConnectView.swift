import SwiftUI

/// Before the phone has handed over a session.
struct ConnectView: View {
  @Environment(WatchModel.self) private var model

  var body: some View {
    let copy = model.copy
    NavigationStack {
      content(copy)
        .containerBackground(LinearGradient(colors: [Palette.accent.opacity(0.28), .black], startPoint: .top, endPoint: .center), for: .navigation)
    }
  }

  private func content(_ copy: Copy) -> some View {
    ScrollView {
      VStack(spacing: 10) {
        LogoMark().fill(Palette.bourgeon).frame(width: 44, height: 44).padding(.top, 8)
        Text(copy.connectTitle)
          .font(.rounded(18, .bold))
          .multilineTextAlignment(.center)
        Text(copy.connectBody)
          .font(.rounded(14, .medium))
          .foregroundStyle(Palette.text2)
          .multilineTextAlignment(.center)
        Image(systemName: "iphone.gen3")
          .font(.system(size: 22))
          .foregroundStyle(Palette.accent)
          .padding(.top, 4)
          .symbolEffect(.pulse)
      }
      .padding(.horizontal, 6)
    }
  }
}

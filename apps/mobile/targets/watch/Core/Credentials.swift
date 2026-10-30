import Foundation
import Security

/// The server URL and session token, in the watch app's own Keychain.
///
/// Only the app talks to the server: the complications render the glance the
/// app stores in the App Group. So the token stays in this app's Keychain
/// (no shared access group), readable after the first unlock so background
/// refreshes work, and never synced or backed up.
struct Credentials: Codable, Equatable {
  var serverUrl: String
  var token: String

  private static let query: [CFString: Any] = [
    kSecClass: kSecClassGenericPassword,
    kSecAttrService: "io.synapsr.symbiose.watch",
    kSecAttrAccount: "session",
  ]

  static func load() -> Credentials? {
    var query = query
    query[kSecReturnData] = true
    query[kSecMatchLimit] = kSecMatchLimitOne
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
    return try? JSONDecoder().decode(Credentials.self, from: data)
  }

  func save() {
    guard let data = try? JSONEncoder().encode(self) else { return }
    let status = SecItemUpdate(Self.query as CFDictionary, [kSecValueData: data] as CFDictionary)
    guard status == errSecItemNotFound else { return }
    var item = Self.query
    item[kSecValueData] = data
    item[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(item as CFDictionary, nil)
  }

  static func clear() {
    SecItemDelete(query as CFDictionary)
  }
}

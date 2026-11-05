import ExpoModulesCore
import Foundation
import Network

/// A one-shot web server on 127.0.0.1: the sign-in page (in the browser the app
/// opened) redirects to it with the code, and the app reads that request. The
/// browser is shown over the app, so the app is in the foreground and listening.
public class LoopbackAuthModule: Module {
  private let queue = DispatchQueue(label: "io.synapsr.symbiose.loopback-auth")
  private var listener: NWListener?
  private var path = "/"
  private var page = ""
  /// The redirect received before anyone waited for it.
  private var received: String?
  private var waiting: Promise?
  private var timeout: DispatchWorkItem?

  public func definition() -> ModuleDefinition {
    Name("LoopbackAuth")

    AsyncFunction("start") { (path: String, page: String, promise: Promise) in
      self.queue.async { self.start(path: path, page: page, promise: promise) }
    }

    AsyncFunction("waitForRedirect") { (timeoutMs: Int, promise: Promise) in
      self.queue.async {
        if let received = self.received {
          self.received = nil
          promise.resolve(received)
          return
        }
        self.waiting?.resolve(nil)
        self.waiting = promise
        let item = DispatchWorkItem { [weak self] in self?.finish(nil) }
        self.timeout?.cancel()
        self.timeout = item
        self.queue.asyncAfter(deadline: .now() + .milliseconds(timeoutMs), execute: item)
      }
    }

    Function("stop") {
      self.queue.async { self.finish(nil) }
    }

    Function("bringToFront") {
      // The browser is shown over the app on iOS: nothing to bring back.
    }
  }

  private func start(path: String, page: String, promise: Promise) {
    stopListening()
    self.path = path
    self.page = page
    received = nil
    do {
      // Bound to 127.0.0.1 (unreachable from any other device), on a port the system picks.
      let parameters = NWParameters.tcp
      parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: .any)
      parameters.allowLocalEndpointReuse = true
      let listener = try NWListener(using: parameters)
      var settled = false
      listener.stateUpdateHandler = { [weak self] state in
        guard !settled else { return }
        switch state {
        case .ready:
          settled = true
          promise.resolve(Int(listener.port?.rawValue ?? 0))
        case .failed(let error):
          settled = true
          promise.reject("ERR_LOOPBACK", "Could not listen on 127.0.0.1: \(error)")
          self?.stopListening()
        default:
          break
        }
      }
      listener.newConnectionHandler = { [weak self] connection in self?.serve(connection) }
      listener.start(queue: queue)
      self.listener = listener
    } catch {
      promise.reject("ERR_LOOPBACK", "Could not listen on 127.0.0.1: \(error)")
    }
  }

  private func serve(_ connection: NWConnection) {
    connection.start(queue: queue)
    var buffer = Data()
    func read() {
      connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { [weak self] data, _, isComplete, error in
        guard let self else { return }
        if let data { buffer.append(data) }
        let text = String(decoding: buffer, as: UTF8.self)
        if text.contains("\r\n\r\n") || isComplete || error != nil || buffer.count > 65_536 {
          self.answer(connection, request: text)
        } else {
          read()
        }
      }
    }
    read()
  }

  private func answer(_ connection: NWConnection, request: String) {
    // "GET /auth/callback?code=…&state=… HTTP/1.1"
    let target = request.split(separator: "\r\n").first?.split(separator: " ").dropFirst().first.map(String.init) ?? ""
    let targetPath = target.split(separator: "?", maxSplits: 1).first.map(String.init) ?? ""
    let matches = targetPath == path
    let body = matches ? page : "Not found"
    let status = matches ? "200 OK" : "404 Not Found"
    let response = "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.utf8.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n\(body)"
    // The whole page, then a clean close (FIN): cancelling at once would cut it off.
    connection.send(content: Data(response.utf8), contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [weak self] _ in
      self?.queue.asyncAfter(deadline: .now() + 2) { connection.cancel() }
    })
    if matches { finish(target) }
  }

  private func finish(_ target: String?) {
    timeout?.cancel()
    timeout = nil
    if let waiting {
      self.waiting = nil
      waiting.resolve(target)
    } else if let target {
      received = target
    }
    // One redirect only: the server closes once it came, timed out or was stopped.
    stopListening()
  }

  private func stopListening() {
    listener?.cancel()
    listener = nil
  }
}

package io.synapsr.symbiose.loopbackauth

import android.content.Intent
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * A one-shot web server on 127.0.0.1: the sign-in page, in the browser tab the
 * app opened, redirects to it with the code, and the app reads that request.
 */
class LoopbackAuthModule : Module() {
  private val executor = Executors.newSingleThreadScheduledExecutor()
  private val lock = Any()
  private var server: ServerSocket? = null
  private var path = "/"
  private var page = ""
  private var received: String? = null
  private var waiting: Promise? = null
  private var timeout: ScheduledFuture<*>? = null

  override fun definition() = ModuleDefinition {
    Name("LoopbackAuth")

    AsyncFunction("start") { path: String, page: String, promise: Promise ->
      synchronized(lock) {
        stopListening()
        this@LoopbackAuthModule.path = path
        this@LoopbackAuthModule.page = page
        received = null
        try {
          val socket = ServerSocket(0, 8, InetAddress.getByName("127.0.0.1"))
          server = socket
          Thread { accept(socket) }.apply { isDaemon = true }.start()
          promise.resolve(socket.localPort)
        } catch (error: Exception) {
          promise.reject("ERR_LOOPBACK", "Could not listen on 127.0.0.1: ${error.message}", error)
        }
      }
    }

    AsyncFunction("waitForRedirect") { timeoutMs: Int, promise: Promise ->
      synchronized(lock) {
        val already = received
        if (already != null) {
          received = null
          promise.resolve(already)
          return@synchronized
        }
        waiting?.resolve(null)
        waiting = promise
        timeout?.cancel(false)
        timeout = executor.schedule({ finish(null) }, timeoutMs.toLong(), TimeUnit.MILLISECONDS)
      }
    }

    Function("stop") {
      finish(null)
    }

    Function("bringToFront") {
      // The browser tab sits over the app in its task: opening the app's activity again closes it.
      appContext.currentActivity?.let { activity ->
        activity.startActivity(Intent(activity, activity.javaClass).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
      }
    }

    OnDestroy {
      finish(null)
      executor.shutdownNow()
    }
  }

  private fun accept(socket: ServerSocket) {
    while (!socket.isClosed) {
      val client: Socket = try {
        socket.accept()
      } catch (_: SocketException) {
        return
      }
      client.use { answer(it) }
    }
  }

  private fun answer(client: Socket) {
    client.soTimeout = 5_000
    val reader = BufferedReader(InputStreamReader(client.getInputStream(), Charsets.UTF_8))
    // "GET /auth/callback?code=…&state=… HTTP/1.1"
    val target = reader.readLine()?.split(" ")?.getOrNull(1) ?: ""
    // Read the headers to the end: closing with unread bytes resets the connection before the page is read.
    while (true) {
      val header = reader.readLine() ?: break
      if (header.isEmpty()) break
    }
    val matches = target.substringBefore("?") == path
    val body = if (matches) page else "Not found"
    val status = if (matches) "200 OK" else "404 Not Found"
    val bytes = body.toByteArray(Charsets.UTF_8)
    val head = "HTTP/1.1 $status\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${bytes.size}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
    client.getOutputStream().apply {
      write(head.toByteArray(Charsets.UTF_8))
      write(bytes)
      flush()
    }
    client.shutdownOutput()
    if (matches) finish(target)
  }

  private fun finish(target: String?) {
    synchronized(lock) {
      timeout?.cancel(false)
      timeout = null
      val pending = waiting
      if (pending != null) {
        waiting = null
        pending.resolve(target)
      } else if (target != null) {
        received = target
      }
      // One redirect only: the server closes once it came, timed out or was stopped.
      stopListening()
    }
  }

  private fun stopListening() {
    try {
      server?.close()
    } catch (_: Exception) {
    }
    server = null
  }
}

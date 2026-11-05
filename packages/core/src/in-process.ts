// Running the API in the same JavaScript engine as the app, without a network:
// the app on its own calls it through a `fetch` of the same shape as the real
// one, so its client code is the same for a server and for the phone.

/** What `inProcessFetch` needs from the API: Hono's `app.request`. */
export interface InProcessApp {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

export interface InProcessOptions {
  /**
   * Error codes that mean "no network" for the caller: an AI the phone can't
   * reach (`ai_unreachable`) is the phone being offline, so its offline queue
   * keeps the capture and tries again, as it would for a server out of reach.
   */
  offlineCodes?: readonly string[];
}

/**
 * A `fetch` that answers from the API in this engine. Only the path of the URL
 * matters: the app gives every request the same made-up origin.
 */
export function inProcessFetch(app: () => Promise<InProcessApp>, options: InProcessOptions = {}): typeof fetch {
  const offline = new Set(options.offlineCodes ?? []);
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = url.replace(/^[a-z][\w+.-]*:\/\/[^/]*/i, '') || '/';
    const res = await (await app()).request(path, init);
    if (offline.size && res.status === 424 && !res.headers.get('content-type')?.includes('event-stream')) {
      const text = await res.text();
      const code = (() => {
        try {
          return (JSON.parse(text) as { error?: { code?: string } }).error?.code;
        } catch {
          return undefined;
        }
      })();
      // The same error a real fetch gives without a network.
      if (code && offline.has(code)) throw new TypeError('Network request failed');
      return new Response(text, { status: res.status, headers: res.headers });
    }
    return res;
  }) as typeof fetch;
}

/**
 * React Native's `Response` (the whatwg-fetch polyfill) can't carry a stream:
 * given one, its body becomes the text "[object ReadableStream]". The API
 * streams its replies (the coach, the morning check-in, a craving tip), so the
 * app installs a `Response` that keeps a stream as its body. Where `Response`
 * already streams (Node, browsers) nothing changes.
 */
export function supportStreamingResponses(): void {
  const Base = globalThis.Response as typeof Response & { symbioseStreams?: true };
  if (Base.symbioseStreams || carriesStreams(Base)) return;

  const bytesOf = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { value, done } = await reader.read();
      if (value) chunks.push(value);
      if (done) break;
    }
    const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  };

  // Typed loosely: Node's and the DOM's typings of Response disagree on how its methods are declared.
  interface Readable {
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
  }
  const BaseResponse = Base as unknown as new (body?: unknown, init?: ResponseInit) => Readable;
  const base = Base.prototype as unknown as Readable;

  class StreamingResponse extends BaseResponse {
    private readonly stream: ReadableStream<Uint8Array> | null;

    constructor(body?: unknown, init?: ResponseInit) {
      const stream = typeof ReadableStream !== 'undefined' && body instanceof ReadableStream ? (body as ReadableStream<Uint8Array>) : null;
      super(stream ? null : body, init);
      this.stream = stream;
      // Hono copies a response with `new Response(res.body, res)`: every response needs a real body.
      Object.defineProperty(this, 'body', {
        configurable: true,
        get: () =>
          this.stream ??
          new ReadableStream<Uint8Array>({
            start: async (controller) => {
              controller.enqueue(new TextEncoder().encode(await base.text.call(this)));
              controller.close();
            },
          }),
      });
    }

    async text(): Promise<string> {
      return this.stream ? new TextDecoder().decode(await bytesOf(this.stream)) : base.text.call(this);
    }

    async json(): Promise<unknown> {
      return JSON.parse(await this.text());
    }

    async arrayBuffer(): Promise<ArrayBuffer> {
      return this.stream ? ((await bytesOf(this.stream)).buffer as ArrayBuffer) : base.arrayBuffer.call(this);
    }
  }
  (StreamingResponse as typeof StreamingResponse & { symbioseStreams?: true }).symbioseStreams = true;
  globalThis.Response = StreamingResponse as unknown as typeof Response;
}

function carriesStreams(R: typeof Response): boolean {
  try {
    if (typeof ReadableStream === 'undefined') return false;
    const stream = new ReadableStream({ start: (controller) => controller.close() });
    return new R(stream).body instanceof ReadableStream;
  } catch {
    return false;
  }
}

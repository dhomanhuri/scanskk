"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

type Status = "idle" | "scanning" | "sending" | "done" | "error";

type ScanResponse = {
  id: string;
  ok: boolean;
  status?: number;
  data?: unknown;
  raw?: string;
  error?: string;
};

/** Shape of `data` in a successful scanbooth response. */
type Profile = {
  name?: string;
  picture?: string;
  email?: string;
  company?: string;
  invitation?: string;
};

/**
 * The endpoint answers `{code, msg, data}`. A hit has `data` populated; a miss
 * returns code 200 with empty/null data, which is not an error.
 */
function readProfile(res: ScanResponse): Profile | null {
  const payload = res.data as { data?: unknown } | undefined;
  const inner = payload?.data;
  if (inner && typeof inner === "object") return inner as Profile;
  return null;
}

const REGION_ID = "qr-reader";
const SCAN_CONFIG = { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1 };

export default function QrScanner() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const busyRef = useRef(false);

  const [status, setStatus] = useState<Status>("idle");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResponse | null>(null);
  const [manualId, setManualId] = useState("");

  const showResult = useCallback((res: ScanResponse) => {
    setResult(res);
    setStatus(res.ok ? "done" : "error");
  }, []);

  /** Fire the API call for an id, ignoring repeat scans while one is in flight. */
  const submit = useCallback(
    async (raw: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setStatus("sending");
      setResult(null);
      try {
        const res = await fetch("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ raw }),
        });
        showResult((await res.json()) as ScanResponse);
      } catch {
        showResult({ id: raw, ok: false, error: "Koneksi ke server gagal" });
      } finally {
        busyRef.current = false;
      }
    },
    [showResult],
  );

  // Camera lifecycle: start once, tear down on unmount.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const scanner = new Html5Qrcode(REGION_ID, {
          formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
          verbose: false,
        });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          SCAN_CONFIG,
          (decoded) => {
            void submit(decoded);
          },
          () => {
            // Per-frame decode misses are expected; stay quiet.
          },
        );
        if (cancelled) {
          await scanner.stop();
          return;
        }
        setStatus("scanning");
      } catch (err) {
        if (!cancelled) {
          setCameraError(
            err instanceof Error ? err.message : "Kamera tidak dapat diakses",
          );
          setStatus("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      if (scanner) {
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {});
      }
    };
  }, [submit]);

  /** Resume scanning for the next participant. */
  const scanAgain = useCallback(async () => {
    setResult(null);
    setStatus("scanning");
    busyRef.current = false;
    const scanner = scannerRef.current;
    if (scanner) {
      try {
        await scanner.start(
          { facingMode: "environment" },
          SCAN_CONFIG,
          (decoded) => {
            void submit(decoded);
          },
          () => {},
        );
      } catch {
        setCameraError("Kamera tidak dapat dinyalakan ulang");
        setStatus("error");
      }
    }
  }, [submit]);

  const manualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = manualId.trim();
    if (value) void submit(value);
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-5">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-bold tracking-tight text-ink">
          SKK<span className="text-accent">{"//"}</span>scanbooth
        </h1>
        <span className="text-xs text-ink-faint">id only</span>
      </header>

      <section className="relative overflow-hidden rounded-xl border border-border bg-panel">
        <div id={REGION_ID} className="w-full" />
        {status === "scanning" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
            <span className="rounded-full border border-accent-dim bg-bg/85 px-3 py-1 text-xs text-accent">
              Arahkan kamera ke QR
            </span>
          </div>
        )}
        {cameraError && (
          <div className="p-6 text-center text-sm text-danger">{cameraError}</div>
        )}
      </section>

      {status === "sending" && (
        <div className="rounded-xl border border-border bg-panel p-5 text-center text-sm text-ink-dim">
          Memproses…
        </div>
      )}

      {result && <ResultCard result={result} />}

      {(status === "done" || status === "error") && (
        <button
          onClick={scanAgain}
          className="w-full rounded-lg border border-accent-dim bg-accent/10 py-3.5 text-sm font-bold text-accent transition hover:bg-accent/20 active:scale-[0.99]"
        >
          Scan berikutnya
        </button>
      )}

      <form onSubmit={manualSubmit} className="mt-auto flex gap-2 pt-2">
        <input
          value={manualId}
          onChange={(e) => setManualId(e.target.value)}
          inputMode="numeric"
          placeholder="atau ketik ID manual"
          className="flex-1 rounded-lg border border-border bg-panel px-3 py-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent-dim"
        />
        <button
          type="submit"
          disabled={!manualId.trim()}
          className="rounded-lg border border-border bg-panel-raised px-4 py-3 text-sm font-bold text-ink-dim transition hover:text-ink disabled:opacity-40"
        >
          Kirim
        </button>
      </form>
    </main>
  );
}

function ResultCard({ result }: { result: ScanResponse }) {
  const profile = readProfile(result);
  // A transport error, or a miss (no profile attached) — both read as "not found".
  const found = result.ok && !!profile;
  const body =
    result.error ??
    (typeof result.data === "string"
      ? result.data
      : JSON.stringify(result.data, null, 2));

  return (
    <section
      className={`rounded-xl border p-5 ${
        found ? "border-accent-dim bg-accent/5" : "border-warn/40 bg-warn/5"
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <span
          className={`text-xs font-bold tracking-widest ${
            found ? "text-accent" : "text-warn"
          }`}
        >
          {found ? "BERHASIL" : result.ok ? "TIDAK DITEMUKAN" : "GAGAL"}
        </span>
        <span className="text-xs text-ink-faint">
          {result.status ? `HTTP ${result.status}` : "—"}
        </span>
      </div>

      <div className="mb-4">
        <span className="text-xs text-ink-faint">ID</span>
        <p className="text-4xl font-bold leading-none text-ink">{result.id}</p>
      </div>

      {profile ? (
        <div className="space-y-4">
          {profile.picture && (
            // Remote participant photo; a plain img avoids the next/image
            // loader needing the upstream host allow-listed.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.picture}
              alt={profile.name ?? "Foto peserta"}
              className="mx-auto h-40 w-40 rounded-full border border-border object-cover"
            />
          )}
          <div className="text-center">
            <p className="text-xl font-bold text-ink">{profile.name ?? "—"}</p>
            {profile.invitation && (
              <span className="mt-1 inline-block rounded-full border border-accent-dim px-2.5 py-0.5 text-xs text-accent">
                {profile.invitation}
              </span>
            )}
          </div>
          <dl className="space-y-2 border-t border-border-soft pt-3 text-sm">
            {profile.company && <Row label="Perusahaan" value={profile.company} />}
            {profile.email && <Row label="Email" value={profile.email} />}
          </dl>
        </div>
      ) : (
        <p className="rounded-lg border border-border-soft bg-bg p-3 text-sm text-ink-dim">
          {result.error ?? "Tidak ada data peserta untuk ID ini."}
        </p>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-ink-faint hover:text-ink-dim">
          Response mentah
        </summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border-soft bg-bg p-3 text-xs leading-relaxed text-ink-dim">
          {body || "—"}
        </pre>
      </details>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-xs text-ink-faint">{label}</dt>
      <dd className="min-w-0 break-words text-ink-dim">{value}</dd>
    </div>
  );
}

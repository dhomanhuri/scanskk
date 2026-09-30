import { NextResponse } from "next/server";
import { extractId } from "@/lib/extract-id";
import { scanId, SymposiumError } from "@/lib/symposium";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let raw: unknown;
  try {
    ({ raw } = await req.json());
  } catch {
    return NextResponse.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }

  if (typeof raw !== "string") {
    return NextResponse.json({ error: "qr tidak valid" }, { status: 400 });
  }

  const id = extractId(raw);
  if (!id) {
    return NextResponse.json(
      { error: "QR tidak memuat ID numerik" },
      { status: 400 },
    );
  }

  try {
    const result = await scanId(id);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    if (err instanceof SymposiumError) {
      return NextResponse.json(
        { id, ok: false, error: err.message },
        { status: err.status },
      );
    }
    const message = err instanceof Error ? err.message : "Gagal menghubungi server";
    return NextResponse.json({ id, ok: false, error: message }, { status: 502 });
  }
}

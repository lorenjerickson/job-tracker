import "server-only";
import { NextResponse } from "next/server";
import { ConfigError } from "./ai";
import { LockedError } from "./db";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

export function fail(err: unknown, status = 500) {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof LockedError) return NextResponse.json({ error: message, locked: true }, { status: 409 });
  if (!(err instanceof ConfigError)) console.error(err);
  return NextResponse.json({ error: message }, { status: err instanceof ConfigError ? 400 : status });
}

export async function idParam(params: Promise<{ id: string }>): Promise<number> {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid id");
  return id;
}

export function pdfResponse(buf: Buffer, filename: string, download: boolean) {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename.replace(/[^\w.\- ]/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}

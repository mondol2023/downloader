import type { Metadata } from "next";
import type { ExtractionResult } from "@media/shared";
import { MediaScreen } from "@/features/formats";

const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

/**
 * OG tags come from the API's cached record. The lookup is anonymous (no cookies), which is fine
 * for title/poster, and it must never block the page: any failure falls back to generic tags.
 */
export async function generateMetadata({ params }: PageProps<"/m/[mediaId]">): Promise<Metadata> {
  const { mediaId } = await params;
  try {
    const res = await fetch(`${API_INTERNAL_URL}/api/v1/media/${encodeURIComponent(mediaId)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return { title: "Media" };
    const { data } = (await res.json()) as { data: ExtractionResult };
    const { title, uploader, bestThumbnail } = data.media;
    const description = uploader ? `${title} by ${uploader}. Choose a format and download.` : `${title}. Choose a format and download.`;
    return {
      title: `${title} · Media`,
      description,
      openGraph: { title, description, type: "video.other", images: bestThumbnail ? [{ url: bestThumbnail }] : undefined },
      twitter: { card: bestThumbnail ? "summary_large_image" : "summary", title, description },
    };
  } catch {
    return { title: "Media" };
  }
}

export default async function MediaPage({ params }: PageProps<"/m/[mediaId]">) {
  const { mediaId } = await params;
  return <MediaScreen mediaId={mediaId} />;
}

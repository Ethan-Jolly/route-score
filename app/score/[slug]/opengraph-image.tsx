import { ImageResponse } from "next/og";
import { getCachedRouteScore, parseRouteSlug } from "@/lib/provider";
import { SITE_NAME, STRAPLINE } from "@/lib/site";
import { BAND_LABELS, TIER_COLORS, tierFor } from "@/lib/score";

export const runtime = "nodejs";
export const alt = `${SITE_NAME} score card`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const TREND_ARROWS = { improving: "↑", degrading: "↓", stable: "→" } as const;

/**
 * The link preview IS the score card — rendered server-side so a pasted URL
 * in Slack/WhatsApp/X shows the score without anyone clicking through.
 */
export default async function OgImage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const parsed = parseRouteSlug(slug);
  // Cached-only: never trigger a slow HSP fetch just to render a preview. If a
  // route isn't warm yet, fall back to the generic card.
  const outcome = parsed
    ? await getCachedRouteScore(parsed.from, parsed.to, parsed.band)
    : null;
  const result = outcome && outcome.noService === false ? outcome : null;

  if (!result) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0f172a",
            color: "white",
            fontSize: 48,
          }}
        >
          {`${SITE_NAME}: ${STRAPLINE}`}
        </div>
      ),
      size
    );
  }

  const color = TIER_COLORS[tierFor(result.score)];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#f8fafc",
          padding: 56,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            background: "white",
            borderRadius: 32,
            border: "1px solid #e2e8f0",
            padding: 56,
            alignItems: "center",
            gap: 56,
          }}
        >
          {/* Score disc */}
          <div
            style={{
              width: 280,
              height: 280,
              borderRadius: 9999,
              background: color,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: "white",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 120,
                fontWeight: 700,
                lineHeight: 1,
              }}
            >
              {String(result.score)}
            </div>
            <div style={{ display: "flex", fontSize: 24, opacity: 0.85 }}>
              out of 100
            </div>
          </div>

          {/* Route details */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div
              style={{
                display: "flex",
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: 4,
                color: "#94a3b8",
                textTransform: "uppercase",
              }}
            >
              {SITE_NAME}
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 16,
                fontSize: 46,
                fontWeight: 700,
                color: "#0f172a",
                lineHeight: 1.15,
              }}
            >
              {`${result.from.name} → ${result.to.name}`}
            </div>
            <div
              style={{
                marginTop: 12,
                fontSize: 26,
                color: "#64748b",
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <span>{BAND_LABELS[result.band]}</span>
              <span
                style={{
                  color,
                  fontWeight: 700,
                }}
              >
                {`${TREND_ARROWS[result.trend]} ${
                  result.trend === "improving"
                    ? "Improving"
                    : result.trend === "degrading"
                      ? "Getting worse"
                      : "Steady"
                }`}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 24,
                fontSize: 28,
                color: "#334155",
                lineHeight: 1.35,
              }}
            >
              {result.verdict}
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 28,
                fontSize: 20,
                color: "#94a3b8",
              }}
            >
              {STRAPLINE}
            </div>
          </div>
        </div>
      </div>
    ),
    size
  );
}

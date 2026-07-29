import OpenAI from "openai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const bodySchema = z.object({
  message: z.string().trim().min(1).max(2000),
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "ai:chat", 10, 60 * 1000);
  if (limited) return limited;

  // Ties usage to an existing player session rather than leaving this open
  // to anyone who finds the route -- this proxies to a paid, rate-limited
  // third-party API on the app's own key, the same reason every other
  // player-facing route requires this cookie.
  const token = request.cookies.get("river_session")?.value;
  if (!token) return NextResponse.json({ error: "Your profile session expired." }, { status: 401 });

  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Local AI chat is not configured on this deployment." },
        { status: 503 },
      );
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "A message is required." }, { status: 400 });
    }

    // Created only when this route is called, and only after every guard
    // above -- an invalid/rate-limited/unauthenticated request never
    // constructs a client or spends a token against the API key.
    const ai = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const completion = await ai.chat.completions.create({
      model: "openrouter/free",
      messages: [{ role: "user", content: parsed.data.message }],
    });

    return NextResponse.json({
      response: completion.choices[0]?.message?.content ?? "The model returned no response.",
      model: completion.model,
    });
  } catch (error) {
    console.error("OpenRouter error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate response." },
      { status: 500 },
    );
  }
}

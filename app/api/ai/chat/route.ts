import OpenAI from "openai";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { error: "Local AI chat is not configured on this deployment." },
        { status: 503 }
      );
    }

    // Create the client only when this route is called. Keeping it out of
    // module scope lets production builds succeed without local AI credentials.
    const ai = new OpenAI({
      apiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });

    const body = await request.json();
    const message = body.message;

    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json(
        { error: "A message is required." },
        { status: 400 }
      );
    }

    const completion = await ai.chat.completions.create({
      model: "openrouter/free",
      messages: [
        {
          role: "user",
          content: message.trim(),
        },
      ],
    });

    return NextResponse.json({
      response:
        completion.choices[0]?.message?.content ??
        "The model returned no response.",
      model: completion.model,
    });
  } catch (error) {
    console.error("OpenRouter error:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate response.",
      },
      { status: 500 }
    );
  }
}
